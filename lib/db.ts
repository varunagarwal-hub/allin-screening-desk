import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type DB = ReturnType<typeof drizzle<typeof schema>>;
let _db: DB | null = null;

/** Lazily create the Drizzle client so builds don't fail without DATABASE_URL. */
export function db(): DB {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  _db = drizzle({ client: neon(url), schema, casing: "snake_case" });
  return _db;
}

export function hasDb() {
  return Boolean(process.env.DATABASE_URL);
}

export { schema };
