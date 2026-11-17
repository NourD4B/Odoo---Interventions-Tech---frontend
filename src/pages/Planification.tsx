// Planification : seule page des techniciens (disponibilités, charge, congés, fériés), deux vues.
// Semaine : techniciens × jours, services en barres ; glisser un service sur un technicien et un jour pour
// l'affecter (ses jours libres s'allument), le glisser dans « À planifier » pour retirer l'affectation, survoler
// pour le détail, cliquer pour ouvrir sa fiche (équipe, dates, véhicule, verrou). Le solveur propose, le
// dispatcher décide. Mois : 4 semaines en cases (PlanMois). Adresse : ?vue=mois&semaine=AAAA-MM-JJ ; la fiche d'un
// service s'ouvre aussi par ?service=<id>&onglet=reglages (lien de la page Services sur site).
// La fiche d'un service centralise tout ce qui se modifie ici : affectation (équipe, dates, véhicule, verrou) et
// réglages de planification (techniciens sur place, type, compétences, position du site) ; le reste se modifie dans Odoo.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent,
  type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { aujourdhui } from '../api';
import { Avertissements, EtatChargement, initiales, useDonnees } from '../composants';
import { useEcriture } from '../composants/Ecriture';
import { IconeTelechargement } from '../composants/BoutonExport';
import { InfoBulle, placeInfoBulle } from '../composants/InfoBulle';
import { enregistrerFichier, exportations, nomFichier } from '../exports';
import CartePlanif, { type AgencePlanif, type SitePlanif } from '../composants/CartePlanif';
import DescriptionOdoo from '../composants/DescriptionOdoo';
import MenuVehicule from '../composants/MenuVehicule';
import ReglagesService, { siteARegler, type EtatReglages, type ReglagesHandle } from '../composants/ReglagesService';
import { nomVehicule, Plaque } from '../composants/Vehicule';
import { meteo, temps, type Meteo } from '../meteo';
import PlanMois from './PlanMois';
import {
  ErreurPlanif, planif, type AffectationProposee, type CorpsAffectation, type LivraisonAttente, type Proposition,
  type Referentiels, type ServicePlanif, type TechnicienPlanif,
} from '../planification';
import { ErreurStats, stats } from '../statistiques';

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre',
  'novembre', 'décembre'];
const CONFLIT = "Modifié par quelqu'un d'autre entre-temps : la semaine a été rechargée, refaites la modification.";

// ---------- dates (jours ouvrés lundi–vendredi) ----------

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function lundiDe(jour: string): Date {
  const d = new Date(`${jour}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
function decaler(d: Date, jours: number): Date { const r = new Date(d); r.setDate(r.getDate() + jours); return r; }
/** `n` jours ouvrés après `jour` (0 = le jour même). */
function plusOuvres(jour: string, n: number): string {
  const d = new Date(`${jour}T12:00:00`);
  let reste = n;
  while (reste > 0) { d.setDate(d.getDate() + 1); if (d.getDay() % 6 !== 0) reste -= 1; }
  return iso(d);
}
/** Jours ouvrés de `debut` (exclu) à `fin` (inclus) : 0 pour un service d'un jour. */
function ouvresApres(debut: string, fin: string): number {
  let n = 0;
  const d = new Date(`${debut}T12:00:00`);
  while (iso(d) < fin) { d.setDate(d.getDate() + 1); if (d.getDay() % 6 !== 0) n += 1; }
  return n;
}
const jj = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
function jourLong(s: string) {
  const d = new Date(`${s.slice(0, 10)}T12:00:00`);
  return `${['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'][d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}`;
}
/** Durée (jours) d'un service non encore affecté : heures par technicien / 8 h. */
const dureeService = (s: ServicePlanif) => Math.max(1, Math.ceil(s.allocated_hours / Math.max(1, s.nb_techniciens) / 8));
const nombreH = (h: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(h)} h`;
const client = (s: ServicePlanif) => s.partner_name ?? 'Client non renseigné';
/** Deux flèches en cercle ; tournent pendant la synchronisation (immobiles si l'animation est réduite). */
function IconeSynchro() {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.2 8.3A6.5 6.5 0 0 0 4.4 6.6" /><path d="M3.8 11.7a6.5 6.5 0 0 0 11.8 1.7" />
      <path d="M4.2 3.2v3.6h3.6" /><path d="M15.8 16.8v-3.6h-3.6" />
    </svg>
  );
}
/** « à l'instant », « il y a 3 min », « il y a 2 h » (heure de fin du dernier cycle de synchronisation, UTC). */
function depuisQuand(iso: string, maintenant: Date): string {
  const min = Math.max(0, Math.round((maintenant.getTime() - new Date(iso).getTime()) / 60_000));
  return min < 1 ? "à l'instant" : min < 60 ? `il y a ${min} min` : `il y a ${Math.round(min / 60)} h`;
}
/** État affiché ; « brouillon » = équipe en cours de composition (jamais renvoyé par l'API). */
const etatDe = (s: ServicePlanif): string => s.affectation?.etat ?? 'a_planifier';
/** Empreinte de l'affectation : la fiche ouverte repart de zéro quand elle change (pas pour un réglage enregistré). */
const cleAffectation = (s: ServicePlanif): string => {
  const a = s.affectation;
  return a ? [a.etat, a.debut, a.fin, a.vehicle_id, ...a.matricules].join('|') : 'libre';
};
const absentSur = (t: TechnicienPlanif, du: string, au: string) => t.absences.some((a) => a.du <= au && a.au >= du);

/** « Date prévue » saisie à la création dans Odoo Field Service : plage du planned_date_begin au date_deadline.
 * Sans date dans Odoo : fenêtre réglée dans l'application (ancienne donnée). */
function contrainteDate(s: ServicePlanif): string | null {
  const du = s.planned_date_begin, au = s.date_deadline;
  if (du && au) return jj(du) === jj(au) ? `Le ${jj(du)}` : `Entre le ${jj(du)} et le ${jj(au)}`;
  if (du) return `À partir du ${jj(du)}`;
  if (s.fenetre_debut || s.fenetre_fin) {
    return s.fenetre_debut && s.fenetre_fin ? `Entre le ${jj(s.fenetre_debut)} et le ${jj(s.fenetre_fin)}`
      : s.fenetre_debut ? `À partir du ${jj(s.fenetre_debut)}` : `Avant le ${jj(s.fenetre_fin!)}`;
  }
  return s.date_deadline ? `Avant le ${jj(s.date_deadline)}` : null;
}

// ---------- glisser-déposer ----------

type Glisse = { serviceId: number; depuis: string | null };
/** Équipe en cours de composition (service à plusieurs techniciens) : rien n'est enregistré avant qu'elle soit
 *  complète ; chaque dépôt sur un technicien l'ajoute, sur la période du premier dépôt. */
type Brouillon = { serviceId: number; debut: string; fin: string; matricules: string[] };
const TYPE_GLISSE = 'application/x-d4b-service';

function lireGlisse(e: DragEvent): Glisse | null {
  try { return JSON.parse(e.dataTransfer.getData(TYPE_GLISSE)) as Glisse; } catch { return null; }
}

/** Élément glissable et activable au clavier (Entrée / Espace = ouvrir la fiche). */
function Glissable({ s, depuis, className, style, titre, fixe = false, onOuvrir, onDebut, onFin, onSurvol, children }: {
  s: ServicePlanif; depuis: string | null; className: string; style?: CSSProperties; titre?: string; fixe?: boolean;
  onOuvrir: () => void; onDebut: (g: Glisse) => void; onFin: () => void; onSurvol?: (id: number | null) => void;
  children: ReactNode;
}) {
  const mobile = !fixe && etatDe(s) !== 'publie';
  return (
    <div role="button" tabIndex={0} className={className} style={style} title={titre} draggable={mobile}
      aria-label={`${client(s)}, ${s.name}`}
      onClick={onOuvrir}
      onMouseEnter={() => onSurvol?.(s.id)} onMouseLeave={() => onSurvol?.(null)}
      onFocus={() => onSurvol?.(s.id)} onBlur={() => onSurvol?.(null)}
      onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOuvrir(); } }}
      onDragStart={(e) => {
        const g: Glisse = { serviceId: s.id, depuis };
        e.dataTransfer.setData(TYPE_GLISSE, JSON.stringify(g));
        e.dataTransfer.effectAllowed = 'move';
        window.setTimeout(() => onDebut(g), 0);            // après la capture de l'image glissée
      }}
      onDragEnd={onFin}>
      {children}
    </div>
  );
}

// ---------- fiche d'un service (fenêtre) ----------

function ChoixTechnicien({ t, choisi, absent, onBasculer }: {
  t: TechnicienPlanif; choisi: boolean; absent: boolean; onBasculer: () => void;
}) {
  return (
    <button type="button" role="checkbox" aria-checked={choisi} onClick={onBasculer}
      className={`pl-choix-tech${choisi ? ' choisi' : ''}${absent ? ' absent' : ''}`}
      title={absent ? `${t.nom} est absent sur ces dates (enregistrable quand même : dérogation signalée)` : t.nom}>
      <span className="pl-avatar petit">{initiales(t.nom)}</span>
      <span className="pl-choix-tech-nom">{t.nom}{absent && <em> · absent</em>}</span>
    </button>
  );
}

/** Matériel pas encore arrivé (pièce de rechange, équipement de swap expédié par Chronopost…) : affiché, jamais
 *  bloquant ; le lien de suivi est celui calculé par Odoo. */
