import { finishGoogleSignIn } from '../lib/auth/google.ts';
import { isGoogleReturn } from '../lib/auth/google-return.ts';

/**
 * The addresses the app is opened with, before Expo Router reads them as screens. The way back
 * from Google (`hrizzup://auth/callback?code=…`) isn't a screen: its code is traded for the
 * session (lib/auth/google.ts, once per code) and the app shows its home, where the sign-in test
 * says how it went. This also finishes a sign-in when Android had closed the app while the
 * browser was open. Never throws: a bad address goes home.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (isGoogleReturn(path)) {
      void finishGoogleSignIn(path);
      return '/';
    }
    return path;
  } catch {
    return '/';
  }
}
