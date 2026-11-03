import type { MetadataRoute } from 'next';
import { currentEnvironment } from '@/lib/env.ts';

/** Search engines may read the live site's public pages; nothing outside production. */
export default function robots(): MetadataRoute.Robots {
  if (currentEnvironment() !== 'production') return { rules: { userAgent: '*', disallow: '/' } };
  return { rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/auth/', '/sign-in-test'] } };
}
