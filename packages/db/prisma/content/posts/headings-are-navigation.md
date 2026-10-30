Sighted readers skim a long post by its headings. Screen reader users do the same thing with a keystroke that jumps from heading to heading. For both, the headings are the table of contents.

## One h1, then in order

The post title is the only top-level heading on the page. Sections inside the post start at the next level down and do not skip levels. A jump from a second-level heading straight to a fourth leaves a hole that a screen reader user experiences as a missing section.

Our markdown renderer shifts every heading in a post down one level, so an author who writes a top-level heading in the body gets a section heading on the page, never a second title.

## Headings that say something

"Introduction" and "Conclusion" tell a reader nothing about where to jump. A heading should name what the section says. You can read this post's headings alone and know its argument.

## Anchors

Every heading gets a stable link anchor, so a reader can share a link to one section. The anchor is derived from the heading text and stays the same unless the heading changes.
