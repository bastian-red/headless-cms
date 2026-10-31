/**
 * `/v1/openapi.json`, generated from the zod schemas in `@cms/shared` that the
 * controllers return and the integration suite parses responses with. The
 * document cannot describe fields the API does not send, because there is no
 * second definition to drift.
 *
 * `@asteasolutions/zod-to-openapi` 9.x on zod 4. Components are named with
 * zod's own `.meta({ id })`, not `registry.register()`: register calls
 * `.openapi()`, which `extendZodWithOpenApi` has to patch in, and zod 4 copies
 * methods onto each schema when it is built. `@cms/shared` builds these at
 * import, before any patch could run, so the patch reaches none of them.
 */
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import {
  slugSchema,
  v1CommentListSchema,
  v1CommentQuerySchema,
  v1ErrorSchema,
  v1MovedSchema,
  v1PostListSchema,
  v1PostQuerySchema,
  v1PostSchema,
  v1SearchQuerySchema,
  v1SearchResultSchema,
  v1TagListSchema,
  z,
} from '@cms/shared';

/** Every route the document describes, as `METHOD /path`; the integration suite compares it with the router. */
export const DOCUMENTED_ROUTES = [
  'GET /v1/posts',
  'GET /v1/posts/{slug}',
  'GET /v1/posts/{slug}/comments',
  'GET /v1/search',
  'GET /v1/tags',
] as const;

let cached: ReturnType<OpenApiGeneratorV3['generateDocument']> | null = null;

export function openApiDocument() {
  if (cached !== null) return cached;
  const registry = new OpenAPIRegistry();
  const bearer = registry.registerComponent('securitySchemes', 'apiKey', {
    type: 'http',
    scheme: 'bearer',
    description: 'A content API key (`hcms_...`), issued by an admin in the studio.',
  });
  const security = [{ [bearer.name]: [] }];
  const json = (schema: z.ZodTypeAny, description: string) => ({
    description,
    content: { 'application/json': { schema } },
  });
  const errors = {
    304: { description: 'Not modified: the `If-None-Match` ETag still matches.' },
    401: json(v1ErrorSchema, 'No key, or a key that is unknown or revoked.'),
    429: json(v1ErrorSchema, 'Over the per-key rate limit.'),
  };

  const PostSummaryList = v1PostListSchema.meta({ id: 'PostList' });
  const Post = v1PostSchema.meta({ id: 'Post' });
  const TagList = v1TagListSchema.meta({ id: 'TagList' });
  const SearchResult = v1SearchResultSchema.meta({ id: 'SearchResult' });
  const CommentList = v1CommentListSchema.meta({ id: 'CommentList' });

  registry.registerPath({
    method: 'get',
    path: '/v1/posts',
    summary: 'Live posts, newest first',
    security,
    request: { query: v1PostQuerySchema },
    responses: {
      200: json(PostSummaryList, 'A page of posts.'),
      400: json(v1ErrorSchema, 'A bad query or cursor.'),
      ...errors,
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/v1/posts/{slug}',
    summary: 'One live post, with its body as markdown and as sanitized HTML',
    security,
    request: { params: z.object({ slug: slugSchema }) },
    responses: {
      200: json(Post, 'The post as readers see it (its published revision).'),
      308: json(v1MovedSchema, 'An old slug: `Location` and `slug` name the current one.'),
      404: json(v1ErrorSchema, 'No live post has ever had this address.'),
      410: json(v1ErrorSchema, 'The post was public and has been taken down.'),
      ...errors,
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/v1/posts/{slug}/comments',
    summary: "Readers' comments on a live post that an editor approved, oldest first",
    description:
      'Plain text: render `body` as text, split into paragraphs on blank lines. Pending, rejected ' +
      'and spam comments are never returned.',
    security,
    request: { params: z.object({ slug: slugSchema }), query: v1CommentQuerySchema },
    responses: {
      200: json(CommentList, 'A page of approved comments.'),
      400: json(v1ErrorSchema, 'A bad query or cursor.'),
      404: json(v1ErrorSchema, 'No live post has this address (old slugs included).'),
      ...errors,
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/v1/search',
    summary: 'Live posts matching a query, best first',
    description:
      'Web-search syntax: `"exact phrase"`, `or`, `-without`. A title match always ranks above a ' +
      'body-only match. `snippet` is runs of text with the matched runs flagged; it carries no HTML.',
    security,
    request: { query: v1SearchQuerySchema },
    responses: {
      200: json(SearchResult, 'A page of hits; `total` counts every match.'),
      400: json(v1ErrorSchema, 'An empty or over-long query, or a cursor from another query.'),
      ...errors,
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/v1/tags',
    summary: 'Tags on at least one live post, with how many',
    security,
    responses: { 200: json(TagList, 'Every tag a reader can browse.'), ...errors },
  });

  cached = new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'headless-cms content API',
      version: '1',
      description:
        "Published content only. Every response is computed from a post's published revision; drafts have no field to travel in.",
    },
  });
  return cached;
}
