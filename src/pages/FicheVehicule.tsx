// Fiche d'un véhicule de service. Photo, valeurs exactes (Odoo, corrigé par le registre flotte), fiche constructeur,
// missions planifiées (service, site, équipe de techniciens, conducteur désigné) et traçabilité en cas de PV :
// qui conduisait à une date, historique des conducteurs d'Odoo Fleet, pièces jointes (avis de contravention,
// désignations…) lues dans Odoo à chaque ouverture, chaque consultation étant notée dans le journal.
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { aujourdhui } from '../api';
import { Avertissements, EtatChargement, useDonnees } from '../composants';
import { useEcriture } from '../composants/Ecriture';
import { ListePieces, PastillePiece, usePieces, type Pieces } from '../composants/Pieces';
import { ConsommationVehicule } from '../composants/Rse';
import {
  electrifie, energieDe, FicheConstructeur, jour, lundiDe, nombre, Plaque, planifiable, titreDe, Visuel,
} from '../composants/Vehicule';
import {
  BOITES, flotte, type AffectationFleet, type ConducteurDuJour, type ConducteurVehicule, type DetailVehicule,
  type Cadrage, type MissionVehicule, type VehiculeFlotte,
} from '../flotte';
import { LIBELLES_STATUT_PLANIF, type StatutPlanif } from '../planification';
import { rse, type ProfilVehicule } from '../rse';

