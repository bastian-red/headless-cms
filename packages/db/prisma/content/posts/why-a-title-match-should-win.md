A search for a word should put the posts that are about that word above the posts that merely mention it. The simplest signal of "about" is the title.

## Weights

We give each part of a post a weight when we build the search index. The title counts most, the excerpt next, and the body least. A word that appears once in a title outranks the same word appearing a few times deep in a body.

## Why not count occurrences

Counting how many times a word appears favours long posts. A three-thousand-word essay that mentions caching in passing six times is not more about caching than a short post titled "Caching". Weighting by position corrects for that.

## We test it

Our seed data includes a word that appears in one post's title and, once, in another post's body. A test searches for it and fails unless the title match comes first.
