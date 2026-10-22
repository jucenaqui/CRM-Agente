import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      DB_PATH: ':memory:',
      JWT_SECRET: 'test-secret-test-secret-test-secret-123',
      RATE_LIMIT_DISABLED: '1',
      BCRYPT_ROUNDS: '4',
    },
    testTimeout: 20000,
  },
});
