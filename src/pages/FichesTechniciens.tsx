import { useState } from 'react';
import { api, LIBELLES_CLASSIFICATION, LIBELLES_RAPPROCHEMENT, type Classification } from '../api';
import { Avertissements, Badge, EtatChargement, ListeEcarts, useDonnees } from '../composants';

/** Employés Odoo rapprochés de GestCo (contrôle des fiches), onglet « Fiches techniciens » de Contrôle des données. */
export default function FichesTechniciens() {
  const [filtre, setFiltre] = useState<Classification | ''>('terrain_confirme');
  const { donnees, erreur, chargement } = useDonnees(() => api.techniciens(), []);
  const tous = donnees?.techniciens ?? [];
  const liste = tous.filter((t) => !filtre || t.classification === filtre);
  const compte = (c: Classification) => tous.filter((t) => t.classification === c).length;

  return (
    <>
      <div className="sous-titre">Employés Odoo rapprochés de GestCo (table Commerciaux) · référentiel : backend/config/correspondances.json</div>

      <div className="filtres" role="group" aria-label="Classification">
        {(['terrain_confirme', 'a_confirmer', 'exclu'] as Classification[]).map((c) => (
          <button key={c} type="button" className={`btn${filtre === c ? ' btn-primaire' : ''}`} aria-pressed={filtre === c}
            onClick={() => setFiltre(c)}>{LIBELLES_CLASSIFICATION[c]} ({compte(c)})</button>
        ))}
        <button type="button" className={`btn${filtre === '' ? ' btn-primaire' : ''}`} aria-pressed={filtre === ''}
          onClick={() => setFiltre('')}>Tous ({tous.length})</button>
      </div>

      <EtatChargement chargement={chargement} erreur={erreur} />
      <Avertissements liste={donnees?.avertissements} />

      <section className="carte defilement" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr><th>Technicien</th><th>Classification</th><th>Sources</th><th>Odoo</th><th>GestCo</th><th>Véhicule</th></tr>
          </thead>
          <tbody>
            {liste.map((t) => (
              <tr key={t.id}>
                <td><strong>{t.nom}</strong><ListeEcarts ecarts={t.ecarts} /></td>
                <td><Badge type={t.classification}>{LIBELLES_CLASSIFICATION[t.classification]}</Badge>
                  <div className="muet">{t.motif_classification}</div></td>
                <td><Badge type={t.rapprochement}>{LIBELLES_RAPPROCHEMENT[t.rapprochement]}</Badge></td>
                <td>{t.odoo ? (<>
                  <div>{t.odoo.poste ?? '—'}</div>
                  <div className="muet">{t.odoo.departement ?? ''} · {t.odoo.user_id ? 'utilisateur Odoo' : 'sans utilisateur'}</div>
                </>) : <span className="muet">absent</span>}</td>
                <td>{t.hfsql ? (<>
                  <div>{t.hfsql.code} · {t.hfsql.service ?? '—'}</div>
                  <div className="muet">{t.hfsql.localisation || 'localisation vide'}{t.hfsql.actif ? '' : ' · inactif'}</div>
                </>) : <span className="muet">absent</span>}</td>
                <td>{t.vehicule ? (<>
                  <div>{t.vehicule.plaque}</div>
                  <div className="muet">{t.vehicule.libelle.split('/').slice(0, 2).join(' ')}{t.vehicule.depuis ? ` · depuis ${t.vehicule.depuis}` : ''}</div>
                </>) : <span className="muet">pool</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!chargement && !liste.length && <div className="vide" style={{ padding: 16 }}>Aucun technicien dans cette catégorie.</div>}
      </section>
    </>
  );
}
