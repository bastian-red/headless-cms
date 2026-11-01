'use client';

import { useEffect, type RefObject } from 'react';

/**
 * After a refused submit, move focus to the first field marked invalid, so
 * a keyboard or screen-reader user lands on what to fix instead of hunting
 * for it. Runs once per new state; nothing moves while the person types.
 */
export function useFocusFirstError(form: RefObject<HTMLFormElement | null>, state: unknown) {
  useEffect(() => {
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [form, state]);
}
