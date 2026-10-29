import Link from 'next/link';

/**
 * The public front page.
 *
 * Static on purpose, and it stays static: from build step 6 it lists published
 * posts through a cached, tagged read of the content API, and an editor's
 * publish revalidates the tag instead of making this page render per request.
 * Nothing here may read cookies or headers, or the whole route turns dynamic.
 */
export default function Home() {
  return (
    <main id="main" className="page">
      <h1>headless-cms</h1>
      <p>
        Nothing is published yet. Posts written and published in the studio appear here, served as
        static pages that update the moment an editor publishes.
      </p>
      <p>
        <Link href="/studio">Open the studio</Link> · <Link href="/status">Service status</Link>
      </p>
    </main>
  );
}
