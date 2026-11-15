// Carte de la semaine (planification) : sites des services affichés et agences de départ. Le service survolé dans
// le calendrier clignote sur la carte (et la carte se décale s'il est hors de vue) ; survoler un site allume ses
// services dans le calendrier.
import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, TileLayer, Tooltip, useMap, ZoomControl } from 'react-leaflet';

export interface SitePlanif { id: number; lat: number; lng: number; etat: string; urgent: boolean; titre: string; detail: string }
export interface AgencePlanif { code: string; nom: string; lat: number; lng: number }

const echapper = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const iconeSite = (s: SitePlanif, flash: boolean) => L.divIcon({
  className: 'pc-marque', iconSize: [22, 22], iconAnchor: [11, 11],
  html: `<span class="pc-point etat-${s.etat}${s.urgent ? ' urgent' : ''}${flash ? ' flash' : ''}"></span>`,
});
const iconeAgence = (a: AgencePlanif) => L.divIcon({
  className: 'dp-marque-agence', iconSize: [24, 24], iconAnchor: [12, 12],
  html: `<span>${echapper(a.nom.slice(0, 1).toUpperCase())}</span>`,
});

/** Cadre tous les points quand la liste change (pas à chaque survol). */
function Cadrage({ points, cle }: { points: [number, number][]; cle: string }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const limites = points.length === 1 ? L.latLng(points[0]).toBounds(8000) : L.latLngBounds(points);
    map.fitBounds(limites, { padding: [48, 48], maxZoom: 11 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, map]);
  return null;
}

/** Ramène dans la vue le site survolé s'il en sort. */
function Suivre({ site }: { site: SitePlanif | undefined }) {
  const map = useMap();
  useEffect(() => { if (site) map.panInside([site.lat, site.lng], { padding: [56, 56] }); }, [site, map]);
  return null;
}

export default function CartePlanif({ sites, agences, focus, onSurvol, onOuvrir }: {
  sites: SitePlanif[]; agences: AgencePlanif[]; focus: number | null;
  onSurvol: (id: number | null) => void; onOuvrir: (id: number) => void;
}) {
  const points = useMemo(() => [...sites.map((s) => [s.lat, s.lng] as [number, number]),
    ...agences.map((a) => [a.lat, a.lng] as [number, number])], [sites, agences]);
  const cle = useMemo(() => [...sites.map((s) => s.id), ...agences.map((a) => a.code)].join(','), [sites, agences]);
  const enVue = sites.find((s) => s.id === focus);
  if (!points.length) return <div className="pc-carte pc-vide">Aucun site géolocalisé cette semaine.</div>;
  return (
    <MapContainer bounds={L.latLngBounds(points)} className="pc-carte" zoomControl={false} scrollWheelZoom={false}>
      <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
      <ZoomControl position="topright" />
      <Cadrage points={points} cle={cle} />
      <Suivre site={enVue} />
      {agences.map((a) => (
        <Marker key={a.code} position={[a.lat, a.lng]} icon={iconeAgence(a)}>
          <Tooltip direction="top" offset={[0, -12]}>Agence {a.nom}</Tooltip>
        </Marker>
      ))}
      {sites.map((s) => (
        <Marker key={`${s.id}-${focus === s.id}`} position={[s.lat, s.lng]} icon={iconeSite(s, focus === s.id)}
          zIndexOffset={focus === s.id ? 1000 : 0}
          eventHandlers={{ mouseover: () => onSurvol(s.id), mouseout: () => onSurvol(null), click: () => onOuvrir(s.id) }}>
          <Tooltip direction="top" offset={[0, -12]}><strong>{s.titre}</strong><br />{s.detail}</Tooltip>
        </Marker>
      ))}
    </MapContainer>
  );
}
