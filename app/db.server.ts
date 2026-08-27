import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

const createPrismaClient = () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }
  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({ adapter });
};

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = createPrismaClient();
  }
}

const prisma = global.prismaGlobal ?? createPrismaClient();

export default prisma;
