A year ago we put a cache in front of every public page and started invalidating it by tag instead of by time. Here is what held up.

## What worked

Tag-based invalidation did what it promised. A typo fix reached readers in seconds, and unrelated pages kept their cached copies for months. The cache hit rate on post pages stayed above ninety-nine percent.

## What surprised us

The pages that changed most were not posts but tag pages, because every new post in a tag changes its list. They are cheap to rebuild, so it did not matter, but it was not what we expected.

## What we would change

We would have written the outbox from the first day. For the first month, announcements were sent directly after the publish, and twice a deploy at the wrong moment left a page stale until the next publish touched it.
