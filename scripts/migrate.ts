import { readFile } from "node:fs/promises";
import postgres from "postgres";
if (!process.env.DATABASE_URL)
  throw new Error("Set DATABASE_URL outside the checkout.");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await sql.unsafe(
    await readFile(new URL("../db/0001-init.sql", import.meta.url), "utf8"),
  );
  console.log("Database migration complete.");
} finally {
  await sql.end();
}
