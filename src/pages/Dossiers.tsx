// Dossiers projets en cartes : chaque carte résume tout le projet (avancement, prochaine intervention, équipe,
// véhicules avec marque et modèle, sites, argent, score RSE, retards) et ouvre le dossier complet du projet.
// La tête bleu nuit reprend le panneau d'identité du dossier : la carte et la page qu'elle ouvre se répondent.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { aujourdhui } from '../api';
import { EtatChargement, initiales, useDonnees } from '../composants';
import { BoutonExport } from '../composants/BoutonExport';
import { PastilleNote } from '../composants/Rse';
import { Plaque } from '../composants/Vehicule';
import { exportations, nomFichier } from '../exports';
import { co2 } from '../rse';
import { euros, heures, LIBELLES_ETAT, nombre, stats, type EtatService, type ResumeProjet } from '../statistiques';
import { villeDe } from './DossierProjet';

type Projet = ResumeProjet & { id: number };

const ORDRE: EtatService[] = ['facture', 'fait', 'planifie', 'en_retard', 'a_planifier'];
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const plier = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const date = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);
const ecart = (iso: string) => Math.round((date(iso).getTime() - date(aujourdhui()).getTime()) / 86_400_000);
function relatif(iso: string) {
  const n = ecart(iso);
  return n === 0 ? "aujourd'hui" : n === 1 ? 'demain' : n > 1 ? `dans ${n} jours` : `il y a ${-n} jour${n < -1 ? 's' : ''}`;
}
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

/** Avancement en anneau : un segment par état, le pourcentage de services faits ou facturés au centre. */
function Anneau({ p }: { p: Projet }) {
  const total = Math.max(1, p.services);
  const R = 25, C = 2 * Math.PI * R, ESPACE = p.services > 1 ? 3 : 0;
  let deja = 0;
  const segments = ORDRE.flatMap((e) => {
    const n = p.par_etat[e] ?? 0;
    if (!n) return [];
    const long = (C * n) / total, debut = deja;
    deja += long;
    return [{ e, long, debut }];
  });
  return (
    <svg className="dc-anneau" viewBox="0 0 64 64" width="64" height="64" role="img"
      aria-label={`Avancement ${nombre(p.avancement_pct ?? 0)} % : ${segments.map(({ e }) => `${p.par_etat[e]} ${LIBELLES_ETAT[e].toLowerCase()}`).join(', ')}`}>
      <circle cx="32" cy="32" r={R} className="fond" />
      {segments.map(({ e, long, debut }) => (
        <circle key={e} cx="32" cy="32" r={R} className={`seg e-${e}`} transform="rotate(-90 32 32)"
          strokeDasharray={`${Math.max(0.01, long - ESPACE)} ${C}`} strokeDashoffset={-debut} />))}
      <text x="32" y="36.5" textAnchor="middle">{nombre(Math.round(p.avancement_pct ?? 0))} %</text>
    </svg>
  );
}

/** Date de la prochaine intervention en pavé de calendrier, comme sur la frise du dossier. */
function Prochaine({ p }: { p: Projet }) {
  const iso = p.prochaine_intervention;
  if (!iso) {
    return (
      <div className="dc-prochaine vide">
        <span className="dc-jour" aria-hidden="true"><b>–</b></span>
        <p><span>Aucune intervention à venir</span>
          <small>{p.par_etat.a_planifier ? `${pluriel(p.par_etat.a_planifier, 'service')} à planifier` : 'Rien à planifier'}</small></p>
      </div>
    );
  }
  const d = date(iso), n = ecart(iso);
  return (
    <div className={`dc-prochaine${n <= 1 ? ' imminente' : ''}`}>
      <span className="dc-jour" aria-hidden="true"><b>{d.getDate()}</b><small>{MOIS[d.getMonth()]}</small></span>
      <p><span>Prochaine intervention <strong>{relatif(iso)}</strong>, {d.toLocaleDateString('fr-FR', { weekday: 'long' })}</span>
        {p.prochaine_mission && <small>{p.prochaine_mission.nom}</small>}</p>
    </div>
  );
}

