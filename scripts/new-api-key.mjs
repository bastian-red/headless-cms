#!/usr/bin/env node
/**
 * Prints a new content API key in the shape the API accepts (`hcms_` + 8 + 43
 * base64url characters, as `generateApiKey` in @cms/shared makes them), for
 * `CONTENT_API_KEY` in `.env`. `pnpm db:seed` then registers its hash:
 *
 *   sed -i "s|^CONTENT_API_KEY=.*|CONTENT_API_KEY=$(node scripts/new-api-key.mjs)|" .env
 *
 * Standalone (no build needed): a fresh clone runs it before anything is built.
 */
import { randomBytes } from 'node:crypto';

const part = (bytes) => randomBytes(bytes).toString('base64url');
process.stdout.write(`hcms_${part(6)}${part(32)}\n`);
