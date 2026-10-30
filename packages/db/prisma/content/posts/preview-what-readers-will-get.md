The preview pane in our studio uses the same renderer as the public site. What an author sees while typing is what readers will see after publishing.

## One pipeline

There is one markdown pipeline, one sanitizer and one set of components. The preview calls it with the draft; the public page calls it with the live revision. There is no second, simpler renderer that could disagree.

## More than the page

An editor deciding whether a post is ready needs to see more than the page. The preview also shows the search result, the social card and the feed entry, each built from the same revision.

## Private by construction

A preview page is reached through a signed link that expires, is never cached, and tells search engines not to index it. Readers cannot stumble on a draft by guessing an address.
