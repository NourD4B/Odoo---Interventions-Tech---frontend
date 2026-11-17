// Services sur site : tâches Odoo Field Service, en lecture seule (créées et modifiées dans Odoo). Les réglages de
// planification absents d'Odoo (techniciens sur place, type, compétences, position du site) se modifient dans la fiche
// du service de la Planification, seul endroit d'écriture : chaque ligne y mène (onglet « Réglages » si le site est à régler).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { aujourdhui } from '../api';
import { Avertissements, Badge, EtatChargement, initiales, useDonnees } from '../composants';
import { nomVehicule } from '../composants/Vehicule';
import { SynchroOdoo } from '../composants/Statistiques';
import {
  LIBELLES_STATUT_PLANIF, planif, type Referentiels, type ServicePlanif, type StatutPlanif,
} from '../planification';
import { jourCourt } from '../statistiques';
import { villeDe } from './DossierProjet';

// ---------- mise en forme ----------

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** « 2026-11-16T07:30:00+01:00 » (heure de Paris) → « lun 16/11 07:30 » */
function quand(iso: string | null): string {
  return iso ? `${jourCourt(iso)} ${iso.slice(11, 16)}` : '—';
}

function datesOdoo(s: ServicePlanif): string {
  if (s.planned_date_begin) {
    const memeJour = s.date_deadline?.slice(0, 10) === s.planned_date_begin.slice(0, 10);
    return s.date_deadline
      ? `${quand(s.planned_date_begin)} → ${memeJour ? s.date_deadline.slice(11, 16) : quand(s.date_deadline)}`
      : `à partir du ${quand(s.planned_date_begin)}`;
  }
  return s.date_deadline ? `au plus tard ${quand(s.date_deadline)}` : 'pas de date dans Odoo';
}

