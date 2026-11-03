import { brand } from '@hrizzup/core';
import type { Metadata, Viewport } from 'next';
import { Instrument_Serif } from 'next/font/google';
import './globals.css';

const display = Instrument_Serif({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-instrument-serif',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://hrizzup.com'),
  title: { default: brand.name, template: `%s · ${brand.name}` },
  description: brand.summary,
  applicationName: brand.name,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfaf7' },
    { media: '(prefers-color-scheme: dark)', color: '#16181c' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN" className={display.variable}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
