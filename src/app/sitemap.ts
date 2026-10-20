import type { MetadataRoute } from "next";
import { families } from "@/lib/models";
export const dynamic = "force-dynamic";
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.APP_URL?.replace(/\/$/, "");
  if (!base) return [];
  return ["", "/build", ...families.map((f) => `/models/${f.slug}`)].map(
    (path) => ({ url: base + path }),
  );
}
