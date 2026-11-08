import type { Health } from '@hrizzup/api/client';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text } from 'react-native';
import { orpc } from '../lib/api.ts';

const PLACES: Record<string, string> = { bom1: 'Mumbai' };

/** The answer in plain words, for the founder's phone and the app's journey test. */
export function describeHealth(health: Health): string {
  const place = PLACES[health.region] ?? health.region;
  const state =
    health.status === 'ok'
      ? 'all working'
      : health.status === 'error'
        ? 'something is down'
        : 'nothing set up yet';
  return `Hrizzup's servers answer: ${state}, from ${place} (${health.environment})`;
}

/**
 * What the typed API's health read answers (PLAN.md step 1.5d), through TanStack Query: shown
 * at once from the phone's copy when there is one, and refreshed in the background.
 */
export function ApiAnswer({ color }: { color: string }) {
  const health = useQuery(orpc.health.queryOptions());
  const text = health.isPending
    ? "Checking Hrizzup's servers…"
    : health.isError
      ? "Hrizzup's servers can't be reached right now"
      : describeHealth(health.data);
  return (
    <Text testID="api-answer" accessibilityLiveRegion="polite" style={[styles.answer, { color }]}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  answer: { fontSize: 15, lineHeight: 21 },
});
