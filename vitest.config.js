import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tres proyectos:
//  - server:      tests unitarios de la API (Node, sin red ni BD).
//  - integration: API completa con supertest contra Postgres + Redis reales
//                 (TEST_DATABASE_URL / TEST_REDIS_URL; se omiten si no están definidas).
//                 Comparten la BD → archivos en serie.
//  - web:         lógica y componentes del frontend en jsdom.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['server/**/*.js', 'src/**/*.{js,jsx}'],
      exclude: ['server/scripts/**', 'server/test/**', 'src/test/**', 'src/main.jsx', 'src/data/**', '**/*.test.*'],
      reporter: ['text-summary', 'text', 'json-summary', 'html'],
    },
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/test/unit/**/*.test.js'],
          setupFiles: ['server/test/setup-env.js'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['server/test/integration/**/*.test.js'],
          setupFiles: ['server/test/setup-env.js'],
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
      {
        plugins: [react()],
        define: { global: 'globalThis' },
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['src/**/*.test.{js,jsx}'],
          setupFiles: ['src/test/setup.js'],
        },
      },
    ],
  },
});
