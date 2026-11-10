import { CryptoDigestAlgorithm, digest, getRandomValues } from 'expo-crypto';

/**
 * The two Web Crypto calls Supabase's sign-in needs for Google (PKCE: a random code verifier and
 * its SHA-256 challenge), from Expo's native crypto, since the app's JavaScript engine (Hermes)
 * has no Web Crypto of its own. Without them Supabase would make the verifier with Math.random and
 * send it as its own challenge ("plain"), which no one should ship. Imported before the sign-in
 * client is made (lib/auth/client.ts); where the engine has either call, it's left as it is.
 */

type WebCrypto = {
  getRandomValues?: typeof getRandomValues;
  subtle?: { digest: (algorithm: string, data: BufferSource) => Promise<ArrayBuffer> };
};

const ALGORITHMS: Record<string, CryptoDigestAlgorithm> = {
  'SHA-256': CryptoDigestAlgorithm.SHA256,
};

const scope = globalThis as unknown as { crypto?: WebCrypto };
scope.crypto ??= {};
scope.crypto.getRandomValues ??= getRandomValues;
scope.crypto.subtle ??= {
  digest: (algorithm, data) => {
    const known = ALGORITHMS[algorithm.toUpperCase()];
    if (!known) return Promise.reject(new Error(`Digest ${algorithm} isn't available here`));
    return digest(known, data);
  },
};
