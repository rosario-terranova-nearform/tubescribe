// @tubescribe/shared — single source of truth for cross-package API contracts
// and the smart source-input parser. The server validates requests with these
// zod schemas; the web client parses responses with the same ones.

export * from './domain.js';
export * from './errors.js';
export * from './source-input.js';
export * from './api/index.js';

export const SHARED_PACKAGE_NAME = '@tubescribe/shared';
export type HealthResponse = { ok: boolean };
