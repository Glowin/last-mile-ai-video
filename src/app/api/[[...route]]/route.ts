import { handle } from "hono/vercel";
import { app } from "@/server/app";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handle(app);
export const POST = handle(app);
export const DELETE = handle(app);
