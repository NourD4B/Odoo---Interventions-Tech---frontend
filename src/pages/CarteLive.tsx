import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import {
  api, aujourdhui, LIBELLES_ACTIVITE, LIBELLES_STATUT, lienItineraire,
  type ActiviteReponse, type ActiviteTechnicien, type Intervention, type PositionLive,
} from '../api';
import { Avertissements, Badge, COULEURS_ACTIVITE, COULEURS_STATUT, EtatChargement, heure, initiales, useDonnees } from '../composants';

const FRANCE: [number, number] = [46.6, 2.4];
const RAFRAICHISSEMENT_MS = 10_000;   // positions GPS et activité toutes les 10 s
const POINTS_MAX = 500;               // longueur maximale de la trace affichée
const GRIS = '#8892a6';
const PRECISIONS_SITE = new Set(['adresse', 'rue', null]);

function depuis(p: PositionLive): string {
  if (!p.horodatage) return 'heure inconnue';
  const min = Math.round((Date.now() - new Date(p.horodatage).getTime()) / 60_000);
  return min < 1 ? "à l'instant" : `il y a ${min} min`;
}

/** Échappe le texte injecté dans le HTML du marqueur (le nom vient de Traccar ou d'Odoo). */
function echapper(texte: string): string {
  return texte.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Pastille HTML (initiales sur fond coloré) pour un marqueur Leaflet. */
function icone(texte: string, couleur: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div class="marqueur" style="background:${couleur}">${echapper(texte)}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function couleur(a: ActiviteTechnicien): string {
  return a.appareil && !a.en_direct ? GRIS : COULEURS_ACTIVITE[a.activite];
}

/** Phrase d'activité : « Sur site chez X depuis 14:35 », « En route vers X · 2,1 km »… */
function resume(a: ActiviteTechnicien): string {
  const i = a.intervention;
  const client = i ? (i.client ?? i.titre) : '';
  switch (a.activite) {
    case 'sur_site': {
      const visite = a.visites.find((v) => v.intervention_id === i?.id && !v.depart);
      return `Sur site chez ${client}${visite ? ` depuis ${heure(visite.arrivee)}` : ''}`;
    }
    case 'en_route':
      return `En route vers ${client}${i?.distance_km != null ? ` · ${i.distance_km.toLocaleString('fr-FR')} km` : ''}`
        + `${heure(i?.debut ?? null) ? ` · prévue à ${heure(i!.debut)}` : ''}`;
    case 'termine': return `Journée terminée (${a.terminees}/${a.total})`;
    case 'sans_intervention': return "Aucune intervention aujourd'hui";
    case 'sans_gps': return i ? `Pas de GPS · prochaine : ${client}` : 'Pas de GPS';
    default: return 'Appareil non associé à un technicien';
  }
}

/** Activité en direct, avec la trace de chaque appareil depuis l'ouverture de la page. */
function useActivite() {
  const [donnees, setDonnees] = useState<ActiviteReponse | null>(null);
  const [traces, setTraces] = useState<Record<string, [number, number][]>>({});
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    const charger = () => api.activite()
      .then((reponse) => {
        if (!actif) return;
        setErreur(null);
        setDonnees(reponse);
        setTraces((avant) => {
          const apres = { ...avant };
          for (const a of reponse.techniciens) {
            const p = a.appareil;
            if (!p) continue;
            const trace = apres[a.cle] ?? [];
            const dernier = trace[trace.length - 1];
            if (!dernier || dernier[0] !== p.lat || dernier[1] !== p.lng) {
              apres[a.cle] = [...trace, [p.lat, p.lng] as [number, number]].slice(-POINTS_MAX);
            }
          }
          return apres;
        });
      })
      .catch((e: Error) => { if (actif) setErreur(e.message); });
    charger();
    const minuterie = setInterval(charger, RAFRAICHISSEMENT_MS);
    return () => { actif = false; clearInterval(minuterie); };
  }, []);

  return { donnees, traces, erreur };
}

/** Cadre la carte sur les techniciens et les sites au premier chargement, puis sur le technicien suivi. */
function Cadrage({ points, cible }: { points: [number, number][]; cible: PositionLive | null }) {
  const map = useMap();
  const fait = useRef(false);
  useEffect(() => {
    if (cible) { map.setView([cible.lat, cible.lng], Math.max(map.getZoom(), 15)); return; }
    if (fait.current || !points.length) return;
    fait.current = true;
    if (points.length === 1) map.setView(points[0], 15);
    else map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
  }, [map, points, cible]);
  return null;
}

