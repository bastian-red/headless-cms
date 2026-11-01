import type { Rendered } from '@cms/markdown';
import { toReact } from '@cms/markdown/react';
import type { ReactNode } from 'react';

import { SpecimenLabel } from './specimen-label';

/**
 * A post as readers get it, set as a specimen sheet: the header (title,
 * byline), the specimen label in the margin, then the prose in the reading
 * column. One component for the public post page, the studio's preview page
 * and the editor's live preview, so the preview cannot drift from what is
 * published (product principle 2).
 *
 * The sheet decides wide or narrow by its own width (a container query on
 * `.sheet-host`), not the window's: the editor's preview pane is narrow on a
 * wide screen, and gets the phone's folded label, which is what it can hold.
 *
 * DOM order is the reading order on every width: header, label, prose. The
 * margin is a grid placement, not a reordering.
 */
export function ArticleBody({ rendered, header }: { rendered: Rendered; header: ReactNode }) {
  return (
    <div className="sheet-host">
      <div className="sheet">
        <div className="sheet-header">{header}</div>
        <SpecimenLabel
          words={rendered.words}
          readingMinutes={rendered.readingMinutes}
          outline={rendered.outline}
        />
        <div className="prose">{toReact(rendered.tree)}</div>
      </div>
    </div>
  );
}
