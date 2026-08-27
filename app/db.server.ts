import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

const databaseUrl = process.env.DATABASE_URL || process.env.NETLIFY_DB_URL;
const createPrismaClient = () => new PrismaClient(
  databaseUrl ? { datasourceUrl: databaseUrl } : undefined,
);

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = createPrismaClient();
  }
}

const prisma = global.prismaGlobal ?? createPrismaClient();

export default prisma;