function CarteDossier({ p }: { p: Projet }) {
  const retard = p.par_etat.en_retard;
  const termines = p.par_etat.fait + p.par_etat.facture;
  const equipe = p.equipe ?? [];
  const vehicules = p.vehicules ?? [];
  const villes = [...new Set((p.sites ?? []).map(villeDe).filter((v): v is string => !!v))];
  return (
    <li>
      <Link to={`/dossiers/${p.id}`} className={`dc${retard ? ' en-retard' : ''}`}>
        <header className="dc-tete">
          <div className="dc-titre">
            <p className="dc-client">{p.client ?? 'Client non renseigné'}{p.simule && <span className="dc-simule">simulé</span>}</p>
            <h2>{p.nom}</h2>
            <p className="dc-compte">{termines} sur {pluriel(p.services, 'service')} terminé{termines > 1 ? 's' : ''}
              {retard > 0 && <b>, {retard} en retard</b>}</p>
          </div>
          <Anneau p={p} />
        </header>

        <div className="dc-corps">
          <Prochaine p={p} />

          <dl className="dc-faits">
            <div><dt>Équipe</dt>
              <dd>{equipe.length ? <span className="dc-equipe">{equipe.map((n) => (
                <span key={n} className="dc-tech"><i aria-hidden="true">{initiales(n)}</i>{n}</span>))}</span>
                : <span className="dc-manque">À planifier</span>}</dd></div>
            <div><dt>{vehicules.length > 1 ? 'Véhicules' : 'Véhicule'}</dt>
              <dd>{vehicules.length ? <span className="dc-vehicules">{vehicules.map((v) => (
                <span key={v.id} className="dc-vehicule"><strong>{v.modele ?? 'Modèle non renseigné'}</strong>
                  {v.plaque ? <Plaque plaque={v.plaque} /> : <small>véhicule n° {v.id}</small>}</span>))}</span>
                : <span className="dc-manque">Aucun véhicule planifié</span>}</dd></div>
            <div><dt>{villes.length > 1 ? 'Sites' : 'Site'}</dt>
              <dd>{villes.length ? villes.join(', ') : <span className="dc-manque">Adresse non renseignée</span>}</dd></div>
          </dl>

          <dl className="dc-chiffres">
            <div><dt>CA HT</dt><dd>{euros(p.ca_ht)}</dd></div>
            <div><dt>Marge estimée</dt><dd className={p.marge_estimee < 0 ? 'negatif' : undefined}>{euros(p.marge_estimee)}</dd></div>
            <div><dt>Reste à facturer</dt><dd>{euros(p.reste_a_facturer_ht)}</dd></div>
            <div><dt>Heures passées</dt><dd>{heures(p.heures_passees)} <small>sur {heures(p.heures_prevues)}</small></dd></div>
            <div><dt>Marge matériel</dt><dd className={p.marge_materiel < 0 ? 'negatif' : undefined}>{euros(p.marge_materiel)}</dd></div>
            <div><dt>Score RSE</dt><dd className="dc-rse"><PastilleNote note={p.rse.note} />
              <small>{p.rse.kg_co2e === null ? 'à renseigner' : co2(p.rse.kg_co2e)}</small></dd></div>
          </dl>
        </div>

        <footer className="dc-pied">
          {retard > 0
            ? <span className="dc-alerte">En retard : {p.en_retard.map((x) => x.nom).join(', ')}</span>
            : <span className="dc-ok">{p.services === termines ? 'Tous les services sont terminés' : 'Aucun retard'}</span>}
          <span className="dc-ouvrir">Ouvrir le dossier</span>
        </footer>
      </Link>
    </li>
  );
}

export default function Dossiers() {
  const [simules, setSimules] = useState(true);
  const [texte, setTexte] = useState('');
  const liste = useDonnees(() => stats.projets(simules), [simules]);
  const tous = useMemo(() => (liste.donnees ?? []).filter((p): p is Projet => p.id !== null), [liste.donnees]);
  const projets = useMemo(() => {
    const q = plier(texte.trim());
    return tous
      .filter((p) => !q || plier([p.nom, p.client ?? '', ...(p.equipe ?? []), ...(p.sites ?? []),
        ...(p.vehicules ?? []).flatMap((v) => [v.modele ?? '', v.plaque ?? ''])].join(' ')).includes(q))
      .sort((a, b) => Number(b.par_etat.en_retard > 0) - Number(a.par_etat.en_retard > 0)
        || (a.prochaine_intervention ?? '9999').localeCompare(b.prochaine_intervention ?? '9999') || a.nom.localeCompare(b.nom));
  }, [tous, texte]);
  const enRetard = tous.filter((p) => p.par_etat.en_retard > 0).length;
  const ca = tous.reduce((t, p) => t + p.ca_ht, 0), reste = tous.reduce((t, p) => t + p.reste_a_facturer_ht, 0);

  return (
    <>
      <div className="entete">
        <div><h1>Dossiers projets</h1>
          <div className="sous-titre">Tout sur un projet au même endroit : missions, équipes, véhicules, tâches, coûts, carte,
            itinéraires, PV et pièces jointes.</div></div>
        <div className="filtres">
          <label className="champ">Rechercher<input type="search" value={texte} onChange={(e) => setTexte(e.target.value)}
            placeholder="Projet, client, véhicule…" /></label>
          <label className="case"><input type="checkbox" checked={simules} onChange={(e) => setSimules(e.target.checked)} />
            Inclure les services simulés</label>
          <BoutonExport libelle="Exporter les projets" nomFichier={nomFichier('projets', 'tout')}
            lire={() => exportations.projets()} />
        </div>
      </div>
      <EtatChargement chargement={liste.chargement && !liste.donnees} erreur={liste.erreur} />
      {liste.donnees && tous.length > 0 && (
        <p className="dc-synthese">{pluriel(tous.length, 'projet')} avec des services sur site
          {enRetard > 0 ? <>, dont <b>{enRetard} avec une mission en retard</b></> : ', aucun en retard'}.
          {' '}{euros(ca)} HT de chiffre d'affaires, {euros(reste)} restent à facturer.</p>
      )}
      {liste.donnees && (
        <ul className="dc-grille">{projets.map((p) => <CarteDossier key={p.id} p={p} />)}</ul>
      )}
      {liste.donnees && !projets.length && <p className="vide">{texte ? 'Aucun projet ne correspond à la recherche.'
        : 'Aucun projet avec un service sur site actif. Les services se créent dans Odoo (Services sur site).'}</p>}
    </>
  );
}
