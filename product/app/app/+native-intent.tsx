import { finishGoogleReturn } from '../lib/auth/google.ts';
import { isGoogleReturn } from '../lib/auth/google-return.ts';

/**
 * The addresses the app is opened with, before Expo Router reads them as screens. The way back
 * from Google (`hrizzup://auth/callback?code=…`) isn't a screen: the app shows its home, where
 * the sign-in test says how it went. A sign-in that's waiting finishes it itself; when Android had
 * closed the app while the browser was open, it's finished here (lib/auth/google.ts). Never
 * throws: a bad address goes home.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (isGoogleReturn(path)) {
      finishGoogleReturn(path);
      return '/';
    }
    return path;
  } catch {
    return '/';
  }
}
