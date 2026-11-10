import { brand } from '@hrizzup/core';
import { ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiAnswer } from '../components/api-answer.tsx';
import { SignInTest } from '../components/sign-in-test.tsx';
import { markFirstContent } from '../lib/startup.ts';

/**
 * The app's only screen for now: an empty shell that shares the website's words, shows what the
 * typed API answers (components/api-answer.tsx), and, below, the sign-in test (PLAN.md step
 * 1.6b). It scrolls, so it fits any phone at any text size.
 */
export default function Home() {
  const dark = useColorScheme() === 'dark';
  const ink = dark ? '#f2f0ea' : '#1d1f24';
  return (
    <SafeAreaView
      testID="home"
      onLayout={markFirstContent}
      style={[styles.screen, { backgroundColor: dark ? '#16181c' : '#fbfaf7' }]}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <Text testID="home-name" style={[styles.name, { color: ink }]}>
            {brand.name}
          </Text>
          <Text testID="home-headline" style={[styles.headline, { color: ink }]}>
            {brand.headline}
          </Text>
          <Text testID="home-note" style={[styles.note, { color: dark ? '#b3b6bd' : '#5f636b' }]}>
            {brand.availability}
          </Text>
          <ApiAnswer color={dark ? '#b3b6bd' : '#5f636b'} />
        </View>
        <SignInTest />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 32,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  content: { gap: 16 },
  name: { fontSize: 40, fontWeight: '600' },
  headline: { fontSize: 24, lineHeight: 30 },
  note: { fontSize: 17, lineHeight: 24 },
});