const nombreH = (h: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(h)} h`;
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

type Alerte = { texte: string; ou: 'ici' | 'odoo' };

/** Ce qui empêche ou fausse la planification : à corriger ici (position) ou dans Odoo (temps alloué). */
function alertes(s: ServicePlanif): Alerte[] {
  if (s.archive_odoo) return [];                       // historique : rien à régler ici
  const a: Alerte[] = [];
  if (s.site_lat === null) a.push({ texte: 'Site sans position : les trajets ne peuvent pas être calculés', ou: 'ici' });
  else if (s.site_precision === 'commune') a.push({ texte: 'Position approximative (centre de la commune)', ou: 'ici' });
  if (!s.allocated_hours) a.push({ texte: 'Temps alloué à 0 h dans Odoo : durée inconnue pour le solveur', ou: 'odoo' });
  if (s.statut_planification !== 'publie' && s.date_deadline && new Date(s.date_deadline) < new Date())
    a.push({ texte: `Date limite dépassée (${quand(s.date_deadline)}) et pas encore publié`, ou: 'odoo' });
  return a;
}
const aRegler = (s: ServicePlanif) => !s.archive_odoo && s.statut_planification !== 'publie'
  && alertes(s).some((x) => x.ou === 'ici');

/** Jour à afficher en pavé : jour planifié, sinon début prévu dans Odoo, sinon date limite. */
function jourDe(s: ServicePlanif): { iso: string; legende: string } | null {
  if (s.affectation) return { iso: s.affectation.debut, legende: 'planifié' };
  if (s.planned_date_begin) return { iso: s.planned_date_begin.slice(0, 10), legende: 'prévu' };
  if (s.date_deadline) return { iso: s.date_deadline.slice(0, 10), legende: 'limite' };
  return null;
}

/** Fiche du service dans la Planification, sur la semaine où elle le montre : celle de son affectation, sinon celle où il
 *  peut être planifié (sa « Date prévue » Odoo, jamais avant aujourd'hui). */
function lienPlanification(s: ServicePlanif, onglet: 'reglages' | null): string {
  const auj = aujourdhui();
  const prevu = s.planned_date_begin?.slice(0, 10) ?? s.fenetre_debut ?? null;
  const p = new URLSearchParams({ semaine: s.affectation?.debut ?? (prevu && prevu > auj ? prevu : auj), service: String(s.id) });
  if (onglet) p.set('onglet', onglet);
  return `/planification?${p}`;
}
/** Visible dans la Planification : ni archivé, ni terminé dans Odoo sans y avoir été planifié. */
const planifiable = (s: ServicePlanif) => !s.archive_odoo && !(s.cloture_odoo && !s.affectation);

// ---------- liste ----------

function LigneService({ s, refs }: { s: ServicePlanif; refs: Referentiels | null }) {
  const a = s.affectation;
  const type = refs?.types_service.find((t) => t.id === s.type_service_id)?.nom;
  const competences = s.competences_requises.map((c) => refs?.competences.find((x) => x.code === c)?.libelle ?? c);
  const liste = alertes(s);
  const j = jourDe(s);
  const d = j ? new Date(`${j.iso.slice(0, 10)}T12:00:00`) : null;
  const ville = villeDe(s.site_adresse);
  const statut = s.archive_odoo ? 'archive' : s.statut_planification;
  return (
    <article className={`sv-ligne statut-${statut}`} aria-labelledby={`service-${s.id}`}>
      <div className={`sv-jour${j?.legende === 'limite' ? ' limite' : ''}`} aria-hidden={!d}>
        {d ? <><b>{d.getDate()}</b><span>{MOIS[d.getMonth()]}</span><small>{j!.legende}</small></> : <><b>–</b><small>sans date</small></>}
      </div>

      <div className="sv-contenu">
        <header className="sv-tete">
          <div className="sv-titre">
            <h2 id={`service-${s.id}`}><Link to={`/statistiques/services/${s.id}`}>{s.name}</Link></h2>
            <p>{s.commande_nom ? `Commande ${s.commande_nom}` : 'Non facturable'}
              {s.partner_name && <><span aria-hidden="true">, </span>{s.partner_name}</>}</p>
          </div>
          <div className="badges">
            {s.simule && <span className="badge b-simulation" title="N'existe pas dans Odoo (copie locale)">simulé</span>}
            {s.priority === '1' && <Badge type="urgent">Urgent</Badge>}
            {s.under_warranty && <span className="badge">Sous garantie</span>}
            {!!s.livraisons_attente?.length && <span className="badge b-a_confirmer"
              title={s.livraisons_attente.map((l) => [l.transporteur, l.nom, l.suivi].filter(Boolean).join(' ')).join(' ; ')}>
              {s.livraisons_attente[0].transporteur ?? 'Matériel'} en livraison</span>}
            {(s.etiquettes ?? []).map((e) => <span key={e} className="badge">{e}</span>)}
            {s.cloture_odoo && !s.archive_odoo && <span className="badge etat-archive">Terminé ou annulé dans Odoo</span>}
            {s.archive_odoo
              ? <span className="badge etat-archive" title="Archivée dans Odoo, gardée en historique (elle a une commande)">Archivée dans Odoo</span>
              : <Badge type={`planif-${s.statut_planification}`}>{LIBELLES_STATUT_PLANIF[s.statut_planification]}</Badge>}
          </div>
        </header>

        <dl className="sv-faits">
          <div><dt>Dans Odoo</dt>
            <dd>{datesOdoo(s)}<small>{nombreH(s.allocated_hours)} alloués{ville ? `, ${ville}` : s.site_adresse ? '' : ', adresse non renseignée'}</small></dd></div>
          <div><dt>Équipe demandée</dt>
            <dd>{pluriel(s.nb_techniciens, 'technicien')}
              {(type || refs?.competences_actives) && <small>{[type, refs?.competences_actives
                ? (competences.length ? competences.join(', ') : 'toutes compétences') : null].filter(Boolean).join(', ')}</small>}</dd></div>
          <div className="sv-planif"><dt>Planification</dt>
            <dd>{a ? (<>
              {a.equipe.length > 0 && <span className="sv-equipe">{a.equipe.map((n) => (
                <span key={n} className="dc-tech"><i aria-hidden="true">{initiales(n)}</i>{n}</span>))}</span>}
              <small>{a.vehicle_id != null ? nomVehicule({ ...a, id: a.vehicle_id }) : 'Sans véhicule'}, {jourCourt(a.debut)}
                {a.fin !== a.debut ? ` au ${jourCourt(a.fin)}` : ''}, {a.propose_par === 'dispatcher' ? 'choix du dispatcher' : 'proposé par le solveur'}
                {a.motif_derogation ? `, dérogation : ${a.motif_derogation}` : ''}</small>
            </>) : <span className="muet">{s.archive_odoo ? 'Historique : ne se planifie pas' : 'Pas encore planifié'}</span>}</dd></div>
        </dl>

        {liste.length > 0 && (
          <ul className="sv-alertes">
            {liste.map((x) => <li key={x.texte}>{x.texte}{x.ou === 'odoo' ? ' (à corriger dans Odoo)' : ''}</li>)}
          </ul>
        )}

        <div className="sv-actions">
          {planifiable(s) && (aRegler(s)
            ? <Link className="btn btn-petit btn-primaire" to={lienPlanification(s, 'reglages')}>Placer le site</Link>
            : <Link className="btn btn-petit" to={lienPlanification(s, null)}>
              {s.statut_planification === 'publie' ? 'Voir dans la planification' : 'Ouvrir dans la planification'}</Link>)}
          {s.odoo_url && <a className="sv-lien" href={s.odoo_url} target="_blank" rel="noreferrer">Ouvrir dans Odoo ↗</a>}
        </div>
      </div>
    </article>
  );
}

type Filtre = 'tous' | StatutPlanif | 'a_regler' | 'archive';
const FILTRES: { cle: Filtre; libelle: string }[] = [
  { cle: 'tous', libelle: 'Tous' }, { cle: 'a_regler', libelle: 'À régler' },
  { cle: 'a_planifier', libelle: LIBELLES_STATUT_PLANIF.a_planifier }, { cle: 'propose', libelle: LIBELLES_STATUT_PLANIF.propose },
  { cle: 'verrouille', libelle: LIBELLES_STATUT_PLANIF.verrouille }, { cle: 'publie', libelle: LIBELLES_STATUT_PLANIF.publie },
  { cle: 'archive', libelle: 'Archivées' },
];
/** Archivées (historique) : seulement dans « Tous » et « Archivées », jamais comptées à planifier. */
const garde = (f: Filtre, s: ServicePlanif) => f === 'tous' || (f === 'archive' ? !!s.archive_odoo
  : !s.archive_odoo && (f === 'a_regler' ? aRegler(s) : s.statut_planification === f));
const sansAccents = (x: string) => x.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const ORDRE: Record<StatutPlanif, number> = { a_planifier: 0, propose: 1, verrouille: 2, publie: 3 };
/** À traiter d'abord (à planifier, proposé, verrouillé), publiés ensuite ; puis par date. */
const cleTri = (s: ServicePlanif) => `${s.archive_odoo ? 9 : ORDRE[s.statut_planification]}`
  + (s.planned_date_begin?.slice(0, 10) ?? s.fenetre_debut ?? s.date_deadline?.slice(0, 10) ?? '9999');

export default function Services() {
  const liste = useDonnees(() => planif.services(undefined, undefined, true), []);   // même liste que les dossiers
  const refs = useDonnees(() => planif.referentiels(), []);
  const [filtre, setFiltre] = useState<Filtre>('tous');
  const [texte, setTexte] = useState('');
  const [commande, setCommande] = useState<string | null>(null);     // null : toutes ; '' : sans commande
  const [simules, setSimules] = useState(true);

  const base = useMemo(() => (liste.donnees ?? []).filter((s) => simules || !s.simule)
    .sort((a, b) => cleTri(a).localeCompare(cleTri(b)) || a.name.localeCompare(b.name, 'fr')), [liste.donnees, simules]);
  /** Commandes clientes présentes dans la liste (dossiers), avec leur nombre de services ; '' : sans commande. */
  const commandes = useMemo(() => {
    const m = new Map<string, { cle: string; nom: string; n: number }>();
    for (const s of base) {
      const cle = s.commande_nom ?? '';
      const c = m.get(cle) ?? { cle, nom: cle || 'Non facturable (sans commande)', n: 0 };
      c.n += 1;
      m.set(cle, c);
    }
    return [...m.values()].sort((a, b) => Number(a.cle === '') - Number(b.cle === '') || a.nom.localeCompare(b.nom, 'fr'));
  }, [base]);
  const commandeActive = commande !== null && commandes.some((c) => c.cle === commande) ? commande : null;
  const dansProjet = useMemo(() => base.filter((s) => commandeActive === null || (s.commande_nom ?? '') === commandeActive),
    [base, commandeActive]);
  const services = useMemo(() => {
    const q = sansAccents(texte.trim());
    return dansProjet.filter((s) => garde(filtre, s)
      && (!q || sansAccents([s.name, s.partner_name, s.commande_nom, s.site_adresse, ...(s.etiquettes ?? [])]
        .filter(Boolean).join(' ')).includes(q)));
  }, [dansProjet, filtre, texte]);
  const nbSimules = (liste.donnees ?? []).filter((s) => s.simule).length;

  return (
    <>
      <header className="dc-entete">
        <div>
          <h1>Services sur site</h1>
          <p className="sous-titre">Créés et modifiés dans Odoo (application Services sur site), copiés ici automatiquement.
            Ce qu'Odoo ne connaît pas (techniciens sur place, position du site) se règle dans la fiche du service, en Planification.</p>
        </div>
        <SynchroOdoo onFini={liste.recharger} />
      </header>

      <div className="dc-outils" role="search">
        <label className="dc-recherche">
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.75" />
            <path d="m13 13 4.5 4.5" /></svg>
          <span className="visuellement-cache">Rechercher</span>
          <input type="search" value={texte} placeholder="Service, client, commande, adresse, étiquette" onChange={(e) => setTexte(e.target.value)} />
        </label>
        <label className="sv-projet">
          <span className="visuellement-cache">Commande</span>
          <select value={commandeActive === null ? '*' : commandeActive}
            onChange={(e) => setCommande(e.target.value === '*' ? null : e.target.value)}>
            <option value="*">Toutes les commandes ({base.length})</option>
            {commandes.map((c) => <option key={c.cle || 'sans'} value={c.cle}>{c.nom} ({c.n})</option>)}
          </select>
        </label>
        {nbSimules > 0 && <label className="dc-bascule">
          <input type="checkbox" checked={simules} onChange={(e) => setSimules(e.target.checked)} />
          <span className="pl-piste" aria-hidden="true" />Services simulés ({nbSimules})
        </label>}
      </div>

      <div className="sv-onglets" role="radiogroup" aria-label="Statut de planification">
        {FILTRES.filter((f) => f.cle !== 'archive' || base.some((s) => s.archive_odoo)).map((f) => {
          const n = dansProjet.filter((s) => garde(f.cle, s)).length;
          return (
            <button key={f.cle} type="button" role="radio" aria-checked={filtre === f.cle}
                    className={`${filtre === f.cle ? 'actif' : ''}${f.cle === 'a_regler' && n > 0 ? ' a-regler' : ''}`}
                    onClick={() => setFiltre(f.cle)}>
              {f.libelle}<span className="compteur">{n}</span></button>
          );
        })}
      </div>

      <Avertissements liste={refs.donnees?.avertissements} />
      <EtatChargement chargement={(liste.chargement && !liste.donnees) || (refs.chargement && !refs.donnees)}
                      erreur={liste.erreur ?? refs.erreur} />

      <section className="sv-liste" aria-label="Services">
        {services.map((s) => (
          <LigneService key={s.id} s={s} refs={refs.donnees} />
        ))}
        {liste.donnees && !liste.donnees.length && (
          <div className="vide">Aucun service sur site actif dans la copie Odoo. Le créer dans Odoo (Services sur site),
            puis « Synchroniser ».</div>
        )}
        {liste.donnees && liste.donnees.length > 0 && !services.length && (
          <div className="vide">Aucun service ne correspond aux filtres.</div>
        )}
      </section>

    </>
  );
}
