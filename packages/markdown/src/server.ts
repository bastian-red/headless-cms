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
  | {
      readonly ok: true;
      readonly ms: number;
      readonly words: number;
      /**
       * The text a reader sees (`render().text`), computed by the render that
       * just passed. The search index stores this, so indexing never runs
       * the parser outside the deadline.
       */
      readonly text: string;
    }
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

interface Job {
  readonly id: number;
  readonly markdown: string;
  readonly timeoutMs: number;
  readonly resolve: (result: RenderCheck) => void;
}

/**
 * One long-lived worker that checks bodies in order.
 *
 * Starting a thread and loading the parser costs about 500 ms, which a save
 * should pay once per process, not once per keystroke-driven autosave. Checks
 * queue, and each one's deadline starts when it reaches the worker, so a slow
 * body delays the saves behind it by at most one budget. A timeout or a crash
 * terminates the worker; the next check starts a fresh one, so a hostile body
 * cannot poison the checker for anybody after it.
 */
export class RenderChecker {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private readonly queue: Job[] = [];
  private running: Job | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;
  private closed = false;

  check(
    markdown: string,
    { timeoutMs = RENDER_BUDGET_MS }: { timeoutMs?: number } = {},
  ): Promise<RenderCheck> {
    if (this.closed) return Promise.reject(new Error('RenderChecker is closed'));
    return new Promise((resolve) => {
      this.queue.push({ id: this.nextId++, markdown, timeoutMs, resolve });
      this.pump();
    });
  }

  /** Stops the worker. Pending checks resolve as crashes. */
  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.queue.splice(0)) {
      job.resolve({ ok: false, reason: 'crash', detail: 'the render checker was closed' });
    }
    const worker = this.worker;
    this.discard();
    this.finish({ ok: false, reason: 'crash', detail: 'the render checker was closed' });
    if (worker !== null) await worker.terminate();
  }

  private pump(): void {
    if (this.running !== null || this.queue.length === 0) return;
    const job = this.queue.shift()!;
    this.running = job;
    void this.start().then(
      () => {
        if (this.running !== job) return;
        this.timer = setTimeout(() => {
          // Detach first: the next job must go to a fresh worker, not to this
          // one, which is still busy with the body that ran out of time.
          this.discard();
          this.finish({
            ok: false,
            reason: 'timeout',
            detail: `did not render within ${String(job.timeoutMs)} ms`,
          });
        }, job.timeoutMs);
        this.worker?.postMessage({ id: job.id, markdown: job.markdown });
      },
      (error: unknown) => {
        this.discard();
        this.finish({ ok: false, reason: 'crash', detail: String(error) });
      },
    );
  }

  /** The worker, started if there is none, resolved once it reports ready. */
  private start(): Promise<void> {
    if (this.ready !== null) return this.ready;
    const worker = new Worker(WORKER, {
      // Not the host's flags: a loader or `--input-type` meant for the parent
      // makes the worker fail to start, which would read as "crash" for every body.
      execArgv: [],
      // A worker cannot take the server's memory with it.
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    this.worker = worker;
    this.ready = new Promise<void>((resolve, reject) => {
      const startup = setTimeout(
        () => reject(new Error(`worker did not start within ${String(STARTUP_LIMIT_MS)} ms`)),
        STARTUP_LIMIT_MS,
      );
      worker.on('message', (message: ({ id: number } & RenderCheck) | { ready: true }) => {
        if ('ready' in message) {
          clearTimeout(startup);
          resolve();
          return;
        }
        if (this.running?.id !== message.id) return;
        const { id: _id, ...result } = message;
        this.finish(result as RenderCheck);
      });
      const fail = (detail: string): void => {
        clearTimeout(startup);
        reject(new Error(detail));
        if (this.worker === worker) {
          this.finish({ ok: false, reason: 'crash', detail });
          this.worker = null;
          this.ready = null;
        }
      };
      worker.once('error', (error) => fail(`${error.name}: ${error.message}`));
      worker.once('exit', (code) => fail(`worker exited with code ${String(code)}`));
    });
    // A rejection is handled by pump(); this keeps a startup failure while no
    // job waits from becoming an unhandled rejection.
    this.ready.catch(() => undefined);
    return this.ready;
  }

  private finish(result: RenderCheck): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const job = this.running;
    this.running = null;
    job?.resolve(result);
    if (!this.closed) this.pump();
  }

  /** Forgets the current worker (terminating it in the background); the next job starts a new one. */
  private discard(): void {
    const worker = this.worker;
    this.worker = null;
    this.ready = null;
    if (worker !== null) void worker.terminate();
  }
}

/** A one-off check in its own worker. A server keeps a `RenderChecker` instead. */
export async function checkRenderable(
  markdown: string,
  options: { timeoutMs?: number } = {},
): Promise<RenderCheck> {
  const checker = new RenderChecker();
  try {
    return await checker.check(markdown, options);
  } finally {
    await checker.close();
  }
}