function LivraisonsAttente({ liste }: { liste: LivraisonAttente[] }) {
  if (!liste.length) return null;
  return (
    <div className="pf-livraisons" role="note">
      <p className="pf-raisons-titre">Matériel en livraison</p>
      <ul>{liste.map((l) => (
        <li key={l.nom}><strong>{l.transporteur ?? 'Livraison'}</strong> {l.nom}
          {l.suivi && <> · suivi {l.suivi_url
            ? <a href={l.suivi_url} target="_blank" rel="noreferrer">{l.suivi}</a> : l.suivi}</>}
          {l.prevue && <> · prévue le {jj(l.prevue)}</>}</li>))}
      </ul>
      <small>Vérifier l'arrivée avant de publier : le planning ne bloque pas.</small>
    </div>
  );
}

// Fiche d'un service = formulaire Odoo : deux onglets (« Affectation », « Réglages ») et un seul bouton d'enregistrement
// pour tout ce qui a changé (réglages d'abord, puis l'affectation), comme le bouton « Enregistrer » d'Odoo.
type Onglet = 'affectation' | 'reglages';
const ONGLETS: { cle: Onglet; libelle: string }[] = [
  { cle: 'affectation', libelle: 'Affectation' }, { cle: 'reglages', libelle: 'Réglages' },
];
const lireOnglet = (x: string | null): Onglet => (x === 'reglages' ? x : 'affectation');

const ICONES = {
  date: <><rect x="3" y="4.5" width="14" height="12.5" rx="2" /><path d="M3 8.5h14M7 2.5v4M13 2.5v4" /></>,
  duree: <><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 2" /></>,
  equipe: <><circle cx="7.5" cy="7" r="2.5" /><path d="M3 16c.6-2.6 2.3-4 4.5-4s3.9 1.4 4.5 4" /><circle cx="14" cy="7.5" r="2" />
    <path d="M13.6 12.1c1.8.2 3 1.4 3.4 3.4" /></>,
};
function Repere({ icone, alerte, titre, children }: {
  icone: keyof typeof ICONES; alerte?: boolean; titre?: string; children: ReactNode;
}) {
  return (
    <li className={alerte ? 'alerte' : undefined} title={titre}>
      <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round">{ICONES[icone]}</svg>{children}</li>
  );
}

