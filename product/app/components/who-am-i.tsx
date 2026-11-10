import type { Me } from '@hrizzup/api/client';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { orpc } from '../lib/api.ts';
import { Choice, type Colors } from './choice.tsx';

const SIGNED_IN_WITH: Record<Me['signedInWith'], string> = {
  google: 'Google',
  email: 'An email code',
  test_account: 'Test account (staging only)',
  other: 'Another way',
  api_key: 'An API key',
};

/**
 * Who is signed in, as our server sees them: the typed API's `me`, which checks the session's
 * token (sent with personal calls only, lib/api.ts), the same answer the website's sign-in test
 * page shows.
 */
export function WhoAmI({ colors }: { colors: Colors }) {
  const me = useQuery(orpc.me.queryOptions({ retry: 1 }));

  if (me.isPending) {
    return <Text style={[styles.value, { color: colors.muted }]}>Checking who you are…</Text>;
  }
  if (me.isError) {
    return (
      <>
        <Text testID="who-am-i-error" style={[styles.value, { color: colors.ink }]}>
          Hrizzup couldn't say who you are just now.
        </Text>
        <Choice label="Try again" onPress={() => void me.refetch()} colors={colors} plain />
      </>
    );
  }
  return (
    <View testID="who-am-i" style={styles.rows}>
      {me.data.name && (
        <Row label="Name" value={me.data.name} testID="signed-in-name" colors={colors} />
      )}
      <Row label="Email" value={me.data.email ?? '—'} testID="signed-in-email" colors={colors} />
      <Row
        label="Signed in with"
        value={SIGNED_IN_WITH[me.data.signedInWith]}
        testID="signed-in-with"
        colors={colors}
      />
    </View>
  );
}

function Row(props: { label: string; value: string; testID: string; colors: Colors }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: props.colors.muted }]}>{props.label}</Text>
      <Text testID={props.testID} style={[styles.value, { color: props.colors.ink }]}>
        {props.value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  rows: { gap: 12 },
  row: { gap: 2 },
  label: { fontSize: 13 },
  value: { fontSize: 17, lineHeight: 23 },
});
