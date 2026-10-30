The word "tag" does two jobs in our stack, and confusing them is the fastest way to a stale page.

## Tags readers see

At the bottom of each post there are a few tags: Caching, Typography, Search. They help a reader find related posts, and each has its own page listing everything that carries it. They are editorial. An author chooses them.

## Tags the cache sees

Every page we build is also labelled with the data it was built from: this post, the list of all posts, each editorial tag it shows. Those labels are cache keys. When something changes, the publisher announces which keys are stale, and every page carrying one of them is rebuilt on its next visit.

| Page       | Cache keys                                  |
| ---------- | ------------------------------------------- |
| A post     | the post, its editorial tags, the post list |
| Home       | the post list                               |
| A tag page | that tag, the post list                     |
| The feed   | the post list                               |

## Why the difference matters

An editorial tag is chosen by a person and can be wrong without harm. A cache key is derived from what the page actually read, and if it is wrong, a page stays stale. So cache keys are never typed by hand. Each page declares them from its own data, in the same code that fetches the data.

That way, when a page starts showing something new, it starts carrying the new key in the same change. There is no list somewhere else to forget to update.
