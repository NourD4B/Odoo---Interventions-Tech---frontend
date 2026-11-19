import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En développement, /api est relayé vers le backend FastAPI (port 8000).
// « npm run build:odoo » (mode odoo) : écrans pour le module Odoo d4b_interventions, servis sous
// /d4b_interventions/static/app/ (dossier dist-odoo, à copier dans odoo_addon/d4b_interventions/static/app du backend).
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'odoo' ? '/d4b_interventions/static/app/' : '/',
  build: { outDir: mode === 'odoo' ? 'dist-odoo' : 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8000' },
  },
}));
