/**
 * The way back from Google (PLAN.md step 1.6b): the app's own address, which Supabase sends the
 * phone's browser to once Google has answered, carrying a one-time code (or Google's refusal).
 * It's on staging's sign-in allow-list (infra/supabase/auth/settings.json). A custom address can
 * be claimed by another app too, which is why the sign-in uses PKCE: the code is useless without
 * the verifier only this app holds. Pure, so it's tested without a phone.
 */
export const GOOGLE_RETURN = 'hrizzup://auth/callback';

/** Whether an address the app was opened with is the way back from Google. */
export function isGoogleReturn(address: string): boolean {
  return /^(?:hrizzup:\/\/|\/)?auth\/callback(?:[?#]|$)/.test(address);
}

export type GoogleReturn =
  | { kind: 'code'; code: string }
  | { kind: 'refused' }
  | { kind: 'nothing' };

/**
 * What the way back carries: the one-time code, Google's or Supabase's refusal (someone pressed
 * Cancel), or nothing usable. Supabase puts both in the query; the fragment is read too.
 */
export function readGoogleReturn(address: string): GoogleReturn {
  if (!isGoogleReturn(address)) return { kind: 'nothing' };
  const query = address.split('#')[0]?.split('?')[1] ?? '';
  const fragment = address.split('#')[1] ?? '';
  const params = new URLSearchParams(query);
  for (const [name, value] of new URLSearchParams(fragment)) {
    if (!params.has(name)) params.set(name, value);
  }
  const code = params.get('code');
  if (code && /^[A-Za-z0-9_-]{1,512}$/.test(code)) return { kind: 'code', code };
  if (params.has('error') || params.has('error_code')) return { kind: 'refused' };
  return { kind: 'nothing' };
}
