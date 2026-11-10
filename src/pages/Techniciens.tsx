// Techniciens : plan de charge et congés (vue principale) ; fiches Odoo ↔ GestCo en second onglet.
import { useSearchParams } from 'react-router-dom';
import FichesTechniciens from './FichesTechniciens';
import PlanDeCharge from './PlanDeCharge';

const ONGLETS = [
  { cle: 'charge', libelle: 'Plan de charge et congés' },
  { cle: 'fiches', libelle: 'Fiches Odoo ↔ GestCo' },
] as const;

export default function Techniciens() {
  const [params, setParams] = useSearchParams();
  const onglet = params.get('vue') === 'fiches' ? 'fiches' : 'charge';
  return (
    <>
      <div className="entete">
        <div>
          <h1>Techniciens</h1>
          <div className="sous-titre">{onglet === 'charge'
            ? 'Disponibilité de chaque technicien croisée avec ses interventions, ses congés et les jours fériés'
            : 'Employés Odoo rapprochés de GestCo'}</div>
        </div>
        <div className="segmente" role="tablist" aria-label="Vue">
          {ONGLETS.map((o) => (
            <button key={o.cle} type="button" role="tab" aria-selected={onglet === o.cle}
              className={onglet === o.cle ? 'actif' : ''}
              onClick={() => setParams(o.cle === 'charge' ? {} : { vue: o.cle }, { replace: true })}>{o.libelle}</button>
          ))}
        </div>
      </div>
      {onglet === 'charge' ? <PlanDeCharge /> : <FichesTechniciens />}
    </>
  );
}
