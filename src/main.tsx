import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { installerModeOdoo, RACINE } from './identite';
import 'leaflet/dist/leaflet.css';
import './styles.css';

installerModeOdoo();                      // build Odoo : appels /api par le relais d'Odoo, avant le 1er rendu

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={RACINE || undefined}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
