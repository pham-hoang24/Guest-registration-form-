import { InMemoryDb } from "./inMemoryDb.js";
import { SqlDb } from "./sqlDb.js";
export { InMemoryDb } from "./inMemoryDb.js";
/**
 * Active DB adapter.
 * - SQL_SERVER set  → SqlDb (Azure SQL with Managed Identity + RLS)
 * - SQL_SERVER unset → InMemoryDb (local dev / tests, no SQL required)
 */
export const db = process.env.SQL_SERVER
    ? new SqlDb()
    : new InMemoryDb();
