import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
let client: ReturnType<typeof postgres> | undefined;
export function database() {
  if (!process.env.DATABASE_URL)
    throw new Error("Database configuration missing");
  client ??= postgres(process.env.DATABASE_URL, {
    max: 4,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return drizzle(client, { schema });
}
export async function closeDatabase() {
  if (client) await client.end();
  client = undefined;
}
