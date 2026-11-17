// Tableau de bord d'une période : compteurs des services, équation de la marge, activité par jour, points à
// surveiller, charge des techniciens, véhicules, argent par projet / société / type, liste des services.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EtatChargement, initiales, useDonnees } from '../composants';
import { Barre, GraphiqueJours, SynchroOdoo, TableServices } from '../composants/Statistiques';
import { Plaque } from '../composants/Vehicule';
import { euros, heures, nombre, stats, type Tableau } from '../statistiques';

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function lundi(d: Date) { const r = new Date(d); r.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return r; }
function plus(d: string, n: number) { const [a, m, j] = d.split('-').map(Number); return iso(new Date(a, m - 1, j + n)); }
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** « 16 – 22 novembre », « 30 novembre – 6 décembre » ; l'année seulement si ce n'est pas l'année en cours. */
function titrePeriode(debut: string, fin: string) {
  const [a, b] = [new Date(`${debut}T12:00:00`), new Date(`${fin}T12:00:00`)];
  const annee = b.getFullYear() !== new Date().getFullYear() ? ` ${b.getFullYear()}` : '';
  return a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
    ? `${a.getDate()} – ${b.getDate()} ${MOIS[b.getMonth()]}${annee}`
    : `${a.getDate()} ${MOIS[a.getMonth()]} – ${b.getDate()} ${MOIS[b.getMonth()]}${annee}`;
}
const capitale = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const SURVEILLER: { cle: keyof Tableau['a_surveiller']; titre: string; grave?: boolean }[] = [
  { cle: 'en_retard', titre: 'En retard', grave: true },
  { cle: 'faits_non_factures', titre: 'Faits, pas encore facturés' },
  { cle: 'faits_sans_feuille_signee', titre: 'Faits sans feuille signée' },
  { cle: 'materiel_non_livre', titre: 'Matériel pas entièrement livré' },
  { cle: 'sans_position', titre: 'Site sans position (adresse à corriger dans Odoo)' },
];
type Regroupement = 'par_dossier' | 'par_client' | 'par_type_service';
const REGROUPEMENTS: { cle: Regroupement; libelle: string }[] = [
  { cle: 'par_dossier', libelle: 'Dossier' }, { cle: 'par_client', libelle: 'Société' },
  { cle: 'par_type_service', libelle: 'Type de service' },
];

