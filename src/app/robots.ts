import type { MetadataRoute } from "next";
export const dynamic = "force-dynamic";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/create"] },
    ...(process.env.APP_URL
      ? { sitemap: `${process.env.APP_URL.replace(/\/$/, "")}/sitemap.xml` }
      : {}),
  };
}
