import { spawn } from "node:child_process";
import { migrate } from "./migrate.mjs";
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error("SESSION_SECRET must contain at least 32 characters.");
  process.exit(1);
}
try {
  const origin = new URL(process.env.APP_URL ?? "");
  if (!["http:", "https:"].includes(origin.protocol)) throw new Error();
} catch {
  console.error("APP_URL must be a valid HTTP(S) origin.");
  process.exit(1);
}
try {
  await migrate();
} catch {
  console.error("Database migration failed; application will not start.");
  process.exit(1);
}
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("A server command is required");
const child = spawn(command, args, { stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("error", () => process.exit(1));
child.on("exit", (code) => process.exit(code ?? 1));
