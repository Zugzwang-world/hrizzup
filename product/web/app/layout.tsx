import { brand } from '@hrizzup/core';
import { values } from '@hrizzup/design';
import type { Metadata, Viewport } from 'next';
import { fontVariables } from '@/lib/fonts.ts';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://hrizzup.com'),
  title: { default: brand.name, template: `%s · ${brand.name}` },
  description: brand.summary,
  applicationName: brand.name,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The browser's own bars match the page, in light and dark (the design values).
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: values.color.background.light },
    { media: '(prefers-color-scheme: dark)', color: values.color.background.dark },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN" className={fontVariables}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
