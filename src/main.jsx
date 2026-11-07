import React from 'react';
import ReactDOM from 'react-dom/client';
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
