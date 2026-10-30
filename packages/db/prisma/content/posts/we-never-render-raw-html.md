Markdown allows raw HTML. That is convenient for authors and dangerous for readers, because HTML can carry a script, and a script on our page can do anything our page can do.

## What we do with it

Our renderer parses markdown into a tree, removes every element and attribute that is not on a short list, and only then turns the tree into the page. Raw HTML in the source is dropped. Links are kept only when they point somewhere a link should: web addresses, mail addresses, and pages on this site. Event handler attributes never survive.

The same cleaning runs for the studio preview, the page and the feed, because they share one pipeline.

## A demonstration

The lines below this paragraph are hostile on purpose. In the source of this post they are a script tag, an image whose error handler runs code, and a link whose address is code. On the page you are reading, they should be gone or inert. If you see an alert, or anything in this section other than plain text and one harmless link, something is broken and we would like to hear about it.

<script>window.__quireHostile = 'script'</script>

<img src="x" onerror="window.__quireHostile = 'onerror'">

[A link that tries to run code](javascript:window.__quireHostile='href')

## How we know

Our tests render hostile fixtures through the pipeline and check the output contains no script, no handler and no unsafe address. The end-to-end tests load this very page in two browsers and check that nothing on it ran.

```html
<!-- Shown as text, never run: -->
<script>
  alert('this is a code sample');
</script>
```
