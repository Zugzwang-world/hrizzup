import { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { checkCode, requestCode } from '../lib/auth/email.ts';
import {
  CODE_LENGTH,
  CODE_MINUTES,
  cleanCode,
  cleanEmail,
  codeFormatMessage,
  SEND_MESSAGES,
  VERIFY_MESSAGES,
} from '../lib/auth/email-code.ts';
import { BotCheck, type BotCheckHandle } from './bot-check.tsx';
import { Choice, type Colors } from './choice.tsx';

type Step =
  | { kind: 'address' }
  | { kind: 'code'; email: string; codeLength: number; minutes: number; sent: boolean };

/**
 * "Email me a code" on the sign-in test (PLAN.md step 1.6b): the address, with the bot check in
 * a small web view running while it's typed; then the code from the email, typed here and
 * checked with Supabase (lib/auth/email.ts). A click before the bot check has answered waits for
 * it, then sends. Someone who already has a code (asked for a minute ago, or on the website) can
 * go straight to typing it. Each bot check answer works once, so any refused request starts a
 * new check.
 */
export function EmailCodeSignIn({ colors, onCancel }: { colors: Colors; onCancel(): void }) {
  const botCheck = useRef<BotCheckHandle>(null);
  const answer = useRef<string | null>(null);
  const sendWhenReady = useRef(false);
  // Set at once, before the screen catches up, so a quick second tap can't start a second request.
  const working = useRef(false);
  const [step, setStep] = useState<Step>({ kind: 'address' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);

  async function send(address: string) {
    const botAnswer = answer.current;
    if (!botAnswer || working.current) return;
    answer.current = null; // it works once, whatever happens next
    sendWhenReady.current = false;
    working.current = true;
    setBusy(true);
    setMessage('Sending your code…');
    const result = await requestCode(address, botAnswer);
    working.current = false;
    setBusy(false);
    if (result.outcome === 'sent') {
      setMessage(null);
      setCode('');
      setStep({
        kind: 'code',
        email: result.sent.email,
        codeLength: result.sent.codeLength,
        minutes: result.sent.minutes,
        sent: true,
      });
      return;
    }
    setMessage(SEND_MESSAGES[result.outcome]);
    botCheck.current?.restart();
  }

  function askForCode() {
    const address = cleanEmail(email);
    if (!address) {
      setMessage(SEND_MESSAGES['invalid-email']);
      return;
    }
    if (working.current) return;
    if (answer.current) {
      void send(address);
      return;
    }
    sendWhenReady.current = true;
    setMessage(checkFailed ? SEND_MESSAGES.failed : "Checking you're not a bot…");
  }

  function haveCode() {
    const address = cleanEmail(email);
    if (!address) {
      setMessage(SEND_MESSAGES['invalid-email']);
      return;
    }
    setMessage(null);
    setCode('');
    setStep({
      kind: 'code',
      email: address,
      codeLength: CODE_LENGTH,
      minutes: CODE_MINUTES,
      sent: false,
    });
  }

  async function signIn(email: string, codeLength: number) {
    const typed = cleanCode(code, codeLength);
    if (!typed) {
      setMessage(codeFormatMessage(codeLength));
      return;
    }
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setMessage('Checking your code…');
    const outcome = await checkCode(email, typed);
    working.current = false;
    setBusy(false);
    // Signed in, the sign-in test shows who's signed in in place of this.
    setMessage(outcome === 'signed-in' ? null : VERIFY_MESSAGES[outcome]);
  }

  function startAgain() {
    answer.current = null;
    sendWhenReady.current = false;
    setCheckFailed(false);
    setMessage(null);
    setStep({ kind: 'address' });
  }

  const inputStyle = [styles.input, { color: colors.ink, borderColor: colors.line }];
  const say = message && (
    <Text
      testID="email-code-message"
      accessibilityLiveRegion="polite"
      style={[styles.note, { color: colors.ink }]}
    >
      {message}
    </Text>
  );

  if (step.kind === 'code') {
    return (
      <View testID="code-step" style={styles.part}>
        <Text style={[styles.note, { color: colors.ink }]}>
          {step.sent ? 'We emailed a code to ' : 'Type the code we emailed to '}
          <Text testID="code-sent-to" style={styles.strong}>
            {step.email}
          </Text>
          . It has {step.codeLength} digits and works for {step.minutes} minutes.
        </Text>
        <Text style={[styles.label, { color: colors.ink }]}>Code</Text>
        <TextInput
          testID="code-input"
          accessibilityLabel="Code"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={step.codeLength + 4}
          returnKeyType="done"
          onSubmitEditing={() => void signIn(step.email, step.codeLength)}
          style={[inputStyle, styles.code]}
          placeholderTextColor={colors.muted}
        />
        <Choice
          testID="verify-code-button"
          label="Sign in"
          onPress={() => void signIn(step.email, step.codeLength)}
          disabled={busy}
          colors={colors}
        />
        {say}
        <Choice
          testID="start-again-button"
          label="Use another email, or get a new code"
          onPress={startAgain}
          disabled={busy}
          colors={colors}
          plain
        />
      </View>
    );
  }

  return (
    <View testID="address-step" style={styles.part}>
      <Text style={[styles.label, { color: colors.ink }]}>Email address</Text>
      <TextInput
        testID="email-input"
        accessibilityLabel="Email address"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={254}
        returnKeyType="send"
        onSubmitEditing={askForCode}
        style={inputStyle}
        placeholderTextColor={colors.muted}
      />
      <BotCheck
        ref={botCheck}
        onAnswer={(value) => {
          answer.current = value;
          setCheckFailed(false);
          if (sendWhenReady.current) {
            sendWhenReady.current = false;
            const address = cleanEmail(email);
            if (address) void send(address);
          }
        }}
        onExpired={() => {
          answer.current = null;
        }}
        onError={() => {
          answer.current = null;
          setCheckFailed(true);
          if (sendWhenReady.current) {
            sendWhenReady.current = false;
            setMessage("The bot check couldn't run. Check your connection, then try again.");
          }
        }}
      />
      <Choice
        testID="send-code-button"
        label="Email me a code"
        onPress={askForCode}
        disabled={busy}
        colors={colors}
      />
      {say}
      {checkFailed && (
        <Choice
          testID="bot-check-again-button"
          label="Start the bot check again"
          onPress={() => {
            setCheckFailed(false);
            botCheck.current?.restart();
          }}
          colors={colors}
          plain
        />
      )}
      <Choice
        testID="have-code-button"
        label="I already have a code"
        onPress={haveCode}
        disabled={busy}
        colors={colors}
        plain
      />
      <Choice
        testID="cancel-email-button"
        label="Back"
        onPress={onCancel}
        disabled={busy}
        colors={colors}
        plain
      />
    </View>
  );
}

const styles = StyleSheet.create({
  part: { gap: 12 },
  note: { fontSize: 15, lineHeight: 21 },
  strong: { fontWeight: '600' },
  label: { fontSize: 15, fontWeight: '500' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 17,
  },
  code: { letterSpacing: 4 },
});
