import type { SimpleState } from '../../app/studio/actions';

/** A small form's outcome: a status for success, an alert for a refusal. */
export function Result({ state }: { state: SimpleState }) {
  return (
    <>
      <p className="form-result" role="status">
        {state.kind === 'done' ? (
          <>
            <span aria-hidden="true">✓ </span>
            {state.message}
          </>
        ) : null}
      </p>
      {state.kind === 'error' ? (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </>
  );
}
