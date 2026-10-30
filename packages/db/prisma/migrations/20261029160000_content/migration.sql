-- Build step 2: the content model.
--
-- The first half is what `prisma migrate diff` generates from schema.prisma.
-- The second half is hand-written: guarantees Prisma cannot express. Every
-- object there is named, and every name is listed in scripts/db-drift.mjs so
-- the drift check treats it as intended rather than as drift.

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED');

-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SPAM');

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "PostStatus" NOT NULL DEFAULT 'DRAFT',
    "author_id" TEXT NOT NULL,
    "head_revision_id" TEXT,
    "published_revision_id" TEXT,
    "published_at" TIMESTAMPTZ(3),
    "scheduled_for" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revisions" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "parent_revision_id" TEXT,
    "restored_from_id" TEXT,
    "author_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "cover_media_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revision_tags" (
    "revision_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,

    CONSTRAINT "revision_tags_pkey" PRIMARY KEY ("revision_id","tag_id")
);

-- CreateTable
CREATE TABLE "slug_redirects" (
    "from_slug" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slug_redirects_pkey" PRIMARY KEY ("from_slug")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "CommentStatus" NOT NULL DEFAULT 'PENDING',
    "ip_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "moderated_at" TIMESTAMPTZ(3),
    "moderated_by_id" TEXT,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "alt" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revalidation_events" (
    "id" TEXT NOT NULL,
    "tags" TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ(3),
    "last_error" TEXT,

    CONSTRAINT "revalidation_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "posts_slug_key" ON "posts"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "posts_head_revision_id_key" ON "posts"("head_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "posts_published_revision_id_key" ON "posts"("published_revision_id");

-- CreateIndex
CREATE INDEX "posts_author_id_idx" ON "posts"("author_id");

-- CreateIndex
CREATE INDEX "posts_published_at_idx" ON "posts"("published_at" DESC);

-- CreateIndex
CREATE INDEX "revisions_author_id_idx" ON "revisions"("author_id");

-- CreateIndex
CREATE INDEX "revisions_parent_revision_id_idx" ON "revisions"("parent_revision_id");

-- CreateIndex
CREATE INDEX "revisions_restored_from_id_idx" ON "revisions"("restored_from_id");

-- CreateIndex
CREATE INDEX "revisions_cover_media_id_idx" ON "revisions"("cover_media_id");

-- CreateIndex
CREATE UNIQUE INDEX "revisions_post_id_number_key" ON "revisions"("post_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "revisions_id_post_id_key" ON "revisions"("id", "post_id");

-- CreateIndex
CREATE UNIQUE INDEX "tags_slug_key" ON "tags"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE INDEX "revision_tags_tag_id_idx" ON "revision_tags"("tag_id");

-- CreateIndex
CREATE INDEX "slug_redirects_post_id_idx" ON "slug_redirects"("post_id");

-- CreateIndex
CREATE INDEX "comments_post_id_status_created_at_idx" ON "comments"("post_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "comments_moderated_by_id_idx" ON "comments"("moderated_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_sha256_key" ON "media"("sha256");

-- CreateIndex
CREATE INDEX "media_uploaded_by_id_idx" ON "media"("uploaded_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_created_by_id_idx" ON "api_keys"("created_by_id");

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_head_revision_id_fkey" FOREIGN KEY ("head_revision_id") REFERENCES "revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_published_revision_id_fkey" FOREIGN KEY ("published_revision_id") REFERENCES "revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_parent_revision_id_fkey" FOREIGN KEY ("parent_revision_id") REFERENCES "revisions"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_restored_from_id_fkey" FOREIGN KEY ("restored_from_id") REFERENCES "revisions"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_cover_media_id_fkey" FOREIGN KEY ("cover_media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revision_tags" ADD CONSTRAINT "revision_tags_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revision_tags" ADD CONSTRAINT "revision_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slug_redirects" ADD CONSTRAINT "slug_redirects_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_moderated_by_id_fkey" FOREIGN KEY ("moderated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Hand-written. Not generated; scripts/db-drift.mjs filters these by name.
-- ===========================================================================

-- Same-post foreign keys -----------------------------------------------------
-- The single-column keys above prove a revision EXISTS; these prove it belongs
-- to the same post. Without them a post could publish another post's revision,
-- and readers of one URL would see another article. MATCH SIMPLE: a null
-- pointer is not checked, which is what an unpublished post needs.

ALTER TABLE "posts" ADD CONSTRAINT "posts_head_revision_same_post_fkey"
  FOREIGN KEY ("head_revision_id", "id") REFERENCES "revisions"("id", "post_id");

ALTER TABLE "posts" ADD CONSTRAINT "posts_published_revision_same_post_fkey"
  FOREIGN KEY ("published_revision_id", "id") REFERENCES "revisions"("id", "post_id");

ALTER TABLE "revisions" ADD CONSTRAINT "revisions_parent_same_post_fkey"
  FOREIGN KEY ("parent_revision_id", "post_id") REFERENCES "revisions"("id", "post_id");

ALTER TABLE "revisions" ADD CONSTRAINT "revisions_restored_from_same_post_fkey"
  FOREIGN KEY ("restored_from_id", "post_id") REFERENCES "revisions"("id", "post_id");

-- CHECK constraints ----------------------------------------------------------
-- Every length below equals LIMITS in packages/shared/src/contracts/content.ts;
-- packages/db/src/content.test.ts reads this file and fails if they disagree.
-- One constraint per line, so that test can find each number.

ALTER TABLE "posts" ADD CONSTRAINT "posts_slug_format_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("slug") <= 96);
ALTER TABLE "tags" ADD CONSTRAINT "tags_slug_format_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("slug") <= 96);
ALTER TABLE "slug_redirects" ADD CONSTRAINT "slug_redirects_from_slug_format_check" CHECK ("from_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("from_slug") <= 96);

ALTER TABLE "revisions" ADD CONSTRAINT "revisions_title_length_check" CHECK (char_length(btrim("title")) >= 1 AND char_length("title") <= 160);
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_excerpt_length_check" CHECK (char_length("excerpt") <= 300);
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_body_length_check" CHECK (char_length("body") <= 200000);
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_seo_title_length_check" CHECK (char_length("seo_title") <= 70);
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_seo_description_length_check" CHECK (char_length("seo_description") <= 160);
ALTER TABLE "tags" ADD CONSTRAINT "tags_name_length_check" CHECK (char_length(btrim("name")) >= 1 AND char_length("name") <= 40);
ALTER TABLE "comments" ADD CONSTRAINT "comments_name_length_check" CHECK (char_length(btrim("name")) >= 1 AND char_length("name") <= 80);
ALTER TABLE "comments" ADD CONSTRAINT "comments_body_length_check" CHECK (char_length(btrim("body")) >= 1 AND char_length("body") <= 2000);
ALTER TABLE "media" ADD CONSTRAINT "media_alt_length_check" CHECK (char_length(btrim("alt")) >= 1 AND char_length("alt") <= 300);

-- The post state rules (POST_STATUSES in @cms/shared says what each means).
-- PUBLISHED: live, and nothing pending (head is the live revision).
ALTER TABLE "posts" ADD CONSTRAINT "posts_published_state_check"
  CHECK ("status" <> 'PUBLISHED' OR ("published_revision_id" IS NOT NULL AND "published_revision_id" = "head_revision_id"));
-- UNPUBLISHED: readers see nothing.
ALTER TABLE "posts" ADD CONSTRAINT "posts_unpublished_state_check"
  CHECK ("status" <> 'UNPUBLISHED' OR "published_revision_id" IS NULL);
-- DRAFT / IN_REVIEW / SCHEDULED: there is pending work, so the head is not the
-- live revision. (A null head is the instant between inserting a post and its
-- first revision, inside one transaction.)
ALTER TABLE "posts" ADD CONSTRAINT "posts_pending_state_check"
  CHECK ("status" NOT IN ('DRAFT', 'IN_REVIEW', 'SCHEDULED') OR "head_revision_id" IS NULL OR "head_revision_id" IS DISTINCT FROM "published_revision_id");
-- A time exactly when scheduled, and never otherwise, so a stale time cannot
-- fire after an editor pulls the post back to draft.
ALTER TABLE "posts" ADD CONSTRAINT "posts_scheduled_state_check"
  CHECK (("status" = 'SCHEDULED') = ("scheduled_for" IS NOT NULL));
-- A live post has a publication date.
ALTER TABLE "posts" ADD CONSTRAINT "posts_published_at_check"
  CHECK ("published_revision_id" IS NULL OR "published_at" IS NOT NULL);

-- Revision lineage: the first revision has no parent, every later one has one,
-- and none is its own.
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_lineage_check"
  CHECK ("number" >= 1 AND ("number" = 1) = ("parent_revision_id" IS NULL) AND "parent_revision_id" IS DISTINCT FROM "id" AND "restored_from_id" IS DISTINCT FROM "id");

-- A decision has a time; a pending comment has none.
ALTER TABLE "comments" ADD CONSTRAINT "comments_moderation_check"
  CHECK (("status" = 'PENDING') = ("moderated_at" IS NULL));
-- A keyed SHA-256, hex. Never an address.
ALTER TABLE "comments" ADD CONSTRAINT "comments_ip_hash_check" CHECK ("ip_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "media" ADD CONSTRAINT "media_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "media" ADD CONSTRAINT "media_mime_type_check" CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif'));
ALTER TABLE "media" ADD CONSTRAINT "media_dimensions_check" CHECK ("bytes" > 0 AND "width" > 0 AND "height" > 0);

-- Shown in the studio as `hcms_` plus eight characters; the key itself is never stored.
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_prefix_check" CHECK ("prefix" ~ '^hcms_[A-Za-z0-9_-]{8}$');
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_key_hash_check" CHECK ("key_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_name_length_check" CHECK (char_length(btrim("name")) >= 1 AND char_length("name") <= 80);

ALTER TABLE "revalidation_events" ADD CONSTRAINT "revalidation_events_shape_check"
  CHECK ("attempts" >= 0 AND cardinality("tags") >= 1);

-- Immutable revisions ---------------------------------------------------------
-- History that can be edited is not history. UPDATE is always refused. DELETE
-- is refused while the post still exists, which leaves exactly one way to
-- remove a revision: deleting its post, whose ON DELETE CASCADE runs after the
-- post row is gone.

CREATE FUNCTION "revisions_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'revisions_immutable: revision % is immutable; save a new revision instead', OLD."id"
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'revisions_immutable';
  END IF;
  IF EXISTS (SELECT 1 FROM "posts" WHERE "id" = OLD."post_id") THEN
    RAISE EXCEPTION 'revisions_immutable: revision % belongs to a post that still exists; delete the post instead', OLD."id"
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'revisions_immutable';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "revisions_immutable" BEFORE UPDATE OR DELETE ON "revisions"
  FOR EACH ROW EXECUTE FUNCTION "revisions_immutable"();

-- A redirect never shadows a live slug -----------------------------------------
-- If /old-slug were both a redirect and some post's slug, which one a reader
-- got would depend on the router's order. Checked from both sides. The
-- advisory lock serialises the two sides per slug, so a rename and a redirect
-- racing for the same slug cannot both pass: under READ COMMITTED each query
-- in the function takes a fresh snapshot, so whoever waits sees the other's
-- committed row.
--
-- Raised as check_violation, not unique_violation: Prisma's typed client turns
-- 23505 into P2002 with no target and drops the message, and with it the only
-- place this constraint's name appears.

CREATE FUNCTION "slug_redirects_not_live"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  candidate TEXT;
BEGIN
  -- NEW is read inside each branch: plpgsql resolves a field against the row
  -- type of the table that fired, so NEW."slug" on slug_redirects is an error.
  IF TG_TABLE_NAME = 'posts' THEN
    candidate := NEW."slug";
    PERFORM pg_advisory_xact_lock(hashtext('slug:' || candidate));
    IF EXISTS (SELECT 1 FROM "slug_redirects" WHERE "from_slug" = candidate) THEN
      RAISE EXCEPTION 'slug_redirects_not_live: slug "%" is a redirect to another post; remove the redirect first', candidate
        USING ERRCODE = 'check_violation', CONSTRAINT = 'slug_redirects_not_live';
    END IF;
  ELSE
    candidate := NEW."from_slug";
    PERFORM pg_advisory_xact_lock(hashtext('slug:' || candidate));
    IF EXISTS (SELECT 1 FROM "posts" WHERE "slug" = candidate) THEN
      RAISE EXCEPTION 'slug_redirects_not_live: slug "%" is a live post; a redirect cannot shadow it', candidate
        USING ERRCODE = 'check_violation', CONSTRAINT = 'slug_redirects_not_live';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "posts_slug_not_redirect" BEFORE INSERT OR UPDATE OF "slug" ON "posts"
  FOR EACH ROW EXECUTE FUNCTION "slug_redirects_not_live"();

CREATE TRIGGER "slug_redirects_not_live" BEFORE INSERT OR UPDATE OF "from_slug" ON "slug_redirects"
  FOR EACH ROW EXECUTE FUNCTION "slug_redirects_not_live"();

-- Partial indexes ---------------------------------------------------------------
-- The moderation queue reads pending comments oldest first, and the publisher
-- reads undelivered events by due time. Both sets stay small while their tables
-- grow, so an index over only those rows stays small too.

CREATE INDEX "comments_pending_queue_idx" ON "comments"("created_at") WHERE "status" = 'PENDING';

CREATE INDEX "revalidation_events_undelivered_idx" ON "revalidation_events"("next_attempt_at") WHERE "delivered_at" IS NULL;
