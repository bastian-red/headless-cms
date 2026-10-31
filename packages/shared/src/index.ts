/**
 * The browser-safe entry point of @cms/shared. Server-only code (jsonwebtoken,
 * scrypt) lives behind `@cms/shared/server`.
 */
export * from './contracts';
export * from './errors';
/**
 * The zod these contracts are built with. A consumer that patches zod (the
 * API's OpenAPI generator) must patch this instance: under a dual ESM/CJS
 * load, its own `import 'zod'` can be a second copy whose prototype the
 * schemas here never see.
 */
export { z } from 'zod';
