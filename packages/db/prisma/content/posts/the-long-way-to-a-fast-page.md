A blog post is the simplest page on the web. It has a title, some paragraphs, maybe a picture and a list of tags. Nothing on it changes while you read it. Nobody needs to be signed in to see it. If any page should be fast without effort, it is this one.

And yet the median article page on a news site still ships more JavaScript than the text of the article, still shifts its own layout twice while you try to start reading, and still asks a server somewhere to rebuild it from a database for every single reader who arrives. None of that is necessary. All of it is the result of small decisions that each looked reasonable on the day.

This post walks through every decision we made for the pages you are reading now, in the order a reader's browser meets them. It is long because the decisions are many, not because any one of them is hard. If you only want the summary, it is this: build the page once, keep it built until something changes, tell the cache exactly what changed, and then get out of the reader's way.

## The page is built before you ask for it

When you opened this post, no code ran to produce it. The HTML you received was written to disk the last time the post changed, and it will be served exactly as it is until the post changes again. That is what static rendering means here: the work of turning markdown into a page happens at publish time, not at read time.

The alternative is rendering on request. A server receives your request, asks the database for the post, turns the markdown into HTML, wraps it in a layout and sends it back. That is not slow, exactly. On a quiet day it takes a few dozen milliseconds. But it is work repeated for every reader, it depends on the database being up, and its cost grows with traffic. The day a post is shared widely is the day the server is busiest, and that is the day you least want it to be doing redundant work.

A static page has none of those properties. Serving it is reading a file. Its cost does not grow with the complexity of the content, only with the number of bytes. It does not depend on the database at all once it is built. If the database is down for maintenance, readers do not notice.

The obvious objection is freshness. If the page is built once, how does it change when an editor fixes a typo? For years the answer was a full rebuild of the site, which is fine for twenty pages and miserable for twenty thousand. The answer we use is narrower: rebuild only the pages that contain what changed, and only when it changes. That needs the cache to know what each page contains, which is the subject of the next section.

There is one page on this site that is not static, and it is worth saying why. Search results depend on what you typed, so they cannot be built ahead of time. The search page renders on every request and tells crawlers not to index it. The studio, where we write, is the other exception: it depends on who you are. Everything a reader can reach without typing is static.

## Every page carries a list of what it contains

Each page we build is tagged with the things it was built from. This post's page carries a tag for the post itself, a tag for each of its tags, and a tag for the list of all posts, because the page shows links to its neighbours. The home page carries the list tag and nothing else. A tag page carries its own tag and the list tag.

When an editor publishes a change, the publishing step does not rebuild anything directly. It announces which tags are now stale. The cache throws away every page carrying one of those tags, and the next reader to ask for one of those pages gets a freshly built copy, which is then kept until the next announcement.

The effect is that a typo fix on one post invalidates that post's page and nothing else. Publishing a new post invalidates the home page, the feed, the sitemap and the pages of the tags it carries. A page that was not affected keeps its built copy indefinitely.

| What changed           | What is rebuilt                                   |
| ---------------------- | ------------------------------------------------- |
| A typo in a live post  | That post's page                                  |
| A new post in two tags | Home, feed, sitemap, both tag pages, the new post |
| A post unpublished     | Its page, home, feed, sitemap, its tag pages      |
| A comment approved     | The post's page                                   |

The important property is that the table above is not a list someone maintains by hand. Each page declares its own tags when it is built, from the data it actually read. If a page starts showing something new, it starts carrying the new tag in the same change. There is no second place to forget.

We wrote more about the distinction between these tags and the tags you see at the bottom of a post in [Tags are cache keys, not categories](/posts/tags-are-cache-keys). The short version is that the same word is doing two jobs, and keeping them apart in the code is what keeps the system honest.

## The announcement survives a crash

The publish step does two things: it changes the post in the database, and it tells the web tier which tags are stale. If those two happened separately, there would be a window in which one had happened and the other had not. A crash in that window would leave a post published in the database and stale on the site, with nothing to notice the difference until someone else published something with an overlapping tag.

So the announcement is not sent during the publish. It is written. In the same database transaction that changes the post, the publish step inserts a row into an outbox table: an event with an id and the list of stale tags. Either both writes commit or neither does. There is no state in which the post changed and the announcement was lost.

A separate process, the publisher, reads undelivered rows from the outbox and delivers them to the web tier over HTTP, signed with a shared secret so nobody else can force our cache to empty. When the web tier confirms, the publisher marks the row delivered. If the web tier is down, the publisher waits and tries again, with increasing gaps between attempts.

