When an author writes a post here, we store exactly what they typed: markdown, as plain text. We never store the HTML it becomes.

## Why not store HTML

HTML is an output. If we stored it, every improvement to the renderer, a better heading anchor, a fixed footnote, a safer link policy, would apply only to posts written after the change. Old posts would keep their old HTML forever, frozen with whatever bugs the renderer had that day.

Storing markdown means every post is rendered by the current renderer every time it is built. Fix the renderer once and every post benefits.

## One renderer, everywhere

The same pipeline produces the studio preview, the public page, the feed entry, the excerpt and the text the search index reads. There is no second implementation that could disagree with the first.

## What markdown we accept

Standard markdown with tables, strikethrough, task lists and footnotes. Raw HTML in the source is not rendered; it is removed. Authors who need something markdown cannot express can ask, and we add it to the pipeline for everyone.
