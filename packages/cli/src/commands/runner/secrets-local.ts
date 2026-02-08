import http from "node:http";
import readline from "node:readline/promises";

type SecretMap = Record<string, string>;

type StoredSecrets = {
  secrets: SecretMap;
  expiresAt: number;
};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function json(status: number, body: unknown): { status: number; body: string; headers: Record<string, string> } {
  return {
    status,
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  };
}

export class LocalSecretsBuffer {
  private readonly byJob = new Map<string, StoredSecrets>();
  private readonly ttlMs: number;
  private server: http.Server | null = null;
  private reaper: NodeJS.Timeout | null = null;

  constructor(ttlMs = 15 * 60_000) {
    this.ttlMs = Math.max(10_000, ttlMs);
  }

  start(params: { port: number; nonce: string; allowedOrigin?: string }): Promise<void> {
    if (this.server) return Promise.resolve();
    const allowedOrigin = String(params.allowedOrigin || "").trim();
    const nonce = String(params.nonce || "").trim();
    if (!nonce) throw new Error("local secrets nonce required");
    if (!allowedOrigin) throw new Error("local secrets allowedOrigin required");

    this.server = http.createServer(async (req, res) => {
      try {
        const method = req.method || "";
        const pathname = String(req.url || "").split("?")[0] || "/";

        if (method === "OPTIONS") {
          if (allowedOrigin) res.setHeader("access-control-allow-origin", allowedOrigin);
          res.setHeader("access-control-allow-methods", "POST,OPTIONS");
          res.setHeader("access-control-allow-headers", "content-type,x-clawlets-nonce");
          res.statusCode = 204;
          res.end();
          return;
        }

        if (method !== "POST" || pathname !== "/secrets/submit") {
          const out = json(404, { error: "not found" });
          res.writeHead(out.status, out.headers);
          res.end(out.body);
          return;
        }

        const origin = String(req.headers.origin || "").trim();
        if (allowedOrigin && origin !== allowedOrigin) {
          const out = json(403, { error: "origin forbidden" });
          res.writeHead(out.status, out.headers);
          res.end(out.body);
          return;
        }

        const headerNonce = String(req.headers["x-clawlets-nonce"] || "").trim();
        if (headerNonce !== nonce) {
          const out = json(403, { error: "nonce mismatch" });
          res.writeHead(out.status, out.headers);
          res.end(out.body);
          return;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const data = parseJson(Buffer.concat(chunks).toString("utf8"));
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          const out = json(400, { error: "invalid json body" });
          res.writeHead(out.status, out.headers);
          res.end(out.body);
          return;
        }
        const body = data as Record<string, unknown>;
        const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
        const secretsRaw = body.secrets;
        if (!jobId || !secretsRaw || typeof secretsRaw !== "object" || Array.isArray(secretsRaw)) {
          const out = json(400, { error: "jobId and secrets required" });
          res.writeHead(out.status, out.headers);
          res.end(out.body);
          return;
        }
        const secrets: SecretMap = {};
        for (const [key, value] of Object.entries(secretsRaw as Record<string, unknown>)) {
          const name = key.trim();
          if (!name) continue;
          if (typeof value !== "string") continue;
          secrets[name] = value;
        }
        this.byJob.set(jobId, { secrets, expiresAt: Date.now() + this.ttlMs });
        const out = json(200, { ok: true, accepted: Object.keys(secrets).length });
        if (allowedOrigin) out.headers["access-control-allow-origin"] = allowedOrigin;
        res.writeHead(out.status, out.headers);
        res.end(out.body);
      } catch (err) {
        const out = json(500, {
          error: "internal error",
          detail: err instanceof Error ? err.message : String(err),
        });
        res.writeHead(out.status, out.headers);
        res.end(out.body);
      }
    });

    this.reaper = setInterval(() => {
      this.purgeExpired();
    }, Math.min(30_000, Math.max(2_000, Math.floor(this.ttlMs / 4))));
    this.reaper.unref?.();

    return new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(params.port, "127.0.0.1", () => {
        this.server!.off("error", reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.reaper) {
      clearInterval(this.reaper);
      this.reaper = null;
    }
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private purgeExpired(now = Date.now()): void {
    for (const [jobId, row] of this.byJob.entries()) {
      if (row.expiresAt <= now) this.byJob.delete(jobId);
    }
  }

  take(jobId: string): SecretMap | null {
    this.purgeExpired();
    const row = this.byJob.get(jobId);
    if (!row) return null;
    if (row.expiresAt <= Date.now()) {
      this.byJob.delete(jobId);
      return null;
    }
    this.byJob.delete(jobId);
    return row.secrets;
  }

  async waitOrPrompt(params: {
    jobId: string;
    timeoutMs: number;
    allowPrompt: boolean;
  }): Promise<SecretMap> {
    const start = Date.now();
    while (Date.now() - start < params.timeoutMs) {
      this.purgeExpired();
      const row = this.take(params.jobId);
      if (row) return row;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!params.allowPrompt) {
      throw new Error("secrets input missing; submit via localhost endpoint or rerun with interactive tty");
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const line = await rl.question("Runner fallback: paste JSON secrets payload and press Enter:\n");
      const parsed = parseJson(line);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("invalid JSON payload");
      }
      const map: SecretMap = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value !== "string") continue;
        const trimmed = key.trim();
        if (!trimmed) continue;
        map[trimmed] = value;
      }
      return map;
    } finally {
      rl.close();
    }
  }
}
