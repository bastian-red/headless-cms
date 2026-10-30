Largest contentful paint measures how long it takes for the largest thing on the first screen to appear. On a page of text, that thing is usually the headline or the first paragraph, not an image.

## So make text arrive first

Our post pages put the title and opening paragraphs early in the HTML, with nothing before them that has to load first. No script needs to run before the text can be drawn.

## The font is on the critical path

Text cannot be drawn in its final font until the font arrives. We serve fonts from our own origin, tell the browser about the body font early, and use a matched fallback, so the text appears at once and does not move when the font swaps in.

## Measure on a slow phone

A fast laptop on office wifi hides everything. Our performance check loads the page on a simulated mid-range phone over a slow connection, and the build fails if the headline takes longer than two seconds to appear.