export default function CarteLive() {
  const [jour, setJour] = useState(aujourdhui());
  const [client, setClient] = useState('');
  const [societe, setSociete] = useState('');
  const [suivi, setSuivi] = useState<string | null>(null);

  const interv = useDonnees(() => api.interventions(jour), [jour]);
  const live = useActivite();

  const toutes = interv.donnees?.interventions ?? [];
  const options = useMemo(() => ({
    clients: [...new Set(toutes.map((i) => i.client).filter(Boolean) as string[])].sort(),
    societes: [...new Set(toutes.map((i) => i.societe).filter(Boolean) as string[])].sort(),
  }), [toutes]);
  const visibles = toutes.filter((i) => (!client || i.client === client) && (!societe || i.societe === societe));

  const lignes = live.donnees?.techniciens ?? [];
  const avecGps = lignes.filter((a) => a.appareil);
  // Cadrage initial une fois les positions ET les interventions chargées
  const pret = live.donnees !== null && !interv.chargement;
  const aCadrer = pret ? [
    ...avecGps.map((a) => [a.appareil!.lat, a.appareil!.lng] as [number, number]),
    ...visibles.filter((i) => i.position).map((i) => [i.position!.lat, i.position!.lng] as [number, number]),
  ] : [];
  const cible = avecGps.find((a) => a.cle === suivi)?.appareil ?? null;
  const rayon = live.donnees?.rayon_m ?? 150;
  const compter = (activite: string) => lignes.filter((a) => a.activite === activite).length;
  const avertissements = [...(live.donnees?.avertissements ?? []),
    ...(interv.donnees?.avertissements ?? [])].filter((a, n, liste) => liste.indexOf(a) === n);

  return (
    <>
      <div className="entete">
        <div>
          <h1>Carte live</h1>
          <div className="sous-titre">
            {avecGps.length} technicien(s) suivi(s) par GPS, dont {avecGps.filter((a) => a.en_direct).length} en direct
            {' '}· actualisé toutes les 10 s
          </div>
        </div>
        <button type="button" className="btn" onClick={() => { api.viderCache().then(interv.recharger); }}>
          Actualiser les interventions
        </button>
      </div>

      <form className="filtres" aria-label="Filtres" onSubmit={(e) => e.preventDefault()}>
        <label className="champ">Jour<input type="date" value={jour} onChange={(e) => setJour(e.target.value)} /></label>
        <Choix libelle="Client" valeur={client} onChange={setClient} options={options.clients} tous="Tous les clients" />
        <Choix libelle="Société" valeur={societe} onChange={setSociete} options={options.societes} tous="Toutes" />
      </form>

      {live.erreur && <div className="erreur" role="alert">Activité en direct : {live.erreur}</div>}
      <EtatChargement chargement={interv.chargement} erreur={interv.erreur} />
      <Avertissements liste={avertissements} />

      <div className="kpis">
        <Kpi libelle="Sur site" valeur={compter('sur_site')} couleur={COULEURS_ACTIVITE.sur_site} />
        <Kpi libelle="En route" valeur={compter('en_route')} couleur={COULEURS_ACTIVITE.en_route} />
        <Kpi libelle="Journée terminée" valeur={compter('termine')} couleur={COULEURS_ACTIVITE.termine} />
        <Kpi libelle="Sans GPS" valeur={compter('sans_gps')} couleur={COULEURS_ACTIVITE.sans_gps} />
      </div>

      <div className="rangee">
        <section className="carte large" aria-label="Carte en direct">
          <h2>Positions en direct</h2>
          <div className="carte-leaflet">
            <MapContainer center={FRANCE} zoom={6} style={{ height: '100%', width: '100%' }}>
              <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19}
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
              <Cadrage points={aCadrer} cible={cible} />

              {/* Sites d'intervention : cercle de détection de l'arrivée, puis le site */}
              {visibles.filter((i) => i.position).map((i) => (
                <SiteIntervention key={i.id} i={i} rayon={rayon} />
              ))}

              {/* Techniciens suivis : trace, précision, position */}
              {avecGps.map((a) => <PositionTechnicien key={a.cle} a={a} trace={live.traces[a.cle] ?? []} />)}
            </MapContainer>
          </div>
          <p className="muet">
            Couleur du technicien : son activité (gris : position de plus de 10 min). Cercle pointillé autour d'un
            site : zone de {rayon} m où l'arrivée est détectée.
          </p>
        </section>

        <section className="carte etroit" aria-label="Techniciens et interventions">
          <h2>Techniciens</h2>
          {!lignes.length && !live.erreur && <div className="vide">Aucun technicien suivi ni intervention aujourd'hui.</div>}
          <div className="liste-activite">
            {lignes.map((a) => (
              <LigneTechnicien key={a.cle} a={a} suivi={a.cle === suivi}
                onSuivre={a.appareil ? () => setSuivi(a.cle === suivi ? null : a.cle) : undefined} />
            ))}
          </div>

          <h2 style={{ marginTop: 8 }}>Interventions du jour</h2>
          {!interv.chargement && !visibles.length && <div className="vide">Aucune intervention pour ces filtres.</div>}
          <div className="liste-activite">
            {visibles.map((i) => <LigneIntervention key={i.id} i={i} />)}
          </div>
        </section>
      </div>
    </>
  );
}

function Kpi({ libelle, valeur, couleur: c }: { libelle: string; valeur: number; couleur: string }) {
  return <div className="kpi"><span>{libelle}</span><strong style={{ color: c }}>{valeur}</strong></div>;
}

