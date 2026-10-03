import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@tubescribe/web',
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
    css: false,
  },
});
