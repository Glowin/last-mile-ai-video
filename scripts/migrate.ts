// Compatibility for existing local runbooks; runtime Docker entrypoint uses plain JS.
import { migrate } from "./migrate.mjs";
await migrate();
console.log("Database migrations complete.");
