Some information is a table. Prices by plan, results by year, features by browser. Turning that into a stack of cards on a small screen throws away the one thing a table is for: comparing across rows and down columns.

## Let it scroll

Our tables keep their shape at every width. When a table is wider than the screen, it scrolls sideways inside its own box, and the rest of the page stays put. The page never scrolls sideways because of a table.

| Plan     | Posts     | Editors   | Price      |
| -------- | --------- | --------- | ---------- |
| Personal | Unlimited | 1         | Free       |
| Team     | Unlimited | 5         | 12 a month |
| Newsroom | Unlimited | Unlimited | 40 a month |

## Make the box obvious

A table that scrolls needs to look like it scrolls. A soft shadow at the cut edge tells the reader there is more, and the box can be focused with the keyboard so it can be scrolled without a mouse.

## Headers that stay meaningful

Every column has a header cell, and the first column holds the row names. A screen reader announces both as the reader moves through the cells, which is what makes a table usable without seeing it.
