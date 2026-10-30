Every page you read here was built before you asked for it. That one choice removes more problems than any optimisation we could make later.

## What a request costs

A page rendered on request costs a database query, a markdown render and a template, every time. Each is fast. Together, multiplied by every reader on a busy day, they are the reason sites slow down exactly when people are paying attention.

A static page costs a file read. It does not care how complicated the post is, and it does not care whether the database is having a bad afternoon.

## What we give up

Freshness, in the naive version. A static page is out of date the moment its source changes. We solve that narrowly: when a post changes, only the pages built from it are thrown away and rebuilt on the next visit. Nothing else is touched.

We also give up personalisation on public pages. There is no "welcome back" banner and no recommendation rail that depends on who you are. We do not miss them.

## Where we do not

Search results depend on what you typed, so the search page renders per request. The studio depends on who is signed in. Everything else a reader can reach is built once and kept.

The rule we follow is simple: if two readers asking for the same URL should see the same thing, that page is static.
