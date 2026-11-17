// Dossiers d'intervention en cartes : un dossier = une commande client et ses interventions sur site (une intervention
// sans commande, « Non facturable » dans Odoo, est son propre dossier). Chaque carte résume le dossier (avancement,
// équipe, véhicules, sites, argent, score RSE, retards, « Urgent » en haut à gauche) et liste ses services sur site,
// chacun avec sa date, son statut de planification et ses alertes ; toute la carte ouvre le dossier complet (la
// planification s'ouvre depuis le dossier).
// Seule liste des services sur site (l'ancienne page « Services sur site » est remplacée) : filtres par statut.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { aujourdhui } from '../api';
import { EtatChargement, initiales, useDonnees } from '../composants';
import { BoutonExport } from '../composants/BoutonExport';
import { PastilleNote } from '../composants/Rse';
import { Plaque } from '../composants/Vehicule';
import { exportations, nomFichier } from '../exports';
import { LIBELLES_STATUT_PLANIF, planif, type ServicePlanif, type StatutPlanif } from '../planification';
import { co2 } from '../rse';
import { alertesPlanif, aReglerPlanif } from '../servicesSurSite';
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

// filtres par statut de planification (ceux de l'ancienne page Services sur site)
type Filtre = 'tous' | StatutPlanif | 'a_regler' | 'archive';
const FILTRES: { cle: Filtre; libelle: string }[] = [
  { cle: 'tous', libelle: 'Tous' }, { cle: 'a_regler', libelle: 'À régler' },
  { cle: 'a_planifier', libelle: LIBELLES_STATUT_PLANIF.a_planifier }, { cle: 'propose', libelle: LIBELLES_STATUT_PLANIF.propose },
  { cle: 'verrouille', libelle: LIBELLES_STATUT_PLANIF.verrouille }, { cle: 'publie', libelle: LIBELLES_STATUT_PLANIF.publie },
  { cle: 'archive', libelle: 'Archivés' },
];
const garde = (f: Filtre, s: ServicePlanif | undefined) => f === 'tous' || (!!s && (f === 'archive' ? !!s.archive_odoo
  : !s.archive_odoo && (f === 'a_regler' ? aReglerPlanif(s) : s.statut_planification === f)));

/** Jour à afficher pour un service : affecté, sinon prévu dans Odoo, sinon sa date limite. */
const jourDe = (s: ServicePlanif | undefined) => s?.affectation?.debut ?? s?.planned_date_begin?.slice(0, 10)
  ?? s?.date_deadline?.slice(0, 10) ?? null;

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

/** Services sur site du dossier, dans l'ordre des dates : jour, statut de planification, alertes, lien de planification.
 *  Le prochain à venir est mis en avant ; hors du filtre choisi, un service est atténué. Un dossier d'un seul service
 *  porte déjà son nom en titre : la ligne commence alors par le statut. */
function ServicesDuDossier({ p, parId, filtre }: { p: Projet; parId: Map<number, ServicePlanif>; filtre: Filtre }) {
  const auj = aujourdhui();
  const seul = p.interventions.length === 1;
  const lignes = p.interventions.map((i) => ({ i, s: parId.get(i.id) }))
    .sort((a, b) => (jourDe(a.s) ?? '9999').localeCompare(jourDe(b.s) ?? '9999') || a.i.nom.localeCompare(b.i.nom));
  const prochain = lignes.find(({ s }) => (jourDe(s) ?? '') >= auj && s && !s.archive_odoo)?.i.id;
  return (
    <ul className="dc-services" aria-label="Services sur site">
      {lignes.map(({ i, s }) => {
        const j = jourDe(s);
        const alertes = s ? alertesPlanif(s) : [];
        const statut = s ? (s.archive_odoo ? 'Archivé dans Odoo' : LIBELLES_STATUT_PLANIF[s.statut_planification]) : i.etat_libelle;
        // « urgent » : pastille en haut à gauche de la carte ; sur la ligne seulement s'il y a plusieurs services
        const precisions = [i.id === prochain && j ? relatif(j) : null, !seul && s?.priority === '1' ? 'urgent' : null]
          .filter((x): x is string => !!x);
        return (
          <li key={i.id} className={`dc-service${i.id === prochain ? ' prochain' : ''}${garde(filtre, s) ? '' : ' hors-filtre'}`}>
            <span className="dc-jour" aria-hidden="true">{j ? <><b>{date(j).getDate()}</b><small>{MOIS[date(j).getMonth()]}</small></>
              : <b>–</b>}</span>
            <span className="dc-service-nom">
              {seul
                ? <><strong>{statut}</strong>{precisions.length > 0 && <small>{precisions.join(', ')}</small>}</>
                : <><strong>{i.nom}</strong><small>{[statut, ...precisions].join(', ')}</small></>}
              {alertes.length > 0 && <small className="dc-service-alerte" title={alertes.map((x) => x.texte).join(' ; ')}>
                {alertes[0].court}{alertes.length > 1 ? ` (+${alertes.length - 1})` : ''}</small>}</span>
          </li>
        );
      })}
    </ul>
  );
}

