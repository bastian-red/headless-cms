import { AuthForm } from '../../../components/auth-form';
import { safeNextPath } from '../../../lib/next-path';
import { signInAction } from '../actions';

export const metadata = { title: 'Sign in', robots: { index: false } };

/**
 * Sign in to the studio. `next` is where a deep link was going; it is validated
 * here and again in the action, so a crafted value can only ever land on
 * `/studio`.
 *
 * There is no "create an account" link: accounts are made by an admin.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNextPath((await searchParams).next);
  return (
    <main id="main" className="page">
      <h1>Sign in to the studio</h1>
      <div className="panel">
        <AuthForm next={next} action={signInAction} />
      </div>
      <p className="muted">
        Demo accounts, one per role: <code translate="no">ines@quire.test</code> (admin),{' '}
        <code translate="no">tomas@quire.test</code> (editor),{' '}
        <code translate="no">mara@quire.test</code> (author). Passwords are in the README.
      </p>
    </main>
  );
}
