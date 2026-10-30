Publishing a post does two things: it changes the post in the database, and it tells the website which pages are now out of date. If the second step could fail after the first succeeded, a post would be published in the database and stale on the site.

## One transaction

So we do not send the announcement during the publish. We write it. The publish inserts a row into an outbox table in the same transaction that changes the post. Either both are saved or neither is.

## A separate delivery

A small process reads undelivered rows and delivers each one to the website over a signed request. When the website confirms, the row is marked delivered. If the website is down, the process waits and tries again, waiting longer each time.

## At least once is enough

Delivery can repeat if the confirmation is lost. That is harmless: marking a page stale twice costs one extra rebuild. Each announcement carries an id so the website can tell when it has seen one before.
