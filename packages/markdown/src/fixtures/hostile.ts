/**
 * Hostile markdown, one vector per entry. Each is something an author (or a
 * compromised author account) could type into the studio, adapted from the
 * OWASP XSS filter evasion cheat sheet to what markdown can actually express.
 *
 * `gone` lists strings that must not appear anywhere in the rendered HTML.
 * Every entry also goes through the generic checks in `sanitize.test.ts`, which
 * parse the output: an attacker's text that survives as escaped, visible text
 * (`&#x3C;img onerror=...`) is inert, so `gone` names markup, not words.
 */
export interface Vector {
  readonly name: string;
  readonly markdown: string;
  readonly gone: readonly string[];
}

export const VECTORS: readonly Vector[] = [
  // --- Raw HTML: dropped before sanitizing, so its text goes too -------------
  { name: 'script block', markdown: '<script>window.x=1</script>', gone: ['<script', 'window.x'] },
  { name: 'inline script', markdown: 'a <script>window.x=1</script> b', gone: ['<script'] },
  {
    name: 'img onerror',
    markdown: '<img src="x" onerror="window.x=1">',
    gone: ['onerror', 'window.x'],
  },
  {
    name: 'svg onload',
    markdown: '<svg onload="window.x=1"><circle/></svg>',
    gone: ['<svg', 'onload'],
  },
  {
    name: 'iframe srcdoc',
    markdown: '<iframe srcdoc="<script>x</script>"></iframe>',
    gone: ['iframe', 'srcdoc'],
  },
  {
    name: 'style block',
    markdown: '<style>body{display:none}</style>',
    gone: ['<style', 'display:none'],
  },
  {
    name: 'inline style',
    markdown: '<p style="position:fixed;inset:0">cover</p>',
    gone: ['style', 'fixed'],
  },
  {
    name: 'form action',
    markdown: '<form action="https://evil.test"><button>go</button></form>',
    gone: ['<form', 'evil.test'],
  },
  {
    name: 'meta refresh',
    markdown: '<meta http-equiv="refresh" content="0;url=https://evil.test">',
    gone: ['<meta', 'evil.test'],
  },
  { name: 'base href', markdown: '<base href="https://evil.test/">', gone: ['<base', 'evil.test'] },
  {
    name: 'object data',
    markdown: '<object data="javascript:x"></object>',
    gone: ['<object', 'javascript'],
  },
  {
    name: 'raw anchor',
    markdown: '<a href="javascript:window.x=1">x</a>',
    gone: ['javascript', 'href'],
  },
  {
    name: 'details ontoggle',
    markdown: '<details open ontoggle="window.x=1">',
    gone: ['ontoggle', '<details'],
  },
  {
    name: 'html comment',
    markdown: '<!-- <script>window.x=1</script> -->',
    gone: ['<script', '<!--'],
  },
  { name: 'cdata', markdown: '<![CDATA[<script>window.x=1</script>]]>', gone: ['<script'] },
  {
    name: 'unclosed tag swallowing the next line',
    markdown: '<img src=x onerror=window.x=1 \n\nnext',
    // Not a complete tag, so markdown keeps it as visible text: escaped, inert.
    gone: ['<img'],
  },
  {
    name: 'math mutation',
    markdown: '<math><mtext><table><mglyph><style><img src=x onerror=window.x=1>',
    gone: ['<img', '<math'],
  },
  {
    name: 'noscript mutation',
    markdown: '<noscript><p title="</noscript><img src=x onerror=window.x=1>">',
    gone: ['onerror'],
  },

  // --- Markdown links and images with hostile destinations -------------------
  { name: 'javascript link', markdown: '[x](javascript:window.x=1)', gone: ['javascript', 'href'] },
  {
    name: 'mixed-case scheme',
    markdown: '[x](JaVaScRiPt:window.x=1)',
    gone: ['avascript', 'href'],
  },
  {
    name: 'entity-encoded scheme',
    markdown: '[x](&#106;avascript:window.x=1)',
    gone: ['avascript', 'href'],
  },
  {
    name: 'hex entity colon',
    markdown: '[x](javascript&#x3A;window.x=1)',
    gone: ['avascript', 'href'],
  },
  {
    name: 'named entity colon',
    markdown: '[x](javascript&colon;window.x=1)',
    gone: ['avascript', 'href'],
  },
  {
    name: 'tab inside scheme',
    markdown: '[x](<java\tscript:window.x=1>)',
    gone: ['script:', 'href'],
  },
  {
    name: 'encoded tab inside scheme',
    markdown: '[x](java&#9;script:window.x=1)',
    gone: ['script:', 'href'],
  },
  {
    name: 'newline inside scheme',
    markdown: '[x](java&#10;script:window.x=1)',
    gone: ['script:', 'href'],
  },
  {
    name: 'leading control character',
    markdown: '[x](&#1;javascript:window.x=1)',
    gone: ['avascript', 'href'],
  },
  {
    name: 'leading spaces in angle brackets',
    markdown: '[x](<  javascript:window.x=1>)',
    gone: ['avascript', 'href'],
  },
  { name: 'vbscript', markdown: '[x](vbscript:msgbox(1))', gone: ['vbscript', 'href'] },
  {
    name: 'data html link',
    markdown: '[x](data:text/html,<script>window.x=1</script>)',
    gone: ['data:', 'href'],
  },
  {
    name: 'data svg image',
    markdown: '![x](data:image/svg+xml,<svg onload=window.x=1>)',
    gone: ['<svg', 'src='],
  },
  {
    name: 'javascript image',
    markdown: '![x](javascript:window.x=1)',
    gone: ['avascript', 'src='],
  },
  { name: 'file scheme', markdown: '[x](file:///etc/passwd)', gone: ['file:', 'href'] },
  { name: 'autolink javascript', markdown: '<javascript:window.x=1>', gone: ['href'] },
  {
    name: 'reference definition',
    markdown: '[x][evil]\n\n[evil]: javascript:window.x=1',
    gone: ['avascript', 'href'],
  },
  {
    name: 'title that breaks out of the attribute',
    markdown: '[x](https://example.test "a\\" onmouseover=\\"window.x=1")',
    gone: ['" onmouseover'],
  },
  {
    name: 'alt that breaks out of the attribute',
    markdown: '![" onerror="window.x=1](https://example.test/a.png)',
    gone: ['" onerror'],
  },
  {
    name: 'destination that breaks out of the attribute',
    markdown: '[x](https://example.test/"onmouseover="window.x=1)',
    gone: ['"onmouseover="'],
  },

  // --- Text that looks like markup -------------------------------------------
  {
    name: 'escaped tag in text',
    markdown: '\\<script>window.x=1\\</script>',
    gone: ['<script'],
  },
  {
    name: 'tag inside inline code',
    markdown: '`<img src=x onerror=window.x=1>`',
    gone: ['<img'],
  },
  {
    name: 'closing tag inside a code block',
    markdown: '```\n</code></pre><script>window.x=1</script>\n```',
    gone: ['<script', '</code></pre><'],
  },
  {
    name: 'html in a table cell',
    markdown: '| a |\n|---|\n| <img src=x onerror=window.x=1> |',
    gone: ['<img'],
  },
  {
    name: 'html in a footnote',
    markdown: 'a[^1]\n\n[^1]: <script>window.x=1</script>',
    gone: ['<script'],
  },
  {
    name: 'footnote label that targets a page global',
    markdown: 'a[^__next_f]\n\n[^__next_f]: b',
    gone: ['id="__next_f"', 'id="fn-__next_f"'],
  },
  {
    name: 'heading that targets a page global',
    markdown: '## __next_f\n\n## __NEXT_DATA__',
    gone: ['id="__next_f"', 'id="__NEXT_DATA__"', 'id="__next_data__"'],
  },
  {
    name: 'task list checkbox stays inert',
    markdown: '- [x] done\n- [ ] not yet',
    gone: ['<input type="checkbox" checked>', 'name='],
  },
];
