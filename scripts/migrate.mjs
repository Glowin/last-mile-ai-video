import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

export async function migrate(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("Set DATABASE_URL outside the checkout.");
  const client = postgres(url, { max: 1, connect_timeout: 10 });
  try {
    await client.begin(async (tx) => {
      // One atomic, serialized upgrade. Safe for both legacy volumes and replicas.
      await tx`SELECT pg_advisory_xact_lock(7421912)`;
      await tx`CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
      )`;
      const files = (await readdir(new URL("../db/", import.meta.url)))
        .filter((f) => /^\d{4}-.+\.sql$/.test(f))
        .sort();
      for (const name of files) {
        const source = await readFile(
          new URL(`../db/${name}`, import.meta.url),
          "utf8",
        );
        const checksum = createHash("sha256").update(source).digest("hex");
        const [applied] =
          await tx`SELECT checksum FROM schema_migrations WHERE name=${name}`;
        if (applied) {
          if (applied.checksum !== checksum)
            throw new Error(`Applied migration changed: ${name}`);
          continue;
        }
        await tx.unsafe(source);
        await tx`INSERT INTO schema_migrations(name,checksum) VALUES(${name},${checksum})`;
      }
    });
  } finally {
    await client.end();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await migrate();
    console.log("Database migrations complete.");
  } catch {
    console.error(
      "Database migration failed; application will not start. Check database access and migration history.",
    );
    process.exitCode = 1;
  }
}
