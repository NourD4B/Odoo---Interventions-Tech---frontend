// Planification : seule page des techniciens (disponibilités, charge, congés, fériés), deux vues.
// Semaine : techniciens × jours, services en barres ; glisser un service sur un technicien et un jour pour
// l'affecter (ses jours libres s'allument), le glisser dans « À planifier » pour retirer l'affectation, survoler
// pour le détail, cliquer pour ouvrir sa fiche (équipe, dates, véhicule, verrou). Le solveur propose, le
// dispatcher décide. Mois : 4 semaines en cases (PlanMois). Adresse : ?vue=mois&semaine=AAAA-MM-JJ.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent,
  type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { aujourdhui } from '../api';
import { Avertissements, EtatChargement, initiales, useDonnees } from '../composants';
import { useEcriture } from '../composants/Ecriture';
import { IconeTelechargement } from '../composants/BoutonExport';
import { InfoBulle, placeInfoBulle } from '../composants/InfoBulle';
import { enregistrerFichier, exportations, nomFichier } from '../exports';
import CartePlanif, { type AgencePlanif, type SitePlanif } from '../composants/CartePlanif';
import MenuVehicule from '../composants/MenuVehicule';
import { nomVehicule, Plaque } from '../composants/Vehicule';
import { meteo, temps, type Meteo } from '../meteo';
import PlanMois from './PlanMois';
import {
  ErreurPlanif, planif, type AffectationProposee, type CorpsAffectation, type Proposition, type Referentiels,
  type ServicePlanif, type TechnicienPlanif,
} from '../planification';

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
/** État affiché ; « brouillon » = équipe en cours de composition (jamais renvoyé par l'API). */
const etatDe = (s: ServicePlanif): string => s.affectation?.etat ?? 'a_planifier';
const absentSur = (t: TechnicienPlanif, du: string, au: string) => t.absences.some((a) => a.du <= au && a.au >= du);

