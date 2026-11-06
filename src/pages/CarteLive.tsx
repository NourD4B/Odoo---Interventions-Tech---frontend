import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { api, aujourdhui, LIBELLES_STATUT, lienItineraire, type Intervention, type PositionLive } from '../api';
import { Avertissements, Badge, COULEURS_STATUT, EtatChargement, heure, initiales, useDonnees } from '../composants';

const FRANCE: [number, number] = [46.6, 2.4];
const RAFRAICHISSEMENT_MS = 10_000;   // positions GPS toutes les 10 s
const PERIME_MS = 5 * 60_000;         // au-delà : position grisée
const POINTS_MAX = 500;               // longueur maximale de la trace affichée

/** Âge d'une position, en millisecondes. */
function age(p: PositionLive): number {
  return p.horodatage ? Date.now() - new Date(p.horodatage).getTime() : Infinity;
}

function depuis(p: PositionLive): string {
  const ms = age(p);
  if (!Number.isFinite(ms)) return 'heure inconnue';
  const min = Math.round(ms / 60_000);
  return min < 1 ? "à l'instant" : `il y a ${min} min`;
}

/** Échappe le texte injecté dans le HTML du marqueur (le nom vient de Traccar). */
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

/** Positions GPS en direct, avec la trace de chaque appareil depuis l'ouverture de la page. */
function usePositions() {
  const [positions, setPositions] = useState<PositionLive[]>([]);
  const [traces, setTraces] = useState<Record<string, [number, number][]>>({});
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    const charger = () => api.positionsLive()
      .then((liste) => {
        if (!actif) return;
        setErreur(null);
        setPositions(liste);
        setTraces((avant) => {
          const apres = { ...avant };
          for (const p of liste) {
            const trace = apres[p.id] ?? [];
            const dernier = trace[trace.length - 1];
            if (!dernier || dernier[0] !== p.lat || dernier[1] !== p.lng) {
              apres[p.id] = [...trace, [p.lat, p.lng] as [number, number]].slice(-POINTS_MAX);
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

  return { positions, traces, erreur };
}

/** Centre la carte sur les appareils au premier chargement, puis sur l'appareil suivi. */
function Cadrage({ positions, cible }: { positions: PositionLive[]; cible: PositionLive | null }) {
  const map = useMap();
  const fait = useRef(false);
  useEffect(() => {
    if (cible) { map.setView([cible.lat, cible.lng], Math.max(map.getZoom(), 15)); return; }
    if (fait.current || !positions.length) return;
    fait.current = true;
    if (positions.length === 1) map.setView([positions[0].lat, positions[0].lng], 15);
    else map.fitBounds(L.latLngBounds(positions.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40] });
  }, [map, positions, cible]);
  return null;
}

export default function CarteLive() {
  const [jour, setJour] = useState(aujourdhui());
  const [client, setClient] = useState('');
  const [societe, setSociete] = useState('');
  const [suivi, setSuivi] = useState<string | null>(null);

  const interv = useDonnees(() => api.interventions(jour), [jour]);
  const gps = usePositions();

  const toutes = interv.donnees?.interventions ?? [];
  const options = useMemo(() => ({
    clients: [...new Set(toutes.map((i) => i.client).filter(Boolean) as string[])].sort(),
    societes: [...new Set(toutes.map((i) => i.societe).filter(Boolean) as string[])].sort(),
  }), [toutes]);
  const visibles = toutes.filter((i) => (!client || i.client === client) && (!societe || i.societe === societe));
  const compter = (...statuts: string[]) => visibles.filter((i) => statuts.includes(i.statut)).length;
  const cible = gps.positions.find((p) => p.id === suivi) ?? null;
  const enDirect = gps.positions.filter((p) => age(p) <= PERIME_MS).length;

  return (
    <>
      <div className="entete">
        <div>
          <h1>Carte live</h1>
          <div className="sous-titre">
            {gps.positions.length} appareil(s) GPS, dont {enDirect} en direct · actualisé toutes les 10 s
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

      {gps.erreur && <div className="erreur" role="alert">Positions GPS : {gps.erreur}</div>}
      <EtatChargement chargement={interv.chargement} erreur={interv.erreur} />
      <Avertissements liste={interv.donnees?.avertissements} />

      <div className="kpis">
        <div className="kpi"><span>GPS en direct</span><strong style={{ color: '#0f766e' }}>{enDirect}</strong></div>
        <div className="kpi"><span>Sur site</span><strong style={{ color: '#1d4ed8' }}>{compter('sur_site')}</strong></div>
        <div className="kpi"><span>Planifiées</span><strong style={{ color: '#b45309' }}>{compter('planifiee', 'a_planifier', 'en_cours')}</strong></div>
        <div className="kpi"><span>Terminées</span><strong>{compter('terminee')}</strong></div>
      </div>

      <div className="rangee">
        <section className="carte large" aria-label="Carte en direct">
          <h2>Positions en direct</h2>
          <div className="carte-leaflet">
            <MapContainer center={FRANCE} zoom={6} style={{ height: '100%', width: '100%' }}>
              <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19}
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
              <Cadrage positions={gps.positions} cible={cible} />

              {/* Sites d'intervention (secondaires) */}
              {visibles.filter((i) => i.position).map((i) => (
                <CircleMarker key={i.id} center={[i.position!.lat, i.position!.lng]} radius={7}
                  pathOptions={{ color: COULEURS_STATUT[i.statut], fillColor: '#ffffff', fillOpacity: 1, weight: 3 }}>
                  <Tooltip>{i.client ?? i.titre} · {LIBELLES_STATUT[i.statut]}</Tooltip>
                </CircleMarker>
              ))}

              {/* Appareils GPS : trace, précision, position */}
              {gps.positions.map((p) => (
                <PositionAppareil key={p.id} p={p} trace={gps.traces[p.id] ?? []} />
              ))}
            </MapContainer>
          </div>
          <p className="muet">
            Pastille verte : position reçue il y a moins de 5 min ; grise : plus ancienne. Cercles blancs : sites d'intervention.
          </p>
        </section>

        <section className="carte etroit" aria-label="Appareils et interventions">
          <h2>Appareils GPS</h2>
          {!gps.positions.length && !gps.erreur && <div className="vide">Aucune position reçue de Traccar.</div>}
          <div className="liste-activite">
            {gps.positions.map((p) => (
              <button key={p.id} type="button" className={`ligne-activite${p.id === suivi ? ' selectionnee' : ''}`}
                onClick={() => setSuivi(p.id === suivi ? null : p.id)} aria-pressed={p.id === suivi}>
                <span className="pastille" style={{ background: age(p) > PERIME_MS ? '#8892a6' : '#0f766e' }}>
                  {initiales(p.nom)}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                  <strong>{p.nom}</strong>
                  <span className="muet">
                    {depuis(p)}{p.precision_m ? ` · ±${Math.round(p.precision_m)} m` : ''}
                    {p.batterie != null ? ` · batterie ${Math.round(p.batterie)} %` : ''}
                    {p.id === suivi ? ' · suivi' : ''}
                  </span>
                </span>
              </button>
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

function PositionAppareil({ p, trace }: { p: PositionLive; trace: [number, number][] }) {
  const perime = age(p) > PERIME_MS;
  const couleur = perime ? '#8892a6' : '#0f766e';
  return (
    <>
      {trace.length > 1 && <Polyline positions={trace} pathOptions={{ color: couleur, weight: 4, opacity: 0.8 }} />}
      {p.precision_m ? (
        <Circle center={[p.lat, p.lng]} radius={p.precision_m}
          pathOptions={{ color: couleur, weight: 1, fillOpacity: 0.08 }} />
      ) : null}
      <Marker position={[p.lat, p.lng]} icon={icone(initiales(p.nom), couleur)}>
        <Popup>
          <strong>{p.nom}</strong><br />
          {depuis(p)}{p.precision_m ? ` · ±${Math.round(p.precision_m)} m` : ''}
          {perime && <><br />Position ancienne : téléphone éteint, hors réseau ou suivi arrêté.</>}
        </Popup>
      </Marker>
    </>
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
