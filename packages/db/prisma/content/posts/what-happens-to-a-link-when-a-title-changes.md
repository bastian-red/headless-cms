This post was published under a different title and a different address. We renamed it a day later because the first title was vague. If you followed an old link to get here, you were redirected, and that is what this post is about.

## The redirect

When a published post's slug changes, the old slug is stored as a redirect pointing at the post. A request for the old address answers with a permanent redirect to the new one. Browsers follow it without the reader noticing, and search engines move their records to the new address.

## Permanent, and the right kind

We answer with status 308, a permanent redirect that keeps the request method. Search engines read it as "this page has moved for good" and carry its standing across.

## Chains

If a post is renamed twice, both old slugs point at the post itself, not at each other. A reader is never sent through a chain of hops, and a crawler never gives up halfway.
