type GithubRepoCheck =
  | { ok: true; status: "public" }
  | { ok: true; status: "private-or-missing" }
  | { ok: true; status: "unauthorized" }
  | { ok: true; status: "rate-limited"; detail?: string }
  | { ok: false; status: "network"; detail: string };

function parseGithubFlakeUri(flakeBase: string): { owner: string; repo: string } | null {
  const m = flakeBase.trim().match(/^github:([^/]+)\/([^/]+)(?:\/.*)?$/);
  if (!m) return null;
  const owner = m[1];
  const repo = m[2];
  if (!owner || !repo) return null;
  return { owner, repo };
}

export function tryParseGithubFlakeUri(
  flakeBase: string,
): { owner: string; repo: string } | null {
  return parseGithubFlakeUri(flakeBase);
}

async function readBodyText(res: Response, maxBytes: number): Promise<string> {
  try {
    const buf = new Uint8Array(await res.arrayBuffer());
    const sliced = buf.slice(0, maxBytes);
    return new TextDecoder("utf-8").decode(sliced);
  } catch {
    return "";
  }
}

export async function checkGithubRepoVisibility(params: {
  owner: string;
  repo: string;
  token?: string;
  timeoutMs?: number;
}): Promise<GithubRepoCheck> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(250, params.timeoutMs ?? 4000),
  );

  try {
    const res = await fetch(`https://api.github.com/repos/${params.owner}/${params.repo}`, {
      method: "GET",
      headers: {
        "User-Agent": "clawlets",
        Accept: "application/vnd.github+json",
        ...(params.token ? { Authorization: `Bearer ${params.token}` } : {}),
      },
      signal: controller.signal,
    });

    if (res.status === 200) return { ok: true, status: "public" };
    if (res.status === 401) return { ok: true, status: "unauthorized" };
    if (res.status === 403) {
      const body = await readBodyText(res, 1024);
      return { ok: true, status: "rate-limited", detail: body.trim() || undefined };
    }
    if (res.status === 404) return { ok: true, status: "private-or-missing" };

    const body = await readBodyText(res, 1024);
    return { ok: false, status: "network", detail: `HTTP ${res.status}: ${body.trim()}`.trim() };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, status: "network", detail };
  } finally {
    clearTimeout(timeout);
  }
}
