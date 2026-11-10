import { notFound } from 'next/navigation';
import { signInTestEnabled } from '@/lib/env.ts';

/**
 * The markets sandbox (/sandbox) exists wherever the sign-in test page does, staging, previews and
 * this Mac, and nowhere on production until launch: its pages and its buttons start here, so on
 * production they answer "not found" before reading anything.
 */
export function sandboxOnly(): void {
  if (!signInTestEnabled()) notFound();
}