function SiteIntervention({ i, rayon }: { i: Intervention; rayon: number }) {
  const { lat, lng, precision } = i.position!;
  const c = COULEURS_STATUT[i.statut];
  return (
    <>
      {PRECISIONS_SITE.has(precision) && i.statut !== 'annulee' && (
        <Circle center={[lat, lng]} radius={rayon}
          pathOptions={{ color: c, weight: 1, dashArray: '4 4', fillOpacity: 0.05 }} />
      )}
      <CircleMarker center={[lat, lng]} radius={7}
        pathOptions={{ color: c, fillColor: '#ffffff', fillOpacity: 1, weight: 3 }}>
        <Tooltip>
          {i.client ?? i.titre} · {LIBELLES_STATUT[i.statut]}
          {precision && !PRECISIONS_SITE.has(precision) ? ` · position approximative (${precision})` : ''}
        </Tooltip>
      </CircleMarker>
    </>
  );
}

function PositionTechnicien({ a, trace }: { a: ActiviteTechnicien; trace: [number, number][] }) {
  const p = a.appareil!;
  const c = couleur(a);
  return (
    <>
      {trace.length > 1 && <Polyline positions={trace} pathOptions={{ color: c, weight: 4, opacity: 0.8 }} />}
      {p.precision_m ? (
        <Circle center={[p.lat, p.lng]} radius={p.precision_m} pathOptions={{ color: c, weight: 1, fillOpacity: 0.08 }} />
      ) : null}
      <Marker position={[p.lat, p.lng]} icon={icone(initiales(a.nom), c)}>
        <Popup>
          <strong>{a.nom}</strong> · {LIBELLES_ACTIVITE[a.activite]}<br />
          {resume(a)}<br />
          <span className="muet">{depuis(p)}{p.precision_m ? ` · ±${Math.round(p.precision_m)} m` : ''}</span>
        </Popup>
      </Marker>
    </>
  );
}

function LigneTechnicien({ a, suivi, onSuivre }: { a: ActiviteTechnicien; suivi: boolean; onSuivre?: () => void }) {
  const p = a.appareil;
  const contenu = (
    <>
      <span className="pastille" style={{ background: couleur(a) }}>{initiales(a.nom)}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <strong>{a.nom}</strong>
          <Badge type={a.activite}>{LIBELLES_ACTIVITE[a.activite]}</Badge>
        </span>
        <span>{resume(a)}</span>
        {p && (
          <span className="muet">
            {depuis(p)}{p.precision_m ? ` · ±${Math.round(p.precision_m)} m` : ''}
            {p.batterie != null ? ` · batterie ${Math.round(p.batterie)} %` : ''}
            {a.total ? ` · ${a.terminees}/${a.total} terminée(s)` : ''}
            {suivi ? ' · suivi' : ''}
          </span>
        )}
        {a.visites.length > 0 && (
          <span className="muet">
            Passages : {a.visites.map((v) =>
              `${v.client ?? 'site'} ${heure(v.arrivee)}–${v.depart ? heure(v.depart) : '…'} (${v.duree_min} min)`).join(' · ')}
          </span>
        )}
        {a.alertes.length > 0 && <ul className="ecarts">{a.alertes.map((x) => <li key={x}>{x}</li>)}</ul>}
      </span>
    </>
  );
  if (!onSuivre) return <div className="ligne-activite" style={{ cursor: 'default' }}>{contenu}</div>;
  return (
    <button type="button" className={`ligne-activite${suivi ? ' selectionnee' : ''}`} onClick={onSuivre}
      aria-pressed={suivi} title={suivi ? 'Arrêter de suivre' : 'Suivre sur la carte'}>
      {contenu}
    </button>
  );
}

function LigneIntervention({ i }: { i: Intervention }) {
  const lien = lienItineraire(i);
  return (
    <div className="ligne-activite" style={{ cursor: 'default' }}>
      <span className="pastille" style={{ background: COULEURS_STATUT[i.statut] }}>
        {i.techniciens[0] ? initiales(i.techniciens[0]) : '?'}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <strong>{i.client ?? i.titre}</strong>
          <Badge type={i.statut}>{LIBELLES_STATUT[i.statut]}</Badge>
        </span>
        <span className="muet">
          {heure(i.debut) && `${heure(i.debut)}–${heure(i.fin)} · `}{i.techniciens.join(', ') || 'non assignée'}
          {i.ville ? ` · ${i.ville}` : ''}
        </span>
        {lien && (
          <a href={lien} target="_blank" rel="noopener noreferrer" className="lien-itineraire">
            Itinéraire (Google Maps)
          </a>
        )}
      </span>
    </div>
  );
}

export function Choix({ libelle, valeur, onChange, options, tous }:
  { libelle: string; valeur: string; onChange: (v: string) => void; options: string[]; tous: string }) {
  return (
    <label className="champ">{libelle}
      <select value={valeur} onChange={(e) => onChange(e.target.value)}>
        <option value="">{tous}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
