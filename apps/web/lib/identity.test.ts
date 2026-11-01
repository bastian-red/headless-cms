import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractTokens, resolve, stripCssComments } from './contrast';

/**
 * The identity lock: "the foundry type specimen" (docs/DESIGN.md, 2026-10-31).
 * Specimen paper and a printer's blue by day, the same sheet under a reading
 * lamp by night; Brygada 1918 / Libre Franklin / Reddit Mono; 1px corners.
 *
 * Read out of the real stylesheet and `app/layout.tsx`. A redesign that drifts
 * compiles, renders and passes every other test; changing the identity means
 * editing this file deliberately.
 */
const APP = join(__dirname, '..', 'app');
const globals = stripCssComments(readFileSync(join(APP, 'globals.css'), 'utf8'));
const layout = readFileSync(join(APP, 'layout.tsx'), 'utf8');

const light = extractTokens(globals, ':root');
export const SURFACES = {
  light,
  dark: {
    ...light,
    ...extractTokens(
      globals.slice(globals.indexOf('@media (prefers-color-scheme: dark)')),
      ':root',
    ),
  },
} as const;

const IDENTITY = {
  light: { '--bg': '#ebdbca', '--accent': '#2e408a', '--radius': '1px' },
  dark: { '--bg': '#2d2213', '--accent': '#afb5ff', '--radius': '1px' },
} as const;

const FONTS = ['Brygada_1918', 'Libre_Franklin', 'Reddit_Mono'];

/**
 * The faces this app loads, by the same rules `web/scripts/identity-distinct.mjs`
 * applies: the names in a `next/font/google` import, plus the `<Face>` directory
 * of every self-hosted `./fonts/<Face>/...` file.
 */
function importedFaces(): string[] {
  const faces = new Set<string>();
  const google = /import\s*\{([^}]*)\}\s*from\s*'next\/font\/google'/.exec(layout);
  for (const name of google?.[1]?.split(',') ?? []) if (name.trim()) faces.add(name.trim());
  for (const m of layout.matchAll(/'\.\/fonts\/([A-Za-z0-9_]+)\//g)) faces.add(m[1]!);
  if (faces.size === 0) throw new Error('layout.tsx loads no typeface the identity checks can see');
  return [...faces].sort();
}

describe('visual identity', () => {
  for (const [scheme, tokens] of Object.entries(IDENTITY)) {
    it.each(Object.entries(tokens))(`${scheme}: %s is %s`, (token, expected) => {
      const palette = SURFACES[scheme as keyof typeof SURFACES];
      const value = token === '--radius' ? palette[token] : resolve(palette, token).toLowerCase();
      expect(value).toBe(expected);
    });
  }

  it('loads exactly the faces this identity is built on', () => {
    expect(importedFaces()).toEqual(FONTS);
  });

  it('self-hosts every face, with its licence beside it, and fetches nothing from Google', () => {
    expect(layout).not.toMatch(/from\s*['"]next\/font\/google['"]/u);
    for (const face of FONTS) {
      const dir = join(APP, 'fonts', face);
      expect(readdirSync(dir).filter((f) => f.endsWith('.woff2')).length, face).toBeGreaterThan(0);
      expect(readFileSync(join(dir, 'OFL.txt'), 'utf8'), face).toMatch(/SIL Open Font License/u);
    }
  });

  it('ships the reading face in roman and italic: prose emphasis is a real italic', () => {
    const files = readdirSync(join(APP, 'fonts', 'Brygada_1918'));
    expect(files.filter((f) => f.endsWith('.woff2')).sort()).toEqual([
      'Brygada1918-latin-wght-italic.woff2',
      'Brygada1918-latin-wght.woff2',
    ]);
    expect(layout).toMatch(
      /Brygada1918-latin-wght-italic\.woff2',\s*weight: '400 700',\s*style: 'italic'/u,
    );
  });

  it('wires each face to the variable the stylesheet reads', () => {
    for (const variable of ['--font-text', '--font-ui', '--font-mono']) {
      expect(layout).toContain(`variable: '${variable}'`);
      expect(globals).toContain(`var(${variable})`);
    }
  });

  it('paints the browser chrome with the canvas in each scheme', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const bg = resolve(SURFACES[scheme], '--bg').toLowerCase();
      expect(layout, `${scheme} theme-color`).toContain(
        `{ media: '(prefers-color-scheme: ${scheme})', color: '${bg}' }`,
      );
    }
  });

  it('spends no status colour on decoration: code is not painted --danger', () => {
    // UX-AUDIT #8: inline code read as an error. --danger and --ok belong to
    // states whose meaning is known (a refused save, a sent comment).
    const codeRules = [...globals.matchAll(/([^{}]*\bcode\b[^{}]*)\{([^}]*)\}/g)];
    expect(codeRules.length).toBeGreaterThan(0);
    for (const [, selector, body] of codeRules) {
      expect(body, selector!.trim()).not.toMatch(/var\(--(danger|ok)\)/u);
    }
  });

  it('draws no shadows: structure is the only ornament', () => {
    expect(globals).not.toMatch(/box-shadow|text-shadow|drop-shadow/u);
  });
});

