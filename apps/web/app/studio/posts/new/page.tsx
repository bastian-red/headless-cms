import { studioUser } from '../../../../lib/studio/me';
import { NewPostForm } from '../../../../components/studio/new-post-form';

export const metadata = { title: 'New post' };

export default async function NewPostPage() {
  await studioUser('/studio/posts/new');
  return (
    <main id="main" className="studio-page">
      <h1>New post</h1>
      <p className="muted">
        A title is enough to start. The post is a draft until an editor publishes it; nobody else
        sees it.
      </p>
      <NewPostForm />
    </main>
  );
}
