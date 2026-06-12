import type { MetadataRoute } from 'next';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nibbin.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/app/', '/api/', '/waitlist/'] },
    sitemap: `${SITE.replace(/\/$/, '')}/sitemap.xml`,
    host: SITE,
  };
}