That makes delivery at least once, not exactly once, and the web tier is built for it. Each announcement carries its event id, and invalidating a tag twice is harmless anyway: the second invalidation throws away a page that was just rebuilt, which costs one extra render and nothing else. We prefer that to the alternative, where a lost announcement leaves a stale page forever.

Scheduled posts use the same path. An editor sets a time, the publisher holds a delayed job keyed by the revision, and at that time it performs the publish exactly as a person would, outbox row included. Two publisher processes running at once cannot publish twice, because the job id is the revision id and the queue refuses a second job with the same id. We explain that in [Scheduled means exactly once](/posts/scheduled-means-exactly-once).

## The HTML is small because the text is the page

When the page arrives, your browser starts reading the HTML before all of it has arrived. That makes the order of the document matter. Our pages put the title and the first paragraphs of the post near the top of the HTML, after a short head and a small header, so the text you came for is in the first few kilobytes.

The page uses almost no JavaScript. The text, the links, the table of contents and the comment list are all plain HTML. The browser can show them without downloading, parsing or running a script. There is a small script for the comment form, because sending a comment needs one, and it loads after the text is on screen.

We measure this rather than assume it. Our test suite builds the site and checks the size of what each public page ships. If a change adds a dependency that drags a large library into the post page, the test fails with the number of bytes it added. Performance work that is not checked by a test is a promise that expires the first time someone is in a hurry.

The markdown pipeline itself runs at build time and never reaches the browser. It turns the source into an HTML tree, cleans that tree, and hands it to the page as components. No HTML string is ever injected into the page. That is a security decision first, and we wrote about it in [We never render raw HTML](/posts/we-never-render-raw-html), but it is also a size decision: the renderer, with its parsers and its syntax highlighter, stays on the server.

## Fonts arrive without moving the text

Text needs a font, and a web font is a file the browser has to fetch before it can use it. In the meantime the browser draws the text in a fallback font that is already installed. When the web font arrives, the browser swaps it in. If the two fonts have different widths, every line of text rewraps, every paragraph changes height, and everything below the first paragraph jumps. That jump is layout shift, and it is the most common reason a reader loses their place in the first second.

Three things keep our text still. First, the fonts are served from our own origin, so there is no extra connection to a font service to set up before the download can start. Second, the HTML tells the browser about the body font early, so the download starts while the rest of the page is still arriving. Third, and most important, the fallback is adjusted to match the web font's measurements.

Every font has metrics: how tall its capitals are, how far its descenders reach, how wide its average character is. CSS lets us tell the browser to scale and shift the fallback so that its metrics match the web font's. With those overrides in place, a line set in the fallback breaks at almost exactly the same characters as the same line set in the web font. When the swap happens, the shapes of the letters change, but the lines do not move.

```css
@font-face {
  font-family: 'Body Fallback';
  src: local('Georgia');
  size-adjust: 104%;
  ascent-override: 92%;
  descent-override: 24%;
  line-gap-override: 0%;
}
```

The numbers above are illustrative; the real ones are computed from the font files, not guessed. The framework we use computes them for each font at build time and writes the overrides into the stylesheet. We check the result the only way that counts: a test loads the page with a slow network, records every layout shift, and fails if the total goes above a small threshold.

## The measure is decided before the colours

The width of a line of text, the measure, decides how easy a page is to read more than any other single choice. Too long, and the eye loses its place when it returns to the start of the next line. Too short, and the reader spends their attention on line breaks instead of sentences. The long-standing rule of thumb is between forty-five and seventy-five characters, with sixty-six as the comfortable middle. Our body text sits close to that.

That number is in characters, not pixels, and that matters. A measure set in pixels changes with the font size. When a reader enlarges the text, a pixel measure squeezes fewer characters into each line until the paragraphs become ragged columns of three words. A measure set in character units grows with the text. Enlarge the text and the column grows with it, until it meets the edge of the screen and wraps sensibly.

On a phone, the screen is narrower than the ideal measure, so the screen sets the line length. That is fine. What we avoid on a phone is everything that eats into the width: wide side margins, indented blockquotes that halve the measure, tables that force the whole page to scroll sideways. Tables on our pages scroll inside their own box instead, which we explained in [Tables on a phone](/posts/tables-on-a-phone).

The body size is larger than a typical interface. Long reading is a different task from scanning a dashboard. The text is set at around twenty pixels on a desktop screen, with generous line spacing, and it does not shrink on a phone below the size the platform recommends for comfortable reading.

> The best typography is the kind the reader never thinks about, because they are busy thinking about what it says.

The colours came last, deliberately. A palette chosen before the type tends to be chosen for how it looks in a swatch rather than how it reads in a paragraph. Ours was checked against the body text in both light and dark mode, and every pair of text and background clears the contrast ratio the accessibility guidelines require. A test reads the real stylesheet and fails if a later change breaks a pair.

