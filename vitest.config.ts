import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    hookTimeout: 120_000,
    testTimeout: 30_000,
    pool: 'forks',
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-that-is-long-enough-for-validation',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/unused',
    },
  },
})
