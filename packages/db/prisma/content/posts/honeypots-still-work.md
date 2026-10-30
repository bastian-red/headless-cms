Our comment form has a field you cannot see. It is labelled, hidden from view and from screen readers, and left out of the tab order. A person never fills it in. Many bots fill in every field they find.

## What happens when it is filled

The server accepts the request, answers exactly as it would for a real comment, and throws it away. The bot learns nothing. A rejection message would teach it which field to skip.

## Why it is not enough

A bot written for our site would skip the field. So the honeypot is one layer: there is also a rate limit per address, a length limit, and an editor who reads every comment before it is shown.

## Why it is still worth it

It costs nothing to run, nothing for a reader, and it stops the large share of spam that is not written for anyone in particular.
