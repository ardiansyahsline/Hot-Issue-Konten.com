import type { MetadataRoute } from "next";

// Web internal: jangan diindeks mesin pencari
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
