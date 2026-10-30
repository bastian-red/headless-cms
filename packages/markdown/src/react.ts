/**
 * The sanitized tree as React elements, for the post page and the studio
 * preview. A subpath of its own (`@cms/markdown/react`) so the API, which only
 * needs text for search, never loads React.
 *
 * This is why the web app never needs `dangerouslySetInnerHTML`: the tree
 * becomes elements directly, and React escapes every text node and attribute
 * on the way out (`apps/web/lib/no-inner-html.test.ts` keeps it that way).
 */
import type { Root } from 'hast';
import { toJsxRuntime, type Components } from 'hast-util-to-jsx-runtime';
import type { ReactElement } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';

export type { Components };

/**
 * `components` replaces an element by tag, e.g. `{ a: Link }` to route
 * internal links through Next. The replacement receives the sanitized
 * properties as props; it must not reintroduce what the sanitizer removed.
 */
export function toReact(tree: Root, components: Partial<Components> = {}): ReactElement {
  return toJsxRuntime(tree, { Fragment, jsx, jsxs, components, passKeys: true });
}
