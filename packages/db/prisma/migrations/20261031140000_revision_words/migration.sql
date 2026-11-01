-- Step 10 (design): the size index. Home and tag lists show each post's
-- reading time, so a summary needs the word count without rendering every
-- body on every list request.
--
-- `words` is what @cms/markdown counts in the reader-visible text, written by
-- the API from the render check that passed the save (and by the seed from
-- the same renderer). A revision is immutable, so the count never goes stale.
--
-- Nullable on purpose: rows written before this migration have no count, and
-- SQL cannot compute the renderer's. The content API renders those once
-- (cached by revision id) and serves the same number either way.

-- AlterTable
ALTER TABLE "revisions" ADD COLUMN "words" INTEGER;

ALTER TABLE "revisions" ADD CONSTRAINT "revisions_words_check" CHECK ("words" >= 0);
