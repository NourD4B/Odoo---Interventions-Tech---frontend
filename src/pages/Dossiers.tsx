// Dossiers d'intervention en cartes : un dossier = une commande client et ses interventions sur site (une intervention
// sans commande, « Non facturable » dans Odoo, est son propre dossier). Chaque carte résume le dossier (avancement,
// prochaine intervention, équipe, véhicules avec marque et modèle, sites, argent, score RSE, retards) et ouvre le
// dossier complet. Le module Projet d'Odoo n'entre pas en jeu.
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
import { euros, heures, LIBELLES_ETAT, lienDossier, nombre, stats, titreDossier, type EtatService,
  type ResumeDossier } from '../statistiques';
import { villeDe } from './DossierProjet';

type Projet = ResumeDossier;

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

/** Avancement en anneau : un segment par état, le pourcentage d'interventions faites ou facturées au centre. */
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
          <small>{p.par_etat.a_planifier ? `${pluriel(p.par_etat.a_planifier, 'intervention')} à planifier` : 'Rien à planifier'}</small></p>
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
      <Link to={lienDossier(p)} className={`dc${retard ? ' en-retard' : ''}`}>
        <header className="dc-tete">
          <div className="dc-titre">
            <p className="dc-client">{p.client ?? 'Client non renseigné'}{p.simule && <span className="dc-simule">simulé</span>}</p>
            <h2>{titreDossier(p)}</h2>
            <p className="dc-commande">{p.type === 'commande'
              ? <>Commande <strong>{p.nom}</strong>{p.commande?.montant_ht != null && <> · {euros(p.commande.montant_ht)} HT</>}</>
              : 'Sans commande · non facturable'}</p>
            <p className="dc-compte">{termines} sur {pluriel(p.services, 'intervention')} terminée{termines > 1 ? 's' : ''}</p>
            <ul className="dc-legende">{ORDRE.filter((e) => p.par_etat[e]).map((e) => (
              <li key={e} className={e === 'en_retard' ? 'retard' : undefined}><i className={`e-${e}`} aria-hidden="true" />
                {p.par_etat[e]} {LIBELLES_ETAT[e].toLowerCase()}</li>))}
            </ul>
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
            <div><dt>Score RSE, CO2e</dt><dd className="dc-rse"><PastilleNote note={p.rse.note} />
              <small title={p.rse.kg_co2e === null ? undefined : co2(p.rse.kg_co2e)}>
                {p.rse.kg_co2e === null ? 'à renseigner' : `${nombre(Math.round(p.rse.kg_co2e))} kg`}</small></dd></div>
          </dl>
        </div>

        <footer className="dc-pied">
          {retard > 0
            ? <span className="dc-alerte">En retard : {p.en_retard.map((x) => x.nom).join(', ')}</span>
            : <span className="dc-ok">{p.services === termines ? 'Toutes les interventions sont terminées' : 'Aucun retard'}</span>}
        </footer>
      </Link>
    </li>
  );
}

