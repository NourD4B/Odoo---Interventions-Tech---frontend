// Tableau de bord : services planifiés et réalisés d'une période, avec tous les détails.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EtatChargement, useDonnees } from '../composants';
import { Barre, GraphiqueJours, TableServices, Tuile } from '../composants/Statistiques';
import { dateHeure, euros, heures, nombre, stats, type EtatSynchro, type Tableau } from '../statistiques';

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function lundi(d: Date) { const r = new Date(d); r.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return r; }
function plus(d: string, n: number) { const [a, m, j] = d.split('-').map(Number); return iso(new Date(a, m - 1, j + n)); }

const SURVEILLER: { cle: keyof Tableau['a_surveiller']; titre: string }[] = [
  { cle: 'en_retard', titre: 'En retard' },
  { cle: 'faits_non_factures', titre: 'Faits, pas encore facturés' },
  { cle: 'faits_sans_feuille_signee', titre: 'Faits sans feuille de travail signée' },
  { cle: 'materiel_non_livre', titre: 'Planifiés, matériel pas entièrement livré' },
  { cle: 'sans_position', titre: 'Site sans position (adresse à corriger dans Odoo)' },
];
type Regroupement = 'par_projet' | 'par_client' | 'par_type_service';
const REGROUPEMENTS: { cle: Regroupement; libelle: string }[] = [
  { cle: 'par_projet', libelle: 'Projet' }, { cle: 'par_client', libelle: 'Société' },
  { cle: 'par_type_service', libelle: 'Type de service' },
];

function Synchro({ etat, onSynchroniser, occupe }: { etat: EtatSynchro | null; onSynchroniser: () => void; occupe: boolean }) {
  const taches = etat?.modeles.find((m) => m.modele === 'project.task');
  const erreur = etat?.modeles.find((m) => m.erreur)?.erreur;
  return (
    <div className="synchro">
      <span className={`point ${erreur ? 'point-erreur' : 'point-ok'}`} />
      <span>{taches?.derniere_synchro
        ? <>Copie Odoo du {dateHeure(taches.derniere_synchro)} UTC · {taches.nb_local} tâches</>
        : 'Copie Odoo jamais synchronisée'}
        {erreur && <span className="muet" title={erreur}> · dernière erreur : {erreur.slice(0, 60)}</span>}</span>
      <button type="button" className="btn btn-petit" disabled={occupe || etat?.en_cours} onClick={onSynchroniser}>
        {occupe ? 'Synchronisation…' : 'Synchroniser'}</button>
    </div>
  );
}

