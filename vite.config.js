import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  // Lee PORT del .env (solo para el proxy; no se expone al cliente).
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = env.PORT || 4000;

  return {
    plugins: [react(), tailwindcss()],
    // stellar-sdk referencia `global` (estilo Node) en algunas dependencias.
    define: { global: 'globalThis' },
    server: {
      proxy: {
        '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
      },
    },
  };
});
