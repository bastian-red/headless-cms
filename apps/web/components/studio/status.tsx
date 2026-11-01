import type { PostStatus } from '@cms/shared';

import { STATUS_UI } from '../../lib/studio/workflow-ui';

/** A post's state: a glyph and a word, never colour alone. */
export function Status({ status }: { status: PostStatus }) {
  const ui = STATUS_UI[status];
  return (
    <span className="post-status" data-status={status}>
      <span aria-hidden="true">{ui.glyph} </span>
      {ui.word}
    </span>
  );
}