function CarteDossier({ p, parId, filtre }: { p: Projet; parId: Map<number, ServicePlanif>; filtre: Filtre }) {
  const retard = p.par_etat.en_retard;
  const termines = p.par_etat.fait + p.par_etat.facture;
  const equipe = p.equipe ?? [];
  const vehicules = p.vehicules ?? [];
  const villes = [...new Set((p.sites ?? []).map(villeDe).filter((v): v is string => !!v))];
  const urgent = p.interventions.some((i) => { const s = parId.get(i.id); return s?.priority === '1' && !s.archive_odoo; });
  return (
    <li>
      <article className={`dc${retard ? ' en-retard' : ''}`}>
        <header className="dc-tete">
          <div className="dc-titre">
            <p className="dc-client">{urgent && <span className="dc-urgent">Urgent</span>}
              {p.client ?? 'Client non renseigné'}{p.simule && <span className="dc-simule">simulé</span>}</p>
            <h2><Link to={lienDossier(p)} className="dc-lien">{titreDossier(p)}</Link></h2>
            {/* commande seulement (montant = « CA HT » plus bas) ; rien pour une intervention sans commande */}
            {p.type === 'commande' && <p className="dc-commande">Commande <strong>{p.nom}</strong></p>}
            {/* avancement : utile à partir de deux services (pour un seul, son statut est dans sa ligne) */}
            {p.services > 1 && <p className="dc-compte">{termines} sur {pluriel(p.services, 'intervention')} terminée{termines > 1 ? 's' : ''}</p>}
          </div>
          {p.services > 1 && <Anneau p={p} />}
        </header>

        <div className="dc-corps">
          <ServicesDuDossier p={p} parId={parId} filtre={filtre} />

          {/* équipe et véhicules : seulement s'ils sont planifiés (sinon le statut « À planifier » de la ligne le dit) */}
          <dl className="dc-faits">
            {equipe.length > 0 && <div><dt>Équipe</dt>
              <dd><span className="dc-equipe">{equipe.map((n) => (
                <span key={n} className="dc-tech"><i aria-hidden="true">{initiales(n)}</i>{n}</span>))}</span></dd></div>}
            {vehicules.length > 0 && <div><dt>{vehicules.length > 1 ? 'Véhicules' : 'Véhicule'}</dt>
              <dd><span className="dc-vehicules">{vehicules.map((v) => (
                <span key={v.id} className="dc-vehicule"><strong>{v.modele ?? 'Modèle non renseigné'}</strong>
                  {v.plaque ? <Plaque plaque={v.plaque} /> : <small>véhicule n° {v.id}</small>}</span>))}</span></dd></div>}
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
        {/* pas de pied « En retard : … » : chaque ligne de service porte déjà son alerte, le liseré rouge signale le dossier */}
      </article>
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
  const [filtre, setFiltre] = useState<Filtre>('tous');
  const liste = useDonnees(() => stats.dossiers(simules), [simules]);
  const planifies = useDonnees(() => planif.services(undefined, undefined, true), []);   // statut, alertes, liens
  const parId = useMemo(() => new Map((planifies.donnees ?? []).map((s) => [s.id, s])), [planifies.donnees]);
  const tous = useMemo(() => liste.donnees ?? [], [liste.donnees]);
  const services = useMemo(() => tous.flatMap((p) => p.interventions.map((i) => parId.get(i.id))), [tous, parId]);
  const projets = useMemo(() => {
    const q = plier(texte.trim());
    return tous
      .filter((p) => filtre === 'tous' || p.interventions.some((i) => garde(filtre, parId.get(i.id))))
      .filter((p) => !q || plier([p.nom, p.client ?? '', ...p.interventions.map((i) => i.nom), ...(p.equipe ?? []),
        ...(p.sites ?? []),
        ...(p.vehicules ?? []).flatMap((v) => [v.modele ?? '', v.plaque ?? ''])].join(' ')).includes(q))
      .sort((a, b) => Number(b.par_etat.en_retard > 0) - Number(a.par_etat.en_retard > 0)
        || (a.prochaine_intervention ?? '9999').localeCompare(b.prochaine_intervention ?? '9999') || a.nom.localeCompare(b.nom));
  }, [tous, texte, filtre, parId]);

  return (
    <>
      <header className="dc-entete">
        <div>
          <h1>Dossiers d'intervention</h1>
          <p className="sous-titre">Une commande client et ses services sur site, tout au même endroit. Les services se créent
            et se modifient dans Odoo (Services sur site) ; ils se planifient et se règlent dans la Planification.</p>
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
            placeholder="Commande, service, client, technicien, véhicule" />
        </label>
        {(texte || filtre !== 'tous') && tous.length > 0 && <span className="dc-resultats" aria-live="polite">
          {projets.length} sur {pluriel(tous.length, 'dossier')}</span>}
        <label className="dc-bascule">
          <input type="checkbox" checked={simules} onChange={(e) => setSimules(e.target.checked)} />
          <span className="pl-piste" aria-hidden="true" />Services simulés
        </label>
      </div>

      <div className="sv-onglets" role="radiogroup" aria-label="Statut de planification des services">
        {FILTRES.filter((f) => f.cle !== 'archive' || services.some((s) => s?.archive_odoo)).map((f) => {
          const n = services.filter((s) => s && garde(f.cle, s)).length;
          return (
            <button key={f.cle} type="button" role="radio" aria-checked={filtre === f.cle}
                    className={`${filtre === f.cle ? 'actif' : ''}${f.cle === 'a_regler' && n > 0 ? ' a-regler' : ''}`}
                    onClick={() => setFiltre(f.cle)}>
              {f.libelle}<span className="compteur">{n}</span></button>
          );
        })}
      </div>

      <EtatChargement chargement={liste.chargement && !liste.donnees} erreur={liste.erreur ?? planifies.erreur} />
      {liste.donnees && tous.length > 0 && filtre === 'tous' && !texte && <Synthese projets={tous} />}
      {liste.donnees && (
        <ul className="dc-grille">{projets.map((p) => <CarteDossier key={p.cle} p={p} parId={parId} filtre={filtre} />)}</ul>
      )}
      {liste.donnees && !projets.length && <p className="vide">{texte || filtre !== 'tous' ? 'Aucun dossier ne correspond aux filtres.'
        : 'Aucune intervention sur site. Les interventions se créent dans Odoo (Services sur site).'}</p>}
    </>
  );
}
