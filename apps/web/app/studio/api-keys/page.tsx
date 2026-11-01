import { apiKeySchema } from '@cms/shared';
import { z } from 'zod';

import { NewKeyForm, RevokeKey } from '../../../components/studio/api-keys';
import { When } from '../../../components/studio/when';
import { apiFetch } from '../../../lib/api';
import { requireAbility } from '../../../lib/studio/admin-page';

export const metadata = { title: 'API keys' };

/**
 * Keys for the read-only content API (`/v1`). Admins only. A key is shown
 * once at creation; the list shows its prefix, which is enough to tell keys
 * apart and nothing more.
 */
export default async function ApiKeysPage() {
  const { session } = await requireAbility('/studio/api-keys', 'apikey.manage');
  const keys = await apiFetch(session, '/studio/api-keys', z.array(apiKeySchema));
  return (
    <main id="main" className="studio-page">
      <h1>API keys</h1>
      <p className="muted">
        Each key reads published content through <code translate="no">/v1</code>, sent as{' '}
        <code translate="no">Authorization: Bearer hcms_…</code>. It cannot see drafts or change
        anything.
      </p>
      <NewKeyForm />
      {keys.length === 0 ? (
        <p className="panel">No keys yet.</p>
      ) : (
        <table className="table keys">
          <caption className="visually-hidden">Content API keys</caption>
          <thead>
            <tr>
              <th scope="col">For</th>
              <th scope="col">Starts with</th>
              <th scope="col">Created</th>
              <th scope="col">Last used</th>
              <th scope="col">State</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id}>
                <td data-label="For">{key.name}</td>
                <td data-label="Starts with">
                  <code translate="no">{key.prefix}…</code>
                </td>
                <td data-label="Created">
                  <When instant={key.createdAt} /> by {key.createdBy.name}
                </td>
                <td data-label="Last used">
                  {key.lastUsedAt === null ? 'Never' : <When instant={key.lastUsedAt} />}
                </td>
                <td data-label="State">
                  {key.revokedAt === null ? (
                    <RevokeKey keyId={key.id} name={key.name} />
                  ) : (
                    <span>
                      <span aria-hidden="true">✕ </span>Revoked <When instant={key.revokedAt} />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
