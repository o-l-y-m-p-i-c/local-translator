import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env for local runs. On Netlify, env vars are injected by the platform.
if (!process.env.NETLIFY) {
  try {
    const envPath = resolve(process.cwd(), ".env");
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed
        .slice(eqIdx + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // .env not found — skip; missing vars will be reported below
  }
}

const required = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "SCOPES",
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  throw new Error(`Missing required Netlify environment variables: ${missing.join(", ")}`);
}

const appUrl = new URL(process.env.SHOPIFY_APP_URL);
if (appUrl.protocol !== "https:" || appUrl.pathname !== "/") {
  throw new Error("SHOPIFY_APP_URL must be an HTTPS origin without a path");
}

const pooledUrl = new URL(process.env.DATABASE_URL);
const directUrl = new URL(process.env.DATABASE_URL_UNPOOLED);
if (
  !["postgres:", "postgresql:"].includes(pooledUrl.protocol) ||
  !["postgres:", "postgresql:"].includes(directUrl.protocol) ||
  !pooledUrl.hostname.endsWith(".neon.tech") ||
  !directUrl.hostname.endsWith(".neon.tech")
) {
  throw new Error("DATABASE_URL and DATABASE_URL_UNPOOLED must be Neon PostgreSQL URLs");
}
if (!pooledUrl.hostname.includes("-pooler")) {
  throw new Error("DATABASE_URL must use the pooled Neon hostname containing -pooler");
}
if (directUrl.hostname.includes("-pooler")) {
  throw new Error("DATABASE_URL_UNPOOLED must use the direct Neon hostname without -pooler");
}
if (
  pooledUrl.searchParams.get("sslmode") !== "require" ||
  directUrl.searchParams.get("sslmode") !== "require"
) {
  throw new Error("Neon database URLs must include sslmode=require");
}

console.log("Netlify environment configuration is valid");
