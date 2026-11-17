// Dossier d'intervention (une commande client et ses services sur site, ou un service sans commande), tout au même
// endroit, chaque information une seule fois. Tête bleu nuit : client, commande, avancement (plusieurs services) et
// carte des sites et des agences de départ. Corps : les missions dans l'ordre des dates, une carte par service sur
// site avec ce que montre la liste Odoo (étape, feuille de travail, assignés, jalon, étiquettes, activité suivante),
// les alertes et le lien vers sa fiche dans la Planification ; son détail est un carnet comme celui d'Odoo :
// Description, Feuilles de temps, Sous-tâches, Argent (coûts estimés, commandes et factures), Matériel, Déplacement
// et RSE. Mêmes libellés et mêmes calculs qu'Odoo : chaque bloc correspond à un champ ou un widget d'Odoo (voir le
// plan, « intégration dans Odoo »). Lecture seule ; description et pièces lues dans Odoo à l'affichage, journalisées.
import L from 'leaflet';
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, ZoomControl } from 'react-leaflet';
import { Link, useParams } from 'react-router-dom';
import { aujourdhui } from '../api';
import { Avertissements, Badge, EtatChargement, initiales, useDonnees } from '../composants';
import { BoutonExport } from '../composants/BoutonExport';
import DescriptionOdoo from '../composants/DescriptionOdoo';
import { useEcriture } from '../composants/Ecriture';
import { ListePieces, usePieces, type Pieces } from '../composants/Pieces';
import { BandeauRse, BilanMission, ChoixMode, IconeMode, PastilleNote } from '../composants/Rse';
import { Barre, BadgeEtat } from '../composants/Statistiques';
import { Plaque } from '../composants/Vehicule';
import { dossiers, type AgenceDepart, type Dossier, type Itineraire, type ServiceDossier } from '../dossiers';
import { exportations, nomFichier } from '../exports';
import { co2 } from '../rse';
import { alertesFiche, lienPlanification, statutOdooNotable } from '../servicesSurSite';
import { euros, heures, LIBELLES_ETAT, LIBELLES_FACTURATION, LIBELLES_LIVRAISON, LIBELLES_PAIEMENT, nombre, titreDossier,
  type ActiviteOdoo, type EtatService, type TypeDossier } from '../statistiques';

type Ecrire = <T>(action: () => Promise<T>) => Promise<T | undefined>;

const ETATS: EtatService[] = ['en_retard', 'planifie', 'a_planifier', 'fait', 'facture', 'archive'];   // ordre d'urgence
const COULEURS: Record<EtatService, string> = {
  a_planifier: '#7a8191', planifie: '#1d4ed8', en_retard: '#b91c1c', fait: '#0f766e', facture: '#0f1d44', archive: '#a8a29e',
};
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
/** Statut d'une tâche Odoo (champ « state », pastille de la liste). */
const ETATS_TACHE: Record<string, string> = {
  '01_in_progress': 'en cours', '02_changes_requested': 'modifications demandées', '03_approved': 'approuvée',
  '04_waiting_normal': 'en attente', '1_done': 'terminée', '1_canceled': 'annulée',
};
/** Statut de planification d'un service planifié (proposé par le solveur, verrouillé, publié aux techniciens). */
const STATUTS_PLANIF: Record<string, string> = { propose: 'Proposé', verrouille: 'Verrouillé', publie: 'Publié' };

const date = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);
const debutDe = (s: ServiceDossier) => (s.planification.debut ?? s.prevu.debut)?.slice(0, 10) ?? null;
const finDe = (s: ServiceDossier) => (s.planification.fin ?? s.prevu.fin)?.slice(0, 10) ?? debutDe(s);
const jourCourt = (iso: string) => date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const jj = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const km = (x: number | null) => (x === null ? null : `${nombre(Math.round(x))} km`);
function duree(h: number | null) {
  if (h === null) return null;
  const m = Math.round(h * 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
/** « 21 Rue Victor Grignard, 42000 SAINT ETIENNE » -> « Saint Etienne ». */
export function villeDe(adresse: string | null) {
  const v = adresse?.match(/\b\d{5}\s+([^,]+)$/)?.[1] ?? adresse?.split(',').pop() ?? null;
  return v ? v.trim().toLowerCase().replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase()) : null;
}
const echapper = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Échéance d'une activité, comme Odoo : « aujourd'hui », « demain », « dans 3 jours », « 2 jours de retard ». */
function quand(echeance: string | null, auj: string): string {
  if (!echeance) return 'sans échéance';
  const n = Math.round((date(echeance).getTime() - date(auj).getTime()) / 86_400_000);
  if (n === 0) return "aujourd'hui";
  if (n === 1) return 'demain';
  if (n === -1) return 'hier';
  return n > 1 ? `dans ${n} jours` : `${-n} jours de retard`;
}
/** Visible dans la Planification : ni archivé, ni terminé sans y avoir été planifié. */
const planifiable = (s: ServiceDossier) => !s.archive_odoo && !((s.etat === 'fait' || s.etat === 'facture') && !s.planification.debut);

// ---------- carte : sites, agences de départ, trajets ----------

type Point = [number, number];
interface Site { cle: string; position: Point; adresse: string | null; ville: string | null; services: ServiceDossier[]; etat: EtatService }
interface Trajet { cle: string; depart: Point; site: Site; it: Itineraire; services: number[] }

/** Courbe de Bézier quadratique entre deux points : le trajet se lit comme un départ, pas comme une route exacte. */
function arc(a: Point, b: Point, n = 48): Point[] {
  const c: Point = [(a[0] + b[0]) / 2 - (b[1] - a[1]) * 0.2, (a[1] + b[1]) / 2 + (b[0] - a[0]) * 0.2];
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t;
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
  });
}

function geographie(d: Dossier) {
  const sites = new Map<string, Site>();
  for (const s of d.services) {
    if (s.site.lat === null || s.site.lng === null) continue;
    const cle = `${s.site.lat.toFixed(4)},${s.site.lng.toFixed(4)}`;
    const site = sites.get(cle) ?? { cle, position: [s.site.lat, s.site.lng] as Point, adresse: s.site.adresse,
      ville: villeDe(s.site.adresse), services: [], etat: s.etat };
    site.services.push(s);
    if (ETATS.indexOf(s.etat) < ETATS.indexOf(site.etat)) site.etat = s.etat;
    sites.set(cle, site);
  }
  const trajets = new Map<string, Trajet>();
  for (const site of sites.values()) {
    for (const s of site.services) {
      for (const it of s.itineraires) {
        if (it.agence.lat === null || it.agence.lng === null) continue;
        const cle = `${it.agence.code}>${site.cle}`;
        const t = trajets.get(cle) ?? { cle, depart: [it.agence.lat, it.agence.lng] as Point, site, it, services: [] };
        t.services.push(s.id);
        trajets.set(cle, t);
      }
    }
  }
  const sansPosition = d.services.filter((s) => s.site.lat === null || s.site.lng === null).length;
  return { sites: [...sites.values()], trajets: [...trajets.values()], sansPosition };
}

