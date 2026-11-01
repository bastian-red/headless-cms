import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

import { appBaseUrl } from '../lib/config';
import { SITE } from '../lib/seo';
import './globals.css';

/**
 * The document, the three typefaces, and the skip link.
 *
 * **`auth()` is not called here, and must not be.** A root layout that awaits
 * the session opts every route into dynamic rendering, and this product's
 * public pages are meant to be static (scripts/render-check.mjs holds the matrix).
 * The studio reads the session itself (`lib/session.ts`).
 *
 * The faces, from the type specimen this identity is drawn from (docs/DESIGN.md):
 *
 * - **Brygada 1918** for the reading column and the titles: a text serif
 *   revived from a 1918 Polish foundry specimen, with the sturdy serifs and
 *   open counters a 3,000-word read at 20 px needs. Roman and italic, because
 *   prose emphasis is italic and a synthesized slant is not a real one.
 * - **Libre Franklin** for the specimen label, the masthead, the studio's
 *   controls and tables: a specimen-tradition grotesque (Franklin Gothic),
 *   with tabular figures for word counts and minutes.
 * - **Reddit Mono** for code, slugs and API keys: distinct 0/O and 1/l/I.
 *
 * Self-hosted (variable woff2, latin subset) beside their SIL Open Font
 * License in `app/fonts/<Face>/`, so a build never fetches a font.
 * `lib/identity.test.ts` and `web/scripts/identity-distinct.mjs` read the face
 * names from the `./fonts/<Face>/` paths below.
 *
 * `metadataBase` is the public origin, so every relative Open Graph or
 * canonical URL a page declares resolves against the address readers use.
 */
const text = localFont({
  src: [
    {
      path: './fonts/Brygada_1918/Brygada1918-latin-wght.woff2',
      weight: '400 700',
      style: 'normal',
    },
    {
      path: './fonts/Brygada_1918/Brygada1918-latin-wght-italic.woff2',
      weight: '400 700',
      style: 'italic',
    },
  ],
  display: 'swap',
  variable: '--font-text',
});

const ui = localFont({
  src: [
    {
      path: './fonts/Libre_Franklin/LibreFranklin-latin-wght.woff2',
      weight: '100 900',
      style: 'normal',
    },
  ],
  display: 'swap',
  variable: '--font-ui',
});

const mono = localFont({
  src: [
    { path: './fonts/Reddit_Mono/RedditMono-latin-wght.woff2', weight: '200 900', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata: Metadata = {
  metadataBase: new URL(appBaseUrl),
  title: { default: SITE.name, template: `%s · ${SITE.name}` },
  description:
    'A headless content system with its own blog: markdown, immutable revisions, static pages that update the moment an editor publishes.',
};

/** The browser chrome matches the canvas in each scheme (`--bg`; identity.test.ts pins both). */
export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ebdbca' },
    { media: '(prefers-color-scheme: dark)', color: '#2d2213' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${text.variable} ${ui.variable} ${mono.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