/**
 * What the rest of the portfolio already spent (001-010). The cross-repo
 * script is the authority (it also checks perceptual distance); this is the
 * half a single repo can check in its own gate.
 */
const SPENT = {
  canvases: [
    '#fafaf8',
    '#101319',
    '#fffdfa',
    '#f6f7f9',
    '#fbf8f3',
    '#f8fafc',
    '#f7f6fb',
    '#12111a',
    '#ecedf0',
    '#191621',
    '#f4f1e8',
    '#15191c',
    '#e4e8e0',
    '#171b17',
    '#ffffff',
    '#1b1b1d',
    '#fbf3ea',
    '#1b1714',
    '#dce8f7',
    '#0b1a35',
    '#0b1220',
    '#14120e',
    '#0d1117',
    '#14120f',
    '#d0d9db',
    '#050a0b',
  ],
  accents: [
    '#4f46e5',
    '#818cf8',
    '#7a2e2e',
    '#1f6feb',
    '#0f766e',
    '#1d4ed8',
    '#6d28d9',
    '#a78bfa',
    '#a01a6d',
    '#f4a3d6',
    '#0d6b85',
    '#63c9e6',
    '#1a6b3c',
    '#6fca90',
    '#4d5c00',
    '#b9c95a',
    '#8a5a00',
    '#e6b450',
    '#b50f2b',
    '#ff6b7d',
    '#86269b',
    '#de88f2',
  ],
  faces: [
    'Fraunces',
    'Inter',
    'Instrument_Serif',
    'Archivo',
    'IBM_Plex_Mono',
    'Source_Serif_4',
    'IBM_Plex_Sans',
    'JetBrains_Mono',
    'Newsreader',
    'Public_Sans',
    'Roboto_Mono',
    'Sora',
    'Manrope',
    'DM_Mono',
    'Literata',
    'Figtree',
    'Azeret_Mono',
    'Spectral',
    'Karla',
    'Red_Hat_Mono',
    'Lora',
    'Hanken_Grotesk',
    'Geist_Mono',
    'Jost',
    'Overpass',
    'Overpass_Mono',
    'Sofia_Sans_Condensed',
    'Chivo',
    'Chivo_Mono',
  ],
  radii: ['10px', '2px', '6px', '4px', '12px', '3px', '16px', '7px', '8px', '0px'],
} as const;

describe('no two projects share an identity', () => {
  it.each(Object.keys(SURFACES))(
    '%s: the canvas and the accent are this project alone',
    (scheme) => {
      const palette = SURFACES[scheme as keyof typeof SURFACES];
      expect(SPENT.canvases).not.toContain(resolve(palette, '--bg').toLowerCase());
      expect(SPENT.accents).not.toContain(resolve(palette, '--accent').toLowerCase());
    },
  );

  it('loads no typeface another project already uses', () => {
    expect(
      importedFaces().filter((face) => (SPENT.faces as readonly string[]).includes(face)),
    ).toEqual([]);
  });

  it('uses a primary radius no sibling uses', () => {
    expect(SPENT.radii as readonly string[]).not.toContain(SURFACES.light['--radius']);
  });
});
