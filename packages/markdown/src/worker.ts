/**
 * Renders bodies in a worker thread for `RenderChecker` (server.ts).
 *
 * Posts `{ ready }` once its imports have loaded, then answers each
 * `{ id, markdown }` with `{ id, ...result }`, one at a time. A stack overflow
 * or an audit refusal is reported, not thrown, so the parent can tell them
 * apart from a timeout. A body that never finishes is the parent's problem:
 * it terminates this thread and starts another.
 */
/// <reference types="node" />
import { parentPort } from 'node:worker_threads';

import { UnsafeOutputError } from './audit.js';
import { render } from './render.js';

const port = parentPort;
if (port === null) throw new Error('worker.ts runs only as a worker thread');

port.on('message', ({ id, markdown }: { id: number; markdown: string }) => {
  const started = performance.now();
  try {
    const { words } = render(markdown);
    port.postMessage({ id, ok: true, ms: performance.now() - started, words });
  } catch (error) {
    port.postMessage({
      id,
      ok: false,
      reason: error instanceof UnsafeOutputError ? 'unsafe' : 'crash',
      detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
});

// The imports above are loaded; from here on a deadline measures rendering,
// not the cost of starting a thread on a busy machine.
port.postMessage({ ready: true });
