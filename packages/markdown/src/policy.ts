/**
 * What may reach a reader, written down once.
 *
 * Two things read this file and they are deliberately different code:
 * `schema.ts` turns it into the rules `rehype-sanitize` enforces, and `audit.ts`
 * checks the finished tree against it with its own walk. A sanitizer bug (or a
 * pipeline change that skips the sanitizer) is then caught by the audit, which
 * refuses to return the tree at all.
 */

/**
 * Every element markdown (with GFM) can produce, and nothing else. Raw HTML in
 * the source never becomes an element (it is dropped before this list is
 * consulted), so this is not a list of "safe HTML": it is the exact output
 * vocabulary of the parser.
 */
export const ALLOWED_TAGS = Object.freeze([
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'input',
  'li',
  'ol',
  'p',
  'pre',
  'section',
  'strong',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
] as const);

/**
 * `h1` is missing on purpose: the page's title is its one `h1`, so a body
 * heading starts at `h2` (`render.ts` shifts an author's `#` down a level).
 */
export type AllowedTag = (typeof ALLOWED_TAGS)[number];

/** Schemes a link may use. Anything without a scheme is a path on this site. */
export const LINK_PROTOCOLS = Object.freeze(['http', 'https', 'mailto'] as const);

/** Schemes an image may load from. No `data:`: an SVG data URL can carry script. */
export const IMAGE_PROTOCOLS = Object.freeze(['http', 'https'] as const);

/** Properties (hast names) whose value is a URL the browser may follow or fetch. */
export const URL_PROPERTIES = Object.freeze({
  href: LINK_PROTOCOLS,
  src: IMAGE_PROTOCOLS,
  cite: IMAGE_PROTOCOLS,
} as const);
