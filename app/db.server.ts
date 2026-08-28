import { parseEnv } from "@neon/env";
import { PrismaNeon, PrismaNeonHTTP } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";
import neonConfig from "../neon";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

const createPrismaClient = () => {
  const { postgres } = parseEnv(neonConfig, ["DATABASE_URL"]);
  // In serverless environments (Netlify Functions), use HTTP-based driver
  // to avoid WebSocket connection issues. In development, use the WebSocket
  // pool for better performance with concurrent queries.
  const isServerless = Boolean(process.env.NETLIFY) || process.env.NODE_ENV === "production";
  const adapter = isServerless
    ? new PrismaNeonHTTP(postgres.databaseUrl, {})
    : new PrismaNeon({ connectionString: postgres.databaseUrl });
  return new PrismaClient({ adapter });
};

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = createPrismaClient();
  }
}

const prisma = global.prismaGlobal ?? createPrismaClient();

export default prisma;
