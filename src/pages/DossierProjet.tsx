// Dossier d'intervention (une commande client et ses services sur site, ou un service sans commande), tout au même
// endroit. Tête bleu nuit : client, commande, avancement, prochaine intervention, équipe et véhicules. Corps : les
// missions dans l'ordre des dates (une carte par service sur site, avec ce que montre Odoo : étape, modèle de feuille
// de travail, assignés, jalon, étiquettes, activité suivante, temps et avancement ; dans le détail, les onglets du
// formulaire Odoo « Description », « Feuilles de temps », « Sous-tâches », puis rapport, argent, matériel et
// déplacement). Colonne de droite : carte des sites et des agences de départ, départs, véhicules, commandes et pièces.
// Mêmes libellés et mêmes calculs qu'Odoo : chaque bloc correspond à un champ ou un widget du formulaire Odoo (voir le
// plan, « intégration dans Odoo »). Lecture seule ; description et pièces lues dans Odoo à l'affichage, journalisées.
import L from 'leaflet';
import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, ZoomControl } from 'react-leaflet';
import { Link, useParams } from 'react-router-dom';
import { aujourdhui } from '../api';
import { Avertissements, EtatChargement, initiales, useDonnees } from '../composants';
import { BoutonExport } from '../composants/BoutonExport';
import DescriptionOdoo from '../composants/DescriptionOdoo';
import { useEcriture } from '../composants/Ecriture';
import { ListePieces, usePieces, type Pieces } from '../composants/Pieces';
import { BandeauRse, ChoixMode, DetailRse, IconeMode, PastilleNote } from '../composants/Rse';
import { BadgeEtat } from '../composants/Statistiques';
import { Plaque } from '../composants/Vehicule';
import { dossiers, type Dossier, type Itineraire, type ServiceDossier } from '../dossiers';
import { exportations, nomFichier } from '../exports';
import { co2 } from '../rse';
import { euros, heures, LIBELLES_ETAT, LIBELLES_FACTURATION, LIBELLES_LIVRAISON, nombre, titreDossier, type ActiviteOdoo,
  type EtatService, type TypeDossier } from '../statistiques';

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
/** « 2026-11-17T15:00:00+01:00 » -> « mar. 17 nov., 15:00 » (heure de Paris, déjà dans la chaîne). */
const jourHeure = (iso: string) => `${jourCourt(iso)}${iso.length > 10 ? `, ${iso.slice(11, 16)}` : ''}`;
/** Échéance d'une activité, comme Odoo : « aujourd'hui », « demain », « dans 3 jours », « 2 jours de retard ». */
function quand(echeance: string | null, auj: string): string {
  if (!echeance) return 'sans échéance';
  const n = Math.round((date(echeance).getTime() - date(auj).getTime()) / 86_400_000);
  if (n === 0) return "aujourd'hui";
  if (n === 1) return 'demain';
  if (n === -1) return 'hier';
  return n > 1 ? `dans ${n} jours` : `${-n} jours de retard`;
}

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

