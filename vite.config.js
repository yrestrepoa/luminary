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
    build: {
      // Sin sourcemaps públicos en producción (actívalos con VITE_SOURCEMAP=true si subes los
      // mapas a un servicio de errores en lugar de servirlos).
      sourcemap: env.VITE_SOURCEMAP === 'true',
      // El SDK de Stellar es grande por sí solo (~620 kB); se carga solo en las vistas que lo usan
      // (Rollup lo separa solo gracias a las rutas perezosas y a sus propios import() internos).
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          // Dependencias estables en chunks propios: se cachean entre despliegues de la app.
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'react';
            if (id.includes('@stellar/freighter-api')) return 'freighter';
            return undefined;
          },
        },
      },
    },
    server: {
      proxy: {
        '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
      },
    },
  };
});
