import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // stellar-sdk referencia `global` (estilo Node) en algunas dependencias.
  define: { global: 'globalThis' },
});
