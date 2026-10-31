-- Build step 5, second half: what the 2,000-post benchmark measured.
--
-- 1. Index live documents only. Every revision has a document, and the
--    studio autosaves, so a post collects dozens of revisions. A GIN index
--    over all of them grows with every keystroke pause and makes a common
--    word match every old revision, which the published-only join then
--    throws away. `live` is true exactly for a post's published revision,
--    and the index is partial on it.
--
-- 2. `live` is computed, never written. A BEFORE trigger derives it from
--    `posts.published_revision_id` on every insert and update of a document,
--    and an AFTER trigger on posts touches the old and new published
--    documents whenever that pointer moves. So the API, the seed, the
--    publisher's scheduled publish and a hand-written UPDATE all get the same
--    answer, and `SET live = true` on a draft's document is undone in the
--    same statement.
--
-- 3. Rank and title tier on small vectors. Measured: decompressing a body's
--    vector costs about 30 us a row and `ts_rank_cd` on it about 55 us more,
--    so ranking 2,000 matches of a common word took over 250 ms. The title
--    tier reads `title_vector`; the rank reads `lead_vector` (title A,
--    excerpt B, the opening `lead` of the body C), which stays small.
--
-- 4. `lead`: the first 600 characters of the body, cut back to a word
--    boundary. Snippets come from it when the match is there, which spares
--    parsing the whole body (about 2.5 ms for 7,500 characters).

ALTER TABLE "search_documents"
  ADD COLUMN "live" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lead" TEXT GENERATED ALWAYS AS (
    CASE WHEN length("body") <= 600 THEN "body"
         ELSE regexp_replace(left("body", 601), ' [^ ]*$', '') END
  ) STORED,
  ADD COLUMN "title_vector" tsvector GENERATED ALWAYS AS (
    to_tsvector('english'::regconfig, "title")
  ) STORED,
  ADD COLUMN "lead_vector" tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english'::regconfig, "title"), 'A') ||
    setweight(to_tsvector('english'::regconfig, "excerpt"), 'B') ||
    setweight(to_tsvector('english'::regconfig,
      CASE WHEN length("body") <= 600 THEN "body"
           ELSE regexp_replace(left("body", 601), ' [^ ]*$', '') END), 'C')
  ) STORED;

CREATE FUNCTION "search_documents_live"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."live" := EXISTS (SELECT 1 FROM "posts" WHERE "published_revision_id" = NEW."revision_id");
  RETURN NEW;
END;
$$;

CREATE TRIGGER "search_documents_live" BEFORE INSERT OR UPDATE ON "search_documents"
  FOR EACH ROW EXECUTE FUNCTION "search_documents_live"();

CREATE FUNCTION "search_documents_follow_post"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- A no-op touch: the BEFORE trigger above recomputes `live` for each row.
  UPDATE "search_documents" SET "live" = "live"
  WHERE "revision_id" IN (
    CASE WHEN TG_OP = 'UPDATE' THEN OLD."published_revision_id" END,
    NEW."published_revision_id");
  RETURN NULL;
END;
$$;

CREATE TRIGGER "search_documents_follow_post" AFTER INSERT OR UPDATE OF "published_revision_id" ON "posts"
  FOR EACH ROW EXECUTE FUNCTION "search_documents_follow_post"();

-- Existing documents: the touch recomputes every flag.
UPDATE "search_documents" SET "live" = "live";

DROP INDEX "search_documents_vector_idx";
CREATE INDEX "search_documents_live_vector_idx" ON "search_documents" USING GIN ("vector") WHERE "live";