function contrainteDate(s: ServicePlanif): string | null {
  if (s.planned_date_begin) return `Prévu le ${jj(s.planned_date_begin)}`;
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

function DialogueService({ s, brouillon, techniciens, agences, propose, cause, refs, enregistrer, retirer, depublier,
  onFermer }: {
  s: ServicePlanif; brouillon: Brouillon | null; techniciens: TechnicienPlanif[]; agences: Map<string, string>;
  propose: AffectationProposee | undefined; cause: string | undefined; refs: Referentiels | null;
  enregistrer: (s: ServicePlanif, corps: Omit<CorpsAffectation, 'version' | 'motif'>, motif?: string | null) => Promise<boolean>;
  retirer: (s: ServicePlanif) => Promise<boolean>;
  depublier: (s: ServicePlanif, motif: string | null) => Promise<boolean>;
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
  const fermer = useRef<HTMLButtonElement>(null);
  const fin = plusOuvres(debut, Math.max(1, jours) - 1);
  const basculer = (m: string) => setEquipe((x) => (x.includes(m) ? x.filter((y) => y !== m) : [...x, m]));
  const parAgence = useMemo(() => {
    const groupes = new Map<string, TechnicienPlanif[]>();
    for (const t of [...techniciens].sort((x, y) => x.nom.localeCompare(y.nom))) groupes.set(t.agence, [...(groupes.get(t.agence) ?? []), t]);
    return [...groupes.entries()];
  }, [techniciens]);
  const competences = refs?.competences_actives && s.competences_requises.length
    ? s.competences_requises.map((c) => refs.competences.find((x) => x.code === c)?.libelle ?? c).join(', ') : null;

  useEffect(() => {
    fermer.current?.focus();
    const touche = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape' && !envoi) onFermer(); };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, [envoi, onFermer]);

  const agir = async (action: () => Promise<boolean>) => {
    setEnvoi(true);
    try { if (await action()) onFermer(); } finally { setEnvoi(false); }
  };

  const etat = etatDe(s);
  const premier = a ? new Date(`${a.debut}T12:00:00`) : null;
  return (
    <div className="voile pl-voile" role="dialog" aria-modal="true" aria-labelledby="pl-titre-fiche"
         onMouseDown={(e) => { if (e.target === e.currentTarget && !envoi) onFermer(); }}>
      <div className={`pl-fiche pf etat-${etat}`}>
        <header className="pf-tete">
          <div className="pf-titre">
            <p>{client(s)}{s.simule && <span className="dc-simule">simulé</span>}</p>
            <h2 id="pl-titre-fiche">{s.name}</h2>
            <div className="pf-badges">
              <span className={`pf-etat etat-${etat}`}>{{ a_planifier: 'À planifier', propose: 'Proposé',
                verrouille: 'Verrouillé', publie: 'Publié' }[etat]}</span>
              {s.priority === '1' && <span className="pf-etat urgent">Urgent</span>}
            </div>
          </div>
          <button ref={fermer} type="button" className="sv-fermer" aria-label="Fermer" onClick={onFermer} disabled={envoi}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg></button>
        </header>

        <div className="pf-corps">
          <dl className="sv-d-faits">
            <div><dt>Date prévue</dt><dd>{contrainteDate(s) ?? 'Libre'}</dd></div>
            <div><dt>Durée</dt><dd>{nombreH(s.allocated_hours)}<small>{s.nb_techniciens} technicien{s.nb_techniciens > 1 ? 's' : ''}
              {s.vehicule_requis === 'utilitaire' ? ', utilitaire requis' : ''}</small></dd></div>
            <div><dt>Projet</dt><dd>{s.project_name ?? `n° ${s.project_id}`}</dd></div>
            {competences && <div><dt>Compétences</dt><dd>{competences}</dd></div>}
            <div className="pf-large"><dt>Site</dt><dd>{s.site_adresse ?? 'Adresse non renseignée'}
              {s.site_lat === null && <small className="precision-faible">Sans position : à placer dans les réglages du service</small>}</dd></div>
          </dl>

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
                <span className={equipe.length === s.nb_techniciens ? 'pf-compte ok' : 'pf-compte'}>
                  {equipe.length} sur {s.nb_techniciens}</span>
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

            <section className="pf-section" aria-labelledby="pl-dates">
              <div className="pf-section-tete"><h3 id="pl-dates">Dates</h3>
                <span className="pf-aide">jusqu'au <strong>{jourLong(fin)}</strong></span></div>
              <div className="pf-dates">
                <label>Premier jour<input type="date" value={debut} onChange={(e) => e.target.value && setDebut(e.target.value)} /></label>
                <label>Jours ouvrés<input type="number" min={1} max={20} value={jours}
                  onChange={(e) => setJours(Math.max(1, Number(e.target.value) || 1))} /></label>
              </div>
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

        <footer className="sv-d-pied pf-pied">
          <div className="pf-liens">
            <Link to={`/statistiques/services/${s.id}`}>Fiche du service</Link>
            <Link to={`/services?regler=${s.id}`}>Réglages du service</Link>
            {s.odoo_url && <a href={s.odoo_url} target="_blank" rel="noreferrer">Ouvrir dans Odoo ↗</a>}
          </div>
          <div className="sv-d-boutons">
            {!publie && a && (
              <button type="button" className="btn pl-btn-retirer" disabled={envoi} onClick={() => void agir(() => retirer(s))}>
                Retirer l'affectation</button>
            )}
            {publie && motif === null && (
              <button type="button" className="btn pl-btn-retirer" onClick={() => setMotif('')}>Retirer la publication</button>
            )}
            {publie && motif !== null && (
              <button type="button" className="btn btn-primaire" disabled={envoi}
                onClick={async () => { setEnvoi(true); try { await depublier(s, motif.trim() || null); } finally { setEnvoi(false); } }}>
                {envoi ? 'Retrait…' : 'Confirmer le retrait'}</button>
            )}
            <button type="button" className="btn" onClick={onFermer} disabled={envoi}>{publie ? 'Fermer' : 'Annuler'}</button>
            {!publie && (
              <button type="button" className="btn btn-primaire" disabled={!equipe.length || envoi}
                onClick={() => void agir(() => enregistrer(s, { matricules: equipe, vehicle_id: vehicule, debut, fin, verrouiller: verrou },
                  note.trim() || null))}>
                {envoi ? 'Enregistrement…' : a ? 'Enregistrer' : 'Affecter'}</button>
            )}
          </div>
        </footer>
      </div>
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
  const ressources = useDonnees(() => planif.ressources(debut, fin), [debut]);
  const refs = useDonnees(() => planif.referentiels(), []);
  const [proposition, setProposition] = useState<Proposition | null>(null);
  const [ouvert, setOuvert] = useState<number | null>(null);
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
  const causes = useMemo(() => new Map((proposition?.non_planifies ?? []).map((n) => [n.service_id, n.cause])), [proposition]);
  const aPlanifier = liste.filter((s) => !s.affectation)
    .sort((x, y) => Number(y.priority === '1') - Number(x.priority === '1') || x.name.localeCompare(y.name, 'fr'));
  const aPublier = liste.filter((s) => s.affectation && s.statut_planification !== 'publie');
  const duSolveur = liste.filter((s) => s.affectation?.etat === 'propose' && s.affectation.propose_par === 'solveur');
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

  const recharger = () => { services.recharger(); };
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
        setProposition(p);
        setMessage({ type: 'ok', texte: `Le solveur a proposé ${p.affectations.length} service(s)`
          + (p.non_planifies.length ? ` ; ${p.non_planifies.length} restent à planifier (cause sur chaque carte).` : '.') });
        recharger();
      }
    } catch (e) { setMessage({ type: 'erreur', texte: erreurTexte(e) }); } finally { setOccupe(false); }
  };

  const retirerPropositions = async () => {
    setMessage(null); setOccupe(true);
    try {
      const r = await ecrire(() => planif.retirerPropositions(debut, fin));
      if (r) {
        setProposition(null);
        setMessage({ type: 'ok', texte: `${r.services} proposition(s) du solveur retirée(s) ; verrouillés et vos choix gardés.` });
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
  const sitesCarte: SitePlanif[] = liste.filter((s) => s.site_lat !== null && s.site_lng !== null).map((s) => ({
    id: s.id, lat: s.site_lat!, lng: s.site_lng!, etat: etatDe(s), urgent: s.priority === '1', titre: client(s),
    detail: `${s.name}, ${s.affectation ? datesAffectation(s.affectation.debut, s.affectation.fin).toLowerCase() : 'à planifier'}` }));
  const agencesCarte: AgencePlanif[] = (ressources.donnees?.agences ?? []).filter((a) => a.lat !== null && a.lng !== null)
    .map((a) => ({ code: a.code, nom: a.nom, lat: a.lat!, lng: a.lng! }));

  return (
    <div className={`pl${glisse ? ' pl-glisse' : ''}`}>
      <header className="pl-barre-outils">
        <h1>Planification</h1>
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
            {duSolveur.length > 0 && <button type="button" className="btn" disabled={occupe} onClick={() => void retirerPropositions()}
              title="Retire les propositions du solveur ; garde les services verrouillés, publiés et vos choix.">
              Retirer les propositions ({duSolveur.length})</button>}
            <button type="button" className="btn" disabled={occupe || !aPublier.length} onClick={() => setConfirmerPublication(true)}>
              Publier{aPublier.length ? ` (${aPublier.length})` : ''}</button>
            <button type="button" className="btn pl-btn-retirer" disabled={occupe || !(aRetirer.length + publiees.length)}
              onClick={() => setConfirmerRetrait(true)}
              title="Retire toutes les affectations de la semaine, publiées comprises">Tout retirer</button>
            <button type="button" className="btn btn-primaire" disabled={occupe} onClick={() => void proposer()}>
              {occupe ? 'Calcul en cours…' : 'Proposer la semaine'}</button>
          </>) : (
            <button type="button" className="btn" onClick={() => aller(lundi, 'semaine')}>
              {aPlanifier.length ? `${aPlanifier.length} à planifier` : 'Ouvrir la semaine'}</button>
          )}
        </div>
      </header>
      <p className="pl-contexte">
        <span className="pl-horloge"><i aria-hidden="true" />{dateParis}, {heure} <small>heure de Paris</small></span>
        {actuel && temps_?.actuelle && siege && <span className="pl-meteo" title={`${actuel.libelle} à ${siege.nom}`}>
          <span aria-hidden="true">{actuel.icone}</span>{Math.round(temps_.actuelle.temperature)} °C, {actuel.libelle.toLowerCase()}
          <small>{siege.nom}</small></span>}
      </p>

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
                                onOuvrir={() => setOuvert(s.id)} onDebut={setGlisse} onFin={finGlisse} onSurvol={setFocus}>
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
            <CartePlanif sites={sitesCarte} agences={agencesCarte} focus={focus} onSurvol={setFocus} onOuvrir={setOuvert} />
            <div className="pc-legende" aria-hidden="true">
              <span><i className="pc-point etat-a_planifier" />À planifier</span><span><i className="pc-point etat-propose" />Proposé</span>
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
                    onOuvrir={() => setOuvert(s.id)} onDebut={setGlisse} onFin={finGlisse} onSurvol={setFocus}>
                    <span className="pl-carte-client">{client(s)}</span>
                    <span className="pl-carte-nom">{s.name}</span>
                    <span className="pl-carte-infos">{infos}</span>
                    {retard && <span className="pl-carte-retard">{retard}</span>}
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
        <DialogueService key={`${selection.id}-${selection.version}`} s={selection} brouillon={brouillon} techniciens={techniciens}
          agences={agences} propose={proposes.get(selection.id)} cause={causes.get(selection.id)} refs={refs.donnees}
          enregistrer={enregistrer} retirer={retirer} depublier={depublier} onFermer={() => setOuvert(null)} />
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
