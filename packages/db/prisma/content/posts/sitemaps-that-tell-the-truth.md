A sitemap is a list of the pages a site wants crawled, each with the time it last changed. Crawlers use that time to decide what to fetch again. It only helps if it is true.

## The common lie

Many sitemaps are generated on the fly with every page's last-modified time set to the moment the sitemap was requested. Every page appears to have changed today, every day. Crawlers notice, stop trusting the field, and fall back to their own schedule.

## Our answer

Each post's entry carries the time its current live revision was published. Fixing a typo publishes a new revision, so the time moves. A new comment does not change the post's text, so it does not. The sitemap is rebuilt when a post is published or unpublished, and served as a static file the rest of the time.

## What is not in it

Drafts, scheduled posts, the search page, previews and the studio. A sitemap is a list of pages we want found, so it lists only pages anyone can read.
