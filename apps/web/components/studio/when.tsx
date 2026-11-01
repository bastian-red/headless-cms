'use client';

import { useEffect, useState } from 'react';

import { utcText, zonedText } from '../../lib/studio/when';

/**
 * An instant, in the viewer's own zone once the page has loaded; in UTC,
 * labelled as such, before that (and without JavaScript). Never a bare time
 * a reader has to guess the zone of.
 */
export function When({ instant }: { instant: string }) {
  const [text, setText] = useState(() => utcText(instant));
  useEffect(() => {
    setText(zonedText(instant, Intl.DateTimeFormat().resolvedOptions().timeZone));
  }, [instant]);
  return <time dateTime={instant}>{text}</time>;
}
