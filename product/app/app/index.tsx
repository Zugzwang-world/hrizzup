import { brand } from '@hrizzup/core';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** The app's only screen for now: an empty shell that shares the website's words. */
export default function Home() {
  const dark = useColorScheme() === 'dark';
  const ink = dark ? '#f2f0ea' : '#1d1f24';
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: dark ? '#16181c' : '#fbfaf7' }]}>
      <View style={styles.content}>
        <Text style={[styles.name, { color: ink }]}>{brand.name}</Text>
        <Text style={[styles.headline, { color: ink }]}>{brand.headline}</Text>
        <Text style={[styles.note, { color: dark ? '#b3b6bd' : '#5f636b' }]}>
          {brand.availability}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 16 },
  name: { fontSize: 40, fontWeight: '600' },
  headline: { fontSize: 24, lineHeight: 30 },
  note: { fontSize: 17, lineHeight: 24 },
});
