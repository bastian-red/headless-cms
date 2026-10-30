/**
 * The `rehype-sanitize` schema: GitHub's defaults (the schema github.com uses
 * for READMEs, shipped as `defaultSchema`) narrowed to the policy in
 * `policy.ts`.
 *
 * Narrowed, not widened. GitHub's list covers HTML an author typed; raw HTML is
 * dropped here before sanitizing, so only markdown's own elements remain, and
 * the schemes lose `irc`, `ircs` and `xmpp`. `clobberPrefix` stays, so a
 * footnote id can never shadow a global the page's own script reads.
 */
import { defaultSchema, type Options as Schema } from 'rehype-sanitize';

import { ALLOWED_TAGS, IMAGE_PROTOCOLS, LINK_PROTOCOLS } from './policy.js';

/** Put in front of every id and `aria-describedby` the source produced. */
export const CLOBBER_PREFIX = 'user-content-';

export const SCHEMA: Schema = Object.freeze({
  ...defaultSchema,
  clobberPrefix: CLOBBER_PREFIX,
  // `name` is never emitted by markdown; an id or a reference to one is.
  clobber: ['id', 'ariaDescribedBy', 'ariaLabelledBy'],
  tagNames: [...ALLOWED_TAGS],
  protocols: {
    href: [...LINK_PROTOCOLS],
    src: [...IMAGE_PROTOCOLS],
    cite: [...IMAGE_PROTOCOLS],
  },
  // Without this, rehype-sanitize keeps the text of a removed element. That is
  // right for an unknown inline tag and wrong for these, whose text is code.
  strip: ['script', 'style', 'template', 'noscript', 'iframe', 'textarea', 'title', 'xmp'],
});
