import { Pressable, StyleSheet, Text } from 'react-native';

export type Colors = { ink: string; muted: string; line: string };

/**
 * A plain button for the sign-in test (stock look; the real screens' buttons come from the design
 * chat): at least 48 points tall, Android's smallest comfortable target, and wrapping its words
 * at any text size. `plain` drops the border, for the lesser choices.
 */
export function Choice(props: {
  label: string;
  onPress(): void;
  colors: Colors;
  disabled?: boolean;
  plain?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.choice,
        props.plain ? styles.plain : { borderColor: props.colors.line, borderWidth: 1 },
        { opacity: pressed || props.disabled ? 0.6 : 1 },
      ]}
    >
      <Text
        style={[
          styles.label,
          { color: props.colors.ink },
          props.plain ? styles.plainLabel : styles.boldLabel,
        ]}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  choice: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  plain: { paddingHorizontal: 0 },
  label: { fontSize: 17 },
  boldLabel: { fontWeight: '500' },
  plainLabel: { textDecorationLine: 'underline' },
});
