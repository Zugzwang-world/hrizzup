import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { type GoogleOutcome, onGoogleOutcome, signInWithGoogle } from '../lib/auth/google.ts';
import { retrySignIn, signOut, useSignIn } from '../lib/auth/session.ts';

const GOOGLE: Record<GoogleOutcome, string | null> = {
  'signed-in': null,
  cancelled: 'Sign-in was cancelled.',
  refused: 'Sign-in was cancelled or refused.',
  failed: "Google sign-in didn't finish. Try again.",
};

/**
 * The sign-in test (PLAN.md step 1.6b): a plain place to try the app's sign-in on staging, as
 * the website's sign-in test page is. There's no password anywhere. The real sign-in screen comes
 * from the design chat.
 */
export function SignInTest() {
  const dark = useColorScheme() === 'dark';
  const colors = {
    ink: dark ? '#f2f0ea' : '#1d1f24',
    muted: dark ? '#b3b6bd' : '#5f636b',
    line: dark ? '#3a3d44' : '#d9d6cf',
  };
  const signIn = useSignIn();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => onGoogleOutcome((outcome) => setMessage(GOOGLE[outcome])), []);
  // Signed in, no word about an earlier try (say, a cancel that ended after the sign-in).
  useEffect(() => {
    if (signIn.state === 'signed-in') setMessage(null);
  }, [signIn.state]);

  async function google() {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(GOOGLE[await signInWithGoogle()]);
    } finally {
      setBusy(false);
    }
  }

  async function out() {
    setBusy(true);
    setMessage(null);
    try {
      if (!(await signOut())) setMessage("You couldn't be signed out just now. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View testID="sign-in-test" style={[styles.section, { borderColor: colors.line }]}>
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.ink }]}>
        Sign-in test
      </Text>
      <Text style={[styles.note, { color: colors.muted }]}>
        For checking sign-in on staging. The real sign-in screen comes later.
      </Text>

      {message && signIn.state !== 'signed-in' && (
        <Text
          testID="sign-in-message"
          accessibilityLiveRegion="polite"
          style={[styles.message, { color: colors.ink }]}
        >
          {message}
        </Text>
      )}

      {signIn.state === 'checking' && (
        <Text style={[styles.note, { color: colors.muted }]}>Checking sign-in…</Text>
      )}

      {signIn.state === 'unavailable' && (
        <>
          <Text testID="sign-in-unavailable" style={[styles.note, { color: colors.ink }]}>
            Sign-in can't be reached right now.
          </Text>
          <Choice label="Try again" onPress={retrySignIn} colors={colors} />
        </>
      )}

      {signIn.state === 'signed-out' && (
        <>
          <Text testID="signed-out" style={[styles.status, { color: colors.ink }]}>
            You're signed out
          </Text>
          <Choice
            testID="google-button"
            label="Continue with Google"
            onPress={google}
            disabled={busy}
            colors={colors}
          />
        </>
      )}

      {signIn.state === 'signed-in' && (
        <>
          <Text testID="signed-in" style={[styles.status, { color: colors.ink }]}>
            You're signed in
          </Text>
          <Text testID="signed-in-email" style={[styles.note, { color: colors.ink }]}>
            {signIn.session.user.email}
          </Text>
          <Choice
            testID="sign-out-button"
            label="Sign out"
            onPress={out}
            disabled={busy}
            colors={colors}
          />
        </>
      )}
    </View>
  );
}

type Colors = { ink: string; muted: string; line: string };

/** A plain button: stock look, at least 48 points tall (Android's smallest comfortable target). */
function Choice(props: {
  label: string;
  onPress: () => void;
  colors: Colors;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(props.disabled), busy: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.choice,
        { borderColor: props.colors.line, opacity: pressed || props.disabled ? 0.6 : 1 },
      ]}
    >
      <Text style={[styles.choiceLabel, { color: props.colors.ink }]}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 24, gap: 12 },
  heading: { fontSize: 20, fontWeight: '600' },
  note: { fontSize: 15, lineHeight: 21 },
  status: { fontSize: 17, fontWeight: '600' },
  message: { fontSize: 15, lineHeight: 21 },
  choice: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: 48,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  choiceLabel: { fontSize: 17, fontWeight: '500' },
});
