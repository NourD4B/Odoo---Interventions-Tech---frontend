// Planification de la semaine : techniciens × jours, services en barres sur leurs jours ; glisser un service
// sur un technicien et un jour pour l'affecter, le glisser dans « À planifier » pour retirer l'affectation,
// cliquer pour ouvrir sa fiche (équipe, dates, véhicule, verrou). Le solveur propose, le dispatcher décide.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent,
  type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { aujourdhui } from '../api';
import { Avertissements, EtatChargement, initiales, useDonnees } from '../composants';
import DialogueDerogation from '../composants/DialogueDerogation';
import { useEcriture } from '../composants/Ecriture';
import MenuVehicule from '../composants/MenuVehicule';
import {
  ErreurPlanif, planif, type AffectationProposee, type CorpsAffectation, type Proposition, type Referentiels,
  type ServicePlanif, type TechnicienPlanif, type Violation,
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
function titreSemaine(debut: string, fin: string) {
  const [a, b] = [new Date(`${debut}T12:00:00`), new Date(`${fin}T12:00:00`)];
  return a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()} ${MOIS[b.getMonth()]} ${b.getFullYear()}`
    : `${a.getDate()} ${MOIS[a.getMonth()]} – ${b.getDate()} ${MOIS[b.getMonth()]} ${b.getFullYear()}`;
}
/** Durée (jours) d'un service non encore affecté : heures par technicien / 8 h. */
const dureeService = (s: ServicePlanif) => Math.max(1, Math.ceil(s.allocated_hours / Math.max(1, s.nb_techniciens) / 8));
const nombreH = (h: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(h)} h`;
const client = (s: ServicePlanif) => s.partner_name ?? 'Client non renseigné';
const etatDe = (s: ServicePlanif) => s.affectation?.etat ?? 'a_planifier';
const absentSur = (t: TechnicienPlanif, du: string, au: string) => t.absences.some((a) => a.du <= au && a.au >= du);

function contrainteDate(s: ServicePlanif): string | null {
  if (s.planned_date_begin) return `Prévu le ${jj(s.planned_date_begin)}`;
  if (s.fenetre_debut || s.fenetre_fin) {
    return s.fenetre_debut && s.fenetre_fin ? `Entre le ${jj(s.fenetre_debut)} et le ${jj(s.fenetre_fin)}`
      : s.fenetre_debut ? `À partir du ${jj(s.fenetre_debut)}` : `Avant le ${jj(s.fenetre_fin!)}`;
  }
  return s.date_deadline ? `Avant le ${jj(s.date_deadline)}` : null;
}

function IconeVerrou({ ouvert = false }: { ouvert?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" className="pl-icone">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
      <path d={ouvert ? 'M5.5 7V5a2.5 2.5 0 0 1 4.9-.6' : 'M5.5 7V5a2.5 2.5 0 0 1 5 0v2'} fill="none"
            stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

// ---------- glisser-déposer ----------

type Glisse = { serviceId: number; depuis: string | null };
const TYPE_GLISSE = 'application/x-d4b-service';

function lireGlisse(e: DragEvent): Glisse | null {
  try { return JSON.parse(e.dataTransfer.getData(TYPE_GLISSE)) as Glisse; } catch { return null; }
}

/** Élément glissable et activable au clavier (Entrée / Espace = ouvrir la fiche). */
function Glissable({ s, depuis, className, style, titre, onOuvrir, onDebut, onFin, children }: {
  s: ServicePlanif; depuis: string | null; className: string; style?: CSSProperties; titre: string;
  onOuvrir: () => void; onDebut: (g: Glisse) => void; onFin: () => void; children: ReactNode;
}) {
  const mobile = etatDe(s) !== 'publie';
  return (
    <div role="button" tabIndex={0} className={className} style={style} title={titre} draggable={mobile}
      aria-label={`${client(s)}, ${s.name}`}
      onClick={onOuvrir}
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
      title={absent ? `${t.nom} est absent sur ces dates (dérogation demandée à l'enregistrement)` : t.nom}>
      <span className="pl-avatar petit">{initiales(t.nom)}</span>
      <span className="pl-choix-tech-nom">{t.nom}{absent && <em> · absent</em>}</span>
    </button>
  );
}

function DialogueService({ s, techniciens, agences, propose, cause, refs, enregistrer, retirer, depublier, onFermer }: {
  s: ServicePlanif; techniciens: TechnicienPlanif[]; agences: Map<string, string>;
  propose: AffectationProposee | undefined; cause: string | undefined; refs: Referentiels | null;
  enregistrer: (s: ServicePlanif, corps: Omit<CorpsAffectation, 'version' | 'motif'>) => Promise<boolean>;
  retirer: (s: ServicePlanif) => Promise<boolean>;
  depublier: (s: ServicePlanif, motif: string) => Promise<boolean>;
  onFermer: () => void;
}) {
  const a = s.affectation;
  const publie = s.statut_planification === 'publie';
  const [motif, setMotif] = useState<string | null>(null);         // null : pas en train de retirer la publication
  const [equipe, setEquipe] = useState<string[]>(a?.matricules ?? []);
  const [debut, setDebut] = useState(a?.debut ?? s.planned_date_begin?.slice(0, 10) ?? s.fenetre_debut ?? aujourdhui());
  const [jours, setJours] = useState(a ? ouvresApres(a.debut, a.fin) + 1 : dureeService(s));
  const [vehicule, setVehicule] = useState<number | null>(a?.vehicle_id ?? null);
  const [verrou, setVerrou] = useState(a?.etat === 'verrouille');
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

  return (
    <div className="voile pl-voile" role="dialog" aria-modal="true" aria-labelledby="pl-titre-fiche"
         onMouseDown={(e) => { if (e.target === e.currentTarget && !envoi) onFermer(); }}>
      <div className={`pl-fiche etat-${etatDe(s)}`}>
        <header className="pl-fiche-tete">
          <div className="pl-fiche-titres">
            <h2 id="pl-titre-fiche">{client(s)}</h2>
            <p>{s.name}</p>
          </div>
          <span className={`pl-etat etat-${etatDe(s)}`}>{{ a_planifier: 'À planifier', propose: 'Proposé',
            verrouille: 'Verrouillé', publie: 'Publié' }[etatDe(s)]}</span>
          <button ref={fermer} type="button" className="pl-fermer" aria-label="Fermer" onClick={onFermer}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </header>

        <dl className="pl-faits">
          <div><dt>Date (Odoo et fenêtre)</dt><dd>{contrainteDate(s) ?? 'Libre'}</dd></div>
          <div><dt>Charge</dt><dd>{nombreH(s.allocated_hours)} · {s.nb_techniciens} technicien{s.nb_techniciens > 1 ? 's' : ''}</dd></div>
          <div><dt>Véhicule</dt><dd>{s.vehicule_requis === 'utilitaire' ? 'Utilitaire requis' : 'Indifférent'}</dd></div>
          {competences && <div><dt>Compétences</dt><dd>{competences}</dd></div>}
          <div className="large"><dt>Site</dt><dd>{s.site_adresse ?? 'Adresse non renseignée'}
            {s.site_lat === null && <span className="pl-alerte-texte"> — sans position, à placer dans Services</span>}</dd></div>
        </dl>

        {(propose || a?.motif_derogation || cause) && (
          <div className="pl-raisons">
            {cause && <p className="pl-cause">Non planifié par le solveur : {cause}</p>}
            {propose && <><p>{propose.raison_techniciens}</p><p>{propose.raison_vehicule}
              {propose.km_aller_retour != null && ` · ${Math.round(propose.km_aller_retour)} km aller-retour`}
              {propose.cout_estime != null && ` · ≈ ${Math.round(propose.cout_estime)} € (hors hôtel et repas)`}</p>
              {!publie && !a && (
                <button type="button" className="lien-bouton" onClick={() => {
                  setEquipe(propose.matricules); setDebut(propose.debut);
                  setJours(ouvresApres(propose.debut, propose.fin) + 1); setVehicule(propose.vehicle_id);
                }}>Reprendre la proposition du solveur ({propose.equipe.join(', ')}, {jj(propose.debut)}
                  {propose.fin !== propose.debut ? ` → ${jj(propose.fin)}` : ''})</button>
              )}</>}
            {a?.motif_derogation && <p className="pl-cause">Dérogation : {a.motif_derogation}</p>}
          </div>
        )}

        {publie ? (
          <div className="pl-bloc">
            <h3>Affectation publiée</h3>
            <p>{a?.equipe.join(', ')} · {a?.plaque ?? 'sans véhicule'} · {a && (a.debut === a.fin ? jourLong(a.debut)
              : `${jourLong(a.debut)} → ${jourLong(a.fin)}`)}</p>
            {motif === null ? (
              <p className="muet">Publiée : figée. Pour la modifier ou la retirer, retirez d'abord la publication
                (elle repasse « verrouillée », équipe, dates et véhicule gardés).</p>
            ) : (
              <label className="champ">Pourquoi retirer la publication ? (enregistré dans le journal)
                <textarea autoFocus rows={2} maxLength={500} value={motif} onChange={(e) => setMotif(e.target.value)}
                  placeholder="Ex. : le client a déplacé le rendez-vous" />
                {motif.trim().length > 0 && motif.trim().length < 3 &&
                  <span className="erreur-champ">3 caractères au moins.</span>}
              </label>
            )}
          </div>
        ) : (<>
          <section className="pl-bloc" aria-labelledby="pl-equipe">
            <div className="pl-bloc-tete">
              <h3 id="pl-equipe">Équipe</h3>
              <span className={equipe.length === s.nb_techniciens ? 'pl-compte ok' : 'pl-compte'}>
                {equipe.length} / {s.nb_techniciens}</span>
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

          <section className="pl-bloc" aria-labelledby="pl-dates">
            <h3 id="pl-dates">Dates</h3>
            <div className="pl-dates">
              <label className="champ">Premier jour<input type="date" value={debut} onChange={(e) => e.target.value && setDebut(e.target.value)} /></label>
              <label className="champ">Jours ouvrés<input type="number" min={1} max={20} value={jours}
                onChange={(e) => setJours(Math.max(1, Number(e.target.value) || 1))} /></label>
              <div className="pl-dernier">jusqu'au <strong>{jourLong(fin)}</strong></div>
            </div>
          </section>

          <section className="pl-bloc" aria-labelledby="pl-vehicule">
            <h3 id="pl-vehicule">Véhicule</h3>
            <MenuVehicule serviceId={s.id} matricules={equipe} debut={debut} fin={fin} actuel={vehicule}
              onChoisir={(v) => setVehicule(v?.vehicle_id ?? null)} />
          </section>

          <label className="pl-interrupteur">
            <input type="checkbox" checked={verrou} onChange={(e) => setVerrou(e.target.checked)} />
            <span className="pl-piste" aria-hidden="true" />
            <span>Verrouiller <span className="muet">— le solveur ne changera plus cette affectation</span></span>
          </label>
        </>)}

        <footer className="pl-fiche-pied">
          <div className="pl-liens">
            <Link to={`/statistiques/services/${s.id}`}>Statistiques</Link>
            <Link to="/services">Réglages du service</Link>
            {s.odoo_url && <a href={s.odoo_url} target="_blank" rel="noreferrer">Ouvrir dans Odoo</a>}
          </div>
          {!publie && a && (
            <button type="button" className="btn pl-btn-retirer" disabled={envoi} onClick={() => void agir(() => retirer(s))}>
              Retirer l'affectation</button>
          )}
          {publie && motif === null && (
            <button type="button" className="btn pl-btn-retirer" onClick={() => setMotif('')}>Retirer la publication</button>
          )}
          {publie && motif !== null && (
            <button type="button" className="btn btn-primaire" disabled={envoi || motif.trim().length < 3}
              onClick={async () => { setEnvoi(true); try { await depublier(s, motif.trim()); } finally { setEnvoi(false); } }}>
              {envoi ? 'Retrait…' : 'Confirmer le retrait'}</button>
          )}
          <button type="button" className="btn" onClick={onFermer} disabled={envoi}>{publie ? 'Fermer' : 'Annuler'}</button>
          {!publie && (
            <button type="button" className="btn btn-primaire" disabled={!equipe.length || envoi}
              onClick={() => void agir(() => enregistrer(s, { matricules: equipe, vehicle_id: vehicule, debut, fin, verrouiller: verrou }))}>
              {envoi ? 'Enregistrement…' : a ? 'Enregistrer' : 'Affecter'}</button>
          )}
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

export default function Planification() {
  const [lundi, setLundi] = useState(() => lundiDe(aujourdhui()));
  const jours = JOURS.map((_, k) => iso(decaler(lundi, k)));
  const [debut, fin] = [jours[0], jours[4]];
  const auj = aujourdhui();

  const services = useDonnees(() => planif.services(debut, fin), [debut]);
  const ressources = useDonnees(() => planif.ressources(debut, fin), [debut]);
  const refs = useDonnees(() => planif.referentiels(), []);
  const [proposition, setProposition] = useState<Proposition | null>(null);
  const [ouvert, setOuvert] = useState<number | null>(null);
  const [message, setMessage] = useState<{ type: 'erreur' | 'ok'; texte: string } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [derogation, setDerogation] = useState<{ violations: Violation[]; resoudre: (motif: string | null) => void } | null>(null);
  const [confirmerPublication, setConfirmerPublication] = useState(false);
  const [glisse, setGlisse] = useState<Glisse | null>(null);
  const [survol, setSurvol] = useState<string | null>(null);
  const { ecrire, dialogue } = useEcriture();

  const liste = useMemo(() => services.donnees ?? [], [services.donnees]);
  const techniciens = useMemo(() => ressources.donnees?.techniciens ?? [], [ressources.donnees]);
  const agences = useMemo(() => new Map((ressources.donnees?.agences ?? []).map((a) => [a.code, a.nom])), [ressources.donnees]);
  const parId = useMemo(() => new Map(liste.map((s) => [s.id, s])), [liste]);
  const proposes = useMemo(() => new Map((proposition?.affectations ?? []).map((a) => [a.service_id, a])), [proposition]);
  const causes = useMemo(() => new Map((proposition?.non_planifies ?? []).map((n) => [n.service_id, n.cause])), [proposition]);
  const aPlanifier = liste.filter((s) => !s.affectation)
    .sort((x, y) => Number(y.priority === '1') - Number(x.priority === '1') || x.name.localeCompare(y.name, 'fr'));
  const compte = (e: string) => liste.filter((s) => etatDe(s) === e).length;
  const aPublier = liste.filter((s) => s.affectation && s.statut_planification !== 'publie');
  const duSolveur = liste.filter((s) => s.affectation?.etat === 'propose' && s.affectation.propose_par === 'solveur');
  const groupes = useMemo(() => {
    const par = new Map<string, TechnicienPlanif[]>();
    for (const t of [...techniciens].sort((x, y) => x.nom.localeCompare(y.nom))) par.set(t.agence, [...(par.get(t.agence) ?? []), t]);
    return [...par.entries()].sort(([a], [b]) => (agences.get(a) ?? a).localeCompare(agences.get(b) ?? b, 'fr'));
  }, [techniciens, agences]);
  const glisseAffecte = glisse ? !!parId.get(glisse.serviceId)?.affectation : false;

  const recharger = () => { services.recharger(); };
  const erreurTexte = (e: unknown) =>
    (e instanceof ErreurPlanif && e.statut === 409 ? CONFLIT : e instanceof Error ? e.message : String(e));
  const finGlisse = () => { setGlisse(null); setSurvol(null); };

  /** Enregistre un choix du dispatcher ; règles enfreintes -> dialogue de dérogation (motif) puis renvoi. */
  const enregistrer = async (s: ServicePlanif, corps: Omit<CorpsAffectation, 'version' | 'motif'>): Promise<boolean> => {
    setMessage(null);
    const envoyer = (motif: string | null) => planif.affecter(s.id, { ...corps, motif, version: s.version });
    try {
      const r = await ecrire(() => envoyer(null));
      if (!r) return false;
    } catch (e) {
      const violations = e instanceof ErreurPlanif && e.statut === 422
        ? (e.detail as { violations?: Violation[] } | null)?.violations : undefined;
      if (!violations) {
        setMessage({ type: 'erreur', texte: erreurTexte(e) });
        if (e instanceof ErreurPlanif && e.statut === 409) recharger();
        return false;
      }
      const motif = await new Promise<string | null>((resoudre) => setDerogation({ violations, resoudre }));
      setDerogation(null);
      if (!motif) return false;
      try { await ecrire(() => envoyer(motif)); } catch (e2) { setMessage({ type: 'erreur', texte: erreurTexte(e2) }); return false; }
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
    const equipe = a ? [...new Set(a.matricules.map((m) => (m === g.depuis ? matricule : m)))] : [matricule];
    // durée gardée si déjà affecté ; sinon celle du solveur s'il l'a proposé (trajet compris), sinon les heures
    const suggestion = proposes.get(s.id);
    const finAff = plusOuvres(jour, a ? ouvresApres(a.debut, a.fin)
      : suggestion ? ouvresApres(suggestion.debut, suggestion.fin) : dureeService(s) - 1);
    // Équipe ou jours changés : garder le véhicule s'il reste conforme, sinon prendre le premier conforme
    let vehicule = a?.vehicle_id ?? null;
    try {
      const choix = await planif.vehicules(s.id, { matricules: equipe.join(','), debut: jour, fin: finAff });
      const actuel = choix.find((v) => v.vehicle_id === vehicule && v.conforme);
      vehicule = actuel?.vehicle_id ?? choix.find((v) => v.conforme)?.vehicle_id ?? vehicule;
    } catch { /* liste indisponible : véhicule actuel gardé, la règle le signalera si besoin */ }
    if (await enregistrer(s, { matricules: equipe, vehicle_id: vehicule, debut: jour, fin: finAff,
      verrouiller: a?.etat === 'verrouille' })) {
      const t = techniciens.find((x) => x.matricule === matricule);
      setMessage({ type: 'ok', texte: `« ${client(s)} » affecté à ${t?.nom ?? matricule}, ${jourLong(jour)}.` });
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
  const depublier = async (s: ServicePlanif, motif: string): Promise<boolean> => {
    setMessage(null);
    try {
      const r = await ecrire(() => planif.depublier(s.id, s.version, motif));
      if (!r) return false;
      setMessage({ type: 'ok', texte: `« ${client(s)} » n'est plus publié : verrouillé, de nouveau modifiable — journalisé.` });
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

  const publier = async () => {
    setConfirmerPublication(false); setMessage(null); setOccupe(true);
    try {
      const r = await ecrire(() => planif.publier(debut, fin));
      if (r) { setMessage({ type: 'ok', texte: `${r.services} service(s) publié(s).` }); recharger(); }
    } catch (e) { setMessage({ type: 'erreur', texte: erreurTexte(e) }); } finally { setOccupe(false); }
  };

  const joursOccupes = (matricule: string) => new Set(jours.filter((j) => liste.some((s) =>
    s.affectation?.matricules.includes(matricule) && s.affectation.debut <= j && s.affectation.fin >= j)));
  const selection = ouvert !== null ? parId.get(ouvert) : undefined;
  const titreBarre = (s: ServicePlanif) => {
    const p = proposes.get(s.id), a = s.affectation;
    return [`${client(s)} — ${s.name}`, a && `${a.equipe.join(', ')} · ${a.plaque ?? 'sans véhicule'}`,
      p?.raison_techniciens, a?.motif_derogation && `Dérogation : ${a.motif_derogation}`].filter(Boolean).join('\n');
  };

  return (
    <div className={`pl${glisse ? ' pl-glisse' : ''}`}>
      <header className="pl-barre-outils">
        <div className="pl-titre">
          <h1>Planification</h1>
          <p>Semaine du {titreSemaine(debut, fin)}</p>
        </div>
        <nav className="pl-semaines" aria-label="Semaine">
          <button type="button" className="btn" aria-label="Semaine précédente" onClick={() => setLundi(decaler(lundi, -7))}>‹</button>
          <button type="button" className="btn" onClick={() => setLundi(lundiDe(aujourdhui()))}>Aujourd'hui</button>
          <button type="button" className="btn" aria-label="Semaine suivante" onClick={() => setLundi(decaler(lundi, 7))}>›</button>
        </nav>
        <div className="pl-actions">
          <button type="button" className="btn" disabled={occupe || !duSolveur.length} onClick={() => void retirerPropositions()}
            title="Retire les propositions du solveur de la semaine ; garde les verrouillés, les publiés et vos choix">
            Retirer les propositions{duSolveur.length ? ` (${duSolveur.length})` : ''}</button>
          <button type="button" className="btn" disabled={occupe || !aPublier.length} onClick={() => setConfirmerPublication(true)}>
            Publier{aPublier.length ? ` (${aPublier.length})` : ''}</button>
          <button type="button" className="btn btn-primaire" disabled={occupe} onClick={() => void proposer()}>
            {occupe ? 'Calcul en cours…' : 'Proposer la semaine'}</button>
        </div>
      </header>

      <div className="pl-resume" aria-label="Légende et compteurs">
        <span><i className="pl-pastille etat-a_planifier" />À planifier <b>{aPlanifier.length}</b></span>
        <span><i className="pl-pastille etat-propose" />Proposé <b>{compte('propose')}</b></span>
        <span><i className="pl-pastille etat-verrouille" />Verrouillé <b>{compte('verrouille')}</b></span>
        <span><i className="pl-pastille etat-publie" />Publié <b>{compte('publie')}</b></span>
        <span><i className="pl-pastille absent" />Absent</span>
        <span><i className="pl-pastille urgent" />Urgent</span>
      </div>

      {message && <div className={message.type === 'erreur' ? 'erreur' : 'succes'} role={message.type === 'erreur' ? 'alert' : 'status'}>{message.texte}</div>}
      <EtatChargement chargement={(services.chargement && !services.donnees) || (ressources.chargement && !ressources.donnees)}
                      erreur={services.erreur ?? ressources.erreur} />
      <Avertissements liste={[...new Set([...(ressources.donnees?.avertissements ?? []), ...(proposition?.avertissements ?? [])])]} />

      <div className="pl-corps">
        <section className="pl-tableau" aria-label="Semaine par technicien">
          <div className="pl-grille">
            <div className="pl-ligne pl-entete">
              <div className="pl-coin">{techniciens.length} technicien{techniciens.length > 1 ? 's' : ''}</div>
              {jours.map((j, k) => (
                <div key={j} className={`pl-jour${j === auj ? ' aujourdhui' : ''}`} style={{ gridColumn: k + 2 }}>
                  <span>{JOURS[k]}</span><strong>{Number(j.slice(8))}</strong>
                </div>
              ))}
            </div>
            {groupes.map(([code, techs]) => (
              <div key={code} className="pl-agence" role="group" aria-label={agences.get(code) ?? code}>
                <div className="pl-agence-nom">{agences.get(code) ?? code}<span>{techs.length}</span></div>
                {techs.map((t) => {
                  const { segments, voies } = segmentsDe(t.matricule, liste, jours);
                  const occupes = joursOccupes(t.matricule);
                  return (
                    <div key={t.matricule} className="pl-ligne" style={{ gridTemplateRows: `repeat(${voies}, minmax(58px, auto))` }}>
                      <div className="pl-tech" style={{ gridRow: '1 / -1' }}>
                        <span className="pl-avatar">{initiales(t.nom)}</span>
                        <span className="pl-tech-texte">
                          <strong>{t.nom}</strong>
                          <span className="pl-charge" aria-label={`${occupes.size} jour(s) occupé(s) sur 5`}>
                            {jours.map((j) => <i key={j} className={occupes.has(j) ? 'pris' : absentSur(t, j, j) ? 'absent' : ''} />)}
                            <em>{occupes.size}/5 j</em>
                          </span>
                          {t.agence_a_confirmer && <span className="pl-a-confirmer">site à confirmer</span>}
                        </span>
                      </div>
                      {jours.map((j, k) => {
                        const cle = `${t.matricule}|${j}`;
                        const absent = absentSur(t, j, j);
                        return (
                          <div key={j} style={{ gridColumn: k + 2, gridRow: '1 / -1' }}
                            className={`pl-cellule${j === auj ? ' aujourdhui' : ''}${absent ? ' absent' : ''}${survol === cle ? ' survol' : ''}`}
                            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (survol !== cle) setSurvol(cle); }}
                            onDragLeave={() => setSurvol((x) => (x === cle ? null : x))}
                            onDrop={(e) => void deposer(e, t.matricule, j)}>
                            {absent && <span className="pl-absent-texte">Absent</span>}
                          </div>
                        );
                      })}
                      {segments.map(({ s, de, a, voie, coupeAvant, coupeApres }) => {
                        const p = proposes.get(s.id);
                        return (
                          <Glissable key={s.id} s={s} depuis={t.matricule} titre={titreBarre(s)}
                            className={`pl-service etat-${etatDe(s)}${s.priority === '1' ? ' urgent' : ''}`
                              + `${coupeAvant ? ' coupe-avant' : ''}${coupeApres ? ' coupe-apres' : ''}`
                              + `${glisse?.serviceId === s.id ? ' en-glisse' : ''}`}
                            style={{ gridColumn: `${de + 2} / ${a + 3}`, gridRow: voie + 1 }}
                            onOuvrir={() => setOuvert(s.id)} onDebut={setGlisse} onFin={finGlisse}>
                            <span className="pl-service-client">{client(s)}</span>
                            <span className="pl-service-nom">{s.name}</span>
                            <span className="pl-service-meta">
                              {etatDe(s) === 'verrouille' && <IconeVerrou />}
                              {s.affectation?.plaque ?? 'sans véhicule'}
                              {p?.km_aller_retour != null && <> · {Math.round(p.km_aller_retour)} km</>}
                              {s.affectation && s.affectation.matricules.length > 1 && <> · {s.affectation.matricules.length} tech.</>}
                              {s.affectation?.motif_derogation && <> · dérogation</>}
                            </span>
                          </Glissable>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
            {!techniciens.length && ressources.donnees && <div className="vide pl-vide">Aucun technicien terrain sur la période.</div>}
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
          {glisse && glisseAffecte
            ? <div className="pl-depot">Déposer ici pour retirer l'affectation</div>
            : <p className="pl-aide">Glissez une carte sur un technicien et un jour, ou cliquez dessus pour l'affecter.</p>}
          <div className="pl-cartes">
            {aPlanifier.map((s) => {
              const cause = causes.get(s.id);
              const quand = contrainteDate(s);
              return (
                <Glissable key={s.id} s={s} depuis={null} titre={`${client(s)} — ${s.name}`}
                  className={`pl-carte${s.priority === '1' ? ' urgent' : ''}${glisse?.serviceId === s.id ? ' en-glisse' : ''}`}
                  onOuvrir={() => setOuvert(s.id)} onDebut={setGlisse} onFin={finGlisse}>
                  <span className="pl-carte-client">{client(s)}</span>
                  <span className="pl-carte-nom">{s.name}</span>
                  <span className="pl-carte-meta">
                    <span>{nombreH(s.allocated_hours)}</span>
                    <span>{s.nb_techniciens} tech.</span>
                    {s.vehicule_requis === 'utilitaire' && <span>utilitaire</span>}
                    {quand && <span>{quand}</span>}
                  </span>
                  {cause && <span className="pl-carte-cause">{cause}</span>}
                </Glissable>
              );
            })}
            {!aPlanifier.length && services.donnees && <div className="pl-tout-planifie">Tout est planifié cette semaine.</div>}
          </div>
        </aside>
      </div>

      {selection && (
        <DialogueService key={`${selection.id}-${selection.version}`} s={selection} techniciens={techniciens}
          agences={agences} propose={proposes.get(selection.id)} cause={causes.get(selection.id)} refs={refs.donnees}
          enregistrer={enregistrer} retirer={retirer} depublier={depublier} onFermer={() => setOuvert(null)} />
      )}
      {confirmerPublication && (
        <div className="voile" role="dialog" aria-modal="true" aria-labelledby="titre-publier">
          <div className="dialogue">
            <h2 id="titre-publier">Publier la semaine ?</h2>
            <p>{aPublier.length} service(s) passeront à l'étape « Planned ». Ils ne seront plus recalculés ni retirables.
              Odoo n'est pas modifié.</p>
            <div className="actions">
              <button type="button" className="btn" onClick={() => setConfirmerPublication(false)}>Annuler</button>
              <button type="button" className="btn btn-primaire" onClick={() => void publier()}>Publier</button>
            </div>
          </div>
        </div>
      )}
      {derogation && (
        <DialogueDerogation violations={derogation.violations} onConfirmer={(m) => derogation.resoudre(m)}
          onAnnuler={() => derogation.resoudre(null)} />
      )}
      {dialogue}
    </div>
  );
}
