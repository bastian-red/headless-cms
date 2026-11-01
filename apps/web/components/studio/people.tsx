'use client';

import { ROLES, type Role } from '@cms/shared';
import { useActionState, useId, useRef } from 'react';

import {
  changeRole,
  createUser,
  type CreateUserState,
  type SimpleState,
} from '../../app/studio/actions';
import { FieldError } from './field';
import { Result } from './result';
import { useFocusFirstError } from './use-focus-first-error';

const ROLE_WORD: Record<Role, string> = { AUTHOR: 'Author', EDITOR: 'Editor', ADMIN: 'Admin' };

/** One person's role, changed with a select and a button (no change on select alone). */
export function RoleForm({ userId, name, role }: { userId: string; name: string; role: Role }) {
  const id = useId();
  const [state, action, pending] = useActionState<SimpleState, FormData>(changeRole, {
    kind: 'idle',
  });
  return (
    <form action={action} className="role-form">
      <input type="hidden" name="userId" value={userId} />
      <label htmlFor={`${id}-role`} className="visually-hidden">
        Role for {name}
      </label>
      <select id={`${id}-role`} className="field-input" name="role" defaultValue={role}>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_WORD[r]}
          </option>
        ))}
      </select>
      <button className="button" type="submit" disabled={pending}>
        Change role<span className="visually-hidden"> for {name}</span>
      </button>
      <Result state={state} />
    </form>
  );
}

export function NewPersonForm() {
  const id = useId();
  const [state, action, pending] = useActionState<CreateUserState, FormData>(createUser, {
    kind: 'idle',
  });
  const error = state.kind === 'error' ? state : null;
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  const field = (
    name: 'email' | 'name' | 'password',
    label: string,
    type: string,
    auto: string,
  ) => (
    <div className="field">
      <label htmlFor={`${id}-${name}`}>{label}</label>
      <input
        id={`${id}-${name}`}
        className="field-input"
        name={name}
        type={type}
        required
        autoComplete={auto}
        spellCheck={false}
        defaultValue={name === 'password' ? '' : (error?.values[name] ?? '')}
        aria-invalid={error?.fields[name] === undefined ? undefined : true}
        aria-describedby={error?.fields[name] === undefined ? undefined : `${id}-${name}-error`}
      />
      <FieldError id={`${id}-${name}-error`} message={error?.fields[name]} />
    </div>
  );
  return (
    <form
      ref={formRef}
      action={action}
      className="panel"
      noValidate
      key={state.kind === 'done' ? state.at : 'draft'}
    >
      <h2>Add a person</h2>
      {error === null ? null : (
        <p className="form-error" role="alert">
          {error.message}
        </p>
      )}
      {field('name', 'Name', 'text', 'off')}
      {field('email', 'Email', 'email', 'off')}
      {field('password', 'Password for their first sign-in', 'password', 'new-password')}
      <div className="field">
        <label htmlFor={`${id}-role`}>Role</label>
        <select
          id={`${id}-role`}
          className="field-input"
          name="role"
          defaultValue={error?.values.role || 'AUTHOR'}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_WORD[r]}
            </option>
          ))}
        </select>
      </div>
      <button className="button button-primary" type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add person'}
      </button>
      <p className="form-result" role="status">
        {state.kind === 'done' ? (
          <>
            <span aria-hidden="true">✓ </span>
            {state.message}
          </>
        ) : null}
      </p>
    </form>
  );
}
