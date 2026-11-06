import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api';
import { useDonnees } from './composants';
import CarteLive from './pages/CarteLive';
import Planning from './pages/Planning';
import Reconciliation from './pages/Reconciliation';
import Techniciens from './pages/Techniciens';
import Vehicules from './pages/Vehicules';

const LIENS = [
  { vers: '/carte', libelle: 'Carte live' },
  { vers: '/planning', libelle: 'Planning' },
  { vers: '/techniciens', libelle: 'Techniciens' },
  { vers: '/vehicules', libelle: 'Véhicules et PV' },
  { vers: '/reconciliation', libelle: 'Contrôle des données' },
];

export default function App() {
  const etat = useDonnees(() => api.etat(), []);
  return (
    <div className="app">
      <nav className="barre-laterale" aria-label="Navigation principale">
        <div className="logo">
          <div className="logo-carre">D4B</div>
          <div><strong>Interventions</strong><small>Digital4Business</small></div>
        </div>
        <div className="nav">
          {LIENS.map((l) => (
            <NavLink key={l.vers} to={l.vers} className={({ isActive }) => (isActive ? 'actif' : '')}>{l.libelle}</NavLink>
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
          <Route path="/planning" element={<Planning />} />
          <Route path="/techniciens" element={<Techniciens />} />
          <Route path="/vehicules" element={<Vehicules />} />
          <Route path="/reconciliation" element={<Reconciliation />} />
        </Routes>
      </main>
    </div>
  );
}
