import type { MetadataRoute } from "next";
import { families } from "@/lib/models";
import { topics } from "@/lib/topics";
export const dynamic = "force-dynamic";
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.APP_URL?.replace(/\/$/, "");
  if (!base) return [];
  return [
    "",
    "/build",
    "/pricing",
    ...families.map((f) => `/models/${f.slug}`),
    ...topics.map((topic) => `/topics/${topic.slug}`),
  ].map((path) => ({ url: base + path }));
}
