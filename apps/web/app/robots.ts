import type { MetadataRoute } from 'next';

import { appBaseUrl } from '../lib/config';
import { absolute, paths } from '../lib/seo';

/**
 * Crawlers read the public site and nothing else. The studio, previews,
 * sign-in and the app's own API routes are disallowed. Search stays crawlable
 * on purpose: its pages say `noindex`, and a crawler that may not fetch a
 * page never sees that.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/studio', '/preview', '/sign-in', '/api/'] }],
    sitemap: absolute(appBaseUrl, paths.sitemap),
  };
}
