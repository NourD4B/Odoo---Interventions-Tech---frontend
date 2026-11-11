// Client de l'API /api/rse et types du score RSE des déplacements (calcul côté serveur, config/rse.json).
// Les clés de mode sont celles de la future sélection Odoo project.task.transport_mode.
import { auteur, AuteurManquant, ErreurPlanif } from './planification';

export type ModeTransport = 'car_thermal' | 'car_electric' | 'plane' | 'public_transport' | 'walk';
export type NoteRse = 'A' | 'B' | 'C' | 'D' | 'E';
export type SourceMode = 'odoo' | 'saisie' | 'planification';

export const MODES: { cle: ModeTransport; libelle: string }[] = [
  { cle: 'car_thermal', libelle: 'Voiture thermique' },
  { cle: 'car_electric', libelle: 'Voiture électrique' },
  { cle: 'public_transport', libelle: 'Transport en commun' },
  { cle: 'plane', libelle: 'Avion' },
  { cle: 'walk', libelle: 'À pied' },
];
export const NOTES: NoteRse[] = ['A', 'B', 'C', 'D', 'E'];
export const SOURCES: Record<SourceMode, string> = {
  odoo: 'renseigné dans Odoo', saisie: "choisi dans l'application", planification: 'déduit du véhicule affecté',
};

export interface VehiculeRse {
  vehicle_id: number | null; plaque: string | null; energie: string | null; famille: string; carburant: string;
  consommation: number; unite: string; source_consommation: 'saisie' | 'constructeur' | 'defaut';
  consommation_constructeur: number | null; kg_co2e_par_km: number;
}

/** Score RSE d'une mission (fiche service). */
export interface RseMission {
  mode: ModeTransport | null; mode_choisi: ModeTransport | null; mode_libelle: string | null; source: SourceMode | null; vehicule: VehiculeRse | null;
  voyageurs: number; km: number | null; kg_co2e: number | null; reference_kg: number | null;
  evite_pct: number | null; note: NoteRse | null; detail: string[]; alertes: string[]; estime: boolean;
}

/** Score RSE de plusieurs missions (projet, période). */
export interface BilanRse {
  kg_co2e: number | null; reference_kg: number | null; evite_pct: number | null; note: NoteRse | null;
  missions: number; notees: number; sans_mode: number;
  par_mode: { mode: ModeTransport; libelle: string; missions: number; kg_co2e: number }[]; estime: boolean;
}

export interface ProfilVehicule extends VehiculeRse {
  hybride_rechargeable: boolean; pertes_recharge: number | null; facteur: number; facteur_unite: string;
  facteur_source: string;
}

export interface MethodeRse {
  version: string; reference: string; reference_kg_par_km: number; ecart_usage_reel: number; pertes_recharge: number;
  modes: { cle: string; libelle: string; source: string | null;
           tranches: { jusqu_a_km: number | null; libelle: string; kg_co2e_par_km: number }[] | null }[];
  carburants: { cle: string; libelle: string; kg_co2e: number; unite: string; source: string }[];
  notes: { note: NoteRse; evite_min_pct: number | null }[];
  sources: { titre: string; url: string | null }[];
}

async function appel<T>(methode: 'GET' | 'PUT', chemin: string, corps?: unknown): Promise<T> {
  const entetes: Record<string, string> = { Accept: 'application/json' };
  if (methode !== 'GET') {
    const nom = auteur();
    if (!nom) throw new AuteurManquant('Indiquez votre nom (journal des modifications)');
    entetes['X-Auteur'] = encodeURIComponent(nom);
    entetes['Content-Type'] = 'application/json';
  }
  const r = await fetch(`/api/rse${chemin}`, { method: methode, headers: entetes,
    body: corps === undefined ? undefined : JSON.stringify(corps) });
  if (!r.ok) {
    let detail: unknown = null;
    try { detail = (await r.json()).detail; } catch { /* corps non JSON */ }
    throw new ErreurPlanif(typeof detail === 'string' ? detail : `erreur ${r.status}`, r.status, detail);
  }
  return r.json() as Promise<T>;
}

export const rse = {
  methode: () => appel<MethodeRse>('GET', '/methode'),
  choisirMode: (serviceId: number, mode: ModeTransport | null) =>
    appel<{ service_id: number; transport_mode: ModeTransport | null }>('PUT', `/services/${serviceId}/transport`,
      { transport_mode: mode }),
  vehicule: (id: number) => appel<ProfilVehicule>('GET', `/vehicules/${id}`),
  saisirConsommation: (id: number, consommation: number | null) =>
    appel<ProfilVehicule>('PUT', `/vehicules/${id}/consommation`, { consommation }),
};

const KG = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
/** « 216,6 kg CO2e », « 1,2 t CO2e ». */
export const co2 = (kg: number | null | undefined) =>
  kg === null || kg === undefined ? '—' : kg >= 1000 ? `${KG.format(kg / 1000)} t CO2e` : `${KG.format(kg)} kg CO2e`;
