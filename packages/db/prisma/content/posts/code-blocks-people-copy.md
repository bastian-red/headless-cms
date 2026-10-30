When a reader copies a code sample, they want the code. Not line numbers, not a shell prompt, not a curly quote the editor helpfully substituted.

## No prompt in the sample

A shell command is written without a leading dollar sign, so it can be pasted as it is.

```sh
pnpm install
pnpm dev
```

## Straight quotes inside code

Our renderer turns straight quotes into typographic ones in prose and leaves code alone. A curly quote in a code sample is a syntax error waiting for the reader who trusted it.

## Wrap or scroll

Long lines in a code block scroll inside the block rather than wrapping. A wrapped line of code reads as two lines, and in some languages it means two lines.

## Highlighting at build time

Syntax colouring is applied when the page is built, as plain styled text. It needs no script in the reader's browser, and it works in the feed too.
