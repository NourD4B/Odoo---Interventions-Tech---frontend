import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, LIBELLES_RAPPROCHEMENT } from '../api';
import { Avertissements, Badge, EtatChargement, ListeEcarts, useDonnees } from '../composants';
import FichesTechniciens from './FichesTechniciens';

const ONGLETS = [
  { cle: 'ecarts', libelle: 'Écarts Odoo ↔ HFSQL' },
  { cle: 'fiches', libelle: 'Fiches techniciens Odoo ↔ GestCo' },
] as const;

/** Contrôle des données : écarts Odoo ↔ HFSQL à corriger à la source, et fiches techniciens (?vue=fiches). */
export default function Reconciliation() {
  const [params, setParams] = useSearchParams();
  const onglet = params.get('vue') === 'fiches' ? 'fiches' : 'ecarts';
  const onglets = (
    <div className="segmente" role="tablist" aria-label="Vue">
      {ONGLETS.map((o) => (
        <button key={o.cle} type="button" role="tab" aria-selected={onglet === o.cle} className={onglet === o.cle ? 'actif' : ''}
          onClick={() => setParams(o.cle === 'ecarts' ? {} : { vue: o.cle }, { replace: true })}>{o.libelle}</button>
      ))}
    </div>
  );
  if (onglet === 'fiches') {
    return (
      <>
        <div className="entete">
          <div><h1>Contrôle des données</h1></div>
          {onglets}
        </div>
        <FichesTechniciens />
      </>
    );
  }
  return <Ecarts onglets={onglets} />;
}

function Ecarts({ onglets }: { onglets: ReactNode }) {
  const synthese = useDonnees(() => api.reconciliation(), []);
  const techs = useDonnees(() => api.techniciens(), []);
  const vehs = useDonnees(() => api.vehicules(), []);

  const techsAVoir = (techs.donnees?.techniciens ?? []).filter((t) => t.rapprochement !== 'concordant' && t.classification !== 'exclu');
  const vehsAVoir = (vehs.donnees?.vehicules ?? []).filter((v) => v.rapprochement !== 'concordant');

  return (
    <>
      <div className="entete">
        <div>
          <h1>Contrôle des données</h1>
          <div className="sous-titre">Écarts entre Odoo et HFSQL à corriger dans la source concernée</div>
        </div>
        {onglets}
      </div>

      <EtatChargement chargement={synthese.chargement} erreur={synthese.erreur} />
      <Avertissements liste={[...(techs.donnees?.avertissements ?? []), ...(vehs.donnees?.avertissements ?? [])]} />

      <div className="kpis">
        {synthese.donnees?.map((s) => (
          <div key={s.entite} className="kpi">
            <span style={{ textTransform: 'capitalize' }}>{s.entite}</span>
            <strong>{s.concordant}/{s.total}</strong>
            <span>concordants · {s.ecart} écart(s) · {s.odoo_seul} Odoo seul · {s.hfsql_seul} HFSQL seul · {s.ambigu} ambigu(s)</span>
          </div>
        ))}
      </div>

      <section className="carte defilement">
        <h2>Techniciens à vérifier ({techsAVoir.length})</h2>
        <table>
          <thead><tr><th>Technicien</th><th>Statut</th><th>Que faire</th></tr></thead>
          <tbody>
            {techsAVoir.map((t) => (
              <tr key={t.id}>
                <td><strong>{t.nom}</strong><ListeEcarts ecarts={t.ecarts} /></td>
                <td><Badge type={t.rapprochement}>{LIBELLES_RAPPROCHEMENT[t.rapprochement]}</Badge></td>
                <td className="muet">{conseil(t.rapprochement)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="carte defilement">
        <h2>Véhicules à vérifier ({vehsAVoir.length})</h2>
        <table>
          <thead><tr><th>Plaque</th><th>Statut</th><th>Que faire</th></tr></thead>
          <tbody>
            {vehsAVoir.map((v) => (
              <tr key={v.plaque}>
                <td><strong>{v.plaque}</strong><ListeEcarts ecarts={v.ecarts} /></td>
                <td><Badge type={v.rapprochement}>{LIBELLES_RAPPROCHEMENT[v.rapprochement]}</Badge></td>
                <td className="muet">{conseil(v.rapprochement)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function conseil(r: string): string {
  switch (r) {
    case 'ecart': return 'Corriger la valeur fausse dans la source concernée.';
    case 'odoo_seul': return 'Absent de HFSQL : créer la fiche, ou confirmer que c’est normal.';
    case 'hfsql_seul': return 'Absent d’Odoo : créer la fiche (employé ou véhicule), ou archiver dans HFSQL.';
    case 'ambigu': return 'Plusieurs correspondances : ajouter un lien dans config/correspondances.json.';
    default: return '';
  }
}
