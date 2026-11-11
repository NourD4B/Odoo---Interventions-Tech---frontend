// Véhicules : la flotte (photos, modèles, fiches constructeur, corrections Odoo), le rapprochement Odoo ↔ SPOC
// et la recherche du conducteur pour un PV.
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, aujourdhui, LIBELLES_RAPPROCHEMENT, type Affectation, type ResultatPV } from '../api';
import { Avertissements, Badge, EtatChargement, ListeEcarts, useDonnees } from '../composants';
import Flotte from './Flotte';

const ONGLETS = [
  { cle: 'flotte', libelle: 'Flotte', aide: 'Véhicules de service : modèle, missions, conducteurs et pièces jointes (traçabilité des PV)' },
  { cle: 'rapprochement', libelle: 'Odoo ↔ SPOC', aide: 'Fleet (Odoo) rapproché du parc SPOC (HFSQL), historique des conducteurs' },
  { cle: 'pv', libelle: 'PV', aide: 'Qui conduisait ? (PV à désigner sous 45 jours)' },
] as const;

export default function Vehicules() {
  const [params, setParams] = useSearchParams();
  const onglet = ONGLETS.find((o) => o.cle === params.get('vue')) ?? ONGLETS[0];
  return (
    <>
      <div className="entete">
        <div>
          <h1>Véhicules</h1>
          <div className="sous-titre">{onglet.aide}</div>
        </div>
        <div className="segmente" role="tablist" aria-label="Vue">
          {ONGLETS.map((o) => (
            <button key={o.cle} type="button" role="tab" aria-selected={onglet.cle === o.cle}
              className={onglet.cle === o.cle ? 'actif' : ''}
              onClick={() => setParams(o.cle === 'flotte' ? {} : { vue: o.cle }, { replace: true })}>{o.libelle}</button>
          ))}
        </div>
      </div>
      {onglet.cle === 'flotte' && <Flotte />}
      {onglet.cle === 'rapprochement' && <Rapprochement />}
      {onglet.cle === 'pv' && <RecherchePV />}
    </>
  );
}

function Rapprochement() {
  const { donnees, erreur, chargement } = useDonnees(() => api.vehicules(), []);
  const [historique, setHistorique] = useState<{ plaque: string; lignes: Affectation[] } | null>(null);
  const vehicules = donnees?.vehicules ?? [];
  const pool = vehicules.filter((v) => v.odoo?.pool).length;

  const ouvrirHistorique = (id: number, plaque: string) => {
    api.affectations(id).then((lignes) => setHistorique({ plaque, lignes })).catch(() => setHistorique(null));
  };

  return (
    <>
      <p className="muet rapprochement-resume">{vehicules.length} véhicule(s), dont {pool} en pool</p>
      <EtatChargement chargement={chargement} erreur={erreur} />
      <Avertissements liste={donnees?.avertissements} />

      <div className="rangee">
        <section className="carte large defilement" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Plaque</th><th>Véhicule</th><th>Conducteur (Fleet)</th><th>Sources</th><th>Compteur</th><th /></tr></thead>
            <tbody>
              {vehicules.map((v) => (
                <tr key={v.plaque}>
                  <td><strong>{v.plaque}</strong><ListeEcarts ecarts={v.ecarts} /></td>
                  <td>{[v.odoo?.marque ?? v.hfsql?.marque, v.odoo?.modele ?? v.hfsql?.modele].filter(Boolean).join(' ') || '—'}
                    <div className="muet">{v.odoo?.energie ?? v.hfsql?.energie ?? ''}</div></td>
                  <td>{v.odoo?.pool ? <Badge type="a_planifier">Pool</Badge> : (v.odoo?.conducteur ?? '—')}</td>
                  <td><Badge type={v.rapprochement}>{LIBELLES_RAPPROCHEMENT[v.rapprochement]}</Badge></td>
                  <td>{v.odoo?.compteur ? `${v.odoo.compteur} km` : <span className="muet">non relevé</span>}</td>
                  <td>{v.odoo && <button type="button" className="btn" onClick={() => ouvrirHistorique(v.odoo!.vehicule_id, v.plaque)}>Historique</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <aside className="carte etroit" aria-label="Historique des conducteurs">
          <h2>Historique des conducteurs</h2>
          {!historique && <div className="vide">Choisir « Historique » sur un véhicule.</div>}
          {historique && (<>
            <strong>{historique.plaque}</strong>
            {historique.lignes.map((a, k) => (
              <div key={k} className="bloc bloc-terminee">
                <strong>{a.pool ? 'Pool (conducteur non tracé)' : a.conducteur}</strong>
                <span>{a.debut ?? '?'} → {a.fin ?? 'en cours'}</span>
              </div>
            ))}
          </>)}
        </aside>
      </div>
    </>
  );
}

function RecherchePV() {
  const [plaque, setPlaque] = useState('');
  const [jour, setJour] = useState(aujourdhui());
  const [resultat, setResultat] = useState<ResultatPV | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const chercher = (e: FormEvent) => {
    e.preventDefault();
    setErreur(null);
    api.pv(plaque, jour).then(setResultat).catch((err: Error) => { setResultat(null); setErreur(err.message); });
  };

  return (
    <section className="carte" aria-label="Recherche PV">
      <h2>Qui conduisait ? (PV à désigner sous 45 jours)</h2>
      <form className="filtres" onSubmit={chercher}>
        <label className="champ">Plaque<input value={plaque} onChange={(e) => setPlaque(e.target.value)} placeholder="GX-127-AS" required /></label>
        <label className="champ">Date de l'infraction<input type="date" value={jour} onChange={(e) => setJour(e.target.value)} required /></label>
        <button type="submit" className="btn btn-primaire">Rechercher</button>
      </form>
      {erreur && <div className="erreur">{erreur}</div>}
      {resultat && (
        <div className={resultat.conducteur_identifie ? 'bloc bloc-terminee' : 'avertissement'}>
          <strong>{resultat.conducteur_identifie ?? 'Conducteur non identifié'}</strong>
          <span>{resultat.message}</span>
        </div>
      )}
    </section>
  );
}
