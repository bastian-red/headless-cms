/**
 * `pnpm search:reindex [--all]`: write the search document of every revision
 * that has none, or with `--all`, rewrite every one.
 *
 * Search documents are derived data. The API writes one with every revision
 * and the seed writes its own, so on a healthy database this finds nothing.
 * It is for a database that holds revisions written before search existed,
 * and for a change to the renderer or to `searchText` (`--all`). Each body
 * goes through the same deadline-bounded worker as a save, so a body the
 * parser chokes on is reported, not indexed, and cannot stall the run.
 * `--all` rewrites rows in place (upsert), so search never goes empty while
 * it runs.
 */
import { createPrismaClient } from '@cms/db';
import { searchDocument } from '@cms/shared';

const BATCH = 200;

async function main(): Promise<number> {
  const all = process.argv.includes('--all');
  const db = createPrismaClient();
  const { RenderChecker } = await import('@cms/markdown/server');
  const checker = new RenderChecker();
  const where = all ? {} : { search: { is: null } };
  const todo = await db.revision.count({ where });
  console.info(`search reindex: ${String(todo)} revision(s) to index${all ? ' (--all)' : ''}`);

  let written = 0;
  const refused: string[] = [];
  let after: string | undefined;
  try {
    for (;;) {
      const batch = await db.revision.findMany({
        where: { ...where, ...(after === undefined ? {} : { id: { gt: after } }) },
        orderBy: { id: 'asc' },
        take: BATCH,
        select: { id: true, title: true, excerpt: true, body: true },
      });
      if (batch.length === 0) break;
      for (const revision of batch) {
        const check = await checker.check(revision.body);
        if (!check.ok) {
          refused.push(`${revision.id} (${check.reason})`);
          continue;
        }
        const { revisionId, ...fields } = searchDocument(revision.id, {
          ...revision,
          text: check.text,
        });
        await db.searchDocument.upsert({
          where: { revisionId },
          create: { revisionId, ...fields },
          update: fields,
        });
        written += 1;
      }
      after = batch.at(-1)!.id;
      console.info(`search reindex: ${String(written + refused.length)}/${String(todo)}`);
    }
  } finally {
    await checker.close();
    await db.$disconnect();
  }

  console.info(`search reindex: wrote ${String(written)}, refused ${String(refused.length)}`);
  for (const line of refused) console.info(`  refused: ${line}`);
  return refused.length === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error('search reindex failed:', error);
    process.exit(2);
  },
);