## Images earn their bytes

Most of our posts have no images at all, and that is part of why they are fast. When a post does have one, a few rules apply.

Every image has a text alternative. Our studio will not let an image be published without one, because an image without alt text is a hole in the page for anyone using a screen reader. Writing good alt text is a skill, and we wrote down how we approach it in [Alt text is writing, not metadata](/posts/alt-text-is-writing).

Every image declares its width and height in the HTML, so the browser can reserve the right amount of space before the image arrives. Without dimensions, the text below an image jumps down when it loads, which is the second most common cause of layout shift after fonts.

Images are served in a modern format at the size they are displayed, not at the size they were uploaded. A photograph taken on a phone is several megabytes; displayed at the width of our column, it needs a small fraction of that. The resizing happens once, when the image is first requested at a given size, and the result is cached like everything else.

Images below the first screen load lazily: the browser does not fetch them until the reader scrolls near them. The image at the top of a post, if there is one, does the opposite. It is marked as important so the browser fetches it early, because it is likely to be the largest thing on the first screen, and the time it takes to appear is what the largest contentful paint metric measures.

## Search engines read the same page you do

Everything above makes the page fast for people. Search engines and social networks are readers too, with their own needs, and a page that ignores them gets fewer human readers in the end.

Every post has one canonical address. The same post can be reached with or without a trailing slash, with tracking parameters on the end, or through an old slug from before it was renamed. All of those are the same page, and the page says so: it names its canonical address in its head, and the old slugs answer with a permanent redirect to it. We explained why in [One page, one canonical URL](/posts/one-page-one-canonical-url).

Every post has a title and a description written for search results, which may differ from the headline on the page. The studio shows the author how the result will look and warns when either is long enough to be cut off. If the author leaves them empty, the page falls back to the post title and the excerpt.

Each post page also carries a small block of structured data describing it as a blog post, with its headline, dates, author and the breadcrumb trail that leads to it. Search engines use it to show richer results. We include the two types that describe a post and nothing else, because a long list of schema types pasted into every page tends to be wrong in ways nobody checks. Our tests parse the block on every page and check its fields against the post.

The sitemap lists every live post with the time its current revision was published. That time is the honest answer to the question a crawler is asking, which is whether the content changed. A sitemap that claims every page changed today is a sitemap crawlers learn to ignore. The feed carries the full text of each post, cleaned by the same sanitizer as the page, because some readers will only ever read us in a feed reader.

Pages that should not be indexed say so. The search results page, the preview pages editors use to check a draft, and the studio are all marked as not for indexing, and the robots file asks crawlers to stay out of the studio and the previews entirely.

## Nothing unpublished leaks

The rule that matters most is the one readers never see: a draft is never public. Not on the page, not in the feed, not in the sitemap, not in search results, not in the content API, and not in any file the build writes to disk.

That sounds like a matter of filtering by status, and in the database it partly is. Every public query asks for posts that have a published revision and reads that revision, never the newest one. But the dangerous case is not the obvious one. A post that has never been published is easy to keep out. A post that is live and has an unpublished edit in progress is harder, because the post itself is public and only part of its history is not. A query that reads the latest revision instead of the published one would show readers the edit before an editor approved it.

So we test for it with a canary. The seed data includes posts in every state, and every piece of text that must not be public contains an unusual word that appears nowhere else. After the build, a test searches every public surface for that word: every built page on disk, the feed, the sitemap, the content API, the search results. If the word appears anywhere, the test fails and names the place. The test was written before the public pages were, and it has already caught one mistake.

The database helps too. Revisions cannot be edited once written, so the text a reader saw yesterday is exactly the text that is stored. A post's pointer to its live revision can only point at a revision of that same post. A post marked as published must point at the revision it is publishing. These rules are constraints in the database itself, which means no code path, however new, can break them without being refused.

## What it adds up to

None of the decisions above is clever. Rendering ahead of time, tagging pages with what they contain, writing announcements in the same transaction as the change, keeping JavaScript off a text page, matching fallback fonts, setting a measure, sizing images, describing pages honestly to crawlers and testing that drafts stay private: each is well known, and each has a clear reason.

What makes them work is that each is checked by something other than good intentions. The rendering mode of every page is read from the build output and compared to the plan. The publish path is tested end to end, from the button to the public page, with a clock running. Layout shift and page weight are measured on every change. Contrast is computed from the real stylesheet. The canary word is searched for in everything we serve.

A fast page is not one decision. It is a dozen small ones, kept. The long way to it is mostly the work of making sure they stay kept after the day they were made.

If you have read this far, thank you. That is about three thousand words, which a reading time estimate would call fifteen minutes. We hope they felt shorter.
