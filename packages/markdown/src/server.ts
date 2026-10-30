/**
 * Server only (`@cms/markdown/server`): the check a revision must pass before
 * it is saved.
 *
 * The parser is not linear on every input. Measured on micromark 4 (the parser
 * under remark), 16,000 characters of alternating emphasis (`*_*_…a…_*_*`)
 * take 8 s, 400 levels of nested list take 4.8 s, and 8,000 nested `>` overflow
 * the stack. The body limit is 200,000 characters, so one saved post could stall
 * every server that renders it. No cheap scan of the source bounds this
 * reliably, so the bound is time: the render runs in a worker thread with a
 * deadline, and a worker that misses it is terminated. The API refuses to save
 * a body that fails here (422), so pages, feeds and the search index only ever
 * render bodies that finished in budget.
 */
/// <reference types="node" />
import { Worker } from 'node:worker_threads';

/**
 * The longest a body may take to render. The seeded 3,451-word long read
 * takes about 55 ms in a warm process and about 200 ms in a fresh worker; the
 * budget leaves room for a slow CI machine and is still far below the slow
 * shapes above.
 */
export const RENDER_BUDGET_MS = 2000;

export type RenderCheck =
  | { readonly ok: true; readonly ms: number; readonly words: number }
  | {
      readonly ok: false;
      readonly reason: 'timeout' | 'crash' | 'unsafe';
      readonly detail: string;
    };

const WORKER = new URL('./worker.js', import.meta.url);

/**
 * Starting a thread and loading the parser is not the body's fault, so it has
 * its own, generous limit. The render deadline starts when the worker says it
 * is ready; before that change a 170 ms render missed a 2 s deadline on a busy
 * machine because thread start-up was counted against it.
 */
export const STARTUP_LIMIT_MS = 15_000;

export function checkRenderable(
  markdown: string,
  { timeoutMs = RENDER_BUDGET_MS }: { timeoutMs?: number } = {},
): Promise<RenderCheck> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER, {
      workerData: { markdown },
      // Not the host's flags: a loader or `--input-type` meant for the parent
      // makes the worker fail to start, which would read as "crash" for every body.
      execArgv: [],
      // A worker cannot take the server's memory with it.
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    let settled = false;
    const settle = (result: RenderCheck): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };
    let timer = setTimeout(() => {
      settle({
        ok: false,
        reason: 'crash',
        detail: `worker did not start within ${String(STARTUP_LIMIT_MS)} ms`,
      });
    }, STARTUP_LIMIT_MS);
    worker.on('message', (message: RenderCheck | { ready: true }) => {
      if (!('ready' in message)) {
        settle(message);
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        settle({
          ok: false,
          reason: 'timeout',
          detail: `did not render within ${String(timeoutMs)} ms`,
        });
      }, timeoutMs);
    });
    worker.once('error', (error) =>
      settle({ ok: false, reason: 'crash', detail: `${error.name}: ${error.message}` }),
    );
    worker.once('exit', (code) =>
      settle({ ok: false, reason: 'crash', detail: `worker exited with code ${String(code)}` }),
    );
  });
}
