import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { capterIdentiteOdoo } from './identite';
import 'leaflet/dist/leaflet.css';
import './styles.css';

capterIdentiteOdoo();                     // ouverte dans Odoo : utilisateur connecté (jeton signé), avant le 1er rendu

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
