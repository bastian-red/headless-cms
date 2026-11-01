'use client';

/**
 * CodeMirror 6 over a real `<textarea>`.
 *
 * The textarea is the form field and stays in the form, so a save without
 * JavaScript (or before it loads) posts the body like any other field. Once
 * the page is interactive, CodeMirror mounts beside it, the textarea is
 * hidden, and every change in the editor is written back through `onChange`,
 * which is the same state the textarea's value comes from. Hidden fields are
 * still submitted; only disabled ones are not. The editor owns its document
 * while the person types; the returned function is the only way in.
 *
 * The bare `codemirror` package and a few lines of hook, not a React
 * wrapper: the wrappers on npm re-create the view on prop changes or lag
 * CodeMirror's releases, and this is all the integration the page needs.
 */
import { markdown } from '@codemirror/lang-markdown';
import { EditorView, basicSetup } from 'codemirror';
import { useCallback, useEffect, useRef, type RefObject } from 'react';

interface Options {
  readonly textarea: RefObject<HTMLTextAreaElement | null>;
  readonly onChange: (value: string) => void;
  /** The textarea's accessible name and description, carried over to the editable surface. */
  readonly label: string;
  readonly describedBy?: string;
}

const theme = EditorView.theme({
  '&': {
    color: 'var(--text)',
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--rule)',
    borderRadius: 'var(--radius)',
    minHeight: '24rem',
    // Fixed on a wide screen (globals.css --editor-height), so the line being
    // written, the save bar and the preview stay in one viewport; the
    // document scrolls inside. Auto on a phone, where the page scrolls.
    height: 'var(--editor-height)',
  },
  '.cm-scroller': { overflow: 'auto' },
  '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '2px' },
  '.cm-content': { fontFamily: 'var(--font-mono)', caretColor: 'var(--text)', padding: '0.5rem 0' },
  '.cm-gutters': {
    backgroundColor: 'var(--surface)',
    color: 'var(--muted)',
    borderRight: '1px solid var(--rule)',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--text)' },
});

export function useCodeMirror({
  textarea,
  onChange,
  label,
  describedBy,
}: Options): (text: string) => void {
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    const field = textarea.current;
    if (field === null) return;
    const host = document.createElement('div');
    host.className = 'editor-surface';
    field.after(host);
    const editor = new EditorView({
      parent: host,
      doc: field.value,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        theme,
        EditorView.contentAttributes.of({
          // The editable surface is already in the tab order; saying so
          // explicitly lets axe see that the scroller (which scrolls on a wide
          // screen, --editor-height) holds focusable content
          // (scrollable-region-focusable). No extra tab stop is added.
          tabindex: '0',
          'aria-label': label,
          ...(describedBy === undefined ? {} : { 'aria-describedby': describedBy }),
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) change.current(update.state.doc.toString());
        }),
      ],
    });
    view.current = editor;
    field.hidden = true;
    return () => {
      field.hidden = false;
      editor.destroy();
      host.remove();
      view.current = null;
    };
    // Mounted once; outside changes arrive through the function returned below.
  }, []);

  /**
   * Replace the document from outside: loading the newer revision, or a
   * reset after a save. Only the caller knows a change came from outside.
   * An effect that pushed every React value back into the editor once lost
   * keystrokes in Firefox: a render carrying the text from two keys ago
   * overwrote the two keys typed since ("First hand" saved as "Fisthad").
   */
  return useCallback((text: string) => {
    const editor = view.current;
    if (editor === null) return;
    const current = editor.state.doc.toString();
    if (current !== text) {
      editor.dispatch({ changes: { from: 0, to: current.length, insert: text } });
    }
  }, []);
}
