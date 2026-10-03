import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@tubescribe/shared',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
