/**
 * One render, in a worker thread, for `checkRenderable` (server.ts). Posts
 * `{ ready }`, then one result, and exits. A stack overflow or an audit refusal is reported, not
 * thrown, so the parent can tell them apart from a timeout.
 */
/// <reference types="node" />
import { parentPort, workerData } from 'node:worker_threads';

import { UnsafeOutputError } from './audit.js';
import { render } from './render.js';

// The imports above are loaded; from here on the parent's deadline is the
// render's alone, not the cost of starting a thread on a busy machine.
parentPort?.postMessage({ ready: true });

const started = performance.now();
try {
  const { words } = render((workerData as { markdown: string }).markdown);
  parentPort?.postMessage({ ok: true, ms: performance.now() - started, words });
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    reason: error instanceof UnsafeOutputError ? 'unsafe' : 'crash',
    detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  });
}
