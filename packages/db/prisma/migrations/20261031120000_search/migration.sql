-- Build step 5: full-text search.
--
-- One derived row per revision. The vector is GENERATED, so it can never
-- disagree with the text it was computed from, and the configuration is
-- spelled out as a regconfig literal: `to_tsvector(text)` with no
-- configuration depends on the session's default_text_search_config and is
-- not immutable, so Postgres would refuse it in a generated column.
--
-- Hand-written objects (named in HAND_WRITTEN_DIFF_OBJECTS where Prisma's
-- diff would drop them): the generated expression and the GIN index.

-- CreateTable
CREATE TABLE "search_documents" (
    "revision_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "vector" tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english'::regconfig, "title"), 'A') ||
        setweight(to_tsvector('english'::regconfig, "excerpt"), 'B') ||
        setweight(to_tsvector('english'::regconfig, "body"), 'C')
    ) STORED,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_documents_pkey" PRIMARY KEY ("revision_id")
);

-- AddForeignKey
ALTER TABLE "search_documents" ADD CONSTRAINT "search_documents_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written -----------------------------------------------------------------

-- The index every search query starts from (`vector @@ query`).
CREATE INDEX "search_documents_vector_idx" ON "search_documents" USING GIN ("vector");
