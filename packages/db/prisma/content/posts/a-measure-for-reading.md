The measure is the length of a line of text. It decides how comfortable a long read is more than the typeface, the size or the colour.

## Why about sixty-six characters

At the end of each line the eye has to travel back to the start of the next one. On a very long line that return trip is long enough to land on the wrong line. On a very short one the reader spends their attention on line breaks. Printers settled on somewhere between forty-five and seventy-five characters a long time ago, with sixty-six as the comfortable middle, and studies of reading on screens have not found a reason to move far from it.

## Set it in characters, not pixels

A measure in pixels shrinks in characters when a reader enlarges the text, until paragraphs turn into columns three words wide. We set our column in character units, so it grows with the text and wraps at the screen edge when it has to.

```css
.prose {
  max-width: 66ch;
}
```

## On a phone

A phone is narrower than the ideal measure, so the screen decides. What we protect on a phone is the width we do have: modest side margins, blockquotes that do not halve the column, and tables that scroll inside their own box instead of pushing the whole page sideways.
