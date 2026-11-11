// Dossier d'un projet, tout au même endroit : carte des sites et des agences de départ (itinéraires Google Maps),
// missions dans l'ordre des dates (équipe, véhicule et conducteur désigné), coûts et marge, véhicules, commandes et
// leurs pièces jointes, tâches Odoo. Conducteurs Fleet et PV : fiche du véhicule (lien). Lecture seule ; pièces
// lues dans Odoo à l'ouverture et chaque consultation journalisée.
import L from 'leaflet';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, ZoomControl } from 'react-leaflet';
import { Link, useParams } from 'react-router-dom';
import { aujourdhui } from '../api';
import { Avertissements, EtatChargement, initiales, useDonnees } from '../composants';
import { ListePieces, usePieces, type Pieces } from '../composants/Pieces';
import { BadgeEtat } from '../composants/Statistiques';
import { Plaque } from '../composants/Vehicule';
import { dossiers, type Dossier, type Itineraire, type ServiceDossier, type TacheDossier } from '../dossiers';
import { euros, heures, LIBELLES_ETAT, LIBELLES_FACTURATION, LIBELLES_LIVRAISON, nombre, type EtatService } from '../statistiques';

const ETATS: EtatService[] = ['en_retard', 'planifie', 'a_planifier', 'fait', 'facture'];   // ordre d'urgence
const COULEURS: Record<EtatService, string> = {
  a_planifier: '#7a8191', planifie: '#1d4ed8', en_retard: '#b91c1c', fait: '#0f766e', facture: '#0f1d44',
};
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const ETATS_TACHE: Record<string, string> = {
  '01_in_progress': 'en cours', '02_changes_requested': 'modifications demandées', '03_approved': 'approuvée',
  '04_waiting_normal': 'en attente', '1_done': 'terminée', '1_canceled': 'annulée',
};

