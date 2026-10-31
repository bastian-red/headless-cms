import { jsonLdText } from '../lib/seo';

/**
 * Structured data as a script element's text child, never raw HTML (the gate
 * in lib/no-inner-html.test.ts holds that): React writes the text as-is apart from escaping
 * `</script`, and `jsonLdText` escapes every `<`, `>` and `&` besides, so the
 * output is JSON that parses back to `data` and cannot end the element.
 */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json">{jsonLdText(data)}</script>;
}