/** Synthèse des dossiers affichés : dossiers et retards, interventions par état, facturation. */
function Synthese({ projets }: { projets: Projet[] }) {
  const somme = (f: (p: Projet) => number) => projets.reduce((t, p) => t + f(p), 0);
  const retard = projets.filter((p) => p.par_etat.en_retard > 0).length;
  const sansCommande = projets.filter((p) => p.type === 'intervention').length;
  const services = somme((p) => p.services);
  const etats = ORDRE.map((e) => [e, somme((p) => p.par_etat[e] ?? 0)] as const).filter(([, n]) => n > 0);
  const ca = somme((p) => p.ca_ht), facture = somme((p) => p.facture_ht), reste = somme((p) => p.reste_a_facturer_ht);
  const part = ca > 0 ? Math.min(100, (100 * facture) / ca) : 0;
  const suivante = projets.filter((p) => p.prochaine_mission)
    .sort((a, b) => a.prochaine_mission!.jour.localeCompare(b.prochaine_mission!.jour))[0];
  return (
    <section className="dc-synthese" aria-label="Synthèse des dossiers">
      <div className="dc-s-bloc">
        <h2 className="dc-s-titre">Dossiers</h2>
        <p className="dc-s-chiffre"><strong>{projets.length - sansCommande}</strong> commande{projets.length - sansCommande > 1 ? 's' : ''}
          {sansCommande > 0 && <small>et {sansCommande} sans commande</small>}</p>
        <p className={`dc-s-etat${retard ? ' retard' : ''}`}><i aria-hidden="true" />
          {retard ? `${retard} avec une intervention en retard` : 'Aucune intervention en retard'}</p>
        {suivante?.prochaine_mission && <p className="dc-s-note">Prochaine intervention {relatif(suivante.prochaine_mission.jour)} :
          {' '}<strong>{suivante.prochaine_mission.nom}</strong></p>}
      </div>
      <div className="dc-s-bloc">
        <h2 className="dc-s-titre">Interventions sur site</h2>
        <p className="dc-s-chiffre"><strong>{services}</strong> intervention{services > 1 ? 's' : ''} au total</p>
        <div className="dc-s-barre etats" role="img"
          aria-label={etats.map(([e, n]) => `${n} ${LIBELLES_ETAT[e].toLowerCase()}`).join(', ')}>
          {etats.map(([e, n]) => <span key={e} className={`e-${e}`} style={{ flexGrow: n }} />)}
        </div>
        <ul className="dc-s-legende">{etats.map(([e, n]) => (
          <li key={e}><i className={`e-${e}`} aria-hidden="true" /><strong>{n}</strong> {LIBELLES_ETAT[e].toLowerCase()}</li>))}
        </ul>
      </div>
      <div className="dc-s-bloc">
        <h2 className="dc-s-titre">Chiffre d'affaires HT</h2>
        <p className="dc-s-chiffre"><strong>{euros(ca)}</strong></p>
        <div className="dc-s-barre facturation" role="img" aria-label={`${nombre(Math.round(part))} % facturé`}>
          <span style={{ width: `${part}%` }} />
        </div>
        <p className="dc-s-repartition"><span><i className="facture" aria-hidden="true" />{euros(facture)} facturés</span>
          <span><i className="reste" aria-hidden="true" />{euros(reste)} à facturer</span></p>
      </div>
    </section>
  );
}

export default function Dossiers() {
  const [simules, setSimules] = useState(true);
  const [texte, setTexte] = useState('');
  const liste = useDonnees(() => stats.dossiers(simules), [simules]);
  const tous = useMemo(() => liste.donnees ?? [], [liste.donnees]);
  const projets = useMemo(() => {
    const q = plier(texte.trim());
    return tous
      .filter((p) => !q || plier([p.nom, p.client ?? '', ...p.interventions.map((i) => i.nom), ...(p.equipe ?? []),
        ...(p.sites ?? []),
        ...(p.vehicules ?? []).flatMap((v) => [v.modele ?? '', v.plaque ?? ''])].join(' ')).includes(q))
      .sort((a, b) => Number(b.par_etat.en_retard > 0) - Number(a.par_etat.en_retard > 0)
        || (a.prochaine_intervention ?? '9999').localeCompare(b.prochaine_intervention ?? '9999') || a.nom.localeCompare(b.nom));
  }, [tous, texte]);

  return (
    <>
      <header className="dc-entete">
        <div>
          <h1>Dossiers d'intervention</h1>
          <p className="sous-titre">Une commande client et ses interventions sur site, tout au même endroit : équipes,
            véhicules, tâches, coûts, carte, itinéraires, PV et pièces jointes.</p>
        </div>
        <BoutonExport libelle="Exporter les dossiers" nomFichier={nomFichier('dossiers', 'tout')}
          lire={() => exportations.dossiers()} />
      </header>

      <div className="dc-outils" role="search">
        <label className="dc-recherche">
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.75" />
            <path d="m13 13 4.5 4.5" /></svg>
          <span className="visuellement-cache">Rechercher</span>
          <input type="search" value={texte} onChange={(e) => setTexte(e.target.value)}
            placeholder="Commande, intervention, client, technicien, véhicule" />
        </label>
        {texte && tous.length > 0 && <span className="dc-resultats" aria-live="polite">
          {projets.length} sur {pluriel(tous.length, 'dossier')}</span>}
        <label className="dc-bascule">
          <input type="checkbox" checked={simules} onChange={(e) => setSimules(e.target.checked)} />
          <span className="pl-piste" aria-hidden="true" />Services simulés
        </label>
      </div>

      <EtatChargement chargement={liste.chargement && !liste.donnees} erreur={liste.erreur} />
      {liste.donnees && tous.length > 0 && <Synthese projets={tous} />}
      {liste.donnees && (
        <ul className="dc-grille">{projets.map((p) => <CarteDossier key={p.cle} p={p} />)}</ul>
      )}
      {liste.donnees && !projets.length && <p className="vide">{texte ? 'Aucun dossier ne correspond à la recherche.'
        : 'Aucune intervention sur site. Les interventions se créent dans Odoo (Services sur site).'}</p>}
    </>
  );
}
