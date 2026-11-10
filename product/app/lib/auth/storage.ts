import * as SecureStore from 'expo-secure-store';
import { piecewise } from './pieces.ts';

/**
 * Where the app keeps its sign-in session: Expo's SecureStore, encrypted with a key Android's
 * Keystore holds (iOS: the Keychain), in pieces small enough for it (pieces.ts). On iOS it's
 * readable once the phone has been unlocked after starting, so the session can refresh in the
 * background, and it never moves to another device in a backup; on Android, expo-secure-store
 * keeps it out of backups too (its plugin in app.json).
 *
 * A value that can no longer be read (Android drops the key if the phone's lock is reset) counts
 * as no value, so the person is simply signed out, never stuck.
 */
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const sessionStorage = piecewise({
  get: async (key) => {
    try {
      return await SecureStore.getItemAsync(key, options);
    } catch {
      return null;
    }
  },
  set: (key, value) => SecureStore.setItemAsync(key, value, options),
  delete: (key) => SecureStore.deleteItemAsync(key, options),
});
