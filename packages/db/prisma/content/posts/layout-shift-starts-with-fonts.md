Text drawn in a fallback font and then redrawn in a web font often changes width. Lines rewrap, paragraphs change height, and everything below them jumps. That jump is the most common layout shift on a text page.

## Match the fallback

CSS can scale and shift a fallback font so that its measurements match the web font: the size of its letters, the height of its capitals, the depth of its descenders. With the overrides in place, a line breaks at the same word in both fonts.

## Computed, not guessed

The numbers come from the font files. Our framework reads them at build time and writes the overrides into the stylesheet. Hand-tuned numbers drift the first time someone swaps a font.

## Then measure it

A test loads each kind of page with a throttled network, records every layout shift, and fails above a small threshold. Fonts are the usual cause; images without dimensions are the other.
