import { userSchema } from '@cms/shared';
import { z } from 'zod';

import { NewPersonForm, RoleForm } from '../../../components/studio/people';
import { When } from '../../../components/studio/when';
import { apiFetch } from '../../../lib/api';
import { requireAbility } from '../../../lib/studio/admin-page';

export const metadata = { title: 'People' };

/** Everyone who can sign in, and what they may do. Admins only. */
export default async function PeoplePage() {
  const { session, me } = await requireAbility('/studio/people', 'user.manage');
  const people = await apiFetch(session, '/studio/users', z.array(userSchema));
  return (
    <main id="main" className="studio-page">
      <h1>People</h1>
      <p className="muted">
        Authors write and submit; editors publish and moderate; admins also manage people and API
        keys. A change of role applies from the person’s next page load.
      </p>
      <table className="table people">
        <caption className="visually-hidden">Everyone who can sign in</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Since</th>
            <th scope="col">Role</th>
          </tr>
        </thead>
        <tbody>
          {people.map((person) => (
            <tr key={person.id}>
              <td data-label="Name">
                {person.name}
                {person.id === me.id ? <span className="muted"> (you)</span> : null}
              </td>
              <td data-label="Email" translate="no">
                {person.email}
              </td>
              <td data-label="Since">
                <When instant={person.createdAt} />
              </td>
              <td data-label="Role">
                <RoleForm userId={person.id} name={person.name} role={person.role} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewPersonForm />
    </main>
  );
}
