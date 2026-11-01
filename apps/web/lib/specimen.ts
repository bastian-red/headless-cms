/**
 * The specimen label: what a post costs to read, and how it is set.
 *
 * The setting is not a description someone keeps in sync by hand. Every
 * number here is the one the stylesheet sets the reading column with, and
 * `specimen.test.ts` parses `app/globals.css` and `app/layout.tsx` to prove it:
 * the face is the `--font-text` file's family, 20 is `--reading-size`, 32 is
 * `--reading-size` times `--reading-leading`, 66 is `--measure`. Change one
 * side alone and the gate fails, so the label cannot claim a setting the page
 * does not have. The e2e suite then reads the same numbers back from the
 * rendered page (`specimen.spec.ts`).
 *
 * The measure is only claimed where it is true: the column is 66 characters
 * wide when the sheet has room for its margin, and narrower on a phone, where
 * the label folds and the measure is not shown.
 */
export const READING = {
  face: 'Brygada 1918',
  sizePx: 20,
  leadingPx: 32,
  measureCh: 66,
} as const;

export interface Specimen {
  /** "3,418 words" */
  readonly words: string;
  /** "15" (the numeral) and "min" are set apart; this is the whole phrase. */
  readonly minutes: string;
  readonly face: string;
  /** "20/32": type size on line spacing, in px, as a specimen sheet prints it. */
  readonly setting: string;
  /** What "20/32" means, for a reader who does not set type. */
  readonly settingLong: string;
  /** "66 characters a line" */
  readonly measure: string;
}

export function specimen(words: number, readingMinutes: number): Specimen {
  return {
    words: `${words.toLocaleString('en')} ${words === 1 ? 'word' : 'words'}`,
    minutes: `${String(readingMinutes)} min`,
    face: READING.face,
    setting: `${String(READING.sizePx)}/${String(READING.leadingPx)}`,
    settingLong: `${String(READING.sizePx)} px type on a ${String(READING.leadingPx)} px line`,
    measure: `${String(READING.measureCh)} characters a line`,
  };
}