export default function Statistiques() {
  const [debut, setDebut] = useState(() => iso(lundi(new Date())));
  const [fin, setFin] = useState(() => plus(iso(lundi(new Date())), 6));
  const [simules, setSimules] = useState(true);
  const [regroupement, setRegroupement] = useState<Regroupement>('par_projet');
  const [occupe, setOccupe] = useState(false);
  const t = useDonnees(() => stats.tableau(debut, fin, simules), [debut, fin, simules]);
  const synchro = useDonnees(() => stats.synchro(), []);
  const semaine = (n: number) => { setDebut(plus(debut, 7 * n)); setFin(plus(fin, 7 * n)); };

  const synchroniser = async () => {
    setOccupe(true);
    try { await stats.synchroniser(); } catch { /* l'état affiche l'erreur */ } finally {
      setOccupe(false); synchro.recharger(); t.recharger();
    }
  };

  const d = t.donnees;
  const maxJours = Math.max(1, ...(d?.par_technicien.map((x) => x.jours_ouvres) ?? [1]));
  const groupes = d ? d[regroupement] : [];
  const maxCa = Math.max(1, ...groupes.map((g) => g.ca_ht));

  return (
    <>
      <div className="entete">
        <div>
          <h1>Statistiques</h1>
          <div className="sous-titre">Services planifiés et réalisés · copie Odoo (lecture seule) + planification ·
            les valeurs « estimées » suivent les règles du solveur</div>
        </div>
        <Synchro etat={synchro.donnees} onSynchroniser={() => void synchroniser()} occupe={occupe} />
      </div>

      <div className="filtres" role="group" aria-label="Période">
        <button type="button" className="btn" aria-label="Semaine précédente" onClick={() => semaine(-1)}>‹</button>
        <button type="button" className="btn" onClick={() => { const l = iso(lundi(new Date())); setDebut(l); setFin(plus(l, 6)); }}>Cette semaine</button>
        <button type="button" className="btn" aria-label="Semaine suivante" onClick={() => semaine(1)}>›</button>
        <label className="champ">Du<input type="date" value={debut} onChange={(e) => e.target.value && setDebut(e.target.value)} /></label>
        <label className="champ">Au<input type="date" value={fin} onChange={(e) => e.target.value && setFin(e.target.value)} /></label>
        <label className="case"><input type="checkbox" checked={simules} onChange={(e) => setSimules(e.target.checked)} />
          Inclure les services simulés</label>
      </div>

      <EtatChargement chargement={t.chargement && !d} erreur={t.erreur} />
      {d && (<>
        {d.compteurs.dont_simules > 0 && (
          <div className="avertissement">{d.compteurs.dont_simules} service(s) sur {d.compteurs.total} sont simulés (copie locale
            seulement, jamais dans Odoo). Décocher « Inclure les services simulés » pour ne voir que les vrais.</div>
        )}
        <section aria-label="Services de la période" className="kpis">
          <Tuile libelle="Planifiés" valeur={d.compteurs.planifies} detail="au moins un jour dans la période" />
          <Tuile libelle="Faits" valeur={d.compteurs.faits} detail="terminés dans la période" />
          <Tuile libelle="À planifier" valeur={d.compteurs.a_planifier} />
          <Tuile libelle="En retard" valeur={d.compteurs.en_retard} detail="date limite passée, pas faits"
                 ton={d.compteurs.en_retard ? 'alerte' : undefined} />
        </section>
        <section aria-label="Argent de la période" className="kpis">
          <Tuile libelle="CA HT (lignes des services)" valeur={euros(d.argent.ca_ht)} />
          <Tuile libelle="Marge matériel" valeur={euros(d.argent.marge_materiel)}
                 detail={`coût matériel ${euros(d.argent.cout_materiel)}`} />
          <Tuile libelle="Facturé HT" valeur={euros(d.argent.facture_ht)} />
          <Tuile libelle="Reste à facturer HT" valeur={euros(d.argent.reste_a_facturer_ht)}
                 detail={`dont services faits ${euros(d.argent.reste_a_facturer_faits_ht)}`} />
          <Tuile libelle="Coûts estimés" valeur={euros(d.argent.couts_estimes)} detail="travail + route + véhicule, hors hôtel et repas" ton="estime" />
          <Tuile libelle="Marge estimée" valeur={euros(d.argent.marge_estimee)} detail="CA − matériel − coûts estimés" ton="estime" />
        </section>

        <section className="carte" aria-labelledby="titre-jours">
          <h2 id="titre-jours">Activité par jour</h2>
          <GraphiqueJours jours={d.par_jour} />
        </section>

        <div className="rangee">
          <section className="carte large" aria-labelledby="titre-techs">
            <h2 id="titre-techs">Charge des techniciens</h2>
            <p className="muet">Jours planifiés sur {d.periode.jours_ouvres} jours ouvrés · heures passées = feuilles de temps Odoo ·
              km estimés depuis l'agence du technicien.</p>
            <div className="defilement"><table>
              <thead><tr><th>Technicien</th><th>Charge</th><th>Services</th><th>Heures passées</th><th className="nombre">Km estimés</th></tr></thead>
              <tbody>{d.par_technicien.map((x) => (
                <tr key={x.matricule} className={x.jours_planifies ? '' : 'ligne-libre'}>
                  <td><strong>{x.nom}</strong><div className="muet">{x.matricule} · {x.agence ?? 'agence ?'}</div></td>
                  <td style={{ minWidth: 180 }}><Barre valeur={x.jours_planifies} max={maxJours}
                    texte={`${x.jours_planifies} j / ${x.jours_ouvres} (${nombre(x.taux_charge_pct)} %)`} /></td>
                  <td>{x.services}</td><td className="nowrap">{heures(x.heures_passees)}</td><td className="nowrap nombre">{nombre(x.km_estimes)} km</td>
                </tr>))}</tbody>
            </table></div>
            {d.autres_employes.length > 0 && <p className="muet">Autres temps saisis (pas des techniciens terrain) :{' '}
              {d.autres_employes.map((x) => `${x.nom} ${heures(x.heures_passees)}`).join(' · ')}</p>}
          </section>
          <section className="carte etroit" aria-labelledby="titre-vehicules">
            <h2 id="titre-vehicules">Véhicules</h2>
            {d.par_vehicule.length ? (
              <div className="defilement"><table className="compacte">
                <thead><tr><th>Véhicule</th><th>Jours</th><th className="nombre">Km estimés</th><th className="nombre">Coût estimé</th></tr></thead>
                <tbody>{d.par_vehicule.map((v) => (
                  <tr key={v.vehicle_id}><td><strong className="nowrap">{v.plaque ?? `n° ${v.vehicle_id}`}</strong>
                    <div className="muet">{v.services} service(s)</div></td>
                    <td>{v.jours}</td><td className="nowrap nombre">{nombre(v.km_estimes)} km</td>
                    <td className="nowrap nombre">{euros(v.cout_estime)}</td></tr>))}</tbody>
              </table></div>) : <div className="vide">Aucun véhicule affecté sur la période.</div>}
          </section>
        </div>

        <div className="rangee">
          <section className="carte large" aria-labelledby="titre-argent">
            <div className="entete">
              <h2 id="titre-argent">Argent par…</h2>
              <div className="segmente" role="radiogroup" aria-label="Regrouper par">
                {REGROUPEMENTS.map((r) => (
                  <button key={r.cle} type="button" role="radio" aria-checked={regroupement === r.cle}
                          className={regroupement === r.cle ? 'actif' : ''} onClick={() => setRegroupement(r.cle)}>{r.libelle}</button>
                ))}
              </div>
            </div>
            <div className="defilement"><table>
              <thead><tr><th>{REGROUPEMENTS.find((r) => r.cle === regroupement)!.libelle}</th><th>Services</th><th>CA HT</th>
                <th className="nombre">Marge matériel</th><th className="nombre">Reste à facturer</th><th className="nombre">Marge estimée</th></tr></thead>
              <tbody>{groupes.map((g) => (
                <tr key={g.nom}><td><strong>{g.nom}</strong><div className="muet">{g.faits} fait(s)</div></td>
                  <td>{g.services}</td>
                  <td style={{ minWidth: 160 }}><Barre valeur={g.ca_ht} max={maxCa} texte={euros(g.ca_ht)} /></td>
                  <td className="nombre">{euros(g.marge_materiel)}</td><td className="nombre">{euros(g.reste_a_facturer_ht)}</td>
                  <td className="nombre">{euros(g.marge_estimee)}</td></tr>))}</tbody>
            </table></div>
          </section>
          <section className="carte etroit" aria-labelledby="titre-surveiller">
            <h2 id="titre-surveiller">À surveiller</h2>
            {SURVEILLER.map(({ cle, titre }) => d.a_surveiller[cle].length > 0 && (
              <div key={cle} className="surveiller">
                <div className="surveiller-titre">{titre} <span className="badge b-a_confirmer">{d.a_surveiller[cle].length}</span></div>
                <ul>{d.a_surveiller[cle].map((s) => (
                  <li key={s.id}><Link to={`/statistiques/services/${s.id}`}>{s.nom}</Link>
                    <span className="muet"> · {s.societe ?? s.client}</span></li>))}</ul>
              </div>
            ))}
            {SURVEILLER.every(({ cle }) => !d.a_surveiller[cle].length) && <div className="vide">Rien à signaler.</div>}
          </section>
        </div>

        <section className="carte" aria-labelledby="titre-services">
          <div className="entete"><h2 id="titre-services">Services de la période ({d.services.length})</h2>
            <Link to="/projets" className="btn btn-petit">Voir par projet</Link></div>
          <TableServices lignes={d.services} vide="Aucun service planifié, fait, à planifier ou en retard sur la période." />
        </section>
      </>)}
    </>
  );
}
