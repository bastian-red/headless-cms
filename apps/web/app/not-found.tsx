import Link from 'next/link';

/**
 * One answer for "does not exist" and "not yours to see". An unpublished post
 * is indistinguishable from one that never existed, by design.
 */
export default function NotFound() {
  return (
    <main id="main" className="page">
      <h1>Nothing here</h1>
      <p className="muted">That page does not exist, or it has not been published.</p>
      <Link href="/">Back to the front page</Link>
    </main>
  );
}