function Cadrage({ points }: { points: Point[] }) {
  const map = useMap();
  const cle = points.map((p) => p.join(',')).join(';');
  useEffect(() => {
    if (!points.length) return;
    const limites = points.length === 1 ? L.latLng(points[0]).toBounds(6000) : L.latLngBounds(points);
    map.fitBounds(limites, { padding: [36, 36], maxZoom: 13 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, map]);
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

function Carte({ d, actif, onSite }: { d: Dossier; actif: number | null; onSite: (s: Site) => void }) {
  const { sites, trajets } = useMemo(() => geographie(d), [d]);
  const points = [...sites.map((s) => s.position), ...trajets.map((t) => t.depart)];
  const agences = regrouperAgences(trajets);
  if (!points.length) return <div className="dp-carte dp-carte-vide">Aucun site géolocalisé pour ce dossier.</div>;
  return (
    <MapContainer bounds={L.latLngBounds(points)} className="dp-carte" zoomControl={false} scrollWheelZoom={false}>
      <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
      <ZoomControl position="topright" />
      <Cadrage points={points} />
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

// ---------- tête du dossier ----------

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

/** Un seul service : avancement d'Odoo (« En cours » : temps passé sur temps alloué, sous-tâches comprises). */
function AnneauOdoo({ s }: { s: ServiceDossier }) {
  const t = s.odoo?.temps;
  const pct = t?.progression ?? 0;
  const R = 30, C = 2 * Math.PI * R;
  return (
    <div className="dp-anneau">
      <svg viewBox="0 0 76 76" width="76" height="76" role="img" aria-label={`En cours : ${pct} %`}>
        <circle cx="38" cy="38" r={R} className="dp-anneau-fond" />
        {pct > 0 && <circle cx="38" cy="38" r={R} className={`dp-seg ${pct > 100 ? 'e-en_retard' : 'e-planifie'}`}
          transform="rotate(-90 38 38)" strokeDasharray={`${(C * Math.min(100, pct)) / 100} ${C}`} />}
        <text x="38" y="43" textAnchor="middle" className="dp-anneau-pct">{nombre(pct)} %</text>
      </svg>
      <div>
        <p className="dp-anneau-titre">En cours</p>
        <ul className="dp-anneau-legende">
          <li>{t ? `${heures(t.total)} passées sur ${heures(t.alloue)}` : `${heures(s.realise.heures_passees)} passées`}</li>
          {t && <li>Temps restant : {heures(t.restant)}</li>}
        </ul>
      </div>
    </div>
  );
}

/** Toute l'équipe du dossier (techniciens planifiés sur ses interventions) et ses véhicules. */
function Equipe({ d }: { d: Dossier }) {
  const techs = new Map<string, string>();
  d.services.forEach((s) => s.planification.techniciens.forEach((t) => techs.set(t.matricule, t.nom)));
  const noms = [...techs.values()].sort((a, b) => a.localeCompare(b));
  return (
    <div className="dp-ident-equipe">
      <div>
        <span className="dp-ident-label">{noms.length ? `Équipe, ${noms.length} technicien${noms.length > 1 ? 's' : ''}` : 'Équipe'}</span>
        {noms.length ? <div className="dp-avatars">{noms.slice(0, 7).map((n) => <i key={n} title={n}>{initiales(n)}</i>)}
          {noms.length > 7 && <i title={noms.slice(7).join(', ')}>+{noms.length - 7}</i>}</div>
          : <span className="dp-tete-vide">à planifier</span>}
      </div>
      <div>
        <span className="dp-ident-label">Véhicule{d.vehicules.length > 1 ? 's' : ''}</span>
        {d.vehicules.length ? <div className="dp-ident-plaques">{d.vehicules.map((v) => (
          <Link key={v.vehicle_id} to={`/vehicules/${v.vehicle_id}`} title="Fiche du véhicule">
            {v.plaque ? <Plaque plaque={v.plaque} /> : <span className="dp-sans-plaque">véhicule {v.vehicle_id}</span>}
            {v.modele && <span className="dp-modele">{v.modele}</span>}</Link>))}
        </div> : <span className="dp-tete-vide">aucun</span>}
      </div>
    </div>
  );
}

function Tete({ d }: { d: Dossier }) {
  const p = d.dossier, r = d.resume, c = p.commande;
  const seul = d.services.length === 1 ? d.services[0] : null;
  const faits: [string, ReactNode][] = [];
  if (p.type === 'commande') {
    faits.push(['Commande', p.nom]);
    if (c?.date) faits.push(['Date de commande', jourCourt(c.date)]);
    if (c && c.montant_ht !== null) faits.push(['Montant', `${euros(c.montant_ht)} HT`]);
    if (c?.type_service) faits.push(['Type de service', c.type_service]);
    if (!seul) faits.push(['Services sur site', String(d.services.length)]);
  } else faits.push(['Commande', 'Non facturable (sans commande)']);
  if (seul?.odoo?.etape) {
    faits.push(['Étape', <>{seul.odoo.etape}{seul.odoo.etape_depuis && <small> depuis le {jj(seul.odoo.etape_depuis)}</small>}</>]);
  }
  if (seul?.prevu.debut) {
    faits.push(['Date prévue', seul.prevu.fin && seul.prevu.fin.slice(0, 10) !== seul.prevu.debut.slice(0, 10)
      ? `${jourHeure(seul.prevu.debut)} → ${jourHeure(seul.prevu.fin)}` : jourHeure(seul.prevu.debut)]);
  }
  return (
    <header className="dp-tete">
      <div className="dp-tete-haut">
        <div className="dp-tete-titre">
          <Link to="/dossiers" className="dp-retour">‹ Dossiers d'intervention</Link>
          <p className="dp-client">{p.client ?? 'Client non renseigné'}{p.simule && <span className="dp-simule">simulé</span>}</p>
          <h1>{titreDossier(r)}</h1>
          <dl className="dp-ident-faits">{faits.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        </div>
        <div className="dp-actions">
          <BoutonExport className="dp-odoo" libelle="Exporter (.xlsx)" nomFichier={nomFichier('dossier', p.nom)}
            lire={() => exportations.dossier(p.type, p.id)} />
          {p.odoo_url && <a className="dp-odoo" href={p.odoo_url} target="_blank" rel="noreferrer">Ouvrir dans Odoo ↗</a>}
        </div>
      </div>
      <div className="dp-tete-bas">
        {seul ? <AnneauOdoo s={seul} /> : <Anneau d={d} />}
        <p className="dp-prochaine">{r.prochaine_intervention
          ? <>Prochaine intervention<strong>{date(r.prochaine_intervention).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</strong></>
          : <>Prochaine intervention<strong>aucune à venir</strong></>}</p>
        <Equipe d={d} />
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

/** « Activité suivante » de la liste Odoo : type, échéance relative, assigné ; couleur d'Odoo (retard, jour, prévue). */
function Activite({ a, auj }: { a: ActiviteOdoo; auj: string }) {
  return (
    <li className={`dp-activite ${a.etat}`} title={`Activité suivante (Odoo)${a.echeance ? `, échéance le ${jj(a.echeance)}` : ''}`}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M5 6.5h6M5 9.5h4" /></svg>
      <strong>{a.type ?? 'Activité'}</strong><span>{quand(a.echeance, auj)}</span>{a.assigne && <span>· {a.assigne}</span>}
    </li>
  );
}

/** Ce que montre la liste Odoo du service : étape, modèle de feuille de travail, assignés, jalon, étiquettes, activités. */
function LigneOdoo({ s, auj }: { s: ServiceDossier; auj: string }) {
  const o = s.odoo;
  if (!o) return null;
  return (
    <ul className="dp-odoo-ligne" aria-label="Dans Odoo">
      {o.etape && <li className="dp-odoo-etape" title={o.etape_depuis ? `Dernière mise à jour de l'étape : ${jj(o.etape_depuis)}` : 'Étape'}>
        <span>Étape</span><strong>{o.etape}</strong></li>}
      {o.feuille_modele && <li title="Modèle de feuille de travail"><span>Feuille</span>{o.feuille_modele}</li>}
      {o.assignes.length > 0 && <li title="Assignés dans Odoo"><span>Assignés</span>{o.assignes.join(', ')}</li>}
      {o.jalon && <li title="Jalon"><span>Jalon</span>{o.jalon}</li>}
      {o.etiquettes.map((e) => <li key={e} className="dp-odoo-etiquette">{e}</li>)}
      {o.activites.map((a) => <Activite key={a.id} a={a} auj={auj} />)}
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
  const st = s.realise.sous_taches;
  const t = s.odoo?.temps;
  const auj = aujourdhui();
  return (
    <li id={`mission-${s.id}`} className={`dp-etape etat-${s.etat}${actif ? ' actif' : ''}${futur ? ' futur' : ''}`}
      onMouseEnter={() => onSurvol(s.id)} onMouseLeave={() => onSurvol(null)}>
      <DateMission s={s} />
      <div className="dp-rail" aria-hidden="true"><span className="dp-point" /></div>
      <article className="dp-mission">
        <header>
          <h3><Link to={`/statistiques/services/${s.id}`}>{s.nom}</Link>
            {st.total > 0 && <span className="dp-sous-compte"> ({st.terminees}/{st.total} sous-tâche{st.total > 1 ? 's' : ''})</span>}</h3>
          <div className="badges"><BadgeEtat etat={s.etat} />
            {s.priorite === 'urgente' && <span className="badge b-urgent">urgent</span>}</div>
        </header>
        <p className="dp-site">{s.site.adresse ?? 'Adresse du site non renseignée'}</p>
        <LigneOdoo s={s} auj={auj} />
        <div className="dp-equipe">
          {s.planification.techniciens.length ? s.planification.techniciens.map((x) => (
            <span key={x.matricule} className="dp-tech" title={`${x.nom} : ${x.jours} jour${x.jours > 1 ? 's' : ''}`}>
              <i aria-hidden="true">{initiales(x.nom)}</i>{x.nom}{x.agence && <small>{agence(x.agence)}</small>}</span>))
            : <span className="dp-a-faire">Équipe à planifier</span>}
          {v && <Link to={`/vehicules/${v.id}`} className="dp-vehicule" title="Fiche du véhicule">
            {plaque ? <Plaque plaque={plaque} /> : <span className="dp-sans-plaque">véhicule {v.id}</span>}
            {(v.modele ?? veh?.modele) && <span className="dp-modele">{v.modele ?? veh?.modele}</span>}
            {mission?.conducteur && <small>conducteur : {mission.conducteur}</small>}</Link>}
        </div>
        <dl className="dp-mesures">
          <div><dt>Heures</dt><dd>{heures(s.realise.heures_passees)} <small>sur {heures(t?.alloue ?? s.prevu.heures)}</small>
            {t?.progression != null && <span className={`dp-barre${t.progression > 100 ? ' depasse' : ''}`}
              title={`En cours : ${t.progression} % (Odoo)`} style={{ '--p': `${Math.min(100, t.progression)}%` } as CSSProperties}><i /></span>}
            {t && <small className="dp-restant">{t.progression ?? 0} %, reste {heures(t.restant)}</small>}</dd></div>
          <div><dt>Matériel livré</dt><dd>{s.materiel.pct_livre === null ? '—' : `${nombre(s.materiel.pct_livre)} %`}</dd></div>
          <div><dt>CA HT</dt><dd>{euros(s.argent.ca_ht)}</dd></div>
          <div><dt>Marge estimée</dt><dd className={marge < 0 ? 'negatif' : ''}>{euros(marge)}</dd></div>
          <div><dt>Score RSE</dt><dd className="dp-rse"><PastilleNote note={s.rse.note} />
            {s.rse.mode ? <span className="dp-rse-valeur"><IconeMode mode={s.rse.mode} />{co2(s.rse.kg_co2e)}</span>
              : <button type="button" className="dp-lien" onClick={ouvert ? undefined : onBasculer}>mode à choisir</button>}</dd></div>
        </dl>
        <div className="dp-pied">
          {s.itineraires.map((it) => (
            <a key={it.agence.code} href={it.google} target="_blank" rel="noreferrer" className="dp-itineraire"
              title={`Itinéraire en voiture dans Google Maps (${it.techniciens.join(', ')})`}>
              Itinéraire depuis {it.agence.nom}<small>{[km(it.km), duree(it.heures)].filter(Boolean).join(', ')}</small></a>))}
          <button type="button" className="dp-deplier" aria-expanded={ouvert} onClick={onBasculer}>
            {ouvert ? 'Masquer le détail' : 'Voir le détail'}</button>
        </div>
        {ouvert && <DetailMission s={s} ecrire={ecrire} onModifie={onModifie} />}
      </article>
    </li>
  );
}

type OngletOdoo = 'description' | 'temps' | 'sous_taches';

/** Onglets du formulaire Odoo du service, dans le même ordre et sous les mêmes noms. */
function CarnetOdoo({ s, ecrire }: { s: ServiceDossier; ecrire: Ecrire }) {
  const [onglet, setOnglet] = useState<OngletOdoo>('description');
  const [vus, setVus] = useState<Set<OngletOdoo>>(() => new Set(['description']));
  const lignes = s.realise.feuilles_de_temps ?? [];
  const st = s.realise.sous_taches;
  const t = s.odoo?.temps;
  const onglets: { cle: OngletOdoo; libelle: string; compte?: string }[] = [
    { cle: 'description', libelle: 'Description' },
    { cle: 'temps', libelle: 'Feuilles de temps', compte: lignes.length ? String(lignes.length) : undefined },
    { cle: 'sous_taches', libelle: 'Sous-tâches', compte: st.total ? `${st.terminees}/${st.total}` : undefined },
  ];
  const id = (o: OngletOdoo) => `dp-${s.id}-${o}`;
  const choisir = (o: OngletOdoo) => { setVus((v) => new Set(v).add(o)); setOnglet(o); };
  return (
    <div className="dp-carnet">
      <div className="dp-carnet-onglets" role="tablist" aria-label="Formulaire Odoo du service">
        {onglets.map((o) => (
          <button key={o.cle} type="button" role="tab" id={`${id(o.cle)}-onglet`} aria-controls={id(o.cle)}
            aria-selected={onglet === o.cle} tabIndex={onglet === o.cle ? 0 : -1} onClick={() => choisir(o.cle)}
            onKeyDown={(e) => {
              const k = onglets.findIndex((x) => x.cle === onglet);
              const n = e.key === 'ArrowRight' ? (k + 1) % onglets.length : e.key === 'ArrowLeft' ? (k + onglets.length - 1) % onglets.length : -1;
              if (n < 0) return;
              e.preventDefault(); choisir(onglets[n].cle); document.getElementById(`${id(onglets[n].cle)}-onglet`)?.focus();
            }}>
            {o.libelle}{o.compte && <span className="dp-carnet-compte">{o.compte}</span>}</button>
        ))}
      </div>
      <div role="tabpanel" id={id('description')} aria-labelledby={`${id('description')}-onglet`} className="dp-carnet-panneau"
           hidden={onglet !== 'description'}>
        {vus.has('description') && <DescriptionOdoo id={s.id} simule={s.simule} ecrire={ecrire} titre={false} />}
      </div>
      <div role="tabpanel" id={id('temps')} aria-labelledby={`${id('temps')}-onglet`} className="dp-carnet-panneau"
           hidden={onglet !== 'temps'}>
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
        </dl>}
      </div>
      <div role="tabpanel" id={id('sous_taches')} aria-labelledby={`${id('sous_taches')}-onglet`} className="dp-carnet-panneau"
           hidden={onglet !== 'sous_taches'}>
        {st.liste.length ? (
          <table className="dp-table">
            <thead><tr><th>Titre</th><th>Étape</th><th>Assignés</th><th className="n">Heures</th><th className="n">Échéance</th></tr></thead>
            <tbody>{st.liste.map((x) => (
              <tr key={x.id} className={x.terminee ? 'faite' : ''}>
                <td><span className="dp-coche" aria-label={x.terminee ? 'terminée' : 'à faire'} />{x.nom}
                  {x.statut && x.statut !== '01_in_progress' && ETATS_TACHE[x.statut] && <small> {ETATS_TACHE[x.statut]}</small>}</td>
                <td>{x.etape ?? '—'}</td><td>{x.assignes?.length ? x.assignes.join(', ') : '—'}</td>
                <td className="n">{heures(x.heures_passees ?? 0)}{x.heures_allouees ? ` / ${heures(x.heures_allouees)}` : ''}</td>
                <td className="n">{x.echeance ? jj(x.echeance) : '—'}</td></tr>))}
            </tbody>
          </table>
        ) : <p className="dp-carnet-vide">Pas de sous-tâche dans Odoo.</p>}
      </div>
    </div>
  );
}

function DetailMission({ s, ecrire, onModifie }: { s: ServiceDossier; ecrire: Ecrire; onModifie: () => void }) {
  const c = s.couts_estimes, f = s.realise.feuille;
  return (
    <div className="dp-detail">
      <CarnetOdoo s={s} ecrire={ecrire} />
      <section>
        <h4>Rapport d'intervention</h4>
        <ul className="dp-lignes dp-rapport">
          <li><span>Modèle</span><span>{s.odoo?.feuille_modele ?? (f.modele_id === null ? 'aucune' : 'modèle Odoo')}</span></li>
          <li><span>État</span><span>{f.modele_id === null ? '—' : f.envoyee ? 'signée et envoyée' : f.signee ? 'signée'
            : f.remplie ? 'remplie, non signée' : 'à remplir'}</span></li>
          <li><span>Terminé le</span><span>{s.realise.fait_le ? jourCourt(s.realise.fait_le) : '—'}</span></li>
        </ul>
        {s.realise.par_employe.length > 0 && <ul className="dp-lignes dp-par-employe">{s.realise.par_employe.map((e, i) => (
          <li key={i}><span>{e.nom ?? 'employé'}</span><span>{heures(e.heures)}</span></li>))}</ul>}
      </section>
      <section>
        <h4>Argent</h4>
        <ul className="dp-lignes">
          <li><span>CA HT</span><span>{euros(s.argent.ca_ht)}</span></li>
          <li><span>Matériel (coût)</span><span>− {euros(s.argent.cout_materiel)}</span></li>
          <li><span>Travail, {heures(c.heures_travail)} à {euros(c.cout_horaire_moyen)}</span><span>− {euros(c.travail)}</span></li>
          <li><span>Route</span><span>− {euros(c.route)}</span></li>
          <li><span>Véhicule</span><span>− {euros(c.vehicule)}</span></li>
          <li className="total"><span>Marge estimée</span><span className={c.marge_estimee < 0 ? 'negatif' : ''}>{euros(c.marge_estimee)}</span></li>
        </ul>
        <p className="muet">Facturation : {s.argent.statut_facturation_libelle ?? LIBELLES_FACTURATION[s.argent.statut_facturation ?? '']
          ?? 'non renseignée'}{s.argent.factures.length > 0 && `, ${s.argent.factures.length} facture${s.argent.factures.length > 1 ? 's' : ''}`}</p>
      </section>
      <section>
        <h4>Matériel</h4>
        {s.materiel.lignes.length ? <ul className="dp-lignes">{s.materiel.lignes.map((l) => (
          <li key={l.id}><span>{l.produit}</span><span>{nombre(l.livre)} / {nombre(l.quantite)} livré{l.quantite > 1 ? 's' : ''}</span></li>))}
        </ul> : <p className="muet">Pas de matériel.</p>}
        {s.materiel.livraisons.map((l) => (
          <p key={l.nom} className="muet">{l.transporteur ? `${l.transporteur} ` : ''}{l.nom} : {LIBELLES_LIVRAISON[l.etat ?? ''] ?? l.etat ?? '—'}
            {l.suivi && <>, suivi {l.suivi_url ? <a href={l.suivi_url} target="_blank" rel="noreferrer">{l.suivi}</a> : l.suivi}</>}</p>))}
      </section>
      <section className="dp-deplacement">
        <h4>Déplacement et score RSE{s.rse.mode_libelle && <span>{s.rse.mode_libelle}, {co2(s.rse.kg_co2e)}</span>}</h4>
        <ChoixMode serviceId={s.id} r={s.rse} onChange={onModifie} />
        <DetailRse r={s.rse} />
      </section>
      <Link to={`/statistiques/services/${s.id}`} className="dp-fiche">Fiche complète du service</Link>
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

// ---------- colonne de droite ----------

function SitesEtDeparts({ d, actif, onSite }: { d: Dossier; actif: number | null; onSite: (s: Site) => void }) {
  const geo = useMemo(() => geographie(d), [d]);
  return (
    <section className="carte dp-bloc dp-bloc-carte">
      <h2>Sites et agences de départ</h2>
      <Carte d={d} actif={actif} onSite={onSite} />
      <div className="dp-legende" aria-hidden="true">
        <span><i className="dp-leg-agence" />agence</span>
        <span><i className="dp-leg-site" />site (missions)</span>
        <span><i className="dp-leg-trajet" />trajet</span>
        {geo.sansPosition > 0 && <span>{geo.sansPosition} sans position</span>}
      </div>
    </section>
  );
}

function Departs({ d }: { d: Dossier }) {
  const parAgence = new Map<string, { nom: string; techniciens: Set<string>; trajets: Map<string, { ville: string | null; it: Itineraire }> }>();
  for (const s of d.services) {
    for (const it of s.itineraires) {
      const a = parAgence.get(it.agence.code) ?? { nom: it.agence.nom, techniciens: new Set<string>(), trajets: new Map() };
      it.techniciens.forEach((t) => a.techniciens.add(t));
      const cle = s.site.adresse ?? String(s.id);
      if (!a.trajets.has(cle)) a.trajets.set(cle, { ville: villeDe(s.site.adresse), it });
      parAgence.set(it.agence.code, a);
    }
  }
  const volOiseau = d.services.some((s) => s.itineraires.some((i) => i.source === 'vol_oiseau'));
  return (
    <section className="carte dp-bloc">
      <h2>Départs</h2>
      {parAgence.size === 0 && <p className="vide">Aucun technicien planifié : pas encore de départ.</p>}
      {[...parAgence.entries()].map(([code, a]) => (
        <div key={code} className="dp-depart">
          <div className="dp-depart-tete"><span className="dp-carre" aria-hidden="true">{a.nom.slice(0, 1)}</span>
            <div><strong>Agence {a.nom}</strong><small>{[...a.techniciens].join(', ')}</small></div></div>
          <ul>{[...a.trajets.values()].map(({ ville, it }) => (
            <li key={it.google}>
              <span className="dp-vers">vers {ville ?? 'le site'}<small>{[km(it.km), duree(it.heures)].filter(Boolean).join(', ') || 'distance inconnue'}</small></span>
              <a href={it.google} target="_blank" rel="noreferrer" className="btn btn-petit">Google Maps</a>
            </li>))}</ul>
        </div>
      ))}
      {parAgence.size > 0 && <p className="dp-note">{volOiseau
        ? "Distances et durées estimées à vol d'oiseau ; l'itinéraire exact s'ouvre dans Google Maps."
        : "Distances et durées estimées par la route ; l'itinéraire s'ouvre dans Google Maps."}</p>}
    </section>
  );
}

function Vehicules({ d }: { d: Dossier }) {
  return (
    <section className="carte dp-bloc">
      <h2>Véhicules</h2>
      {d.vehicules.length === 0 && <p className="vide">Aucun véhicule planifié sur ce dossier.</p>}
      {d.vehicules.map((v) => (
        <div key={v.vehicle_id} className="dp-veh">
          <div className="dp-veh-tete">
            <span className="dp-veh-id">
              {v.plaque ? <Plaque plaque={v.plaque} /> : <span className="dp-sans-plaque">véhicule {v.vehicle_id}</span>}
              <span className="dp-modele">{v.modele ?? 'Modèle non renseigné'}</span></span>
            <Link to={`/vehicules/${v.vehicle_id}`} className="dp-veh-lien">Conducteurs et PV</Link>
          </div>
          <ul className="dp-veh-missions">{v.missions.map((m) => (
            <li key={m.service_id}>
              <span className="dp-veh-dates">{m.debut === m.fin ? jourCourt(m.debut) : `${jourCourt(m.debut)} au ${jourCourt(m.fin)}`}</span>
              <span className="dp-veh-service">{m.service}{m.conducteur && <small>conducteur : {m.conducteur}</small>}</span>
            </li>))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Documents({ d, pieces }: { d: Dossier; pieces: Pieces }) {
  const commandes = new Map(d.resume.commandes.map((c) => [c.id, c]));
  const ids = [...new Set([...d.resume.commandes.map((c) => c.id), ...d.documents.map((x) => x.commande_id)])];
  const pj = new Map(d.documents.map((x) => [x.commande_id, x]));
  return (
    <section className="carte dp-bloc">
      <h2>Commandes et pièces jointes</h2>
      {!d.documents_disponibles && <p className="avertissement">Pièces jointes indisponibles : Odoo injoignable.</p>}
      {ids.length === 0 && <p className="vide">Sans commande : non facturable dans Odoo.</p>}
      {ids.map((cid) => {
        const c = commandes.get(cid), x = pj.get(cid);
        return (
          <div key={cid} className="dp-commande">
            <div className="dp-commande-tete"><strong>{c?.nom ?? x?.commande}</strong>
              {c && <span>{euros(c.montant_ht)} HT<small>{LIBELLES_FACTURATION[c.facturation ?? ''] ?? c.facturation ?? ''}</small></span>}</div>
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
      <Tete d={d} />
      {plusieurs && <Equation d={d} />}
      {plusieurs && <BandeauRse b={d.resume.rse} />}
      <div className="dp-corps">
        <Missions d={d} actif={actif} ouverts={ouverts} basculer={basculer} ecrire={ecrire} onSurvol={setActif}
          onModifie={charge.recharger} />
        <aside className="dp-cote">
          <SitesEtDeparts d={d} actif={actif}
            onSite={(s) => allerA([...s.services].sort((a, b) => (debutDe(a) ?? '9').localeCompare(debutDe(b) ?? '9'))[0].id)} />
          <Departs d={d} />
          <Vehicules d={d} />
          <Documents d={d} pieces={piecesCommandes} />
        </aside>
      </div>
      {piecesCommandes.dialogue}
      {dialogue}
    </div>
  );
}
