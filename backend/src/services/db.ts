import { InMemoryDb } from "./inMemoryDb.js";
import { SqlDb } from "./sqlDb.js";
import type { DbAdapter } from "./dbInterface.js";

export type { DbAdapter } from "./dbInterface.js";
export type { GuestTokenJti, PropertyMembership } from "./dbInterface.js";
export { InMemoryDb } from "./inMemoryDb.js";

/**
 * Active DB adapter.
 * - SQL_SERVER set  → SqlDb (Azure SQL with Managed Identity + RLS)
 * - SQL_SERVER unset → InMemoryDb (local dev / tests, no SQL required)
 */
export const db: DbAdapter = process.env.SQL_SERVER
  ? new SqlDb()
  : new InMemoryDb();
