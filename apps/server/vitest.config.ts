import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@tubescribe/server',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
