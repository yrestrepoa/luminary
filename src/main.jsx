import React from 'react';
import ReactDOM from 'react-dom/client';
// Fuentes autoalojadas (@fontsource): sin peticiones a Google Fonts, que veía la IP de cada
// visitante. La CSP del servidor solo permite fuentes y estilos de 'self'.
import '@fontsource/rubik/400.css';
import '@fontsource/rubik/500.css';
import '@fontsource/rubik/600.css';
import '@fontsource/rubik/700.css';
import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/600.css';
import '@fontsource/source-sans-3/700.css';
import App from './App.jsx';
import './index.css';
import { STELLAR_CONFIG_PROBLEMS } from './config/stellar.js';

// Configuración de red incompleta (p.ej. mainnet sin RPC): visible en la consola del navegador.
for (const problem of STELLAR_CONFIG_PROBLEMS) console.error(`[config] ${problem}`);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
