import { specimen } from '../lib/specimen';

export interface OutlineEntry {
  readonly depth: number;
  readonly id: string;
  readonly text: string;
}

/**
 * The specimen label (docs/DESIGN.md): the reader's question, "is this worth
 * my next ten minutes?", answered in the margin before the first paragraph.
 * How it is set, how long it is, how long it takes, and where its sections
 * start.
 *
 * Wide, it is a column of facts beside the reading column, and the contents
 * stay in reach while reading. Narrow (a phone, or the studio's preview
 * pane), the facts fold to one line under the byline and the contents to a
 * disclosure. Both contents lists are in the markup; CSS shows one, and the
 * hidden one is `display: none`, so a screen reader meets exactly one.
 *
 * The numbers are data, never decoration: words and minutes come from the
 * renderer, and the setting from `lib/specimen.ts`, which a gate test holds
 * against the stylesheet.
 */
export function SpecimenLabel({
  words,
  readingMinutes,
  outline,
}: {
  words: number;
  readingMinutes: number;
  outline: readonly OutlineEntry[];
}) {
  const label = specimen(words, readingMinutes);
  const sections = outline.filter((entry) => entry.depth === 2);
  const list =
    outline.length >= 3 && sections.length > 0 ? (
      <ol role="list" className="specimen-list">
        {sections.map((entry) => (
          <li key={entry.id}>
            <a href={`#${entry.id}`}>{entry.text}</a>
          </li>
        ))}
      </ol>
    ) : null;

  return (
    <div className="specimen" data-testid="specimen">
      <dl className="specimen-facts">
        <div className="specimen-fact" data-fact="setting">
          <dt>Set in</dt>
          <dd>
            <span className="specimen-face">{label.face}</span>{' '}
            <abbr className="specimen-setting" title={label.settingLong}>
              {label.setting}
            </abbr>
            <span className="specimen-measure">, {label.measure}</span>
          </dd>
        </div>
        <div className="specimen-fact" data-fact="words">
          <dt>Length</dt>
          <dd>{label.words}</dd>
        </div>
        <div className="specimen-fact" data-fact="minutes">
          <dt>Reading time</dt>
          <dd>
            <span className="specimen-numeral">{String(readingMinutes)}</span> min
          </dd>
        </div>
      </dl>
      {list === null ? null : (
        <>
          <nav aria-label="In this post" className="specimen-contents specimen-contents-wide">
            <h2 className="specimen-heading">In this post</h2>
            {list}
          </nav>
          <details className="specimen-contents specimen-contents-narrow">
            <summary>
              In this post <span className="muted">({String(sections.length)} sections)</span>
            </summary>
            <nav aria-label="In this post">{list}</nav>
          </details>
        </>
      )}
    </div>
  );
}
