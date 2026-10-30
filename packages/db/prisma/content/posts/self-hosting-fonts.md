Our fonts are files in our own repository, served from our own domain. We do not load them from a font service.

## One less connection

A font from another origin needs a new connection before the download can start: a DNS lookup, a TLS handshake, then the request. On a slow phone that is a few hundred milliseconds before the first byte of the font. A font from our own origin rides the connection the page already opened.

## One less question

Every request to a third party tells that party that someone, somewhere, read our page. We would rather not have to explain in a privacy note why a font is part of that.

## The licence goes with it

Every font we use is under an open licence that allows self-hosting, and its licence file sits next to the font file in the repository. When someone asks whether we are allowed to use a typeface, the answer is in the folder.

## Only what we use

We ship one variable file per family, covering the weights we use, subset to the characters a Latin-script publication needs.
