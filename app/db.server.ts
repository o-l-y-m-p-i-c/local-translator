import { parseEnv } from "@neon/env";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";
import neonConfig from "../neon";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

const createPrismaClient = () => {
  const { postgres } = parseEnv(neonConfig, ["DATABASE_URL"]);
  const adapter = new PrismaNeon({ connectionString: postgres.databaseUrl });
  return new PrismaClient({ adapter });
};

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = createPrismaClient();
  }
}

const prisma = global.prismaGlobal ?? createPrismaClient();

export default prisma;