function DialogueService({ s, onglet, onOnglet, brouillon, techniciens, agences, propose, cause, refs, enregistrer, retirer,
  depublier, onReglages, onFermer }: {
  s: ServicePlanif; onglet: Onglet; onOnglet: (o: Onglet) => void;
  brouillon: Brouillon | null; techniciens: TechnicienPlanif[]; agences: Map<string, string>;
  propose: AffectationProposee | undefined; cause: string | undefined; refs: Referentiels | null;
  enregistrer: (s: ServicePlanif, corps: Omit<CorpsAffectation, 'version' | 'motif'>, motif?: string | null) => Promise<boolean>;
  retirer: (s: ServicePlanif) => Promise<boolean>;
  depublier: (s: ServicePlanif, motif: string | null) => Promise<boolean>;
  onReglages: () => void;                                      // réglages enregistrés seuls, ou conflit : recharger
  onFermer: () => void;
}) {
  const a = s.affectation;
  const publie = s.statut_planification === 'publie';
  const [motif, setMotif] = useState<string | null>(null);         // null : pas en train de retirer la publication
  const b = !a && brouillon?.serviceId === s.id ? brouillon : null;
  const [equipe, setEquipe] = useState<string[]>(a?.matricules ?? b?.matricules ?? []);
  const [debut, setDebut] = useState(a?.debut ?? b?.debut ?? s.planned_date_begin?.slice(0, 10) ?? s.fenetre_debut ?? aujourdhui());
  const [jours, setJours] = useState(a ? ouvresApres(a.debut, a.fin) + 1 : b ? ouvresApres(b.debut, b.fin) + 1 : dureeService(s));
  const [vehicule, setVehicule] = useState<number | null>(a?.vehicle_id ?? null);
  const [verrou, setVerrou] = useState(a?.etat === 'verrouille');
  const [note, setNote] = useState(a?.motif_derogation ?? '');      // motif facultatif (dérogation), journalisé
  const [envoi, setEnvoi] = useState(false);
  // onglets déjà ouverts : gardés montés (réglages en cours), seulement masqués
  const [vus, setVus] = useState<Set<Onglet>>(() => new Set([onglet]));
  const [placer, setPlacer] = useState(false);                     // « Placer le site » : réglages en mode correction
  const [reglages, setReglages] = useState<EtatReglages>({ modifie: false, envoi: false, nb: s.nb_techniciens });
  const reglagesRef = useRef<ReglagesHandle>(null);
  const { ecrire, dialogue } = useEcriture();
  const fermer = useRef<HTMLButtonElement>(null);
  const corps = useRef<HTMLDivElement>(null);
  const occupe = envoi || reglages.envoi;
  const fin = plusOuvres(debut, Math.max(1, jours) - 1);
  const nbVoulu = reglages.nb || s.nb_techniciens;                   // taille en cours de réglage, sinon enregistrée
  const basculer = (m: string) => setEquipe((x) => (x.includes(m) ? x.filter((y) => y !== m) : [...x, m]));
  const parAgence = useMemo(() => {
    const groupes = new Map<string, TechnicienPlanif[]>();
    for (const t of [...techniciens].sort((x, y) => x.nom.localeCompare(y.nom))) groupes.set(t.agence, [...(groupes.get(t.agence) ?? []), t]);
    return [...groupes.entries()];
  }, [techniciens]);
  const competences = refs?.competences_actives && s.competences_requises.length
    ? s.competences_requises.map((c) => refs.competences.find((x) => x.code === c)?.libelle ?? c).join(', ') : null;
  const surEtatReglages = useCallback((e: EtatReglages) =>
    setReglages((x) => (x.modifie === e.modifie && x.envoi === e.envoi && x.nb === e.nb ? x : e)), []);
  const memeEquipe = !!a && equipe.length === a.matricules.length && equipe.every((m) => a.matricules.includes(m));
  const affectationModifiee = equipe.length > 0 && (!a || !memeEquipe || debut !== a.debut || fin !== a.fin
    || vehicule !== a.vehicle_id || verrou !== (a.etat === 'verrouille') || note.trim() !== (a.motif_derogation ?? ''));
  const aEnregistrer = !publie && (reglages.modifie || affectationModifiee);

  useEffect(() => { fermer.current?.focus(); }, []);                // une fois, à l'ouverture
  useEffect(() => {
    const touche = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape' && !occupe) onFermer(); };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, [occupe, onFermer]);

  const changerOnglet = (o: Onglet) => {
    setVus((v) => (v.has(o) ? v : new Set(v).add(o)));
    onOnglet(o);
    corps.current?.scrollTo({ top: 0 });
  };
  /** Flèches gauche / droite, Début, Fin : d'un onglet à l'autre (motif « onglets » de l'ARIA). */
  const toucheOnglets = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = ONGLETS.findIndex((o) => o.cle === onglet);
    const cible = ({ ArrowRight: (k + 1) % ONGLETS.length, ArrowLeft: (k + ONGLETS.length - 1) % ONGLETS.length,
      Home: 0, End: ONGLETS.length - 1 } as Record<string, number>)[e.key];
    if (cible === undefined) return;
    e.preventDefault();
    changerOnglet(ONGLETS[cible].cle);
    document.getElementById(`pf-onglet-${ONGLETS[cible].cle}`)?.focus();
  };
  const agir = async (action: () => Promise<boolean>) => {
    setEnvoi(true);
    try { if (await action()) onFermer(); } finally { setEnvoi(false); }
  };
  /** Enregistre tout ce qui a changé : réglages (nouvelle version du service), puis l'affectation. */
  const sauver = async () => {
    if (!aEnregistrer || occupe) return;
    setEnvoi(true);
    try {
      let version = s.version;
      if (reglages.modifie) {
        const r = await reglagesRef.current?.enregistrer();
        if (!r) { changerOnglet('reglages'); return; }                  // erreur affichée dans l'onglet
        version = r.version;
      }
      if (!affectationModifiee) { onReglages(); onFermer(); return; }
      if (await enregistrer({ ...s, version }, { matricules: equipe, vehicle_id: vehicule, debut, fin, verrouiller: verrou },
        note.trim() || null)) onFermer();
    } finally { setEnvoi(false); }
  };
  const placerSite = () => { setPlacer(true); changerOnglet('reglages'); };

  const etat = etatDe(s);
  const premier = a ? new Date(`${a.debut}T12:00:00`) : null;
  const signalReglages = !publie && siteARegler(s);
  const monte = (o: Onglet) => o === onglet || vus.has(o);
  const alertes: { texte: string; action?: ReactNode }[] = [];
  if (!publie && s.site_lat === null) {
    alertes.push({ texte: 'Site sans position : trajet, véhicule et coût ne peuvent pas être calculés.',
      action: <button type="button" className="lien-bouton" onClick={placerSite}>Placer le site</button> });
  } else if (!publie && s.site_precision === 'commune') {
    alertes.push({ texte: 'Position approximative (centre de la commune).',
      action: <button type="button" className="lien-bouton" onClick={placerSite}>Préciser</button> });
  }

  return (
    <div className="voile pl-voile" role="dialog" aria-modal="true" aria-labelledby="pl-titre-fiche"
         onMouseDown={(e) => { if (e.target === e.currentTarget && !occupe) onFermer(); }}>
      <div className={`pl-fiche pf etat-${etat}`}>
        <div className="pf-entete">
          <header className="pf-tete">
            <div className="pf-titre">
              <p>{client(s)}{s.simule && <span className="dc-simule">simulé</span>}</p>
              <h2 id="pl-titre-fiche">{s.name}</h2>
              <div className="pf-badges">
                <span className={`pf-etat etat-${etat}`}>{{ a_planifier: 'À planifier', propose: 'Proposé',
                  verrouille: 'Verrouillé', publie: 'Publié' }[etat]}</span>
                {s.priority === '1' && <span className="pf-etat urgent">Urgent</span>}
                {s.etape_odoo && <span className="pf-etat odoo" title="Étape dans Odoo">{s.etape_odoo}</span>}
                {s.under_warranty && <span className="pf-etat">Sous garantie</span>}
                {(s.etiquettes ?? []).map((e) => <span key={e} className="pf-etat etiquette">{e}</span>)}
              </div>
              <ul className="pf-reperes" aria-label="En bref">
                <Repere icone="date" titre="Date prévue dans Odoo">{contrainteDate(s) ?? 'Date libre'}</Repere>
                {s.allocated_hours
                  ? <Repere icone="duree" titre="Temps alloué dans Odoo">{nombreH(s.allocated_hours)}, {dureeService(s)} j sur site</Repere>
                  : <Repere icone="duree" alerte titre="Compté 1 jour ; à corriger dans Odoo">0 h dans Odoo, compté 1 j</Repere>}
                <Repere icone="equipe" titre="Techniciens sur place (Réglages)">{nbVoulu} technicien{nbVoulu > 1 ? 's' : ''}
                  {s.vehicule_requis === 'utilitaire' ? ', utilitaire' : ''}</Repere>
              </ul>
            </div>
            <button ref={fermer} type="button" className="sv-fermer" aria-label="Fermer" onClick={onFermer} disabled={occupe}>
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg></button>
          </header>
          <div className="pf-onglets" role="tablist" aria-label="Fiche du service" onKeyDown={toucheOnglets}>
            {ONGLETS.map((o) => (
              <button key={o.cle} type="button" role="tab" id={`pf-onglet-${o.cle}`} aria-controls={`pf-panneau-${o.cle}`}
                aria-selected={onglet === o.cle} tabIndex={onglet === o.cle ? 0 : -1} onClick={() => changerOnglet(o.cle)}>
                {o.libelle}
                {o.cle === 'reglages' && signalReglages && <i className="pf-signal" title="Position du site à régler" />}
              </button>
            ))}
          </div>
        </div>

        <div className="pf-corps" ref={corps}>
          <div role="tabpanel" id="pf-panneau-affectation" aria-labelledby="pf-onglet-affectation" className="pf-panneau"
               hidden={onglet !== 'affectation'}>
            {alertes.length > 0 && (
              <ul className="pf-alertes">{alertes.map((x) => <li key={x.texte}>{x.texte} {x.action}</li>)}</ul>
            )}
            <dl className="sv-d-faits pf-faits">
              <div><dt>Commande</dt><dd>{s.commande_nom ?? 'Non facturable'}
                {s.article_commande && <small>{s.article_commande}</small>}</dd></div>
              {s.feuille_modele && <div><dt>Feuille de travail</dt><dd>{s.feuille_modele}</dd></div>}
              {!!s.assignes_odoo?.length && <div><dt>Assignés dans Odoo</dt><dd>{s.assignes_odoo.join(', ')}</dd></div>}
              {s.partner_phone && <div><dt>Contact</dt><dd>{s.partner_phone}</dd></div>}
              {competences && <div><dt>Compétences</dt><dd>{competences}</dd></div>}
              {s.cloture_odoo && <div><dt>Dans Odoo</dt><dd>Terminé ou annulé</dd></div>}
              <div className="pf-large"><dt>Site</dt><dd>{s.site_adresse ?? 'Adresse non renseignée'}</dd></div>
            </dl>
            <DescriptionOdoo id={s.id} simule={s.simule} ecrire={ecrire} />
            <LivraisonsAttente liste={s.livraisons_attente ?? []} />

            {(propose || a?.motif_derogation || cause) && (
              <div className="pf-raisons">
                {cause && <p className="pf-cause">Non planifié par le solveur : {cause}</p>}
                {propose && <>
                  <p className="pf-raisons-titre">Proposition du solveur</p>
                  <p>{propose.raison_techniciens}</p>
                  <p>{propose.vehicle_id != null && <strong>{nomVehicule({ modele: propose.vehicule_modele, plaque: propose.vehicule, id: propose.vehicle_id })}. </strong>}
                    {propose.raison_vehicule}
                    {propose.km_aller_retour != null && `, ${Math.round(propose.km_aller_retour)} km aller-retour`}
                    {propose.cout_estime != null && `, environ ${Math.round(propose.cout_estime)} € (hors hôtel et repas)`}</p>
                  {!publie && !a && (
                    <button type="button" className="btn btn-petit" onClick={() => {
                      setEquipe(propose.matricules); setDebut(propose.debut);
                      setJours(ouvresApres(propose.debut, propose.fin) + 1); setVehicule(propose.vehicle_id);
                    }}>Reprendre la proposition ({propose.equipe.join(', ')}, {jj(propose.debut)}
                      {propose.fin !== propose.debut ? ` au ${jj(propose.fin)}` : ''})</button>
                  )}</>}
                {a?.motif_derogation && <p className="pf-cause">Dérogation : {a.motif_derogation}</p>}
              </div>
            )}

            {publie ? (<>
              <section className="pf-publiee" aria-labelledby="pf-titre-publiee">
                <div className="pf-jour" aria-hidden="true">
                  {premier && <><b>{premier.getDate()}</b><span>{MOIS_COURT[premier.getMonth()]}</span>
                    <small>{premier.toLocaleDateString('fr-FR', { weekday: 'short' })}</small></>}
                </div>
                <div className="pf-publiee-corps">
                  <h3 id="pf-titre-publiee">Affectation publiée</h3>
                  <p className="pf-dates">{a && datesAffectation(a.debut, a.fin)}</p>
                  {a && a.equipe.length > 0 && <div className="sv-equipe">{a.equipe.map((n) => (
                    <span key={n} className="dc-tech"><i aria-hidden="true">{initiales(n)}</i>{n}</span>))}</div>}
                  <p className="pf-vehicule">{a?.vehicle_id != null
                    ? <><strong>{a.modele ?? 'Véhicule'}</strong>{a.plaque && <Plaque plaque={a.plaque} />}</>
                    : <span className="muet">Sans véhicule</span>}</p>
                </div>
              </section>
              {motif === null ? (
                <p className="pf-note">Publiée, donc figée. Pour la modifier ou la retirer, retirez d'abord la publication : elle
                  repasse « verrouillée », avec la même équipe, les mêmes dates et le même véhicule.</p>
              ) : (
                <label className="pf-motif">Pourquoi retirer la publication ? <small>Facultatif, enregistré dans le journal</small>
                  <textarea autoFocus rows={2} maxLength={500} value={motif} onChange={(e) => setMotif(e.target.value)}
                    placeholder="Ex. : le client a déplacé le rendez-vous" />
                </label>
              )}
            </>) : (<>
              <section className="pf-section" aria-labelledby="pl-equipe">
                <div className="pf-section-tete">
                  <h3 id="pl-equipe">Équipe</h3>
                  <span className={equipe.length === nbVoulu ? 'pf-compte ok' : 'pf-compte'}>{equipe.length} sur {nbVoulu}</span>
                  <span className="pf-aide">du {jourLong(debut)} au {jourLong(fin)}</span>
                  <button type="button" className="lien-bouton pf-taille" onClick={() => changerOnglet('reglages')}>
                    Dates et taille de l'équipe</button>
                </div>
                {parAgence.map(([code, techs]) => (
                  <div key={code} className="pl-groupe-techs">
                    <span className="pl-groupe-nom">{agences.get(code) ?? code}</span>
                    <div className="pl-choix-techs">
                      {techs.map((t) => <ChoixTechnicien key={t.matricule} t={t} choisi={equipe.includes(t.matricule)}
                        absent={absentSur(t, debut, fin)} onBasculer={() => basculer(t.matricule)} />)}
                    </div>
                  </div>
                ))}
              </section>

              <section className="pf-section" aria-labelledby="pl-vehicule">
                <div className="pf-section-tete"><h3 id="pl-vehicule">Véhicule</h3>
                  <span className="pf-aide">les conformes d'abord</span></div>
                <MenuVehicule serviceId={s.id} matricules={equipe} debut={debut} fin={fin} actuel={vehicule}
                  onChoisir={(v) => setVehicule(v?.vehicle_id ?? null)} />
              </section>

              <section className="pf-section" aria-labelledby="pl-motif">
                <div className="pf-section-tete"><h3 id="pl-motif">Motif</h3>
                  <span className="pf-aide">facultatif, enregistré dans le journal (utile si une règle est enfreinte)</span></div>
                <textarea className="pf-texte" aria-labelledby="pl-motif" rows={2} maxLength={500} value={note}
                  onChange={(e) => setNote(e.target.value)} placeholder="Ex. : congé annulé par téléphone" />
              </section>

              <label className="pf-verrou">
                <input type="checkbox" checked={verrou} onChange={(e) => setVerrou(e.target.checked)} />
                <span className="pl-piste" aria-hidden="true" />
                <span><strong>Verrouiller</strong><small>Le solveur ne changera plus cette affectation</small></span>
              </label>
            </>)}
          </div>

          {monte('reglages') && (
            <div role="tabpanel" id="pf-panneau-reglages" aria-labelledby="pf-onglet-reglages" className="pf-panneau"
                 hidden={onglet !== 'reglages'}>
              {publie ? (
                <p className="pf-reglages-fige">Service publié : dates et réglages figés. Pour les modifier, retirer d'abord la
                  publication (onglet « Affectation »).</p>
              ) : (
                <section className="pf-section" aria-labelledby="pl-dates">
                  <div className="pf-section-tete"><h3 id="pl-dates">Dates</h3>
                    <span className="pf-aide">jusqu'au <strong>{jourLong(fin)}</strong>, enregistrées avec l'équipe</span></div>
                  <div className="pf-dates">
                    <label>Premier jour<input type="date" value={debut} onChange={(e) => e.target.value && setDebut(e.target.value)} /></label>
                    <label>Jours ouvrés<input type="number" min={1} max={20} value={jours}
                      onChange={(e) => setJours(Math.max(1, Number(e.target.value) || 1))} /></label>
                  </div>
                </section>
              )}
              {refs ? (
                <ReglagesService key={`${s.id}-${s.version}-${placer}`} ref={reglagesRef} service={s} refs={refs} ecrire={ecrire}
                  corrigerPosition={placer} onEtat={surEtatReglages} onConflit={onReglages} onSoumettre={() => void sauver()} />
              ) : <p className="muet">Chargement des réglages…</p>}
            </div>
          )}
        </div>

        <footer className="sv-d-pied pf-pied">
          <div className="pf-liens">
            <Link to={`/statistiques/services/${s.id}`}>Fiche du service</Link>
            {s.odoo_url && <a href={s.odoo_url} target="_blank" rel="noreferrer">Ouvrir dans Odoo ↗</a>}
          </div>
          <div className="sv-d-boutons">
            {!publie && a && (
              <button type="button" className="btn pl-btn-retirer" disabled={occupe} onClick={() => void agir(() => retirer(s))}>
                Retirer l'affectation</button>
            )}
            {publie && motif === null && (
              <button type="button" className="btn pl-btn-retirer" onClick={() => { changerOnglet('affectation'); setMotif(''); }}>
                Retirer la publication</button>
            )}
            {publie && motif !== null && (
              <button type="button" className="btn btn-primaire" disabled={occupe}
                onClick={async () => { setEnvoi(true); try { await depublier(s, motif.trim() || null); } finally { setEnvoi(false); } }}>
                {envoi ? 'Retrait…' : 'Confirmer le retrait'}</button>
            )}
            <button type="button" className="btn" onClick={onFermer} disabled={occupe}>{aEnregistrer ? 'Annuler' : 'Fermer'}</button>
            {!publie && (
              <button type="button" className="btn btn-primaire" disabled={!aEnregistrer || occupe} onClick={() => void sauver()}>
                {envoi ? 'Enregistrement…' : !a && affectationModifiee ? 'Affecter' : 'Enregistrer'}</button>
            )}
          </div>
        </footer>
      </div>
      {dialogue}
    </div>
  );
}

// ---------- tableau ----------

type Segment = { s: ServicePlanif; de: number; a: number; voie: number; coupeAvant: boolean; coupeApres: boolean };

/** Services d'un technicien sur la semaine, en barres (colonnes 0–4) réparties en voies sans chevauchement. */
function segmentsDe(matricule: string, liste: ServicePlanif[], jours: string[]): { segments: Segment[]; voies: number } {
  const index = (d: string) => (d < jours[0] ? -1 : d > jours[4] ? 5 : Math.max(0, jours.findIndex((j) => j >= d)));
  const bruts = liste
    .filter((s) => s.affectation?.matricules.includes(matricule) && s.affectation.debut <= jours[4] && s.affectation.fin >= jours[0])
    .map((s) => {
      const de = index(s.affectation!.debut), a = index(s.affectation!.fin);
      return { s, de: Math.max(0, de), a: Math.min(4, a), coupeAvant: de < 0, coupeApres: a > 4 };
    })
    .sort((x, y) => x.de - y.de || y.a - x.a);
  const finVoies: number[] = [];
  const segments = bruts.map((b) => {
    let voie = finVoies.findIndex((f) => f < b.de);
    if (voie < 0) { voie = finVoies.length; finVoies.push(b.a); } else finVoies[voie] = b.a;
    return { ...b, voie };
  });
  return { segments, voies: Math.max(1, finVoies.length) };
}

// ---------- page ----------

type Vue = 'semaine' | 'mois';
const MOIS_COURT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const maj = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** « 9 – 13 novembre », « 30 nov. – 4 déc. » ; l'année seulement si ce n'est pas l'année en cours. */
function titrePeriode(debut: string, fin: string, abrege: boolean) {
  const [a, b] = [new Date(`${debut}T12:00:00`), new Date(`${fin}T12:00:00`)];
  const mois = abrege ? MOIS_COURT : MOIS;
  const annee = b.getFullYear() !== new Date().getFullYear() ? ` ${b.getFullYear()}` : '';
  return a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()} ${mois[b.getMonth()]}${annee}`
    : `${a.getDate()} ${mois[a.getMonth()]} – ${b.getDate()} ${mois[b.getMonth()]}${annee}`;
}
/** « Mer. 11 nov. », « Du mer. 11 au jeu. 12 nov. », « Du lun. 30 nov. au mar. 1 déc. ». */
function datesAffectation(debut: string, fin: string) {
  const court = (s: string, avecMois: boolean) => {
    const d = new Date(`${s.slice(0, 10)}T12:00:00`);
    return `${['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'][d.getDay()]} ${d.getDate()}${avecMois ? ` ${MOIS_COURT[d.getMonth()]}` : ''}`;
  };
  if (debut === fin) return maj(court(debut, true));
  return `Du ${court(debut, debut.slice(5, 7) !== fin.slice(5, 7))} au ${court(fin, true)}`;
}

export default function Planification() {
  // ?vue=mois (4 semaines) ; ?semaine=AAAA-MM-JJ (lundi affiché). L'adresse garde la vue et la période.
  const [params, setParams] = useSearchParams();
  const vue: Vue = params.get('vue') === 'mois' ? 'mois' : 'semaine';
  const semaineParam = params.get('semaine');
  const lundi = useMemo(() => lundiDe(semaineParam && /^\d{4}-\d{2}-\d{2}$/.test(semaineParam) ? semaineParam : aujourdhui()),
    [semaineParam]);
  const aller = (l: Date, v: Vue = vue) =>
    setParams(v === 'mois' ? { vue: 'mois', semaine: iso(l) } : { semaine: iso(l) }, { replace: true });
  const jours = useMemo(() => JOURS.map((_, k) => iso(decaler(lundi, k))), [lundi]);
  const [debut, fin] = [jours[0], jours[4]];
  const finMois = iso(decaler(lundi, 25));                 // vendredi de la 4e semaine
  const auj = aujourdhui();
  const lundiAuj = iso(lundiDe(auj));
  const surAujourdhui = vue === 'semaine' ? debut === lundiAuj : lundiAuj >= debut && lundiAuj <= finMois;

  const services = useDonnees(() => planif.services(debut, vue === 'mois' ? finMois : fin), [debut, vue]);
  const plusTard = useDonnees(() => planif.plusTard(fin), [fin]);         // prévus dans Odoo après la semaine
  const ressources = useDonnees(() => planif.ressources(debut, fin), [debut]);
  const refs = useDonnees(() => planif.referentiels(), []);
  const [proposition, setProposition] = useState<Proposition | null>(null);
  const [ouvert, setOuvert] = useState<number | null>(null);
  const [onglet, setOnglet] = useState<Onglet>('affectation');      // onglet de la fiche ouverte
  const [message, setMessage] = useState<{ type: 'erreur' | 'ok'; texte: string } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [enfreintes, setEnfreintes] = useState<{ client: string; regles: string[] } | null>(null);   // dernière dérogation
  const [confirmerPublication, setConfirmerPublication] = useState(false);
  const [confirmerRetrait, setConfirmerRetrait] = useState(false);   // « Tout retirer »
  const [glisse, setGlisse] = useState<Glisse | null>(null);
  const [brouillon, setBrouillon] = useState<Brouillon | null>(null);
  const [survol, setSurvol] = useState<string | null>(null);
  const [recherche, setRecherche] = useState('');
  const [focus, setFocus] = useState<number | null>(null);          // service survolé : clignote sur la carte
  const [maintenant, setMaintenant] = useState(() => new Date());
  const [temps_, setTemps] = useState<Meteo | null>(null);
  const { ecrire, dialogue } = useEcriture();

  const liste = useMemo(() => services.donnees ?? [], [services.donnees]);
  const techniciens = useMemo(() => ressources.donnees?.techniciens ?? [], [ressources.donnees]);
  const agences = useMemo(() => new Map((ressources.donnees?.agences ?? []).map((a) => [a.code, a.nom])), [ressources.donnees]);
  const feries = useMemo(() => new Map((ressources.donnees?.feries ?? []).map((f) => [f.date, f.nom])), [ressources.donnees]);
  const parId = useMemo(() => new Map(liste.map((s) => [s.id, s])), [liste]);
  const proposes = useMemo(() => new Map((proposition?.affectations ?? []).map((a) => [a.service_id, a])), [proposition]);
  // avertissements éphémères : messages, dérogations et causes du solveur s'effacent seuls après quelques secondes
  const [causesVisibles, setCausesVisibles] = useState(false);
  useEffect(() => {
    if (!message) return undefined;
    const t = window.setTimeout(() => setMessage(null), message.type === 'erreur' ? 9000 : 6000);
    return () => window.clearTimeout(t);
  }, [message]);
  useEffect(() => {
    if (!enfreintes) return undefined;
    const t = window.setTimeout(() => setEnfreintes(null), 8000);
    return () => window.clearTimeout(t);
  }, [enfreintes]);
  useEffect(() => {
    if (!causesVisibles) return undefined;
    const t = window.setTimeout(() => setCausesVisibles(false), 8000);
    return () => window.clearTimeout(t);
  }, [causesVisibles, proposition]);
  const causes = useMemo(() => new Map(causesVisibles
    ? (proposition?.non_planifies ?? []).map((n) => [n.service_id, n.cause]) : []), [proposition, causesVisibles]);
  const aPlanifier = liste.filter((s) => !s.affectation)
    .sort((x, y) => Number(y.priority === '1') - Number(x.priority === '1') || x.name.localeCompare(y.name, 'fr'));
  const aPublier = liste.filter((s) => s.affectation && s.statut_planification !== 'publie');
  const aRetirer = liste.filter((s) => s.affectation && s.statut_planification !== 'publie');
  const publiees = liste.filter((s) => s.affectation && s.statut_planification === 'publie');
  const groupes = useMemo(() => {
    const q = sansAccents(recherche.trim());
    const par = new Map<string, TechnicienPlanif[]>();
    for (const t of [...techniciens].sort((x, y) => x.nom.localeCompare(y.nom))) {
      if (q && !sansAccents(t.nom).includes(q)) continue;
      par.set(t.agence, [...(par.get(t.agence) ?? []), t]);
    }
    return [...par.entries()].sort(([a], [b]) => (agences.get(a) ?? a).localeCompare(agences.get(b) ?? b, 'fr'));
  }, [techniciens, agences, recherche]);
  const ordre = groupes.flatMap(([, techs]) => techs.map((t) => t.matricule));
  const glisseAffecte = glisse ? !!parId.get(glisse.serviceId)?.affectation : false;
  // brouillon d'équipe : affiché en barre (pointillés) sur les techniciens déjà choisis, sans être enregistré
  const listeAffichee = useMemo(() => {
    const s = brouillon && parId.get(brouillon.serviceId);
    if (!s || s.affectation) return liste;
    const nom = (m: string) => techniciens.find((x) => x.matricule === m)?.nom ?? m;
    const faux = { ...s, affectation: { matricules: brouillon.matricules, equipe: brouillon.matricules.map(nom),
      vehicle_id: null, plaque: null, debut: brouillon.debut, fin: brouillon.fin, etat: 'brouillon',
      propose_par: 'dispatcher', raison: null, motif_derogation: null } } as unknown as ServicePlanif;
    return [...liste, faux];
  }, [liste, brouillon, parId, techniciens]);
  // jours de la semaine où chaque technicien a déjà un service
  const occupation = useMemo(() => new Map(techniciens.map((t) => [t.matricule, new Set(jours.filter((j) => liste.some((s) =>
    s.affectation?.matricules.includes(t.matricule) && s.affectation.debut <= j && s.affectation.fin >= j)))])),
  [techniciens, liste, jours]);
  const libre = (t: TechnicienPlanif, j: string) => !feries.has(j) && !absentSur(t, j, j) && !occupation.get(t.matricule)?.has(j);
  useEffect(() => { setBrouillon(null); }, [debut]);                                // autre semaine : abandonné
  useEffect(() => {                                                                  // ligne « maintenant »
    const t = window.setInterval(() => setMaintenant(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  /** Agence de référence pour la météo : le siège (Noisy), sinon la première agence placée. */
  const siege = useMemo(() => {
    const placees = (ressources.donnees?.agences ?? []).filter((a) => a.lat !== null && a.lng !== null);
    return placees.find((a) => a.code === 'noisy') ?? placees[0] ?? null;
  }, [ressources.donnees]);
  useEffect(() => {
    let vivant = true;
    setTemps(null);
    if (siege) meteo(siege.lat!, siege.lng!, debut, fin).then((m) => { if (vivant) setTemps(m); }).catch(() => undefined);
    return () => { vivant = false; };
  }, [siege, debut, fin]);
  useEffect(() => {                                                                  // affecté (fiche, autre écran)
    if (brouillon && parId.get(brouillon.serviceId)?.affectation) setBrouillon(null);
  }, [brouillon, parId]);
  // ?service=<id>&onglet=reglages (page Services sur site) : ouvre la fiche du service une fois la semaine chargée
  const aOuvrir = Number(params.get('service')) || null;
  const ongletDemande = params.get('onglet');
  useEffect(() => {
    if (aOuvrir === null || !services.donnees) return;
    if (parId.has(aOuvrir)) { setOnglet(lireOnglet(ongletDemande)); setOuvert(aOuvrir); }
    else setMessage({ type: 'erreur', texte: "Ce service n'apparaît pas sur cette période (terminé dans Odoo, ou planifié "
      + 'une autre semaine).' });
    const reste = new URLSearchParams(params);
    reste.delete('service'); reste.delete('onglet');
    setParams(reste, { replace: true });
  }, [aOuvrir, ongletDemande, services.donnees, parId, params, setParams]);
  const ouvrir = (id: number) => { setOnglet('affectation'); setOuvert(id); };
  const fermerFiche = useCallback(() => setOuvert(null), []);

  // Tout se recalcule depuis le serveur après chaque changement : calendrier, carte, « À planifier », jours libres,
  // charge des techniciens et compteurs de la barre ; aussi au retour sur l'onglet (changement fait ailleurs).
  const recharger = () => { services.recharger(); ressources.recharger(); plusTard.recharger(); };
  const rechargerRef = useRef(recharger);
  rechargerRef.current = recharger;

  // Services créés ou modifiés dans Odoo (Services sur site) : copie mise à jour à l'ouverture, au retour sur l'onglet et
  // toutes les 2 minutes (sautée si le dernier cycle a moins de 60 s), ou tout de suite par le bouton ; la
  // synchronisation automatique du serveur continue. Un changement recharge la semaine.
  const [synchro, setSynchro] = useState<{ fin: string | null; enCours: boolean; erreur: boolean }>(
    { fin: null, enCours: false, erreur: false });
  const synchroniser = async (bouton: boolean) => {
    setSynchro((x) => ({ ...x, enCours: true }));
    try {
      const r = await stats.synchroniser(bouton ? undefined : 60);
      setSynchro({ fin: r.dernier_cycle ?? null, enCours: false, erreur: false });
      const b = r.services;
      if (b && b.ajoutes.length + b.mis_a_jour.length + b.sortis.length > 0) rechargerRef.current();
      if (bouton) {
        setMessage({ type: 'ok', texte: b?.ajoutes.length
          ? `${b.ajoutes.length} nouveau${b.ajoutes.length > 1 ? 'x' : ''} service${b.ajoutes.length > 1 ? 's' : ''} depuis Odoo.`
          : 'Odoo est à jour.' });
      }
    } catch (e) {
      const dejaEnCours = e instanceof ErreurStats && e.statut === 409;            // cycle du serveur en cours : pas une panne
      setSynchro((x) => ({ ...x, enCours: false, erreur: !dejaEnCours }));
      if (bouton) {
        setMessage({ type: 'erreur', texte: e instanceof ErreurStats && e.statut === 409
          ? 'Synchronisation déjà en cours : réessayer dans un instant.' : `Synchronisation Odoo : ${e instanceof Error ? e.message : String(e)}` });
      }
    }
  };
  const synchroRef = useRef(synchroniser);
  synchroRef.current = synchroniser;
  useEffect(() => {
    const auRetour = () => {
      if (document.visibilityState !== 'visible') return;
      rechargerRef.current();
      void synchroRef.current(false);
    };
    void synchroRef.current(false);
    const minuterie = window.setInterval(() => { if (document.visibilityState === 'visible') void synchroRef.current(false); },
      120_000);
    document.addEventListener('visibilitychange', auRetour);
    window.addEventListener('focus', auRetour);
    return () => {
      window.clearInterval(minuterie);
      document.removeEventListener('visibilitychange', auRetour);
      window.removeEventListener('focus', auRetour);
    };
  }, []);
  const erreurTexte = (e: unknown) =>
    (e instanceof ErreurPlanif && e.statut === 409 ? CONFLIT : e instanceof Error ? e.message : String(e));
  const finGlisse = () => { setGlisse(null); setSurvol(null); };

  /** Enregistre un choix du dispatcher. Règles obligatoires enfreintes : enregistré quand même (dérogation, motif
   *  facultatif, journalisée), puis avertissement listant les règles. */
  const enregistrer = async (s: ServicePlanif, corps: Omit<CorpsAffectation, 'version' | 'motif'>,
    motif: string | null = null): Promise<boolean> => {
    setMessage(null);
    setEnfreintes(null);
    try {
      const r = await ecrire(() => planif.affecter(s.id, { ...corps, motif, version: s.version }));
      if (!r) return false;
      if (r.violations?.length) setEnfreintes({ client: client(s), regles: [...new Set(r.violations.map((v) => v.message))] });
    } catch (e) {
      setMessage({ type: 'erreur', texte: erreurTexte(e) });
      if (e instanceof ErreurPlanif && e.statut === 409) recharger();
      return false;
    }
    recharger();
    return true;
  };

  const deposer = async (e: DragEvent, matricule: string, jour: string) => {
    e.preventDefault();
    const g = lireGlisse(e) ?? glisse;
    finGlisse();
    const s = g && parId.get(g.serviceId);
    if (!g || !s || s.statut_planification === 'publie') return;
    const a = s.affectation;
    if (a && a.debut === jour && g.depuis === matricule) return;                       // reposé au même endroit
    const nb = Math.max(1, s.nb_techniciens || 1);
    const nom = (m: string) => techniciens.find((x) => x.matricule === m)?.nom ?? m;
    // durée gardée si déjà affecté ; sinon celle du solveur s'il l'a proposé (trajet compris), sinon les heures
    const suggestion = proposes.get(s.id);
    let debutAff = jour;
    let finAff = plusOuvres(jour, a ? ouvresApres(a.debut, a.fin)
      : suggestion ? ouvresApres(suggestion.debut, suggestion.fin) : dureeService(s) - 1);
    let equipe: string[];
    let texteOk: string;
    if (!a && nb > 1) {
      // service à plusieurs techniciens : composer l'équipe dépôt après dépôt, enregistrer quand elle est complète
      const b = brouillon?.serviceId === s.id ? brouillon : null;
      equipe = b ? [...new Set([...b.matricules, matricule])] : [matricule];
      if (b) { debutAff = b.debut; finAff = b.fin; }
      if (equipe.length < nb) {
        setBrouillon({ serviceId: s.id, debut: debutAff, fin: finAff, matricules: equipe });
        setMessage({ type: 'ok', texte: `« ${client(s)} » : équipe ${equipe.length}/${nb} (${equipe.map(nom).join(', ')}). `
          + `Glissez la carte sur ${nb - equipe.length === 1 ? 'un autre technicien' : `${nb - equipe.length} autres techniciens`} ; `
          + "elle sera enregistrée quand l'équipe sera complète." });
        return;
      }
      texteOk = `« ${client(s)} » affecté à ${equipe.map(nom).join(', ')}, ${jourLong(debutAff)}`
        + `${finAff !== debutAff ? ` → ${jourLong(finAff)}` : ''}.`;
    } else if (a && a.matricules.length < nb && !a.matricules.includes(matricule)) {
      // équipe incomplète : le technicien visé rejoint l'équipe, mêmes dates
      equipe = [...a.matricules, matricule];
      [debutAff, finAff] = [a.debut, a.fin];
      texteOk = `${nom(matricule)} rejoint l'équipe de « ${client(s)} » (${equipe.length}/${nb}).`;
    } else {
      equipe = a ? [...new Set(a.matricules.map((m) => (m === g.depuis ? matricule : m)))] : [matricule];
      texteOk = `« ${client(s)} » affecté à ${nom(matricule)}, ${jourLong(jour)}.`;
    }
    // Équipe ou jours changés : garder le véhicule s'il reste conforme, sinon prendre le premier conforme
    let vehicule = a?.vehicle_id ?? null;
    try {
      const choix = await planif.vehicules(s.id, { matricules: equipe.join(','), debut: debutAff, fin: finAff });
      const actuel = choix.find((v) => v.vehicle_id === vehicule && v.conforme);
      vehicule = actuel?.vehicle_id ?? choix.find((v) => v.conforme)?.vehicle_id ?? vehicule;
    } catch { /* liste indisponible : véhicule actuel gardé, la règle le signalera si besoin */ }
    if (await enregistrer(s, { matricules: equipe, vehicle_id: vehicule, debut: debutAff, fin: finAff,
      verrouiller: a?.etat === 'verrouille' })) {
      if (brouillon?.serviceId === s.id) setBrouillon(null);
      setMessage({ type: 'ok', texte: texteOk });
    }
  };

  const retirer = async (s: ServicePlanif): Promise<boolean> => {
    setMessage(null);
    try {
      const r = await ecrire(() => planif.retirerAffectation(s.id, s.version));
      if (!r) return false;
      setMessage({ type: 'ok', texte: `« ${client(s)} » est revenu dans « À planifier ».` });
      recharger();
      return true;
    } catch (e) {
      setMessage({ type: 'erreur', texte: erreurTexte(e) });
      if (e instanceof ErreurPlanif && e.statut === 409) recharger();
      return false;
    }
  };

  /** Retire la publication : le service repasse « verrouillé » ; la fiche reste ouverte, de nouveau modifiable. */
  const depublier = async (s: ServicePlanif, motif: string | null): Promise<boolean> => {
    setMessage(null);
    try {
      const r = await ecrire(() => planif.depublier(s.id, s.version, motif));
      if (!r) return false;
      setMessage({ type: 'ok', texte: `« ${client(s)} » n'est plus publié : verrouillé, de nouveau modifiable${motif ? ' — motif journalisé' : ''}.` });
      recharger();
      return true;
    } catch (e) {
      setMessage({ type: 'erreur', texte: erreurTexte(e) });
      if (e instanceof ErreurPlanif && e.statut === 409) recharger();
      return false;
    }
  };

  const deposerDansListe = (e: DragEvent) => {
    e.preventDefault();
    const g = lireGlisse(e) ?? glisse;
    finGlisse();
    const s = g && parId.get(g.serviceId);
    if (s?.affectation && s.statut_planification !== 'publie') void retirer(s);
  };

  const proposer = async () => {
    setMessage(null); setOccupe(true);
    try {
      const p = await ecrire(() => planif.proposer(debut, fin));
      if (p) {
        setProposition(p); setCausesVisibles(true);
        const tardifs = p.affectations.filter((a) => a.avertissement);
        setMessage({ type: 'ok', texte: `Le solveur a proposé ${p.affectations.length} service(s)`
          + (tardifs.length ? ` ; ${tardifs.map((a) => `${a.service} : ${a.avertissement}`).join(' ; ')}` : '')
          + (p.non_planifies.length ? ` ; ${p.non_planifies.length} restent à planifier (cause sur chaque carte).` : '.') });
        recharger();
      }
    } catch (e) { setMessage({ type: 'erreur', texte: erreurTexte(e) }); } finally { setOccupe(false); }
  };

  /** Classeur Excel de la période affichée (semaine ou 4 semaines) ; export journalisé (nom demandé si besoin). */
  const exporter = async () => {
    const [d, f] = vue === 'mois' ? [debut, finMois] : [debut, fin];
    setMessage(null);
    try {
      const blob = await ecrire(() => exportations.planification(d, f));
      if (blob) enregistrerFichier(blob, nomFichier('planification', `${d}_${f}`));
    } catch (e) { setMessage({ type: 'erreur', texte: erreurTexte(e) }); }
  };

  /** Retire toutes les affectations de la semaine, publiées comprises ; le journal garde qui l'a fait. */
  const toutRetirer = async () => {
    setConfirmerRetrait(false); setMessage(null); setOccupe(true);
    try {
      const r = await ecrire(() => planif.retirerTout(debut, fin, true, null));
      if (r) {
        setProposition(null);
        setMessage({ type: 'ok', texte: `${r.services} affectation(s) retirée(s) : les services repassent « à planifier ».` });
        recharger();
      }
    } catch (e) { setMessage({ type: 'erreur', texte: erreurTexte(e) }); } finally { setOccupe(false); }
  };

  const publier = async () => {
    setConfirmerPublication(false); setMessage(null); setOccupe(true);
    try {
      const r = await ecrire(() => planif.publier(debut, fin));
      if (r) { setMessage({ type: 'ok', texte: `${r.services} service(s) publié(s).` }); recharger(); }
    } catch (e) { setMessage({ type: 'erreur', texte: erreurTexte(e) }); } finally { setOccupe(false); }
  };

  const selection = ouvert !== null ? parId.get(ouvert) : undefined;
  /** Jours de la semaine où l'affectation tombe sur un férié ou un congé du technicien (dérogation). */
  const conflitsDe = (s: ServicePlanif, t: TechnicienPlanif): string[] => {
    const a = s.affectation;
    if (!a) return [];
    return jours.filter((j) => j >= a.debut && j <= a.fin).flatMap((j) => {
      const ferie = feries.get(j);
      if (ferie) return [`Affecté le ${jourLong(j)}, jour férié (${ferie})`];
      return absentSur(t, j, j) ? [`Affecté pendant un congé (${jourLong(j)})`] : [];
    });
  };
  const infosCarte = (s: ServicePlanif) => {
    const limite = (s.fenetre_fin ?? s.date_deadline)?.slice(0, 10) ?? null;
    const retard = !s.planned_date_begin && limite && limite < auj ? `En retard (avant le ${jj(limite)})` : null;
    const quand = retard ? null : contrainteDate(s);
    return {
      infos: [nombreH(s.allocated_hours), `${s.nb_techniciens} technicien${s.nb_techniciens > 1 ? 's' : ''}`,
        s.vehicule_requis === 'utilitaire' ? 'utilitaire' : null, quand && quand.charAt(0).toLowerCase() + quand.slice(1)]
        .filter(Boolean).join(', '),
      retard };
  };
  const libresDuJour = (j: string) => techniciens.filter((t) => libre(t, j)).length;

  // maintenant (heure de Paris) : ligne sur la colonne du jour, de 8 h (bord gauche) à 18 h (bord droit)
  const parties = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23' }).formatToParts(maintenant);
  const [h, mn] = ['hour', 'minute'].map((t) => Number(parties.find((x) => x.type === t)?.value ?? 0));
  const heure = `${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
  const kAuj = jours.indexOf(auj);
  const fraction = Math.min(1, Math.max(0, (h + mn / 60 - 8) / 10));
  const dateParis = maj(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric',
    month: 'long' }).format(maintenant));
  const actuel = temps_?.actuelle ? temps(temps_.actuelle.code) : null;
  // carte : services affectés seulement (proposés, verrouillés, publiés) ; retirés -> ils quittent la carte
  const sitesCarte: SitePlanif[] = liste.filter((s) => s.affectation && s.site_lat !== null && s.site_lng !== null).map((s) => ({
    id: s.id, lat: s.site_lat!, lng: s.site_lng!, etat: etatDe(s), urgent: s.priority === '1', titre: client(s),
    detail: `${s.name}, ${datesAffectation(s.affectation!.debut, s.affectation!.fin).toLowerCase()}` }));
  const agencesCarte: AgencePlanif[] = (ressources.donnees?.agences ?? []).filter((a) => a.lat !== null && a.lng !== null)
    .map((a) => ({ code: a.code, nom: a.nom, lat: a.lat!, lng: a.lng! }));

  return (
    <div className={`pl${glisse ? ' pl-glisse' : ''}`}>
      <header className="pl-tete-page">
      <div className="pl-titre-ligne">
        <h1>Planification</h1>
        <div className="pl-etat" role="group" aria-label="Aujourd'hui">
          <div className="pl-etat-case pl-etat-heure">
            <time className="pl-etat-valeur" dateTime={maintenant.toISOString()}>{heure}</time>
            <span className="pl-etat-texte"><strong>{dateParis}</strong><small>heure de Paris</small></span>
          </div>
          {actuel && temps_?.actuelle && siege && (
            <div className="pl-etat-case pl-etat-meteo" title={`${actuel.libelle} à ${siege.nom}, maintenant`}>
              <span className="pl-etat-icone" aria-hidden="true">{actuel.icone}</span>
              <span className="pl-etat-valeur">{Math.round(temps_.actuelle.temperature)}°</span>
              <span className="pl-etat-texte"><strong>{actuel.libelle}</strong><small>{siege.nom}</small></span>
            </div>
          )}
          <div className={`pl-etat-case pl-etat-odoo${synchro.enCours ? ' en-cours' : synchro.erreur ? ' en-erreur' : ''}`}>
            <span className="pl-etat-texte" aria-live="polite">
              <strong><i aria-hidden="true" />{synchro.enCours ? 'Synchronisation…' : synchro.erreur ? 'Odoo injoignable'
                : synchro.fin ? 'Odoo à jour' : 'Odoo'}</strong>
              <small>{synchro.enCours ? 'Services sur site' : synchro.erreur ? 'nouvel essai dans 2 min'
                : synchro.fin ? depuisQuand(synchro.fin, maintenant) : 'Services sur site'}</small>
            </span>
            <button type="button" className="pl-etat-synchro" disabled={synchro.enCours} onClick={() => void synchroniser(true)}
              aria-label="Synchroniser avec Odoo maintenant"
              title="Synchroniser avec Odoo maintenant (sinon automatique : à l'ouverture, au retour sur l'onglet, toutes les 2 min)">
              <IconeSynchro /></button>
          </div>
        </div>
      </div>
      <div className="pl-barre-outils">
        <nav className="pl-periode" aria-label="Période">
          <button type="button" className="btn pl-auj" aria-current={surAujourdhui ? 'date' : undefined}
            onClick={() => aller(lundiDe(auj))}>Aujourd'hui</button>
          <div className="pl-fleches">
            <button type="button" className="btn" aria-label={vue === 'mois' ? '4 semaines précédentes' : 'Semaine précédente'}
              title={vue === 'mois' ? '4 semaines précédentes' : 'Semaine précédente'}
              onClick={() => aller(decaler(lundi, vue === 'mois' ? -28 : -7))}>‹</button>
            <button type="button" className="btn" aria-label={vue === 'mois' ? '4 semaines suivantes' : 'Semaine suivante'}
              title={vue === 'mois' ? '4 semaines suivantes' : 'Semaine suivante'}
              onClick={() => aller(decaler(lundi, vue === 'mois' ? 28 : 7))}>›</button>
          </div>
          <strong>{vue === 'mois' ? titrePeriode(debut, finMois, true) : titrePeriode(debut, fin, false)}</strong>
        </nav>
        <div className="pl-vue" role="group" aria-label="Vue">
          <button type="button" aria-pressed={vue === 'semaine'} onClick={() => aller(lundi, 'semaine')}>Semaine</button>
          <button type="button" aria-pressed={vue === 'mois'} onClick={() => aller(lundi, 'mois')}>Mois</button>
        </div>
        <div className="pl-actions">
          <button type="button" className="btn pl-icone" onClick={() => void exporter()}
            aria-label={vue === 'mois' ? 'Exporter les 4 semaines (.xlsx)' : 'Exporter la semaine (.xlsx)'}
            title={vue === 'mois' ? 'Exporter les 4 semaines (.xlsx)' : 'Exporter la semaine (.xlsx)'}><IconeTelechargement /></button>
          {vue === 'semaine' ? (<>
            <button type="button" className="btn" disabled={occupe || !aPublier.length} onClick={() => setConfirmerPublication(true)}>
              Publier{aPublier.length ? ` (${aPublier.length})` : ''}</button>
            <button type="button" className="btn btn-danger" disabled={occupe || !(aRetirer.length + publiees.length)}
              onClick={() => setConfirmerRetrait(true)}
              title="Retire toutes les affectations de la semaine, publiées comprises">Tout retirer</button>
            <button type="button" className="btn btn-primaire" disabled={occupe} onClick={() => void proposer()}>
              {occupe ? 'Calcul en cours…' : 'Proposer la semaine'}</button>
          </>) : (
            <button type="button" className="btn" onClick={() => aller(lundi, 'semaine')}>
              {aPlanifier.length ? `${aPlanifier.length} à planifier` : 'Ouvrir la semaine'}</button>
          )}
        </div>
      </div>
      </header>

      {message && <div className={message.type === 'erreur' ? 'erreur' : 'succes'} role={message.type === 'erreur' ? 'alert' : 'status'}>{message.texte}</div>}
      {enfreintes && (
        <div className="avertissement pl-enfreintes" role="status">
          <span><strong>« {enfreintes.client} » enregistré malgré {enfreintes.regles.length > 1 ? 'des règles obligatoires' : 'une règle obligatoire'}</strong>
            {' '}(dérogation journalisée) : {enfreintes.regles.join(' · ')}</span>
          <button type="button" className="pl-fermer-avert" aria-label="Fermer l'avertissement" onClick={() => setEnfreintes(null)}>×</button>
        </div>
      )}

      {vue === 'mois' ? (
        <PlanMois debut={debut} fin={finMois} onOuvrirSemaine={(l) => aller(lundiDe(l), 'semaine')} />
      ) : (<>
        <EtatChargement chargement={(services.chargement && !services.donnees) || (ressources.chargement && !ressources.donnees)}
                        erreur={services.erreur ?? ressources.erreur} />
        <Avertissements liste={[...new Set([...(ressources.donnees?.avertissements ?? []), ...(proposition?.avertissements ?? [])])]} />

        <div className="pl-corps">
          <div className="pl-principal">
            <section className="pl-tableau" aria-label="Semaine par technicien">
              <div className="pl-grille">
                {kAuj >= 0 && <div className="pl-maintenant" aria-hidden="true" title={`Maintenant, ${heure}`}
                  style={{ left: `calc(var(--pl-col-tech) + (100% - var(--pl-col-tech)) * ${(kAuj + fraction) / 5})` }}><span /></div>}
                <div className="pl-ligne pl-entete">
                  <div className="pl-coin">
                    <input type="search" className="pl-recherche" aria-label="Rechercher un technicien" placeholder="Technicien"
                      value={recherche} onChange={(e) => setRecherche(e.target.value)} />
                  </div>
                  {jours.map((j, k) => {
                    const ferie = feries.get(j);
                    const n = libresDuJour(j);
                    return (
                      <div key={j} className={`pl-jour${j === auj ? ' aujourdhui' : ''}${ferie ? ' ferie' : ''}`} style={{ gridColumn: k + 2 }}>
                        <span className="pl-jour-date"><span>{JOURS[k]}</span><strong>{Number(j.slice(8))}</strong>
                          {temps_?.jours[j] && <span className="pl-jour-meteo" title={`${temps(temps_.jours[j].code).libelle}, `
                            + `${Math.round(temps_.jours[j].min)} à ${Math.round(temps_.jours[j].max)} °C${siege ? ` (${siege.nom})` : ''}`}>
                            <span aria-hidden="true">{temps(temps_.jours[j].code).icone}</span>{Math.round(temps_.jours[j].max)}°</span>}</span>
                        {ferie ? <span className="pl-jour-info">Férié ({ferie})</span>
                          : ressources.donnees && <span className="pl-jour-info libres">{n} libre{n > 1 ? 's' : ''}</span>}
                      </div>
                    );
                  })}
                </div>
                {groupes.map(([code, techs]) => (
                  <div key={code} className="pl-agence" role="group" aria-label={agences.get(code) ?? code}>
                    <div className="pl-agence-nom">{agences.get(code) ?? code}</div>
                    {techs.map((t) => {
                      const { segments, voies } = segmentsDe(t.matricule, listeAffichee, jours);
                      const ouvres = jours.filter((j) => !feries.has(j) && !absentSur(t, j, j));
                      const pris = ouvres.filter((j) => occupation.get(t.matricule)?.has(j)).length;
                      const ligne = ordre.indexOf(t.matricule);
                      return (
                        <div key={t.matricule} className="pl-ligne" style={{ gridTemplateRows: `repeat(${voies}, minmax(58px, auto))` }}>
                          <div className="pl-tech" style={{ gridRow: '1 / -1' }}>
                            <strong title={t.nom}>{t.nom}</strong>
                            <span className="pl-tech-jours" title={`${pris} jour(s) occupé(s) sur ${ouvres.length} disponible(s) cette semaine`}>
                              {pris}/{ouvres.length} j</span>
                            {t.agence_a_confirmer && <span className="pl-a-confirmer">site à confirmer</span>}
                          </div>
                          {jours.map((j, k) => {
                            const cle = `${t.matricule}|${j}`;
                            const absent = !feries.has(j) && absentSur(t, j, j);
                            const debutConge = absent && (k === 0 || feries.has(jours[k - 1]) || !absentSur(t, jours[k - 1], jours[k - 1]));
                            return (
                              <div key={j} style={{ gridColumn: k + 2, gridRow: '1 / -1' }}
                                className={`pl-cellule${j === auj ? ' aujourdhui' : ''}${feries.has(j) ? ' ferie' : ''}${absent ? ' conge' : ''}`
                                  + `${libre(t, j) ? ' libre' : ''}${survol === cle ? ' survol' : ''}`}
                                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (survol !== cle) setSurvol(cle); }}
                                onDragLeave={() => setSurvol((x) => (x === cle ? null : x))}
                                onDrop={(e) => void deposer(e, t.matricule, j)}>
                                {debutConge && <span className="pl-conge-texte">Congé</span>}
                              </div>
                            );
                          })}
                          {segments.map(({ s, de, a, voie, coupeAvant, coupeApres }) => {
                            const p = proposes.get(s.id);
                            const aff = s.affectation!;
                            const conflits = etatDe(s) === 'brouillon' ? [] : conflitsDe(s, t);
                            const lignes: [string, string][] = [
                              ['Dates', datesAffectation(aff.debut, aff.fin)],
                              ['Équipe', aff.equipe.join(', ') || '—'],
                              ['Véhicule', aff.vehicle_id != null ? nomVehicule({ ...aff, id: aff.vehicle_id }) : 'Aucun'],
                              ['Temps prévu', nombreH(s.allocated_hours)]];
                            if (p?.km_aller_retour != null) lignes.push(['Trajet', `${Math.round(p.km_aller_retour)} km aller-retour`]);
                            return (
                              <Glissable key={s.id} s={s} depuis={t.matricule} fixe={etatDe(s) === 'brouillon'}
                                className={`pl-service etat-${etatDe(s)} a-ib${s.priority === '1' ? ' urgent' : ''}`
                                  + `${conflits.length ? ' conflit' : ''}${coupeAvant ? ' coupe-avant' : ''}${coupeApres ? ' coupe-apres' : ''}`
                                  + `${glisse?.serviceId === s.id ? ' en-glisse' : ''}${focus === s.id ? ' repere' : ''}`}
                                style={{ gridColumn: `${de + 2} / ${a + 3}`, gridRow: voie + 1 }}
                                onOuvrir={() => ouvrir(s.id)} onDebut={setGlisse} onFin={finGlisse} onSurvol={setFocus}>
                                <span className="pl-service-client">{client(s)}</span>
                                <span className="pl-service-nom">{s.name}</span>
                                {etatDe(s) === 'brouillon' && (
                                  <span className="pl-service-meta">Équipe {aff.matricules.length}/{s.nb_techniciens}, à compléter</span>)}
                                <InfoBulle titre={client(s)} sousTitre={s.name} etat={etatDe(s)} urgent={s.priority === '1'}
                                  lignes={lignes} place={placeInfoBulle(ligne, ordre.length, de, 5)}
                                  alertes={[...conflits, ...(aff.motif_derogation ? [`Dérogation : ${aff.motif_derogation}`] : [])]} />
                              </Glissable>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                ))}
                {!techniciens.length && ressources.donnees && <div className="vide pl-vide">Aucun technicien terrain sur la période.</div>}
                {techniciens.length > 0 && !groupes.length && <div className="vide pl-vide">Aucun technicien ne correspond à « {recherche} ».</div>}
              </div>
            </section>
            <div className="pl-legende">
              <span><i className="pl-pastille etat-propose" />Proposé</span>
              <span><i className="pl-pastille etat-verrouille" />Verrouillé</span>
              <span><i className="pl-pastille etat-publie" />Publié</span>
              <span><i className="pl-pastille conge" />Congé</span>
              <span><i className="pl-pastille ferie" />Férié</span>
              <span><i className="pl-pastille conflit" />Conflit</span>
              <span><i className="pl-pastille urgent" />Urgent</span>
            </div>
          </div>

          <div className="pl-cote">
          <section className="pl-carte-semaine" aria-labelledby="titre-carte-semaine">
            <div className="pl-liste-tete"><h2 id="titre-carte-semaine">Carte de la semaine</h2>
              <span className="pl-compte">{sitesCarte.length}</span></div>
            <CartePlanif sites={sitesCarte} agences={agencesCarte} focus={focus} onSurvol={setFocus} onOuvrir={ouvrir} />
            <div className="pc-legende" aria-hidden="true">
              <span><i className="pc-point etat-propose" />Proposé</span>
              <span><i className="pc-point etat-verrouille" />Verrouillé</span><span><i className="pc-point etat-publie" />Publié</span>
              <span><i className="pc-agence" />Agence</span>
            </div>
          </section>
          <aside className={`pl-liste${glisse && glisseAffecte ? ' cible' : ''}${survol === 'liste' ? ' survol' : ''}`}
            aria-label="À planifier"
            onDragOver={(e) => { if (!glisseAffecte) return; e.preventDefault(); if (survol !== 'liste') setSurvol('liste'); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSurvol((x) => (x === 'liste' ? null : x)); }}
            onDrop={deposerDansListe}>
            <div className="pl-liste-tete">
              <h2>À planifier</h2><span className="pl-compte">{aPlanifier.length}</span>
              {vue === 'semaine' && !!plusTard.donnees?.nombre && plusTard.donnees.semaine && (
                <button type="button" className="pl-plus-tard" onClick={() => aller(lundiDe(plusTard.donnees!.semaine!))}
                  title="Services prévus dans Odoo après cette semaine : ils apparaissent dans leur semaine">
                  {plusTard.donnees.nombre} plus tard · semaine du {jj(plusTard.donnees.semaine)}</button>)}
            </div>
            {glisse && glisseAffecte && <div className="pl-depot">Déposer ici pour retirer l'affectation</div>}
            <div className="pl-cartes">
              {aPlanifier.map((s) => {
                const cause = causes.get(s.id);
                const { infos, retard } = infosCarte(s);
                const enCours = brouillon?.serviceId === s.id ? brouillon : null;
                return (
                  <Glissable key={s.id} s={s} depuis={null}
                    className={`pl-carte${s.priority === '1' ? ' urgent' : ''}${glisse?.serviceId === s.id ? ' en-glisse' : ''}`
                      + `${enCours ? ' en-cours' : ''}${focus === s.id ? ' repere' : ''}`}
                    onOuvrir={() => ouvrir(s.id)} onDebut={setGlisse} onFin={finGlisse} onSurvol={setFocus}>
                    <span className="pl-carte-client">{client(s)}</span>
                    <span className="pl-carte-nom">{s.name}</span>
                    <span className="pl-carte-infos">{infos}</span>
                    {retard && <span className="pl-carte-retard">{retard}</span>}
                    {(s.under_warranty || !!s.livraisons_attente?.length || !s.allocated_hours) && (
                      <span className="pl-carte-signes">
                        {!!s.livraisons_attente?.length && <span className="livraison">
                          {s.livraisons_attente[0].transporteur ?? 'Matériel'} en livraison</span>}
                        {s.under_warranty && <span>Sous garantie</span>}
                        {!s.allocated_hours && <span className="alerte">0 h dans Odoo</span>}
                      </span>)}
                    {cause && <span className="pl-carte-cause">{cause}</span>}
                    {enCours && (
                      <span className="pl-carte-equipe">
                        <span>Équipe {enCours.matricules.length}/{s.nb_techniciens} : {enCours.matricules
                          .map((m) => techniciens.find((x) => x.matricule === m)?.nom ?? m).join(', ')}</span>
                        <button type="button" className="lien-bouton" onClick={(e) => { e.stopPropagation(); setBrouillon(null); }}>
                          Annuler</button>
                      </span>
                    )}
                  </Glissable>
                );
              })}
              {!aPlanifier.length && services.donnees && <div className="pl-tout-planifie">Tout est planifié cette semaine.</div>}
            </div>
            <p className="pl-aide">Glissez une carte sur un technicien : ses jours libres s'allument en vert. Service à plusieurs
              techniciens : glissez-la sur chacun.</p>
          </aside>
          </div>
        </div>
      </>)}

      {selection && (
        // remontée seulement si l'affectation change (retrait de publication, conflit) : enregistrer des réglages garde
        // l'onglet et l'équipe en cours de choix
        <DialogueService key={`${selection.id}-${cleAffectation(selection)}`} s={selection} onglet={onglet} onOnglet={setOnglet}
          brouillon={brouillon} techniciens={techniciens} agences={agences} propose={proposes.get(selection.id)}
          cause={causes.get(selection.id)} refs={refs.donnees} enregistrer={enregistrer} retirer={retirer}
          depublier={depublier} onReglages={recharger} onFermer={fermerFiche} />
      )}
      {confirmerRetrait && (
        <div className="voile" role="dialog" aria-modal="true" aria-labelledby="titre-retrait"
          onKeyDown={(e) => { if (e.key === 'Escape') setConfirmerRetrait(false); }}>
          <div className="dialogue">
            <h2 id="titre-retrait">Tout retirer de la semaine ?</h2>
            <div className="actions">
              <button type="button" className="btn" onClick={() => setConfirmerRetrait(false)}>Annuler</button>
              <button type="button" className="btn btn-danger" onClick={() => void toutRetirer()}>Tout retirer</button>
            </div>
          </div>
        </div>
      )}
      {confirmerPublication && (
        <div className="voile" role="dialog" aria-modal="true" aria-labelledby="titre-publier">
          <div className="dialogue">
            <h2 id="titre-publier">Publier la semaine ?</h2>
            <p>{aPublier.length} service{aPublier.length > 1 ? 's seront confirmés' : ' sera confirmé'}.</p>
            <div className="actions">
              <button type="button" className="btn" onClick={() => setConfirmerPublication(false)}>Annuler</button>
              <button type="button" className="btn btn-primaire" onClick={() => void publier()}>Publier</button>
            </div>
          </div>
        </div>
      )}
      {dialogue}
    </div>
  );
}
