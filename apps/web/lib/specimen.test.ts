import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractTokens, stripCssComments } from './contrast';
import { READING, specimen } from './specimen';

/**
 * The specimen label prints how the reading column is set. This gate makes
 * the claim true by construction: every number in `READING` is read back out
 * of the real stylesheet and layout, and the `.prose` rule is proven to use
 * exactly those tokens. Change the CSS and not the label (or the reverse) and
 * this fails before a reader ever sees a label that lies.
 */
const APP = join(__dirname, '..', 'app');
const css = stripCssComments(readFileSync(join(APP, 'globals.css'), 'utf8'));
const layout = readFileSync(join(APP, 'layout.tsx'), 'utf8');
const root = extractTokens(css, ':root');

const ROOT_PX = 16;

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`, 'u').exec(css);
  if (match === null) throw new Error(`globals.css has no ${selector} rule`);
  return Object.fromEntries(
    match[1]!
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]),
  );
}

function rem(value: string): number {
  const m = /^([\d.]+)rem$/u.exec(value);
  if (m === null) throw new Error(`${value} is not a rem length`);
  return Number(m[1]) * ROOT_PX;
}

/** "./fonts/Brygada_1918/..." under the localFont whose variable is `variable`. */
function faceOf(variable: string): string {
  const block = layout
    .split('localFont(')
    .slice(1)
    .find((b) => b.includes(`variable: '${variable}'`));
  const dir = block === undefined ? null : /'\.\/fonts\/([A-Za-z0-9_]+)\//u.exec(block);
  if (dir === null) throw new Error(`layout.tsx loads no ./fonts/ face as ${variable}`);
  return dir[1]!.replaceAll('_', ' ');
}

describe('the specimen label tells the truth about the column', () => {
  const prose = rule('.prose');

  it('the column is set with the reading tokens, not with literals', () => {
    expect(prose['font-family']).toBe('var(--face-text)');
    expect(prose['font-size']).toBe('var(--reading-size)');
    expect(prose['line-height']).toBe('var(--reading-leading)');
    expect(prose['max-width']).toBe('var(--measure)');
  });

  it('the face is the file --font-text loads, first in --face-text', () => {
    expect(root['--face-text']!.startsWith('var(--font-text),')).toBe(true);
    expect(faceOf('--font-text')).toBe(READING.face);
  });

  it('the size, the leading and the measure are the stylesheet’s', () => {
    expect(rem(root['--reading-size']!)).toBe(READING.sizePx);
    expect(rem(root['--reading-size']!) * Number(root['--reading-leading'])).toBe(
      READING.leadingPx,
    );
    expect(root['--measure']).toBe(`${String(READING.measureCh)}ch`);
  });

  it('no rule elsewhere resets the column’s size or leading', () => {
    // A later `.prose { font-size: ... }` would win the cascade and leave the
    // first rule, and the label, describing a setting nobody sees.
    const later = [...css.matchAll(/(?:^|[}\s])\.prose\s*\{([^}]*)\}/gu)].slice(1);
    for (const [, body] of later) expect(body).not.toMatch(/font-size|line-height|font-family/u);
  });
});

describe('specimen()', () => {
  // Expected strings typed from running toLocaleString('en') on these inputs.
  it('says the length in words and the time in minutes', () => {
    expect(specimen(3418, 15)).toEqual({
      words: '3,418 words',
      minutes: '15 min',
      face: 'Brygada 1918',
      setting: '20/32',
      settingLong: '20 px type on a 32 px line',
      measure: '66 characters a line',
    });
  });

  it('says one word, not one words', () => {
    expect(specimen(1, 1).words).toBe('1 word');
    expect(specimen(0, 1).words).toBe('0 words');
  });
});