export default function Statistiques() {
  const [debut, setDebut] = useState(() => iso(lundi(new Date())));
  const [fin, setFin] = useState(() => plus(iso(lundi(new Date())), 6));
  const [simules, setSimules] = useState(true);
  const [regroupement, setRegroupement] = useState<Regroupement>('par_dossier');
  const t = useDonnees(() => stats.tableau(debut, fin, simules), [debut, fin, simules]);
  const semaine = (n: number) => { setDebut(plus(debut, 7 * n)); setFin(plus(fin, 7 * n)); };
  const lundiCourant = iso(lundi(new Date()));
  const surCetteSemaine = debut === lundiCourant && fin === plus(lundiCourant, 6);

  const d = t.donnees;
  const maxJours = Math.max(1, ...(d?.par_technicien.map((x) => x.jours_ouvres) ?? [1]));
  const groupes = d ? d[regroupement] : [];
  const maxCa = Math.max(1, ...groupes.map((g) => g.ca_ht));
  const alertes = d ? SURVEILLER.reduce((n, { cle }) => n + d.a_surveiller[cle].length, 0) : 0;

  return (
    <>
      <header className="dc-entete">
        <div>
          <h1>Statistiques</h1>
          <p className="sous-titre">Services planifiés et réalisés sur la période, depuis la copie Odoo et la planification.
            Les valeurs estimées suivent les règles du solveur.</p>
        </div>
        <SynchroOdoo onFini={t.recharger} />
      </header>

      <div className="st-outils">
        <nav className="pl-periode st-periode" aria-label="Période">
          <button type="button" className="btn pl-auj" aria-current={surCetteSemaine ? 'date' : undefined}
            onClick={() => { setDebut(lundiCourant); setFin(plus(lundiCourant, 6)); }}>Cette semaine</button>
          <div className="pl-fleches">
            <button type="button" className="btn" aria-label="Semaine précédente" title="Semaine précédente" onClick={() => semaine(-1)}>‹</button>
            <button type="button" className="btn" aria-label="Semaine suivante" title="Semaine suivante" onClick={() => semaine(1)}>›</button>
          </div>
          <strong>{titrePeriode(debut, fin)}</strong>
        </nav>
        <div className="st-dates" role="group" aria-label="Période personnalisée">
          <label><span className="visuellement-cache">Du</span>
            <input type="date" value={debut} onChange={(e) => e.target.value && setDebut(e.target.value)} /></label>
          <span aria-hidden="true">au</span>
          <label><span className="visuellement-cache">Au</span>
            <input type="date" value={fin} onChange={(e) => e.target.value && setFin(e.target.value)} /></label>
        </div>
        <label className="dc-bascule">
          <input type="checkbox" checked={simules} onChange={(e) => setSimules(e.target.checked)} />
          <span className="pl-piste" aria-hidden="true" />Services simulés
        </label>
      </div>

      <EtatChargement chargement={t.chargement && !d} erreur={t.erreur} />
      {d && (<>
        <section className="st-compteurs" aria-label="Services de la période">
          <div className="st-c"><span className="st-libelle"><i className="e-planifie" />Planifiés</span>
            <strong>{d.compteurs.planifies}</strong><small>au moins un jour sur la période</small></div>
          <div className="st-c"><span className="st-libelle"><i className="e-fait" />Faits</span>
            <strong>{d.compteurs.faits}</strong><small>terminés sur la période</small></div>
          <div className="st-c"><span className="st-libelle"><i className="e-a_planifier" />À planifier</span>
            <strong>{d.compteurs.a_planifier}</strong><small>sans équipe ni date</small></div>
          <div className={`st-c${d.compteurs.en_retard ? ' alerte' : ''}`}><span className="st-libelle"><i className="e-en_retard" />En retard</span>
            <strong>{d.compteurs.en_retard}</strong><small>date limite passée, pas faits</small></div>
          {!!d.compteurs.archivees && <div className="st-c"><span className="st-libelle"><i className="e-archive" />Archivées dans Odoo</span>
            <strong>{d.compteurs.archivees}</strong><small>historique, jamais planifiées</small></div>}
        </section>

        <section className="dp-equation" aria-label="Argent de la période">
          <div className="dp-termes">
            <div className="dp-terme"><span>Chiffre d'affaires HT</span><strong>{euros(d.argent.ca_ht)}</strong>
              <small>lignes des services, {euros(d.argent.facture_ht)} facturés</small></div>
            <span className="dp-op" aria-hidden="true">−</span>
            <div className="dp-terme"><span>Matériel</span><strong>{euros(d.argent.cout_materiel)}</strong>
              <small>coût d'achat, marge matériel {euros(d.argent.marge_materiel)}</small></div>
            <span className="dp-op" aria-hidden="true">−</span>
            <div className="dp-terme"><span>Coûts estimés</span><strong>{euros(d.argent.couts_estimes)}</strong>
              <small>travail, route et véhicule</small></div>
            <span className="dp-op" aria-hidden="true">=</span>
            <div className={`dp-terme dp-resultat${d.argent.marge_estimee < 0 ? ' negatif' : ''}`}><span>Marge estimée</span>
              <strong>{euros(d.argent.marge_estimee)}</strong><small>hors nuits d'hôtel et repas</small></div>
          </div>
          <dl className="dp-chiffres">
            <div><dt>Reste à facturer</dt><dd>{euros(d.argent.reste_a_facturer_ht)} <small>dont services faits {euros(d.argent.reste_a_facturer_faits_ht)}</small></dd></div>
            <div><dt>Facturé HT</dt><dd>{euros(d.argent.facture_ht)}</dd></div>
            <div><dt>Jours ouvrés</dt><dd>{d.periode.jours_ouvres}</dd></div>
          </dl>
        </section>

        <div className="st-grille">
          <section className="carte sf-bloc" aria-labelledby="titre-jours">
            <div className="sf-bloc-tete"><h2 id="titre-jours">Activité par jour</h2></div>
            <GraphiqueJours jours={d.par_jour} />
          </section>
          <section className="carte sf-bloc" aria-labelledby="titre-surveiller">
            <div className="sf-bloc-tete"><h2 id="titre-surveiller">À surveiller</h2>
              {alertes > 0 && <span className="st-total">{alertes}</span>}</div>
            {SURVEILLER.filter(({ cle }) => d.a_surveiller[cle].length > 0).map(({ cle, titre, grave }) => (
              <div key={cle} className={`st-surveiller${grave ? ' grave' : ''}`}>
                <div className="st-surveiller-titre"><i aria-hidden="true" />{titre}<span>{d.a_surveiller[cle].length}</span></div>
                <ul>{d.a_surveiller[cle].map((s) => (
                  <li key={s.id}><Link to={`/statistiques/services/${s.id}`}>{s.nom}</Link><small>{s.societe ?? s.client}</small></li>))}</ul>
              </div>
            ))}
            {!alertes && <p className="st-rien">Rien à signaler sur la période.</p>}
          </section>
        </div>

        <div className="st-grille st-grille-charge">
          <section className="carte sf-bloc" aria-labelledby="titre-techs">
            <div className="sf-bloc-tete"><h2 id="titre-techs">Charge des techniciens</h2>
              <span className="sf-compte">jours planifiés sur {d.periode.jours_ouvres} jours ouvrés</span></div>
            <ul className="st-techs">{d.par_technicien.map((x) => (
              <li key={x.matricule} className={x.jours_planifies ? undefined : 'libre'}>
                <i aria-hidden="true">{initiales(x.nom)}</i>
                <span className="st-qui"><strong>{x.nom}</strong><small>{x.agence ? capitale(x.agence) : 'Agence non renseignée'}</small></span>
                <span className="st-charge"><Barre valeur={x.jours_planifies} max={maxJours}
                  texte={`${x.jours_planifies} j sur ${x.jours_ouvres}, ${nombre(x.taux_charge_pct)} %`} /></span>
                <span className="st-chiffre"><strong>{x.services}</strong><small>service{x.services > 1 ? 's' : ''}</small></span>
                <span className="st-chiffre"><strong>{heures(x.heures_passees)}</strong><small>passées</small></span>
                <span className="st-chiffre"><strong>{nombre(x.km_estimes)} km</strong><small>estimés</small></span>
              </li>))}</ul>
            {d.autres_employes.length > 0 && <p className="sf-note">Autres temps saisis (pas des techniciens terrain) :{' '}
              {d.autres_employes.map((x) => `${x.nom} ${heures(x.heures_passees)}`).join(', ')}.</p>}
            <p className="sf-note">Heures passées : feuilles de temps Odoo. Km estimés depuis l'agence du technicien.</p>
          </section>

          <section className="carte sf-bloc" aria-labelledby="titre-vehicules">
            <div className="sf-bloc-tete"><h2 id="titre-vehicules">Véhicules</h2>
              {d.par_vehicule.length > 0 && <span className="sf-compte">{d.par_vehicule.length} utilisé{d.par_vehicule.length > 1 ? 's' : ''}</span>}</div>
            {d.par_vehicule.length ? <ul className="st-vehicules">{d.par_vehicule.map((v) => (
              <li key={v.vehicle_id}>
                <Link to={`/vehicules/${v.vehicle_id}`} className="st-veh-nom"><strong>{v.modele ?? 'Modèle non renseigné'}</strong>
                  {v.plaque ? <Plaque plaque={v.plaque} /> : <small>n° {v.vehicle_id}</small>}</Link>
                <dl>
                  <div><dt>Jours</dt><dd>{v.jours}</dd></div>
                  <div><dt>Services</dt><dd>{v.services}</dd></div>
                  <div><dt>Km estimés</dt><dd>{nombre(v.km_estimes)}</dd></div>
                  <div><dt>Coût estimé</dt><dd>{euros(v.cout_estime)}</dd></div>
                </dl>
              </li>))}</ul> : <p className="st-rien">Aucun véhicule affecté sur la période.</p>}
          </section>
        </div>

        <section className="carte sf-bloc" aria-labelledby="titre-argent">
          <div className="sf-bloc-tete">
            <h2 id="titre-argent">Argent par {REGROUPEMENTS.find((r) => r.cle === regroupement)!.libelle.toLowerCase()}</h2>
            <div className="sv-onglets st-onglets" role="radiogroup" aria-label="Regrouper par">
              {REGROUPEMENTS.map((r) => (
                <button key={r.cle} type="button" role="radio" aria-checked={regroupement === r.cle}
                        className={regroupement === r.cle ? 'actif' : ''} onClick={() => setRegroupement(r.cle)}>{r.libelle}</button>
              ))}
            </div>
          </div>
          <div className="defilement"><table>
            <thead><tr><th>{REGROUPEMENTS.find((r) => r.cle === regroupement)!.libelle}</th><th className="nombre">Services</th><th>CA HT</th>
              <th className="nombre">Marge matériel</th><th className="nombre">Reste à facturer</th><th className="nombre">Marge estimée</th></tr></thead>
            <tbody>{groupes.map((g) => (
              <tr key={g.nom}><td><strong>{g.nom}</strong><div className="muet">{g.faits} fait{g.faits > 1 ? 's' : ''}</div></td>
                <td className="nombre">{g.services}</td>
                <td style={{ minWidth: 180 }}><Barre valeur={g.ca_ht} max={maxCa} texte={euros(g.ca_ht)} /></td>
                <td className="nombre">{euros(g.marge_materiel)}</td><td className="nombre">{euros(g.reste_a_facturer_ht)}</td>
                <td className={`nombre${g.marge_estimee < 0 ? ' negatif' : ''}`}>{euros(g.marge_estimee)}</td></tr>))}</tbody>
          </table></div>
        </section>

        <section className="carte sf-bloc" aria-labelledby="titre-services">
          <div className="sf-bloc-tete"><h2 id="titre-services">Services de la période <span className="st-total neutre">{d.services.length}</span></h2>
            <Link to="/dossiers" className="sv-lien">Voir par dossier</Link></div>
          <TableServices lignes={d.services} vide="Aucun service planifié, fait, à planifier ou en retard sur la période." />
        </section>
      </>)}
    </>
  );
}
