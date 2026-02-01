import alchemy from "alchemy";
import { TanStackStart } from "alchemy/cloudflare";

const stage = process.env.STAGE || "dev";
const alchemyPassword = process.env.ALCHEMY_PASSWORD;

if (!alchemyPassword) {
  throw new Error("Missing ALCHEMY_PASSWORD. Set it in .env.local (any random string works)");
}

const app = await alchemy("clawlets-docs", {
  stage,
  password: alchemyPassword,
});

const prodDomains = ["docs.clawlets.com"];
const prodRoutes = prodDomains.map((domain) => `${domain}/*`);

export const website = await TanStackStart("website", {
  name: `clawlets-docs-${app.stage}`,
  routes: app.stage === "prod" ? prodRoutes : undefined,
  adopt: true,
  dev: {
    command: "vite dev --port 5174",
  },
});

console.log({ url: website.url });

await app.finalize();
