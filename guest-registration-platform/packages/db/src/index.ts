import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";
export * from "./audit.js";
export * from "./fixtures.js";

let client: PrismaClient | undefined;

/** Lazily constructed singleton so importing @gr/db has no side effects. */
export function getDb(): PrismaClient {
  if (!client) {
    client = new PrismaClient();
  }
  return client;
}

export async function disconnectDb(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}
