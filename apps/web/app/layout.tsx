import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { appBaseUrl } from '../lib/config';
import './globals.css';

/**
 * The document and the skip link.
 *
 * **`auth()` is not called here, and must not be.** A root layout that awaits
 * the session opts every route into dynamic rendering, and this product's
 * public pages are meant to be static (scripts/render-check.mjs holds the matrix).
 * The studio reads the session itself (`lib/session.ts`).
 *
 * No typeface is loaded yet: the scaffold renders in the system face, and the
 * design step self-hosts the chosen faces with `next/font/local` (body face
 * first; it is the product).
 *
 * `metadataBase` is the public origin, so every relative Open Graph or
 * canonical URL a page declares resolves against the address readers use.
 */
export const metadata: Metadata = {
  metadataBase: new URL(appBaseUrl),
  title: { default: 'headless-cms', template: '%s | headless-cms' },
  description:
    'A headless content system with its own blog: markdown, immutable revisions, static pages that update the moment an editor publishes.',
};

/** The browser chrome matches the canvas in each scheme (`--bg` in globals.css). */
export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f4f2' },
    { media: '(prefers-color-scheme: dark)', color: '#161615' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
