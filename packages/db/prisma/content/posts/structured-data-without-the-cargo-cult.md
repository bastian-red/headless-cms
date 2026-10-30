Structured data is a block of JSON in a page's head that tells search engines what the page is, in a vocabulary they agree on. It can earn richer search results. It is also one of the most copy-pasted parts of the web.

## Two types are enough

A blog post page needs a description of the post, its headline, author, dates and image, and a breadcrumb trail showing where it sits in the site. That is two types. We have audited sites with nine, most of them describing things the page did not contain.

## Generated, not written

The block is generated from the same data that renders the page. The headline in the JSON is the headline on the page. The date is the date of the live revision. Nobody types it, so nobody can let it drift.

## Tested like everything else

Our tests parse the block on every post page and compare its fields to the post. A block that fails to parse, or claims a date the post does not have, fails the build.