const date = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);
const debutDe = (s: ServiceDossier) => (s.planification.debut ?? s.prevu.debut)?.slice(0, 10) ?? null;
const finDe = (s: ServiceDossier) => (s.planification.fin ?? s.prevu.fin)?.slice(0, 10) ?? debutDe(s);
const jourCourt = (iso: string) => date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const km = (x: number | null) => (x === null ? null : `${nombre(Math.round(x))} km`);
function duree(h: number | null) {
  if (h === null) return null;
  const m = Math.round(h * 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
/** « 21 Rue Victor Grignard, 42000 SAINT ETIENNE » -> « Saint Etienne ». */
function villeDe(adresse: string | null) {
  const v = adresse?.match(/\b\d{5}\s+([^,]+)$/)?.[1] ?? adresse?.split(',').pop() ?? null;
  return v ? v.trim().toLowerCase().replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase()) : null;
}
const echapper = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

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
    const large = map.getContainer().clientWidth > 900;
    const limites = points.length === 1 ? L.latLng(points[0]).toBounds(6000) : L.latLngBounds(points);
    map.fitBounds(limites, { paddingTopLeft: [large ? 440 : 48, 56], paddingBottomRight: [56, 56], maxZoom: 13 });
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
  if (!points.length) return <div className="dp-carte dp-carte-vide">Aucun site géolocalisé pour ce projet.</div>;
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

// ---------- identité du projet (sur la carte) ----------

function Anneau({ d }: { d: Dossier }) {
  const r = d.resume, total = Math.max(1, r.services);
  const R = 30, C = 2 * Math.PI * R, ECART = r.services > 1 ? 3 : 0;
  const ordre: EtatService[] = ['facture', 'fait', 'planifie', 'en_retard', 'a_planifier'];
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

/** Toute l'équipe du projet (techniciens planifiés sur ses services) et ses véhicules. */
function Equipe({ d }: { d: Dossier }) {
  const techs = new Map<string, string>();
  d.services.forEach((s) => s.planification.techniciens.forEach((t) => techs.set(t.matricule, t.nom)));
  const noms = [...techs.values()].sort((a, b) => a.localeCompare(b));
  if (!noms.length && !d.vehicules.length) return null;
  return (
    <div className="dp-ident-equipe">
      {noms.length > 0 && <div>
        <span className="dp-ident-label">Équipe, {noms.length} technicien{noms.length > 1 ? 's' : ''}</span>
        <div className="dp-avatars">{noms.slice(0, 7).map((n) => <i key={n} title={n}>{initiales(n)}</i>)}
          {noms.length > 7 && <i title={noms.slice(7).join(', ')}>+{noms.length - 7}</i>}</div>
      </div>}
      {d.vehicules.length > 0 && <div>
        <span className="dp-ident-label">Véhicule{d.vehicules.length > 1 ? 's' : ''}</span>
        <div className="dp-ident-plaques">{d.vehicules.map((v) => (
          <Link key={v.vehicle_id} to={`/vehicules/${v.vehicle_id}`} title="Fiche du véhicule">
            {v.plaque ? <Plaque plaque={v.plaque} /> : <span className="dp-sans-plaque">véhicule {v.vehicle_id}</span>}</Link>))}
        </div></div>}
    </div>
  );
}

function Identite({ d }: { d: Dossier }) {
  const p = d.projet, r = d.resume;
  const faits: [string, string][] = [];
  if (p.etape) faits.push(['Étape Odoo', p.etape]);
  if (p.commande) faits.push(['Commande', p.commande]);
  if (p.debut || p.fin) faits.push(['Période', `${p.debut ? jourCourt(p.debut) : '…'} au ${p.fin ? jourCourt(p.fin) : '…'}`]);
  return (
    <div className="dp-identite">
      <Link to="/dossiers" className="dp-retour">‹ Dossiers projets</Link>
      <p className="dp-client">{p.client ?? 'Client non renseigné'}{p.simule && <span className="dp-simule">simulé</span>}</p>
      <h1>{p.nom}</h1>
      {faits.length > 0 && <dl className="dp-ident-faits">{faits.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
      <Anneau d={d} />
      <Equipe d={d} />
      <p className="dp-prochaine">{r.prochaine_intervention
        ? <>Prochaine intervention<strong>{date(r.prochaine_intervention).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</strong></>
        : 'Aucune intervention à venir'}</p>
      {p.odoo_url && <a className="dp-odoo" href={p.odoo_url} target="_blank" rel="noreferrer">Ouvrir le projet dans Odoo</a>}
    </div>
  );
}

// ---------- coûts : une équation ----------

function Equation({ d }: { d: Dossier }) {
  const r = d.resume;
  const parts = d.services.reduce((a, s) => ({ travail: a.travail + s.couts_estimes.travail, route: a.route + s.couts_estimes.route,
    vehicule: a.vehicule + s.couts_estimes.vehicule }), { travail: 0, route: 0, vehicule: 0 });
  const hors = d.services.find((s) => s.couts_estimes.hors)?.couts_estimes.hors;
  return (
    <section className="dp-equation" aria-label="Coûts et marge estimée du projet">
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

function Mission({ s, d, ouvert, actif, futur, onBasculer, onSurvol }: {
  s: ServiceDossier; d: Dossier; ouvert: boolean; actif: boolean; futur: boolean; onBasculer: () => void;
  onSurvol: (id: number | null) => void;
}) {
  const v = s.planification.vehicule;
  const mission = d.vehicules.flatMap((x) => x.missions).find((m) => m.service_id === s.id);
  const plaque = v ? v.plaque ?? d.vehicules.find((x) => x.vehicle_id === v.id)?.plaque ?? null : null;
  const agence = (code: string | null) => d.agences.find((a) => a.code === code)?.nom ?? code;
  const marge = s.couts_estimes.marge_estimee;
  return (
    <li id={`mission-${s.id}`} className={`dp-etape etat-${s.etat}${actif ? ' actif' : ''}${futur ? ' futur' : ''}`}
      onMouseEnter={() => onSurvol(s.id)} onMouseLeave={() => onSurvol(null)}>
      <DateMission s={s} />
      <div className="dp-rail" aria-hidden="true"><span className="dp-point" /></div>
      <article className="dp-mission">
        <header>
          <h3><Link to={`/statistiques/services/${s.id}`}>{s.nom}</Link></h3>
          <div className="badges"><BadgeEtat etat={s.etat} />
            {s.priorite === 'urgente' && <span className="badge b-urgent">urgent</span>}</div>
        </header>
        <p className="dp-site">{s.site.adresse ?? 'Adresse du site non renseignée'}</p>
        <div className="dp-equipe">
          {s.planification.techniciens.length ? s.planification.techniciens.map((t) => (
            <span key={t.matricule} className="dp-tech" title={`${t.nom} : ${t.jours} jour${t.jours > 1 ? 's' : ''}`}>
              <i aria-hidden="true">{initiales(t.nom)}</i>{t.nom}{t.agence && <small>{agence(t.agence)}</small>}</span>))
            : <span className="dp-a-faire">Équipe à planifier</span>}
          {v && <Link to={`/vehicules/${v.id}`} className="dp-vehicule" title="Fiche du véhicule">
            {plaque ? <Plaque plaque={plaque} /> : <span className="dp-sans-plaque">véhicule {v.id}</span>}
            {mission?.conducteur && <small>conducteur : {mission.conducteur}</small>}</Link>}
        </div>
        <dl className="dp-mesures">
          <div><dt>Heures</dt><dd>{heures(s.realise.heures_passees)} <small>sur {heures(s.prevu.heures)}</small></dd></div>
          <div><dt>Matériel livré</dt><dd>{s.materiel.pct_livre === null ? '—' : `${nombre(s.materiel.pct_livre)} %`}</dd></div>
          <div><dt>CA HT</dt><dd>{euros(s.argent.ca_ht)}</dd></div>
          <div><dt>Marge estimée</dt><dd className={marge < 0 ? 'negatif' : ''}>{euros(marge)}</dd></div>
        </dl>
        <div className="dp-pied">
          {s.itineraires.map((it) => (
            <a key={it.agence.code} href={it.google} target="_blank" rel="noreferrer" className="dp-itineraire"
              title={`Itinéraire en voiture dans Google Maps (${it.techniciens.join(', ')})`}>
              Itinéraire depuis {it.agence.nom}<small>{[km(it.km), duree(it.heures)].filter(Boolean).join(', ')}</small></a>))}
          <button type="button" className="dp-deplier" aria-expanded={ouvert} onClick={onBasculer}>
            {ouvert ? 'Masquer le détail' : 'Voir le détail'}</button>
        </div>
        {ouvert && <DetailMission s={s} />}
      </article>
    </li>
  );
}

function DetailMission({ s }: { s: ServiceDossier }) {
  const c = s.couts_estimes, f = s.realise.feuille;
  return (
    <div className="dp-detail">
      <section>
        <h4>Sur place</h4>
        {s.realise.sous_taches.total > 0
          ? <ul className="dp-coches">{s.realise.sous_taches.liste.map((t) => (
            <li key={t.id} className={t.terminee ? 'faite' : ''}>{t.nom}</li>))}</ul>
          : <p className="muet">Pas de sous-tâche.</p>}
        <p className="dp-feuille">Feuille d'intervention : {f.modele_id === null ? 'aucune'
          : f.envoyee ? 'signée et envoyée' : f.signee ? 'signée' : f.remplie ? 'remplie, non signée' : 'à remplir'}</p>
        {s.realise.par_employe.length > 0 && <ul className="dp-lignes">{s.realise.par_employe.map((e, i) => (
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
        {s.materiel.livraisons.map((l) => <p key={l.nom} className="muet">{l.nom} : {LIBELLES_LIVRAISON[l.etat ?? ''] ?? l.etat ?? '—'}</p>)}
      </section>
      <Link to={`/statistiques/services/${s.id}`} className="dp-fiche">Fiche complète du service</Link>
    </div>
  );
}

function Missions({ d, actif, ouverts, basculer, onSurvol }: {
  d: Dossier; actif: number | null; ouverts: Set<number>; basculer: (id: number) => void; onSurvol: (id: number | null) => void;
}) {
  const auj = aujourdhui();
  const dates = d.services.filter((s) => debutDe(s));
  const sansDate = d.services.filter((s) => !debutDe(s));
  const aVenir = dates.findIndex((s) => (debutDe(s) ?? '') >= auj);
  const repere = <li key="aujourdhui" className="dp-aujourdhui"><span>Aujourd'hui, {jourCourt(auj)}</span></li>;
  const ligne = (s: ServiceDossier, futur: boolean) => (
    <Mission key={s.id} s={s} d={d} ouvert={ouverts.has(s.id)} actif={actif === s.id} futur={futur}
      onBasculer={() => basculer(s.id)} onSurvol={onSurvol} />
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
      {d.services.length === 0 && <p className="vide">Aucun service sur site dans ce projet.</p>}
    </section>
  );
}

// ---------- colonne de droite ----------

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
      {d.vehicules.length === 0 && <p className="vide">Aucun véhicule de service planifié sur ce projet.</p>}
      {d.vehicules.map((v) => (
        <div key={v.vehicle_id} className="dp-veh">
          <div className="dp-veh-tete">
            {v.plaque ? <Plaque plaque={v.plaque} /> : <span className="dp-sans-plaque">véhicule {v.vehicle_id}</span>}
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
      {ids.length === 0 && <p className="vide">Aucune commande liée au projet.</p>}
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

function Taches({ d, onMission }: { d: Dossier; onMission: (id: number) => void }) {
  const ids = new Set(d.taches.map((t) => t.id));
  const enfants = new Map<number, TacheDossier[]>();
  d.taches.forEach((t) => {
    if (t.parent_id !== null && ids.has(t.parent_id)) enfants.set(t.parent_id, [...(enfants.get(t.parent_id) ?? []), t]);
  });
  const racines = d.taches.filter((t) => t.parent_id === null || !ids.has(t.parent_id))
    .sort((a, b) => Number(b.service) - Number(a.service) || a.nom.localeCompare(b.nom));
  const ligne = (t: TacheDossier) => (
    <div className="dp-tache">
      <span className="dp-tache-nom">{t.service
        ? <button type="button" className="dp-lien" onClick={() => onMission(t.id)} title="Voir la mission">{t.nom}</button> : t.nom}
        {t.priorite === 'urgente' && <span className="badge b-urgent">urgent</span>}</span>
      {(t.etape || (t.etat && ETATS_TACHE[t.etat])) && <span className="dp-tache-meta">{[t.etape, t.etat && ETATS_TACHE[t.etat]].filter(Boolean).join(', ')}</span>}
      {!!t.heures_prevues && <span className="dp-tache-h">{heures(t.heures_passees ?? 0)} / {heures(t.heures_prevues)}</span>}
    </div>
  );
  return (
    <section className="carte dp-bloc">
      <h2>Tâches Odoo <span className="dp-compte">{d.taches.length}</span></h2>
      <ul className="dp-arbre">{racines.map((t) => (
        <li key={t.id} className={t.service ? 'service' : ''}>{ligne(t)}
          {enfants.has(t.id) && <ul>{enfants.get(t.id)!.map((e) => <li key={e.id}>{ligne(e)}</li>)}</ul>}</li>))}
      </ul>
      {d.taches.length === 0 && <p className="vide">Aucune tâche.</p>}
    </section>
  );
}

// ---------- page ----------

export default function DossierProjet() {
  const id = Number(useParams().id);
  const charge = useDonnees(() => dossiers.projet(id), [id]);
  const piecesCommandes = usePieces((aid) => dossiers.piece(id, aid));
  const [ouverts, setOuverts] = useState<Set<number>>(new Set());
  const [actif, setActif] = useState<number | null>(null);
  const d = charge.donnees;
  const geo = useMemo(() => (d ? geographie(d) : null), [d]);

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
  return (
    <div className="dp">
      <Avertissements liste={d.avertissements} />
      <section className="dp-heros">
        <Carte d={d} actif={actif}
          onSite={(s) => allerA([...s.services].sort((a, b) => (debutDe(a) ?? '9').localeCompare(debutDe(b) ?? '9'))[0].id)} />
        <Identite d={d} />
        <div className="dp-legende" aria-hidden="true">
          <span><i className="dp-leg-agence" />agence de départ</span>
          <span><i className="dp-leg-site" />site (nombre de missions)</span>
          <span><i className="dp-leg-trajet" />trajet</span>
          {geo && geo.sansPosition > 0 && <span>{geo.sansPosition} service{geo.sansPosition > 1 ? 's' : ''} sans position</span>}
        </div>
      </section>
      <Equation d={d} />
      <div className="dp-corps">
        <Missions d={d} actif={actif} ouverts={ouverts} basculer={basculer} onSurvol={setActif} />
        <aside className="dp-cote">
          <Departs d={d} />
          <Vehicules d={d} />
          <Documents d={d} pieces={piecesCommandes} />
          <Taches d={d} onMission={allerA} />
        </aside>
      </div>
      {piecesCommandes.dialogue}
    </div>
  );
}