const JOUR_MS = 86_400_000;
const date = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00`);
const duree = (debut: string | null, fin: string | null) =>
  debut ? Math.round(((fin ? date(fin) : new Date()).getTime() - date(debut).getTime()) / JOUR_MS) + 1 : null;
const jourCourt = (s: string) => date(s).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
/** « 16 → 19 nov. 2026 », « 15 sept. → 2 oct. 2026 », ou les deux dates complètes sur deux années. */
function plage(debut: string, fin: string) {
  if (debut.slice(0, 10) === fin.slice(0, 10)) return jour(debut);
  const a = date(debut), b = date(fin);
  if (a.getFullYear() !== b.getFullYear()) return `${jour(debut)} → ${jour(fin)}`;
  const format: Intl.DateTimeFormatOptions = a.getMonth() === b.getMonth() ? { day: 'numeric' } : { day: 'numeric', month: 'short' };
  return `${a.toLocaleDateString('fr-FR', format)} → ${jour(fin)}`;
}
const periode = (debut: string | null, fin: string | null) =>
  (debut && fin ? plage(debut, fin) : `${debut ? jour(debut) : 'date inconnue'} → ${fin ? jour(fin) : 'en cours'}`);
const initiales = (nom: string) => nom.split(/\s+/).filter(Boolean).slice(0, 2).map((m) => m[0]).join('').toUpperCase();

// ---------- en-tête : photo et valeurs exactes ----------

function Fait({ libelle, valeur }: { libelle: string; valeur: ReactNode }) {
  return (
    <div>
      <dt>{libelle}</dt>
      <dd>{valeur === null || valeur === undefined || valeur === '' ? <span className="muet">non renseigné</span> : valeur}</dd>
    </div>
  );
}

const ZOOM_MAX = 3;
const borne = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));
const pareils = (a: Cadrage, b: Cadrage) => a.cadrage_x === b.cadrage_x && a.cadrage_y === b.cadrage_y && a.zoom === b.zoom;

/** Photo du véhicule : ajout (bouton ou glisser-déposer), retrait et recadrage. Recadrer = faire glisser la photo
 * (point gardé au centre) et zoomer ; l'image d'origine n'est jamais retaillée, le cadrage vaut partout. */
function Photo({ v, onPhoto }: { v: VehiculeFlotte; onPhoto: () => void }) {
  const { ecrire, dialogue } = useEcriture();
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [survol, setSurvol] = useState(false);
  const [cadrage, setCadrage] = useState<Cadrage | null>(null);            // réglage en cours ; null : hors réglage
  const [enregistre, setEnregistre] = useState<Cadrage | null>(null);      // affiché le temps du rechargement
  const [saisie, setSaisie] = useState<{ x: number; y: number; depart: Cadrage } | null>(null);
  const entree = useRef<HTMLInputElement>(null);
  const cadre = useRef<HTMLDivElement>(null);
  useEffect(() => setEnregistre(null), [v.photo?.cadrage_x, v.photo?.cadrage_y, v.photo?.zoom, v.photo?.version]);

  const envoyer = async (fichier: File | undefined) => {
    if (!fichier) return;
    setErreur(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(fichier.type)) { setErreur('Choisir une photo JPEG, PNG ou WebP.'); return; }
    setEnvoi(true);
    try { if (await ecrire(() => flotte.deposerPhoto(v.id, fichier))) onPhoto(); }
    catch (e) { setErreur(e instanceof Error ? e.message : String(e)); } finally { setEnvoi(false); }
  };
  const retirer = async () => {
    setEnvoi(true); setErreur(null);
    try { await ecrire(() => flotte.retirerPhoto(v.id)); onPhoto(); }
    catch (e) { setErreur(e instanceof Error ? e.message : String(e)); } finally { setEnvoi(false); }
  };
  const deposer = (e: DragEvent) => { e.preventDefault(); setSurvol(false); void envoyer(e.dataTransfer.files[0]); };

  const debuter = () => {
    if (!v.photo) return;
    setErreur(null);
    setCadrage(enregistre ?? { cadrage_x: v.photo.cadrage_x, cadrage_y: v.photo.cadrage_y, zoom: v.photo.zoom });
    window.setTimeout(() => cadre.current?.focus(), 0);
  };
  /** Débordement de l'image hors du cadre (px) à ce zoom : ce qu'un glissement peut faire apparaître. */
  const debord = (zoom: number) => {
    const r = cadre.current?.getBoundingClientRect();
    const p = v.photo;
    if (!r || !p) return { x: 0, y: 0 };
    const echelle = Math.max(r.width / p.largeur, r.height / p.hauteur);          // object-fit: cover
    return { x: zoom * p.largeur * echelle - r.width, y: zoom * p.hauteur * echelle - r.height };
  };
  const glisser = (dx: number, dy: number, depart: Cadrage) => {
    const d = debord(depart.zoom);
    setCadrage({ ...depart,
      cadrage_x: d.x > 0.5 ? borne(depart.cadrage_x - (100 * dx) / d.x, 0, 100) : depart.cadrage_x,
      cadrage_y: d.y > 0.5 ? borne(depart.cadrage_y - (100 * dy) / d.y, 0, 100) : depart.cadrage_y });
  };
  const zoomer = (z: number) => cadrage && setCadrage({ ...cadrage, zoom: Math.round(borne(z, 1, ZOOM_MAX) * 100) / 100 });
  const clavier = (e: KeyboardEvent) => {
    if (!cadrage) return;
    const pas = e.shiftKey ? 10 : 2;
    const fleches: Record<string, [number, number]> = { ArrowLeft: [-pas, 0], ArrowRight: [pas, 0], ArrowUp: [0, -pas], ArrowDown: [0, pas] };
    if (fleches[e.key]) {
      e.preventDefault();
      const [dx, dy] = fleches[e.key];
      setCadrage({ ...cadrage, cadrage_x: borne(cadrage.cadrage_x + dx, 0, 100), cadrage_y: borne(cadrage.cadrage_y + dy, 0, 100) });
    } else if (e.key === '+' || e.key === '=') zoomer(cadrage.zoom + 0.1);
    else if (e.key === '-') zoomer(cadrage.zoom - 0.1);
    else if (e.key === 'Escape') setCadrage(null);
    else if (e.key === 'Enter') void enregistrer();
  };
  const enregistrer = async () => {
    if (!cadrage || !v.photo) return;
    const c = { cadrage_x: Math.round(cadrage.cadrage_x * 10) / 10, cadrage_y: Math.round(cadrage.cadrage_y * 10) / 10, zoom: cadrage.zoom };
    if (pareils(c, { cadrage_x: v.photo.cadrage_x, cadrage_y: v.photo.cadrage_y, zoom: v.photo.zoom })) { setCadrage(null); return; }
    setEnvoi(true); setErreur(null);
    try {
      const p = await ecrire(() => flotte.cadrerPhoto(v.id, c));
      if (p) { setEnregistre(p); setCadrage(null); onPhoto(); }
    } catch (e) { setErreur(e instanceof Error ? e.message : String(e)); } finally { setEnvoi(false); }
  };

  const reglage = cadrage !== null;
  return (
    <div className="fv-photo-bloc">
      <div ref={cadre} className={`fv-photo${survol ? ' survol' : ''}${reglage ? ' recadrage' : ''}${saisie ? ' saisie' : ''}`}
        tabIndex={reglage ? 0 : undefined} onKeyDown={clavier}
        role={reglage ? 'application' : undefined}
        aria-label={reglage ? 'Repositionner la photo : glisser, flèches (Maj : plus vite), + et − pour zoomer, Entrée pour enregistrer' : undefined}
        onPointerDown={(e) => {
          if (!cadrage || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setSaisie({ x: e.clientX, y: e.clientY, depart: cadrage });
        }}
        onPointerMove={(e) => { if (saisie) glisser(e.clientX - saisie.x, e.clientY - saisie.y, saisie.depart); }}
        onPointerUp={() => setSaisie(null)} onPointerCancel={() => setSaisie(null)}
        onDragOver={(e) => { if (reglage) return; e.preventDefault(); setSurvol(true); }} onDragLeave={() => setSurvol(false)}
        onDrop={(e) => { if (!reglage) deposer(e); }}>
        <Visuel v={v} grande cadrage={cadrage ?? enregistre ?? undefined} />
        {reglage ? <>
          <div className="fv-tiers" aria-hidden="true" />
          <p className="fv-cadrage-aide" aria-hidden="true">Faites glisser la photo pour la repositionner</p>
          <div className="fv-cadrage-barre" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <div className="fv-cadrage-zoom">
              <button type="button" className="btn" aria-label="Dézoomer" disabled={cadrage.zoom <= 1} onClick={() => zoomer(cadrage.zoom - 0.1)}>−</button>
              <input type="range" min={1} max={ZOOM_MAX} step={0.05} value={cadrage.zoom} aria-label="Zoom"
                onChange={(e) => zoomer(Number(e.target.value))} />
              <button type="button" className="btn" aria-label="Zoomer" disabled={cadrage.zoom >= ZOOM_MAX} onClick={() => zoomer(cadrage.zoom + 0.1)}>+</button>
              <span className="fv-cadrage-pct">{Math.round(cadrage.zoom * 100)} %</span>
            </div>
            <button type="button" className="btn" onClick={() => setCadrage({ cadrage_x: 50, cadrage_y: 50, zoom: 1 })}>Recentrer</button>
            <button type="button" className="btn" onClick={() => setCadrage(null)}>Annuler</button>
            <button type="button" className="btn btn-primaire" disabled={envoi} onClick={() => void enregistrer()}>
              {envoi ? 'Enregistrement…' : 'Enregistrer le cadrage'}</button>
          </div>
        </> : <>
          <Plaque plaque={v.plaque} />
          <div className="fl-actions-photo">
            <input ref={entree} type="file" accept="image/jpeg,image/png,image/webp" hidden
              onChange={(e) => { void envoyer(e.target.files?.[0]); e.target.value = ''; }} />
            {v.photo && <button type="button" className="btn" disabled={envoi} onClick={debuter}>Recadrer</button>}
            <button type="button" className="btn" disabled={envoi} onClick={() => entree.current?.click()}>
              {envoi ? 'Envoi…' : v.photo ? 'Remplacer la photo' : 'Ajouter une photo'}</button>
            {v.photo && <button type="button" className="btn fl-btn-retirer" disabled={envoi} onClick={() => void retirer()}>Retirer</button>}
          </div>
        </>}
      </div>
      {reglage && v.photo
        ? <div className="fv-apercu-parc"><div className="fl-visuel fv-apercu-cadre"><Visuel v={v} cadrage={cadrage} /></div>
            <span>Aperçu dans le parc : le même cadrage s'applique partout. L'image d'origine reste entière.</span></div>
        : <p className="fv-photo-note">{v.photo ? `Photo ajoutée par ${v.photo.auteur} le ${jour(v.photo.ajoutee_le)}`
            : 'Glissez une photo sur l’image · réenregistrée sans métadonnées (GPS)'}</p>}
      {erreur && <div className="erreur" role="alert">{erreur}</div>}
      {dialogue}
    </div>
  );
}

function Entete({ v, onPhoto }: { v: VehiculeFlotte; onPhoto: () => void }) {
  const r = v.retenu;
  const fiche = v.fiche?.statut === 'fiche' ? v.fiche : null;
  return (
    <section className="fv-entete" aria-label="Le véhicule">
      <Photo v={v} onPhoto={onPhoto} />
      <div className="fv-identite">
        <div className="fv-titre">
          <h1>{titreDe(v)}</h1>
          <div className="fv-puces">
            {energieDe(v) && <span className={`fl-energie statique${electrifie(v) ? ' electrifie' : ''}`}>{energieDe(v)}</span>}
            <span className={`fv-puce ${planifiable(v) ? 'ok' : 'non'}`}>{planifiable(v) ? 'Planifiable' : 'Hors planification'}</span>
            <span className="fv-puce">Véhicule de service</span>
          </div>
          <p className="fv-sous">{[fiche?.generation, r.annee, r.lieu].filter(Boolean).join(' · ')}</p>
        </div>
        <dl className="fv-faits">
          <Fait libelle="Modèle" valeur={titreDe(v)} />
          <Fait libelle="Catégorie" valeur={r.categorie} />
          <Fait libelle="Énergie" valeur={energieDe(v)} />
          <Fait libelle="Couleur" valeur={r.couleur} />
          <Fait libelle="Année" valeur={r.annee} />
          <Fait libelle="Lieu" valeur={r.lieu} />
          <Fait libelle="Immatriculé le" valeur={v.date_immatriculation && jour(v.date_immatriculation)} />
          <Fait libelle="État" valeur={v.etat} />
          <Fait libelle="Places" valeur={v.places || null} />
          <Fait libelle="Boîte" valeur={v.boite ? BOITES[v.boite] ?? v.boite : null} />
          <Fait libelle="Puissance" valeur={[v.puissance_ch && `${v.puissance_ch} ch`, v.puissance_kw && `${v.puissance_kw} kW`]
            .filter(Boolean).join(' · ') || null} />
          <Fait libelle="Compteur" valeur={v.compteur ? `${nombre(v.compteur, 0)} ${v.compteur_unite === 'miles' ? 'mi' : 'km'}` : null} />
        </dl>
        {v.a_verifier.length > 0 && (
          <details className="fv-corrections">
            <summary>{v.a_verifier.length} correction{v.a_verifier.length > 1 ? 's' : ''} à reporter dans Odoo</summary>
            <ul>{v.a_verifier.map((a) => <li key={a}>{a}</li>)}</ul>
          </details>
        )}
      </div>
    </section>
  );
}

// ---------- PV : qui conduisait ce jour-là ? ----------

function RecherchePV({ v, pieces, historique, onDate }: { v: VehiculeFlotte; pieces: Pieces; historique: AffectationFleet[];
  onDate: (d: string | null) => void }) {
  const [quand, setQuand] = useState('');                       // à choisir : la date de l'avis, pas aujourd'hui
  const [resultat, setResultat] = useState<ConducteurDuJour | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [recherche, setRecherche] = useState(false);
  const chercher = (e: FormEvent) => {
    e.preventDefault();
    setErreur(null); setRecherche(true);
    flotte.conducteurLe(v.id, quand)
      .then((r) => { setResultat(r); onDate(r.date); })
      .catch((err: Error) => { setResultat(null); onDate(null); setErreur(err.message); })
      .finally(() => setRecherche(false));
  };
  const parId = new Map(historique.map((h) => [h.id, h]));
  return (
    <section className="fv-pv" aria-label="Recherche du conducteur pour un PV">
      <div className="fv-pv-tete">
        <h2>Qui conduisait ce véhicule ?</h2>
        <p>Pour un avis de contravention : le conducteur est à désigner sous 45 jours (article L121-6 du Code de la route).</p>
      </div>
      <form className="fv-pv-form" onSubmit={chercher}>
        <label className="champ">Date de l’infraction
          <input type="date" value={quand} max={aujourdhui()} onChange={(e) => setQuand(e.target.value)} required /></label>
        <button type="submit" className="btn btn-primaire" disabled={recherche || !quand}>{recherche ? 'Recherche…' : 'Rechercher'}</button>
      </form>
      {erreur && <div className="erreur" role="alert">{erreur}</div>}
      {resultat && (
        <div className={`fv-pv-resultat ${resultat.conducteur ? 'identifie' : 'inconnu'}`} aria-live="polite">
          <div className="fv-pv-qui">
            <span>Le {jour(resultat.date)}</span>
            <strong>{resultat.conducteur ?? 'Conducteur non identifié'}</strong>
            {resultat.affectations.length > 1 && <em>{resultat.affectations.length} affectations couvrent cette date : à vérifier</em>}
          </div>
          {resultat.affectations.map((a) => {
            const nom = a.employe ?? (a.pool ? null : a.conducteur);
            return (
              <div key={a.id} className="fv-pv-preuve">
                <h3>Affectation Odoo Fleet <span>{periode(a.debut, a.fin)}</span></h3>
                {nom && nom !== resultat.conducteur && <p>{nom}</p>}
                <ListePieces liste={parId.get(a.id)?.pieces ?? a.pieces} pieces={pieces} />
              </div>
            );
          })}
          {resultat.missions.map((m) => (
            <div key={`${m.service_id}-${m.debut}`} className="fv-pv-preuve">
              <h3>Mission planifiée <span>{plage(m.debut, m.fin)}</span></h3>
              <p><strong>{m.client ?? m.service}</strong> · {m.service}{m.site ? ` · ${m.site}` : ''}</p>
              {(m.equipe.length > 0 || m.conducteur) && <p className="muet">Équipe ce jour : {[
                ...(m.conducteur && !m.equipe.includes(m.conducteur) ? [`${m.conducteur} (conducteur)`] : []),
                ...m.equipe.map((n) => (n === m.conducteur ? `${n} (conducteur)` : n)),
              ].join(', ')}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------- conducteurs (Odoo Fleet) : une ligne compacte par personne, dépliée à la demande ----------

const VISIBLES = 8;
type Groupe = { cle: string; nom: string; ids: number[]; c: ConducteurVehicule | null; nbPieces: number };

/** Qui est-ce : matricule, fonction et, pour un technicien terrain, agence (seulement ce qui est connu). */
function qui(g: Groupe): string {
  if (!g.c) return '';
  const c = g.c;
  return [c.matricule, c.fonction ?? (c.technicien ? 'Technicien' : null), c.agence].filter(Boolean).join(' · ');
}

const couvre = (h: AffectationFleet, jourPV: string) => (!h.debut || h.debut <= jourPV) && (!h.fin || h.fin >= jourPV);

function Conducteurs({ d, pieces, repere }: { d: DetailVehicule; pieces: Pieces; repere: string | null }) {
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [texte, setTexte] = useState('');
  const [avecPieces, setAvecPieces] = useState(false);
  const [tous, setTous] = useState(false);
  const parId = useMemo(() => new Map(d.historique.map((h) => [h.id, h])), [d]);
  const groupes = useMemo<Groupe[]>(() => {
    const compte = (ids: number[]) => ids.reduce((n, id) => n + (parId.get(id)?.pieces.length ?? 0), 0);
    const anonymes = d.historique.filter((h) => !h.employe && h.pool).map((h) => h.id);
    return [
      ...d.conducteurs.map((c) => {
        const ids = c.affectations.map((a) => a.id);
        return { cle: c.nom, nom: c.nom, ids, c, nbPieces: compte(ids) };
      }),
      ...(anonymes.length ? [{ cle: '?', nom: 'Conducteur non renseigné', ids: anonymes, c: null, nbPieces: compte(anonymes) }] : []),
    ];
  }, [d, parId]);
  // date d'un PV recherchée : on déplie la personne de l'affectation qui fait foi (la plus récente qui couvre la date,
  // comme le serveur), même si une affectation plus ancienne restée ouverte la chevauche
  const auPV = useMemo(() => {
    if (!repere) return null;
    const foi = d.historique.filter((h) => couvre(h, repere))
      .sort((a, b) => (b.debut ?? '').localeCompare(a.debut ?? '') || b.id - a.id)[0];
    return foi ? groupes.find((g) => g.ids.includes(foi.id))?.cle ?? null : null;
  }, [repere, groupes, d]);
  useEffect(() => { if (auPV) setOuvert(auPV); }, [auPV]);

  if (!groupes.length) return null;
  const datees = d.historique.filter((h) => h.debut);
  const debut = datees.length ? Math.min(...datees.map((h) => date(h.debut!).getTime())) : Date.now() - 365 * JOUR_MS;
  const fin = Math.max(Date.now(), ...datees.map((h) => (h.fin ? date(h.fin).getTime() : Date.now())));
  const pos = (t: number) => Math.min(100, Math.max(0, ((t - debut) / Math.max(fin - debut, JOUR_MS)) * 100));
  const mois: Date[] = [];
  for (let m = new Date(new Date(debut).getFullYear(), new Date(debut).getMonth() + 1, 1); m.getTime() <= fin;
    m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) mois.push(m);
  const pas = Math.max(1, Math.ceil(mois.length / 9));
  const graduations = mois.filter((_, i) => i % pas === 0);
  const xPV = repere ? pos(date(repere).getTime()) : null;

  const q = texte.trim().toLowerCase();
  const filtres = groupes.filter((g) => (!avecPieces || g.nbPieces > 0)
    && (!q || [g.nom, g.c?.matricule, g.c?.fonction].filter(Boolean).join(' ').toLowerCase().includes(q)));
  const affiches = tous || q || avecPieces ? filtres
    : filtres.filter((g, i) => i < VISIBLES || g.cle === ouvert || g.cle === auPV);

  return (
    <div className="fv-cond">
      <div className="fv-cond-outils">
        <label className="champ champ-recherche">Rechercher
          <input type="search" value={texte} placeholder="Nom, matricule, fonction" onChange={(e) => setTexte(e.target.value)} /></label>
        <label className="fv-cond-case"><input type="checkbox" checked={avecPieces} onChange={(e) => setAvecPieces(e.target.checked)} />
          Avec pièces jointes seulement</label>
        <span className="fv-cond-total">{filtres.length} / {groupes.length} conducteur{groupes.length > 1 ? 's' : ''}</span>
      </div>

      <div className="fv-cond-grille fv-cond-axe" aria-hidden="true">
        <span />
        <div className="fv-cond-graduations">
          {graduations.map((m, i) => <span key={m.getTime()} style={{ left: `${pos(m.getTime())}%` }}>
            {m.toLocaleDateString('fr-FR', { month: 'short', year: m.getMonth() === 0 || i === 0 ? '2-digit' : undefined })}</span>)}
          {xPV !== null && <b className={`fv-cond-pv${xPV > 80 ? ' gauche' : ''}`} style={{ left: `${xPV}%` }}>PV {jour(repere!)}</b>}
        </div>
        <span />
      </div>

      <ul className="fv-cond-liste">
        {affiches.map((g) => {
          const deplie = ouvert === g.cle;
          const lignes = g.ids.map((id) => parId.get(id)).filter((h): h is AffectationFleet => !!h);
          return (
            <li key={g.cle} className={[deplie && 'ouvert', g.cle === auPV && 'au-pv', !g.c && 'anonyme'].filter(Boolean).join(' ') || undefined}>
              <button type="button" className="fv-cond-grille fv-cond-ligne" aria-expanded={deplie}
                onClick={() => setOuvert(deplie ? null : g.cle)}>
                <span className="fv-cond-id">
                  <span className="fv-initiales" aria-hidden="true">{g.c ? initiales(g.nom) : '?'}</span>
                  <span className="fv-cond-nom"><strong>{g.nom}</strong>{qui(g) && <small title={qui(g)}>{qui(g)}</small>}</span>
                </span>
                <span className="fv-cond-piste" aria-hidden="true">
                  {graduations.map((m) => <i key={m.getTime()} className="fv-frise-mois" style={{ left: `${pos(m.getTime())}%` }} />)}
                  {lignes.map((h) => {
                    if (!h.debut) return null;
                    const a = pos(date(h.debut).getTime());
                    const b = pos(h.fin ? date(h.fin).getTime() + JOUR_MS : Date.now());
                    return <i key={h.id} className={`fv-frise-barre${h.pieces.length ? ' avec-pieces' : ''}${h.fin ? '' : ' en-cours'}`}
                      style={{ left: `${a}%`, width: `${Math.max(b - a, 0.8)}%` }} />;
                  })}
                  {xPV !== null && <i className="fv-cond-repere" style={{ left: `${xPV}%` }} />}
                </span>
                <span className="fv-cond-compte">
                  <span>{lignes.length} période{lignes.length > 1 ? 's' : ''}</span>
                  <span className={g.nbPieces ? 'pieces' : undefined}>{g.nbPieces} pièce{g.nbPieces > 1 ? 's' : ''}</span>
                </span>
              </button>
              {deplie && (
                <div className="fv-cond-detail">
                  {g.c && (g.c.departement || g.c.societe || g.c.technicien) && (
                    <p className="fv-cond-infos">
                      {(g.c.departement || g.c.societe) && <span>{[g.c.departement, g.c.societe].filter(Boolean).join(' · ')}</span>}
                      {g.c.technicien && <span className="fv-tag">Technicien terrain{g.c.agence ? ` · ${g.c.agence}` : ''}</span>}
                    </p>
                  )}
                  <table className="fv-cond-periodes">
                    <tbody>{lignes.map((h) => (
                      <tr key={h.id} className={repere && couvre(h, repere) ? 'au-pv' : undefined}>
                        <th scope="row">{periode(h.debut, h.fin)}
                          {duree(h.debut, h.fin) && <small>{duree(h.debut, h.fin)} j</small>}</th>
                        <td>{h.pieces.length
                          ? <span className="fv-puces-pieces">{h.pieces.map((p) => <PastillePiece key={p.id} p={p} pieces={pieces} />)}</span>
                          : <span className="muet">aucune pièce</span>}</td>
                      </tr>))}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!affiches.length && <p className="muet">Aucun conducteur ne correspond.</p>}
      {affiches.length < filtres.length && (
        <button type="button" className="btn fv-cond-plus" onClick={() => setTous(true)}>
          Afficher les {filtres.length - affiches.length} autres conducteurs</button>)}
    </div>
  );
}

// ---------- missions planifiées ----------

const PROPOSE_PAR: Record<string, string> = { solveur: 'le solveur', dispatcher: 'un dispatcher' };

function Mission({ m }: { m: MissionVehicule }) {
  const aujourd = aujourdhui();
  const moment = m.fin < aujourd ? 'passee' : m.debut > aujourd ? 'avenir' : 'encours';
  return (
    <li>
      <details className={`fv-mission ${moment}`}>
        <summary>
          <span className="fv-mission-dates">{plage(m.debut, m.fin)}
            <em>{moment === 'encours' ? 'en cours' : moment === 'avenir' ? 'à venir' : `${m.jours_ouvres} j ouvré${m.jours_ouvres > 1 ? 's' : ''}`}</em></span>
          <span className="fv-mission-titre"><strong>{m.client ?? m.service}</strong><span>{m.service}</span></span>
          <span className="fv-mission-pilote">{m.conducteur ? <>Conducteur <strong>{m.conducteur}</strong></> : 'Conducteur non désigné'}
            <em>{m.equipe.length} technicien{m.equipe.length > 1 ? 's' : ''}</em></span>
          <span className={`fv-etat ${m.etat}`}>{LIBELLES_STATUT_PLANIF[m.etat as StatutPlanif] ?? m.etat}</span>
        </summary>
        <div className="fv-mission-corps">
          <dl className="fv-mission-infos">
            <div><dt>Site d’intervention</dt><dd>{m.site ?? <span className="muet">non renseigné</span>}</dd></div>
            <div><dt>Statut du service</dt><dd>{LIBELLES_STATUT_PLANIF[m.statut as StatutPlanif] ?? m.statut}</dd></div>
            <div><dt>Durée</dt><dd>{m.jours_ouvres} jour{m.jours_ouvres > 1 ? 's' : ''} ouvré{m.jours_ouvres > 1 ? 's' : ''}</dd></div>
            <div><dt>Véhicule proposé par</dt><dd>{PROPOSE_PAR[m.propose_par] ?? m.propose_par}{m.raison ? ` · ${m.raison}` : ''}</dd></div>
            {m.motif && <div className="large"><dt>Motif de dérogation</dt><dd>{m.motif}</dd></div>}
          </dl>
          {m.equipe.length ? (
            <table className="fv-equipe">
              <thead><tr><th scope="col">Technicien</th><th scope="col">Agence</th><th scope="col">Jours sur la mission</th><th scope="col">Rôle</th></tr></thead>
              <tbody>{m.equipe.map((e) => (
                <tr key={e.matricule}>
                  <td><strong>{e.nom}</strong> <small>{e.matricule}</small></td>
                  <td>{e.agence ?? '—'}</td>
                  <td>{e.jours.map(jourCourt).join(', ')}</td>
                  <td>{e.conducteur ? <span className="fv-tag conducteur">Conducteur</span> : 'Équipier'}</td>
                </tr>))}
              </tbody>
            </table>
          ) : <p className="muet">Aucun technicien affecté sur ces dates.</p>}
          <Link className="fv-lien" to={`/planification?semaine=${lundiDe(m.debut)}`}>Ouvrir la semaine dans la planification →</Link>
        </div>
      </details>
    </li>
  );
}

// ---------- page ----------

/** Consommation retenue pour le score RSE (saisie, sinon constructeur, sinon moyenne) et sa saisie. */
function EmissionsVehicule({ id }: { id: number }) {
  const p = useDonnees(() => rse.vehicule(id), [id]);
  const [profil, setProfil] = useState<ProfilVehicule | null>(null);
  const actuel = profil ?? p.donnees;
  if (!actuel) return <EtatChargement chargement={p.chargement} erreur={p.erreur} />;
  return <ConsommationVehicule id={id} profil={actuel} onChange={setProfil} />;
}

export default function FicheVehicule() {
  const { id } = useParams();
  const vid = Number(id);
  const donnees = useDonnees<DetailVehicule>(() => flotte.vehicule(vid), [vid]);
  const pieces = usePieces(flotte.piece);
  const [repere, setRepere] = useState<string | null>(null);
  const d = donnees.donnees;

  if (!d) {
    return (
      <div className="fv">
        <Link className="fv-retour" to="/vehicules">← Parc véhicules</Link>
        <EtatChargement chargement={donnees.chargement} erreur={donnees.erreur} />
      </div>
    );
  }
  const v = d.vehicule;
  const nbPieces = d.historique.reduce((n, h) => n + h.pieces.length, 0);
  return (
    <div className="fv">
      <Link className="fv-retour" to="/vehicules">← Parc véhicules</Link>
      <Avertissements liste={d.avertissements} />
      <Entete v={v} onPhoto={donnees.recharger} />
      {pieces.erreur && <div className="erreur" role="alert">{pieces.erreur}</div>}

      <div className="fv-colonnes">
        <div className="fv-principale">
          <RecherchePV v={v} pieces={pieces} historique={d.historique} onDate={setRepere} />

          <section className="fv-section" aria-label="Conducteurs et pièces jointes">
            <h2>Conducteurs et pièces jointes <span className="fl-source">Odoo Fleet</span>
              <small>{d.historique.length} affectation{d.historique.length > 1 ? 's' : ''} · {nbPieces} pièce{nbPieces > 1 ? 's' : ''}</small></h2>
            {!d.historique_disponible && <p className="muet">Odoo injoignable : historique et pièces jointes indisponibles.</p>}
            {d.historique_disponible && !d.historique.length && <p className="muet">Aucune affectation enregistrée dans Odoo Fleet.</p>}
            <Conducteurs d={d} pieces={pieces} repere={repere} />
          </section>

          <section className="fv-section" aria-label="Missions planifiées">
            <h2>Missions planifiées <span className="fl-source">Planification</span>
              <small>{d.missions.length} mission{d.missions.length > 1 ? 's' : ''}</small></h2>
            {d.missions.length
              ? <ol className="fv-missions">{d.missions.map((m) => <Mission key={m.id} m={m} />)}</ol>
              : <p className="muet">Ce véhicule n’a encore été affecté à aucune mission.</p>}
          </section>
        </div>

        <aside className="fv-cote">
          <section className="fv-section" aria-label="Documents du véhicule">
            <h2>Documents du véhicule <span className="fl-source">Odoo</span></h2>
            <ListePieces liste={d.documents} pieces={pieces} vide="Aucun document joint au véhicule dans Odoo." />
          </section>
          <section className="fv-section" aria-label="Émissions du véhicule">
            <h2>Émissions <span className="fl-source">Score RSE</span></h2>
            <EmissionsVehicule id={vid} />
          </section>
          <section className="fv-section" aria-label="Fiche constructeur">
            <h2>Fiche constructeur</h2>
            {v.fiche ? <FicheConstructeur f={v.fiche} /> : <p className="muet">Pas de fiche pour ce modèle.</p>}
          </section>
        </aside>
      </div>
      {pieces.dialogue}
    </div>
  );
}
