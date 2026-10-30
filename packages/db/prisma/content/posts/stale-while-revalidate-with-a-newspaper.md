Think of the paper on your doorstep. It was printed last night. While you read it, the next edition is being set. The paper in your hands is slightly out of date, and that is fine, because a new one is on its way.

## The cache does the same

When a page has been marked as stale, the next reader still gets the copy that was already built, immediately. In the background, a new copy is built. The reader after that gets the new one.

## Why not wait

The alternative is to make the first reader after a change wait while the page is rebuilt. That reader did nothing wrong. Serving them the previous copy for one more request costs almost nothing.

## When stale is not acceptable

For a post that was unpublished, serving one more stale copy would show a page we took down. Unpublishing therefore removes the page outright rather than marking it stale, and the next request gets a not-found page, not a stale one.
