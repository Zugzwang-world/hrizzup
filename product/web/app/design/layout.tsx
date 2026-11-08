import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { designPagesEnabled } from '@/lib/env.ts';

export const metadata: Metadata = {
  title: { default: 'Design', template: '%s · Design · Hrizzup' },
  robots: { index: false, follow: false },
};

/**
 * The design pages (PLAN.md step 1.4): the founder judges the design here, on a pull request's
 * preview or on this Mac. They don't exist on staging or production.
 */
export default function DesignLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!designPagesEnabled()) notFound();
  return children;
}