/** Cadre la carte sur les sites et les agences ; `gauche` : largeur (px) couverte par le panneau de la tête, laissée
 *  libre pour que les repères restent visibles à côté de lui. */
function Cadrage({ points, gauche }: { points: Point[]; gauche: number }) {
  const map = useMap();
  const cle = points.map((p) => p.join(',')).join(';');
  useEffect(() => {
    if (!points.length) return;
    map.invalidateSize();
    const limites = points.length === 1 ? L.latLng(points[0]).toBounds(6000) : L.latLngBounds(points);
    map.fitBounds(limites, { paddingTopLeft: [gauche + 40, 44], paddingBottomRight: [60, 56], maxZoom: 13 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, map, gauche]);
  return null;
}

const iconeAgences = (noms: string[]) => {
  const largeur = 24 * noms.length + 4 * (noms.length - 1);
  return L.divIcon({ className: 'dp-marque-agence', iconSize: [largeur, 24], iconAnchor: [largeur / 2, 12],
    html: noms.map((n) => `<span>${echapper(n.slice(0, 1).toUpperCase())}</span>`).join('') });
};
/** Agences à moins de ~20 km l'une de l'autre : un seul repère (sinon superposées à l'échelle d'un trajet). */
function regrouperAgences(trajets: Trajet[]) {
  const groupes: { cle: string; position: Point; noms: string[] }[] = [];
  for (const t of trajets) {
    const nom = t.it.agence.nom;
    const g = groupes.find((x) => Math.hypot(x.position[0] - t.depart[0], x.position[1] - t.depart[1]) < 0.2);
    if (!g) groupes.push({ cle: t.it.agence.code, position: t.depart, noms: [nom] });
    else if (!g.noms.includes(nom)) g.noms.push(nom);
  }
  return groupes.map((g) => ({ ...g, noms: [...g.noms].sort((a, b) => a.localeCompare(b)) }));
}
const iconeSite = (site: Site) => L.divIcon({
  className: 'dp-marque-site',
  html: `<span style="--c:${COULEURS[site.etat]}">${site.services.length}</span>`, iconSize: [34, 34], iconAnchor: [17, 17],
});

function Carte({ d, actif, onSite, gauche = 0 }: {
  d: Dossier; actif: number | null; onSite: (s: Site) => void; gauche?: number;
}) {
  const { sites, trajets } = useMemo(() => geographie(d), [d]);
  const points = [...sites.map((s) => s.position), ...trajets.map((t) => t.depart)];
  const agences = regrouperAgences(trajets);
  if (!points.length) return <div className="dp-carte dp-carte-vide">Aucun site géolocalisé pour ce dossier.</div>;
  return (
    <MapContainer bounds={L.latLngBounds(points)} className="dp-carte" zoomControl={false} scrollWheelZoom={false}>
      <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
      <ZoomControl position="topright" />
      <Cadrage points={points} gauche={gauche} />
      {trajets.map((t) => {
        const allume = actif !== null && t.services.includes(actif);
        return (
          <Polyline key={`${t.cle}-${allume}-${actif === null}`} positions={arc(t.depart, t.site.position)}
            pathOptions={{ color: '#b45309', weight: allume ? 3.5 : 2.5, dashArray: allume ? undefined : '1 7', lineCap: 'round',
                           opacity: actif === null || allume ? 0.95 : 0.2 }}>
            <Tooltip sticky>{t.it.agence.nom} vers {t.site.ville ?? 'le site'} : {[km(t.it.km), duree(t.it.heures)].filter(Boolean).join(', ')}
              {t.it.km !== null && ' (estimé)'}</Tooltip>
          </Polyline>
        );
      })}
      {agences.map((g) => (
        <Marker key={g.cle} position={g.position} icon={iconeAgences(g.noms)}>
          <Tooltip direction="top" offset={[0, -12]}>{g.noms.length > 1 ? `Agences ${g.noms.join(' et ')}` : `Agence ${g.noms[0]}`} :
            départ des techniciens</Tooltip>
        </Marker>
      ))}
      {sites.map((s) => (
        <Marker key={s.cle} position={s.position} icon={iconeSite(s)} eventHandlers={{ click: () => onSite(s) }}
          opacity={actif === null || s.services.some((x) => x.id === actif) ? 1 : 0.45}>
          <Tooltip direction="top" offset={[0, -16]}>
            <strong>{s.ville ?? 'Site'}</strong><br />{s.adresse}<br />
            {s.services.length} mission{s.services.length > 1 ? 's' : ''} : {s.services.map((x) => x.nom).join(', ')}
          </Tooltip>
        </Marker>
      ))}
    </MapContainer>
  );
}

// ---------- tête du dossier : identité, avancement, carte ----------

/** Plusieurs services : anneau des services par état (terminés sur le total). */
function Anneau({ d }: { d: Dossier }) {
  const r = d.resume, total = Math.max(1, r.services);
  const R = 30, C = 2 * Math.PI * R, ECART = r.services > 1 ? 3 : 0;
  const ordre: EtatService[] = ['facture', 'fait', 'planifie', 'en_retard', 'a_planifier', 'archive'];
  let deja = 0;
  const segments = ordre.flatMap((e) => {
    const n = r.par_etat[e] ?? 0;
    if (!n) return [];
    const long = (C * n) / total, debut = deja;
    deja += long;
    return [{ e, long, debut }];
  });
  return (
    <div className="dp-anneau">
      <svg viewBox="0 0 76 76" width="76" height="76" role="img"
        aria-label={`Avancement ${nombre(r.avancement_pct ?? 0)} % : ${segments.map(({ e }) => `${r.par_etat[e]} ${LIBELLES_ETAT[e].toLowerCase()}`).join(', ')}`}>
        <circle cx="38" cy="38" r={R} className="dp-anneau-fond" />
        {segments.map(({ e, long, debut }) => (
          <circle key={e} cx="38" cy="38" r={R} className={`dp-seg e-${e}`} transform="rotate(-90 38 38)"
            strokeDasharray={`${Math.max(0.01, long - ECART)} ${C}`} strokeDashoffset={-debut} />))}
        <text x="38" y="43" textAnchor="middle" className="dp-anneau-pct">{nombre(Math.round(r.avancement_pct ?? 0))} %</text>
      </svg>
      <div>
        <p className="dp-anneau-titre">{r.par_etat.fait + r.par_etat.facture} sur {r.services} service{r.services > 1 ? 's' : ''} terminé{r.par_etat.fait + r.par_etat.facture > 1 ? 's' : ''}</p>
        <ul className="dp-anneau-legende">
          {segments.map(({ e }) => <li key={e}><i className={`e-${e}`} />{r.par_etat[e]} {LIBELLES_ETAT[e].toLowerCase()}</li>)}
        </ul>
      </div>
    </div>
  );
}

function Tete({ d, actif, onSite }: { d: Dossier; actif: number | null; onSite: (s: Site) => void }) {
  const p = d.dossier, r = d.resume, c = p.commande;
  const plusieurs = d.services.length > 1;
  const geo = useMemo(() => geographie(d), [d]);
  // commande : un bandeau de faits (numéro, date, montant) ; le type de service en étiquette sous le titre
  const faits: [string, ReactNode][] = [];
  if (p.type === 'commande') {
    faits.push(['Commande', p.nom]);
    if (c?.date) faits.push(['Commandé le', jourCourt(c.date)]);
    if (c && c.montant_ht !== null) faits.push(['Montant HT', euros(c.montant_ht)]);
  }                                                   // sans commande : rien (pas de « non facturable »)
  const urgent = d.services.some((s) => s.priorite === 'urgente' && !s.archive_odoo);
  // la carte occupe toute la tête ; le panneau d'identité flotte dessus, à gauche (en dessous sur téléphone) : sa
  // largeur est laissée libre au cadrage pour que les repères restent visibles
  const panneau = useRef<HTMLDivElement>(null);
  const [gauche, setGauche] = useState(0);
  useEffect(() => {
    const el = panneau.current;
    if (!el) return;
    const mesurer = () => {
      const flotte = window.matchMedia('(min-width: 1001px)').matches;      // même seuil que la feuille de style
      setGauche(flotte ? Math.round(el.getBoundingClientRect().right - el.parentElement!.getBoundingClientRect().left) : 0);
    };
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <header className="dp-tete">
      <figure className="dp-tete-carte" aria-label="Sites et agences de départ">
        <Carte d={d} actif={actif} onSite={onSite} gauche={gauche} />
        <figcaption className="dp-legende">
          <span><i className="dp-leg-agence" />agence de départ</span>
          <span><i className="dp-leg-site" />site</span>
          <span><i className="dp-leg-trajet" />trajet</span>
          {geo.sansPosition > 0 && <span>{geo.sansPosition} sans position</span>}
        </figcaption>
      </figure>
      <div className="dp-tete-panneau" ref={panneau}>
        <Link to="/dossiers" className="dp-retour">‹ Dossiers d'intervention</Link>
        <p className="dp-client">{urgent && <span className="dp-urgent">Urgent</span>}
          {p.client ?? 'Client non renseigné'}{p.simule && <span className="dp-simule">simulé</span>}</p>
        <h1>{titreDossier(r)}</h1>
        {c?.type_service && <p className="dp-type-service" title="Type de service (commande)">{c.type_service}</p>}
        {faits.length > 0 && <dl className="dp-ident-faits">{faits.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
        {plusieurs && <Anneau d={d} />}
        <div className="dp-actions">
          <BoutonExport className="dp-odoo" libelle="Exporter (.xlsx)" nomFichier={nomFichier('dossier', p.nom)}
            lire={() => exportations.dossier(p.type, p.id)} />
          {p.odoo_url && <a className="dp-odoo" href={p.odoo_url} target="_blank" rel="noreferrer">Ouvrir dans Odoo ↗</a>}
        </div>
      </div>
    </header>
  );
}

// ---------- coûts du dossier : une équation (plusieurs services) ----------

function Equation({ d }: { d: Dossier }) {
  const r = d.resume;
  const parts = d.services.reduce((a, s) => ({ travail: a.travail + s.couts_estimes.travail, route: a.route + s.couts_estimes.route,
    vehicule: a.vehicule + s.couts_estimes.vehicule }), { travail: 0, route: 0, vehicule: 0 });
  const hors = d.services.find((s) => s.couts_estimes.hors)?.couts_estimes.hors;
  return (
    <section className="dp-equation" aria-label="Coûts et marge estimée du dossier">
      <div className="dp-termes">
        <div className="dp-terme"><span>Chiffre d'affaires HT</span><strong>{euros(r.ca_ht)}</strong>
          <small>{r.commandes.length} commande{r.commandes.length > 1 ? 's' : ''}, {euros(r.facture_ht)} facturés</small></div>
        <span className="dp-op" aria-hidden="true">−</span>
        <div className="dp-terme"><span>Matériel</span><strong>{euros(r.cout_materiel)}</strong><small>coût d'achat</small></div>
        <span className="dp-op" aria-hidden="true">−</span>
        <div className="dp-terme"><span>Coûts estimés</span><strong>{euros(r.couts_estimes)}</strong>
          <small>travail {euros(parts.travail)}, route {euros(parts.route)}, véhicule {euros(parts.vehicule)}</small></div>
        <span className="dp-op" aria-hidden="true">=</span>
        <div className={`dp-terme dp-resultat${r.marge_estimee < 0 ? ' negatif' : ''}`}><span>Marge estimée</span>
          <strong>{euros(r.marge_estimee)}</strong>{hors && <small>hors {hors}</small>}</div>
      </div>
      <dl className="dp-chiffres">
        <div><dt>Reste à facturer</dt><dd>{euros(r.reste_a_facturer_ht)}</dd></div>
        <div><dt>Heures passées</dt><dd>{heures(r.heures_passees)} <small>sur {heures(r.heures_prevues)} prévues</small></dd></div>
        <div><dt>Route</dt><dd>{km(r.km_estimes) ?? '—'} <small>estimés</small></dd></div>
      </dl>
    </section>
  );
}

// ---------- missions : la ligne du temps ----------

function DateMission({ s }: { s: ServiceDossier }) {
  const debut = debutDe(s), fin = finDe(s);
  if (!debut) return <div className="dp-date dp-date-vide">date à fixer</div>;
  const a = date(debut);
  return (
    <div className="dp-date">
      <strong>{a.getDate()}</strong><span>{MOIS[a.getMonth()]}</span>
      <small>{a.toLocaleDateString('fr-FR', { weekday: 'long' })}</small>
      {fin && fin !== debut && <small className="dp-date-fin">au {date(fin).getDate()} {MOIS[date(fin).getMonth()]}</small>}
    </div>
  );
}

const ETATS_ACTIVITE: Record<ActiviteOdoo['etat'], string> = { en_retard: 'En retard', aujourdhui: "Aujourd'hui", prevue: 'Prévue' };
const IconeActivite = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M5 6.5h6M5 9.5h4" /></svg>
);

/** « Activité suivante » de la liste Odoo : type, échéance relative, assigné ; couleur d'Odoo (retard, jour, prévue).
 *  Un clic l'ouvre, comme dans Odoo : type, échéance, assignée à, état, et le lien vers l'activité dans Odoo, où se
 *  lisent son résumé et sa note (jamais copiés ici) et où elle se marque faite. */
function Activite({ a, auj, odooUrl }: { a: ActiviteOdoo; auj: string; odooUrl: string | null }) {
  const [ouvert, setOuvert] = useState(false);
  const boite = useRef<HTMLLIElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: MouseEvent) => { if (!boite.current?.contains(e.target as Node)) setOuvert(false); };
    const echap = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { setOuvert(false); bouton.current?.focus(); } };
    document.addEventListener('mousedown', dehors);
    document.addEventListener('keydown', echap);
    return () => { document.removeEventListener('mousedown', dehors); document.removeEventListener('keydown', echap); };
  }, [ouvert]);
  const base = odooUrl?.split('/web#')[0];
  const id = `activite-${a.id}`;
  const echeance = a.echeance ? new Date(`${a.echeance}T12:00:00`).toLocaleDateString('fr-FR',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : null;
  return (
    <li ref={boite} className={`dp-activite ${a.etat}${ouvert ? ' ouverte' : ''}`}>
      <button ref={bouton} type="button" className="dp-activite-bouton" aria-expanded={ouvert} aria-controls={id}
        onClick={() => setOuvert((o) => !o)}>
        <IconeActivite /><strong>{a.type ?? 'Activité'}</strong><span>{quand(a.echeance, auj)}</span>
        {a.assigne && <span>· {a.assigne}</span>}</button>
      {ouvert && (
        <div id={id} role="dialog" aria-label={`Activité ${a.type ?? ''}`} className="dp-activite-detail">
          <p className="dp-ad-tete"><IconeActivite /><strong>{a.type ?? 'Activité'}</strong>
            <span className={`dp-ad-etat ${a.etat}`}>{ETATS_ACTIVITE[a.etat]}</span></p>
          <dl>
            <div><dt>Échéance</dt><dd>{echeance ? <>{echeance}<small>{quand(a.echeance, auj)}</small></> : 'Sans échéance'}</dd></div>
            <div><dt>Assignée à</dt><dd>{a.assigne ?? 'Personne'}</dd></div>
          </dl>
          {base ? <>
            <a className="dp-ad-lien" href={`${base}/web#id=${a.id}&model=mail.activity&view_type=form`} target="_blank"
              rel="noreferrer">Ouvrir l'activité dans Odoo ↗</a>
            <p className="muet">Résumé, note et « Marquer comme fait » : dans Odoo (ou sur la{' '}
              <a href={odooUrl!} target="_blank" rel="noreferrer">tâche</a>, fil de discussion).</p></>
            : <p className="muet">Service simulé : l'activité n'existe pas dans Odoo.</p>}
        </div>
      )}
    </li>
  );
}

/** Ce que montre la liste Odoo du service : étape, feuille de travail et son avancement, assignés, jalon, étiquettes,
 *  activités, date de fin. */
function LigneOdoo({ s, auj }: { s: ServiceDossier; auj: string }) {
  const o = s.odoo, f = s.realise.feuille;
  const feuille = f.envoyee ? 'envoyée' : f.signee ? 'signée' : f.remplie ? 'remplie' : 'à remplir';
  return (
    <ul className="dp-odoo-ligne" aria-label="Dans Odoo">
      {o?.etape && <li className="dp-odoo-etape" title={o.etape_depuis ? `Dernière mise à jour de l'étape : ${jj(o.etape_depuis)}` : 'Étape'}>
        <span>Étape</span><strong>{o.etape}</strong></li>}
      {f.modele_id !== null && <li title="Modèle de feuille de travail et son état">
        <span>Feuille</span>{o?.feuille_modele ?? 'modèle Odoo'}<span className="dp-odoo-etat">{feuille}</span></li>}
      {s.realise.fait && s.realise.fait_le && <li className="dp-odoo-fait">Terminé le {jj(s.realise.fait_le)}</li>}
      {!!o?.assignes.length && <li title="Assignés dans Odoo"><span>Assignés</span>{o.assignes.join(', ')}</li>}
      {o?.jalon && <li title="Jalon"><span>Jalon</span>{o.jalon}</li>}
      {o?.etiquettes.map((e) => <li key={e} className="dp-odoo-etiquette">{e}</li>)}
      {o?.activites.map((a) => <Activite key={a.id} a={a} auj={auj} odooUrl={s.odoo_url} />)}
    </ul>
  );
}

function Mission({ s, d, ouvert, actif, futur, ecrire, onBasculer, onSurvol, onModifie }: {
  s: ServiceDossier; d: Dossier; ouvert: boolean; actif: boolean; futur: boolean; ecrire: Ecrire; onBasculer: () => void;
  onSurvol: (id: number | null) => void; onModifie: () => void;
}) {
  const v = s.planification.vehicule;
  const mission = d.vehicules.flatMap((x) => x.missions).find((m) => m.service_id === s.id);
  const veh = v ? d.vehicules.find((x) => x.vehicle_id === v.id) : undefined;
  const plaque = v ? v.plaque ?? veh?.plaque ?? null : null;
  const agence = (code: string | null) => d.agences.find((a) => a.code === code)?.nom ?? code;
  const marge = s.couts_estimes.marge_estimee;
  const t = s.odoo?.temps;
  // un seul service : son nom est déjà le titre du dossier, l'adresse du site prend sa place ; et le lien Odoo de la
  // tête ouvre déjà la même tâche (dossier sans commande)
  const seul = d.services.length === 1;
  const odooIci = !!s.odoo_url && s.odoo_url !== d.dossier.odoo_url;
  const nb = s.planification.nb_techniciens ?? 0;
  const auj = aujourdhui();
  const alertes = alertesFiche(s);
  const statut = s.planification.statut;
  const lien = (onglet: 'reglages' | null) => lienPlanification(s.id, s.planification.debut, s.prevu.debut, onglet);
  return (
    <li id={`mission-${s.id}`} className={`dp-etape etat-${s.etat}${actif ? ' actif' : ''}${futur ? ' futur' : ''}`}
      onMouseEnter={() => onSurvol(s.id)} onMouseLeave={() => onSurvol(null)}>
      <DateMission s={s} />
      <div className="dp-rail" aria-hidden="true"><span className="dp-point" /></div>
      <article className="dp-mission">
        <header>
          {/* « urgent » en haut à gauche, devant le titre ; statut à droite */}
          <div className="dp-mission-titre">
            {s.priorite === 'urgente' && <span className="badge b-urgent">Urgent</span>}
            {seul
              ? <h3 className="dp-site-titre">{s.site.adresse ?? 'Adresse du site non renseignée'}</h3>
              : <h3><Link to={`/statistiques/services/${s.id}`}>{s.nom}</Link></h3>}
          </div>
          <div className="badges">
            {s.etat === 'planifie' && STATUTS_PLANIF[statut]
              ? <Badge type={`planif-${statut}`}>{STATUTS_PLANIF[statut]}</Badge> : <BadgeEtat etat={s.etat} />}
            {statutOdooNotable(s.odoo?.statut) && <span className="badge b-odoo" title="Statut dans Odoo">
              {statutOdooNotable(s.odoo?.statut)}</span>}</div>
        </header>
        {!seul && <p className="dp-site">{s.site.adresse ?? 'Adresse du site non renseignée'}</p>}
        <LigneOdoo s={s} auj={auj} />
        {alertes.length > 0 && (
          <ul className="dp-alertes">{alertes.map((x) => (
            <li key={x.texte}>{x.texte}
              {x.ou === 'ici' && planifiable(s) && <Link to={lien('reglages')}>Placer le site</Link>}
              {x.ou === 'odoo' && <span className="muet"> (à corriger dans Odoo)</span>}</li>))}
          </ul>
        )}
        <div className="dp-equipe">
          {s.planification.techniciens.length ? s.planification.techniciens.map((x) => (
            <span key={x.matricule} className="dp-tech" title={`${x.nom} : ${x.jours} jour${x.jours > 1 ? 's' : ''}`}>
              <i aria-hidden="true">{initiales(x.nom)}</i>{x.nom}{x.agence && <small>{agence(x.agence)}</small>}</span>))
            : <span className="dp-a-faire">Équipe à planifier{nb > 0 && `, ${nb} technicien${nb > 1 ? 's' : ''} demandé${nb > 1 ? 's' : ''}`}</span>}
          {v && <Link to={`/vehicules/${v.id}`} className="dp-vehicule" title="Fiche du véhicule : conducteurs et PV">
            {plaque ? <Plaque plaque={plaque} /> : <span className="dp-sans-plaque">véhicule {v.id}</span>}
            {(v.modele ?? veh?.modele) && <span className="dp-modele">{v.modele ?? veh?.modele}</span>}
            {mission?.conducteur && <small>conducteur : {mission.conducteur}</small>}</Link>}
        </div>
        <dl className="dp-mesures">
          <div><dt>Heures</dt><dd>{heures(s.realise.heures_passees)} <small>sur {heures(t?.alloue ?? s.prevu.heures)}</small>
            {t?.progression != null && <span className={`dp-barre${t.progression > 100 ? ' depasse' : ''}`}
              title={`En cours : ${t.progression} % (Odoo)`} style={{ '--p': `${Math.min(100, t.progression)}%` } as CSSProperties}><i /></span>}</dd></div>
          <div><dt>Matériel livré</dt><dd>{s.materiel.pct_livre === null ? '—' : `${nombre(s.materiel.pct_livre)} %`}</dd></div>
          <div><dt>CA HT</dt><dd>{euros(s.argent.ca_ht)}</dd></div>
          <div><dt>Marge estimée</dt><dd className={marge < 0 ? 'negatif' : ''}>{euros(marge)}</dd></div>
          <div><dt>Score RSE</dt><dd className="dp-rse"><PastilleNote note={s.rse.note} />
            {s.rse.mode ? <span className="dp-rse-valeur"><IconeMode mode={s.rse.mode} />{co2(s.rse.kg_co2e)}</span>
              : <span className="dp-a-faire">mode à choisir</span>}</dd></div>
        </dl>
        <div className="dp-pied">
          {s.itineraires.map((it) => (
            <a key={it.agence.code} href={it.google} target="_blank" rel="noreferrer" className="dp-itineraire"
              title={`Itinéraire en voiture dans Google Maps (${it.techniciens.join(', ')})`}>
              Itinéraire depuis {it.agence.nom}<small>{[km(it.km), duree(it.heures)].filter(Boolean).join(', ')}</small></a>))}
          {odooIci && <a href={s.odoo_url!} target="_blank" rel="noreferrer" className="dp-planifier">Ouvrir dans Odoo ↗</a>}
          <button type="button" className="dp-deplier" aria-expanded={ouvert} onClick={onBasculer}>
            {ouvert ? 'Masquer le détail' : 'Voir le détail'}</button>
        </div>
        {ouvert && <Carnet s={s} agences={d.agences} ecrire={ecrire} onModifie={onModifie} />}
      </article>
    </li>
  );
}

type OngletCarnet = 'description' | 'temps' | 'sous_taches' | 'argent' | 'materiel' | 'rse';
/** Onglets d'Odoo (Description, Feuilles de temps, Sous-tâches) puis ceux de l'application (pages ajoutées au même
 *  carnet par un module Odoo). */
const ONGLETS_CARNET: { cle: OngletCarnet; libelle: string }[] = [
  { cle: 'description', libelle: 'Description' }, { cle: 'temps', libelle: 'Feuilles de temps' },
  { cle: 'sous_taches', libelle: 'Sous-tâches' }, { cle: 'argent', libelle: 'Argent' },
  { cle: 'materiel', libelle: 'Matériel' }, { cle: 'rse', libelle: 'Déplacement et RSE' },
];

function Carnet({ s, agences, ecrire, onModifie }: {
  s: ServiceDossier; agences: AgenceDepart[]; ecrire: Ecrire; onModifie: () => void;
}) {
  const [onglet, setOnglet] = useState<OngletCarnet>('description');
  const [vus, setVus] = useState<Set<OngletCarnet>>(() => new Set(['description']));
  const id = (o: OngletCarnet) => `dp-${s.id}-${o}`;
  const choisir = (o: OngletCarnet) => { setVus((v) => new Set(v).add(o)); setOnglet(o); };
  const panneau = (o: OngletCarnet, contenu: ReactNode) => (
    <div role="tabpanel" id={id(o)} aria-labelledby={`${id(o)}-onglet`} className="dp-carnet-panneau" hidden={onglet !== o}>
      {vus.has(o) && contenu}</div>
  );
  return (
    <div className="dp-carnet">
      <div className="dp-carnet-onglets" role="tablist" aria-label="Détail du service">
        {ONGLETS_CARNET.map((o, k) => (
          <button key={o.cle} type="button" role="tab" id={`${id(o.cle)}-onglet`} aria-controls={id(o.cle)}
            aria-selected={onglet === o.cle} tabIndex={onglet === o.cle ? 0 : -1} onClick={() => choisir(o.cle)}
            className={k === 3 ? 'dp-carnet-app' : undefined}
            onKeyDown={(e) => {
              const n = e.key === 'ArrowRight' ? (k + 1) % ONGLETS_CARNET.length
                : e.key === 'ArrowLeft' ? (k + ONGLETS_CARNET.length - 1) % ONGLETS_CARNET.length : -1;
              if (n < 0) return;
              e.preventDefault(); choisir(ONGLETS_CARNET[n].cle);
              document.getElementById(`${id(ONGLETS_CARNET[n].cle)}-onglet`)?.focus();
            }}>{o.libelle}</button>
        ))}
      </div>
      {panneau('description', <DescriptionOdoo id={s.id} simule={s.simule} ecrire={ecrire} titre={false} />)}
      {panneau('temps', <FeuillesDeTemps s={s} />)}
      {panneau('sous_taches', <SousTaches s={s} />)}
      {panneau('argent', <Argent s={s} />)}
      {panneau('materiel', <Materiel s={s} />)}
      {panneau('rse', <Deplacement s={s} agences={agences} onModifie={onModifie} />)}
    </div>
  );
}

function FeuillesDeTemps({ s }: { s: ServiceDossier }) {
  const lignes = s.realise.feuilles_de_temps ?? [];
  const t = s.odoo?.temps;
  return (<>
    {lignes.length ? (
      <table className="dp-table">
        <thead><tr><th>Date</th><th>Employé</th><th>Sous-tâche</th><th className="n">Heures</th></tr></thead>
        <tbody>{lignes.map((l) => (
          <tr key={l.id}><td>{l.date ? jourCourt(l.date) : '—'}</td><td>{l.employe ?? '—'}</td><td>{l.sous_tache ?? '—'}</td>
            <td className="n">{heures(l.heures)}</td></tr>))}
        </tbody>
      </table>
    ) : <p className="dp-carnet-vide">Aucune feuille de temps : les heures apparaissent ici dès qu'elles sont saisies dans Odoo.</p>}
    {t && <dl className="dp-temps-resume">
      <div><dt>Temps alloué</dt><dd>{heures(t.alloue)}</dd></div>
      <div><dt>Temps passé</dt><dd>{heures(t.passe)}</dd></div>
      <div><dt>Heures consacrées aux sous-tâches</dt><dd>{heures(t.sous_taches)}</dd></div>
      <div><dt>Total du temps passé</dt><dd>{heures(t.total)}</dd></div>
      <div className={t.restant < 0 ? 'negatif' : ''}><dt>Temps restant</dt><dd>{heures(t.restant)}</dd></div>
      <div><dt>En cours</dt><dd>{t.progression ?? 0} %</dd></div>
    </dl>}
  </>);
}

function SousTaches({ s }: { s: ServiceDossier }) {
  const liste = s.realise.sous_taches.liste;
  if (!liste.length) return <p className="dp-carnet-vide">Pas de sous-tâche dans Odoo.</p>;
  return (
    <table className="dp-table">
      <thead><tr><th>Titre</th><th>Étape</th><th>Assignés</th><th className="n">Heures</th><th className="n">Échéance</th></tr></thead>
      <tbody>{liste.map((x) => (
        <tr key={x.id} className={x.terminee ? 'faite' : ''}>
          <td><span className="dp-coche" aria-label={x.terminee ? 'terminée' : 'à faire'} />{x.nom}
            {x.statut && x.statut !== '01_in_progress' && ETATS_TACHE[x.statut] && <small> {ETATS_TACHE[x.statut]}</small>}</td>
          <td>{x.etape ?? '—'}</td><td>{x.assignes?.length ? x.assignes.join(', ') : '—'}</td>
          <td className="n">{heures(x.heures_passees ?? 0)}{x.heures_allouees ? ` / ${heures(x.heures_allouees)}` : ''}</td>
          <td className="n">{x.echeance ? jj(x.echeance) : '—'}</td></tr>))}
      </tbody>
    </table>
  );
}

/** Coûts estimés (barres) et facturation : commandes, factures et avoirs, totaux. CA et marge : sur la carte. */
function Argent({ s }: { s: ServiceDossier }) {
  const a = s.argent, c = s.couts_estimes;
  const max = Math.max(c.travail, c.route, c.vehicule, a.cout_materiel, 1);
  return (
    <div className="dp-argent">
      <section>
        <h4>Coûts estimés <span>{euros(a.cout_materiel + c.total)}</span></h4>
        <div className="sf-couts">
          <span>Matériel</span><Barre valeur={a.cout_materiel} max={max} texte={euros(a.cout_materiel)} />
          <span>Travail <small>{heures(c.heures_travail)}</small></span><Barre valeur={c.travail} max={max} texte={euros(c.travail)} />
          <span>Route</span><Barre valeur={c.route} max={max} texte={euros(c.route)} />
          <span>Véhicule</span><Barre valeur={c.vehicule} max={max} texte={euros(c.vehicule)} />
        </div>
        <p className="sf-note">Heures {c.base_heures === 'passees' ? 'passées' : 'prévues'} × {euros(c.cout_horaire_moyen, true)}/h
          {c.cout_km !== null && <>, véhicule {euros(c.cout_km, true)}/km</>}. {c.hors ? `${c.hors.charAt(0).toUpperCase()}${c.hors.slice(1)} non comptés.` : ''}</p>
      </section>
      <section>
        <h4>Facturation <span>{a.statut_facturation_libelle ?? LIBELLES_FACTURATION[a.statut_facturation ?? ''] ?? 'non renseignée'}</span></h4>
        {a.commandes.length > 0 && <table className="dp-table">
          <thead><tr><th>Commande</th><th className="n">Montant HT</th><th className="n">Marge</th><th>Facturation</th></tr></thead>
          <tbody>{a.commandes.map((x) => (
            <tr key={x.id}><td><strong>{x.nom}</strong></td><td className="n">{euros(x.montant_ht, true)}</td>
              <td className="n">{x.marge === null ? '—' : euros(x.marge, true)}</td>
              <td>{LIBELLES_FACTURATION[x.facturation ?? ''] ?? x.facturation ?? '—'}</td></tr>))}</tbody>
        </table>}
        {a.factures.length > 0 && <table className="dp-table">
          <thead><tr><th>Facture ou avoir</th><th>Date</th><th className="n">Montant HT</th><th>Paiement</th><th className="n">Reste à payer</th></tr></thead>
          <tbody>{a.factures.map((x) => (
            <tr key={x.id}><td><strong>{x.nom}</strong> <small>{x.type}</small></td><td>{x.date ? jourCourt(x.date) : '—'}</td>
              <td className="n">{euros(x.montant_ht, true)}</td><td>{LIBELLES_PAIEMENT[x.paiement ?? ''] ?? x.paiement ?? '—'}</td>
              <td className="n">{euros(x.reste_a_payer, true)}</td></tr>))}</tbody>
        </table>}
        {!a.commandes.length && <p className="dp-carnet-vide">Sans commande : rien à facturer dans Odoo.</p>}
        {a.commandes.length > 0 && <dl className="dp-temps-resume">
          <div><dt>Facturé HT</dt><dd>{euros(a.facture_ht, true)}</dd></div>
          <div><dt>Reste à facturer</dt><dd>{euros(a.reste_a_facturer_ht, true)}</dd></div>
          {a.factures.length > 0 && <div><dt>Net (factures − avoirs)</dt><dd>{euros(a.factures_net_ht, true)}</dd></div>}
          <div><dt>Reste à payer</dt><dd>{euros(a.reste_a_payer, true)}</dd></div>
          <div className={a.marge_materiel < 0 ? 'negatif' : ''}><dt>Marge matériel</dt><dd>{euros(a.marge_materiel, true)}</dd></div>
        </dl>}
      </section>
    </div>
  );
}

function Materiel({ s }: { s: ServiceDossier }) {
  const m = s.materiel;
  return (<>
    {m.lignes.length ? <div className="defilement"><table className="dp-table">
      <thead><tr><th>Produit</th><th className="n">Qté</th><th className="n">Livré</th><th className="n">Facturé</th>
        <th className="n">Prix unit.</th><th className="n">Total HT</th><th className="n">Coût</th><th className="n">Marge</th></tr></thead>
      <tbody>{m.lignes.map((l) => (
        <tr key={l.id}><td>{l.produit}{l.commande && <small> {l.commande}</small>}</td><td className="n">{nombre(l.quantite)}</td>
          <td className="n">{nombre(l.livre)}</td><td className="n">{nombre(l.facture)}</td><td className="n">{euros(l.prix_unitaire, true)}</td>
          <td className="n">{euros(l.sous_total_ht, true)}</td><td className="n">{euros(l.cout_total, true)}</td>
          <td className={`n${l.marge < 0 ? ' negatif' : ''}`}>{euros(l.marge, true)}</td></tr>))}</tbody>
    </table></div> : <p className="dp-carnet-vide">Aucun matériel rattaché à ce service.</p>}
    {m.livraisons.length > 0 && <ul className="dp-livraisons">{m.livraisons.map((x) => (
      <li key={x.nom}><strong>{x.nom}</strong> {LIBELLES_LIVRAISON[x.etat ?? ''] ?? x.etat ?? '—'}
        {x.faite ? `, le ${jj(x.faite)}` : x.prevue ? `, prévue le ${jj(x.prevue)}` : ''}
        {x.transporteur && <> · {x.transporteur}</>}
        {x.suivi && <> · suivi {x.suivi_url ? <a href={x.suivi_url} target="_blank" rel="noreferrer">{x.suivi}</a> : x.suivi}</>}</li>))}
    </ul>}
  </>);
}

/** Score RSE de la mission (même bandeau que le dossier), puis d'où il vient : trajets de l'équipe sur un rail
 *  agence → site (mêmes repères que la carte), mode de déplacement (celui du véhicule affecté ; il se change avec le
 *  véhicule, dans la planification), alertes, et le calcul détaillé à la demande. */
function Deplacement({ s, agences, onModifie }: { s: ServiceDossier; agences: AgenceDepart[]; onModifie: () => void }) {
  const p = s.planification, r = s.rse;
  const lienVehicule = planifiable(s) ? lienPlanification(s.id, p.debut, s.prevu.debut, null) : undefined;
  const vers = villeDe(s.site.adresse) ?? 'Site';
  return (
    <div className="dp-deplacement">
      <BilanMission r={r} />
      <div className="dp-dep-grille">
        <section className="dp-dep-bloc" aria-labelledby={`dp-trajets-${s.id}`}>
          <h4 id={`dp-trajets-${s.id}`}>Trajets de l'équipe</h4>
          {p.techniciens.length ? <ul className="dp-trajets">{p.techniciens.map((x) => {
            const tr = p.trajet.par_technicien.find((y) => y.matricule === x.matricule);
            const depuis = agences.find((a) => a.code === x.agence)?.nom ?? x.agence ?? 'Agence';
            const ar = tr?.km != null && tr.km_aller ? Math.max(1, Math.round(tr.km / (2 * tr.km_aller))) : null;
            return (
              <li key={x.matricule} className="dp-trajet">
                <p className="dp-trajet-qui"><i aria-hidden="true">{initiales(x.nom)}</i><strong>{x.nom}</strong>
                  <span>{x.jours} jour{x.jours > 1 ? 's' : ''} sur site</span></p>
                {tr?.km != null ? <>
                  <p className="dp-trajet-route" aria-label={`De ${depuis} à ${vers} : ${nombre(tr.km_aller ?? 0)} km`}>
                    <span className="dp-trajet-de"><i aria-hidden="true" />{depuis}</span>
                    <span className="dp-trajet-rail" aria-hidden="true"><b>{nombre(tr.km_aller ?? 0)} km</b></span>
                    <span className="dp-trajet-vers"><i aria-hidden="true" />{vers}</span></p>
                  <p className="dp-trajet-total">{ar && <>{ar} aller{ar > 1 ? 's' : ''}-retour{ar > 1 ? 's' : ''}
                    {tr.grand_deplacement ? ' (grand déplacement, nuits sur place)' : ar > 1 ? ', un par jour' : ''} · </>}
                    <strong>{nombre(tr.km)} km</strong> · {heures(tr.heures_route)} de route</p></>
                  : <p className="dp-trajet-total muet">{tr?.cause ?? 'Trajet inconnu'}</p>}
              </li>
            );
          })}</ul> : <p className="dp-dep-vide">Équipe à planifier : pas encore de trajet.</p>}
        </section>
        <section className="dp-dep-bloc" aria-labelledby={`dp-mode-${s.id}`}>
          <h4 id={`dp-mode-${s.id}`}>Mode de déplacement</h4>
          <ChoixMode serviceId={s.id} r={r} onChange={onModifie} lienVehicule={lienVehicule}
            modele={p.vehicule?.modele ?? null} />
        </section>
      </div>
      {r.alertes.map((a) => <p key={a} className="rs-alerte">{a}</p>)}
      {r.detail.length > 0 && (
        <details className="rs-calcul">
          <summary>Voir le calcul</summary>
          <ul>{r.detail.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function Missions({ d, actif, ouverts, basculer, ecrire, onSurvol, onModifie }: {
  d: Dossier; actif: number | null; ouverts: Set<number>; basculer: (id: number) => void; ecrire: Ecrire;
  onSurvol: (id: number | null) => void; onModifie: () => void;
}) {
  const auj = aujourdhui();
  const dates = d.services.filter((s) => debutDe(s));
  const sansDate = d.services.filter((s) => !debutDe(s));
  const aVenir = dates.findIndex((s) => (debutDe(s) ?? '') >= auj);
  const repere = <li key="aujourdhui" className="dp-aujourdhui"><span>Aujourd'hui, {jourCourt(auj)}</span></li>;
  const ligne = (s: ServiceDossier, futur: boolean) => (
    <Mission key={s.id} s={s} d={d} ouvert={ouverts.has(s.id)} actif={actif === s.id} futur={futur} ecrire={ecrire}
      onBasculer={() => basculer(s.id)} onSurvol={onSurvol} onModifie={onModifie} />
  );
  return (
    <section className="carte dp-missions">
      <div className="dp-titre-bloc"><h2>Missions</h2>
        <span className="muet">{d.services.length} service{d.services.length > 1 ? 's' : ''} sur site, dans l'ordre des dates</span></div>
      <ol className="dp-spine">
        {dates.map((s, i) => (
          <Fragment key={s.id}>{i === aVenir && repere}{ligne(s, aVenir !== -1 && i >= aVenir)}</Fragment>))}
        {aVenir === -1 && dates.length > 0 && repere}
        {sansDate.map((s) => ligne(s, true))}
      </ol>
      {d.services.length === 0 && <p className="vide">Aucune intervention sur site dans ce dossier.</p>}
    </section>
  );
}

/** Pièces jointes des commandes du dossier (lues dans Odoo à l'ouverture, consultation journalisée). */
function Documents({ d, pieces }: { d: Dossier; pieces: Pieces }) {
  const commandes = new Map(d.resume.commandes.map((c) => [c.id, c]));
  const ids = [...new Set([...d.resume.commandes.map((c) => c.id), ...d.documents.map((x) => x.commande_id)])];
  const pj = new Map(d.documents.map((x) => [x.commande_id, x]));
  if (!ids.length) return null;
  return (
    <section className="carte dp-bloc">
      <h2>Pièces jointes des commandes</h2>
      {!d.documents_disponibles && <p className="avertissement">Pièces jointes indisponibles : Odoo injoignable.</p>}
      {ids.map((cid) => {
        const c = commandes.get(cid), x = pj.get(cid);
        return (
          <div key={cid} className="dp-commande">
            <div className="dp-commande-tete"><strong>{c?.nom ?? x?.commande}</strong></div>
            {x ? <ListePieces liste={x.pieces} pieces={pieces} />
              : d.documents_disponibles && <p className="fv-sans-piece">Aucune pièce jointe dans Odoo.</p>}
          </div>
        );
      })}
      {pieces.erreur && <p className="erreur">{pieces.erreur}</p>}
    </section>
  );
}

// ---------- page ----------

const TYPES: TypeDossier[] = ['commande', 'intervention'];

export default function DossierProjet() {
  const params = useParams();
  const type = (TYPES.includes(params.type as TypeDossier) ? params.type : 'commande') as TypeDossier;
  const id = Number(params.id);
  const charge = useDonnees(() => dossiers.dossier(type, id), [type, id]);
  const piecesCommandes = usePieces((aid) => dossiers.piece(type, id, aid));
  const { ecrire, dialogue } = useEcriture();
  const [ouverts, setOuverts] = useState<Set<number>>(new Set());
  const [actif, setActif] = useState<number | null>(null);
  const d = charge.donnees;
  const seul = d && d.services.length === 1 ? d.services[0].id : null;
  useEffect(() => { if (seul !== null) setOuverts(new Set([seul])); }, [seul]);   // un seul service : détail ouvert

  const basculer = (sid: number) => setOuverts((o) => {
    const n = new Set(o);
    if (n.has(sid)) n.delete(sid); else n.add(sid);
    return n;
  });
  const allerA = (sid: number) => {
    setOuverts((o) => new Set(o).add(sid));
    window.setTimeout(() => document.getElementById(`mission-${sid}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };

  if (!d) return <EtatChargement chargement={charge.chargement} erreur={charge.erreur} />;
  const plusieurs = d.services.length > 1;
  return (
    <div className="dp">
      <Avertissements liste={d.avertissements} />
      <Tete d={d} actif={actif}
        onSite={(s) => allerA([...s.services].sort((a, b) => (debutDe(a) ?? '9').localeCompare(debutDe(b) ?? '9'))[0].id)} />
      {plusieurs && <Equation d={d} />}
      {plusieurs && <BandeauRse b={d.resume.rse} />}
      <Missions d={d} actif={actif} ouverts={ouverts} basculer={basculer} ecrire={ecrire} onSurvol={setActif}
        onModifie={charge.recharger} />
      <Documents d={d} pieces={piecesCommandes} />
      {piecesCommandes.dialogue}
      {dialogue}
    </div>
  );
}
