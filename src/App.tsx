import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { api } from './api';
import { useDonnees } from './composants';
import CarteLive from './pages/CarteLive';
import DossierProjet from './pages/DossierProjet';
import Dossiers from './pages/Dossiers';
import Exports from './pages/Exports';
import FicheVehicule from './pages/FicheVehicule';
import FicheService from './pages/FicheService';
import Journal from './pages/Journal';
import Materiel from './pages/Materiel';
import Planification from './pages/Planification';
import Reconciliation from './pages/Reconciliation';
import Statistiques from './pages/Statistiques';
import Reglages from './pages/Reglages';
import Services from './pages/Services';
import Vehicules from './pages/Vehicules';

const LIENS = [
  { vers: '/carte', libelle: 'Carte live' },
  { vers: '/statistiques', libelle: 'Statistiques' },
  { vers: '/dossiers', libelle: 'Dossiers projets' },
  { vers: '/services', libelle: 'Services sur site' },
  { vers: '/planification', libelle: 'Planification' },
  { vers: '/reglages', libelle: 'Réglages' },
  { vers: '/journal', libelle: 'Journal' },
  { vers: '/vehicules', libelle: 'Véhicules et PV' },
  { vers: '/materiel', libelle: 'Matériel et traçabilité' },
  { vers: '/exports', libelle: 'Exports' },
  { vers: '/reconciliation', libelle: 'Contrôle des données' },
];

/** Ancienne adresse /projets/:id : le dossier du même projet. */
function VersDossier() {
  return <Navigate to={`/dossiers/${useParams().id ?? ''}`} replace />;
}

export default function App() {
  const etat = useDonnees(() => api.etat(), []);
  // téléphone : la barre latérale devient une barre en haut, menu replié (rouvert par « Menu »)
  const [menuOuvert, setMenuOuvert] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { setMenuOuvert(false); }, [pathname]);
  return (
    <div className="app">
      <nav className={`barre-laterale${menuOuvert ? ' ouverte' : ''}`} aria-label="Navigation principale">
        <div className="barre-tete">
          <div className="logo">
            <div className="logo-carre">D4B</div>
            <div><strong>Interventions</strong><small>Digital4Business</small></div>
          </div>
          <button type="button" className="btn menu-bascule" aria-expanded={menuOuvert} aria-controls="menu-principal"
            onClick={() => setMenuOuvert((o) => !o)}>
            <span className="menu-traits" aria-hidden="true"><i /><i /><i /></span>{menuOuvert ? 'Fermer' : 'Menu'}
          </button>
        </div>
        <div className="nav" id="menu-principal">
          {LIENS.map((l) => (
            <NavLink key={l.vers} to={l.vers} className={({ isActive }) => (isActive ? 'actif' : '')}
              onClick={() => setMenuOuvert(false)}>{l.libelle}</NavLink>
          ))}
        </div>
        <div className="sources" aria-label="État des sources">
          {etat.donnees?.sources.map((s) => (
            <div key={s.nom} className="source" title={s.detail}>
              <span className="point" style={{ background: s.ok ? '#0f766e' : '#b91c1c' }} />
              {s.nom} : {s.ok ? 'OK' : 'indisponible'}
            </div>
          ))}
          {etat.erreur && <div className="source">API injoignable</div>}
        </div>
      </nav>
      <main className="principal">
        <Routes>
          <Route path="/" element={<Navigate to="/carte" replace />} />
          <Route path="/carte" element={<CarteLive />} />
          <Route path="/statistiques" element={<Statistiques />} />
          <Route path="/statistiques/services/:id" element={<FicheService />} />
          {/* ancienne page Projets : tout est dans Dossiers projets (cartes, puis dossier complet) */}
          <Route path="/projets" element={<Navigate to="/dossiers" replace />} />
          <Route path="/projets/:id" element={<VersDossier />} />
          <Route path="/dossiers" element={<Dossiers />} />
          <Route path="/dossiers/:id" element={<DossierProjet />} />
          <Route path="/services" element={<Services />} />
          <Route path="/planification" element={<Planification />} />
          <Route path="/reglages" element={<Reglages />} />
          <Route path="/journal" element={<Journal />} />
          {/* ancienne page Techniciens : disponibilités et charge sont dans Planification (vue Mois),
              fiches Odoo ↔ GestCo dans Contrôle des données */}
          <Route path="/techniciens" element={<Navigate to="/planification?vue=mois" replace />} />
          <Route path="/vehicules" element={<Vehicules />} />
          <Route path="/vehicules/:id" element={<FicheVehicule />} />
          <Route path="/reconciliation" element={<Reconciliation />} />
          <Route path="/exports" element={<Exports />} />
          <Route path="/materiel" element={<Materiel />} />
        </Routes>
      </main>
    </div>
  );
}
