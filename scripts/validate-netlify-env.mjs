const required = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "SCOPES",
  "DATABASE_URL",
  "DIRECT_URL",
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
const directUrl = new URL(process.env.DIRECT_URL);
if (
  !["postgres:", "postgresql:"].includes(pooledUrl.protocol) ||
  !["postgres:", "postgresql:"].includes(directUrl.protocol) ||
  !pooledUrl.hostname.endsWith(".neon.tech") ||
  !directUrl.hostname.endsWith(".neon.tech")
) {
  throw new Error("DATABASE_URL and DIRECT_URL must be Neon PostgreSQL URLs");
}
if (!pooledUrl.hostname.includes("-pooler")) {
  throw new Error("DATABASE_URL must use the pooled Neon hostname containing -pooler");
}
if (directUrl.hostname.includes("-pooler")) {
  throw new Error("DIRECT_URL must use the direct Neon hostname without -pooler");
}
if (
  pooledUrl.searchParams.get("sslmode") !== "require" ||
  directUrl.searchParams.get("sslmode") !== "require"
) {
  throw new Error("Neon database URLs must include sslmode=require");
}

console.log("Netlify environment configuration is valid");
