/** A field's own error, linked from its input by `aria-describedby`; a glyph, not colour alone. */
export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (message === undefined) return null;
  return (
    <span id={id} className="field-error">
      <span aria-hidden="true">⚠ </span>
      {message}
    </span>
  );
}

/** How much of a limit is used, in words for assistive technology. */
export function Counter({ id, used, max }: { id: string; used: number; max: number }) {
  return (
    <span id={id} className="field-count muted" data-over={used > max ? 'true' : undefined}>
      {used.toLocaleString('en')} / {max.toLocaleString('en')}
      <span className="visually-hidden"> characters</span>
    </span>
  );
}
