// Client de l'API /api/dossiers (lecture seule) : le dossier complet d'un projet, tout au même endroit.
// Noms de champs identiques à l'API ; montants en euros HT ; dates « AAAA-MM-JJ ».
import { lireAvecAuteur, type PieceJointe } from './flotte';
import { ErreurStats, type FicheService, type ResumeProjet } from './statistiques';

export interface AgenceDepart { code: string; nom: string; adresse: string | null; lat: number | null; lng: number | null }

/** Départ d'une agence vers le site : distance et durée estimées, itinéraire en voiture dans Google Maps. */
export interface Itineraire {
  agence: AgenceDepart; techniciens: string[]; km: number | null; heures: number | null; source: string | null;
  estime: boolean; google: string;
}

export type ServiceDossier = FicheService & { itineraires: Itineraire[] };

export interface TacheDossier {
  id: number; nom: string; parent_id: number | null; field_service: boolean; service: boolean; etape: string | null;
  etat: string | null; debut: string | null; echeance: string | null; heures_prevues: number | null;
  heures_passees: number | null; priorite: 'normale' | 'urgente'; commande: string | null;
}

/** Mission d'un véhicule pour ce projet et conducteur désigné par la planification (conducteurs Fleet et PV : fiche
 * du véhicule). */
export interface MissionDossier {
  service_id: number; service: string; debut: string; fin: string; etat: string; conducteur: string | null;
}
export interface VehiculeDossier {
  vehicle_id: number; plaque: string | null;
  modele: string | null;                    // « Marque Modèle », comme la page Flotte (Odoo corrigé par le registre)
  missions: MissionDossier[];
}

export interface DocumentsCommande { commande_id: number; commande: string; pieces: PieceJointe[] }

export interface Dossier {
  avertissements: string[];
  projet: { id: number; nom: string; client: string | null; etape: string | null; debut: string | null; fin: string | null;
            commande: string | null; field_service: boolean; simule: boolean; odoo_url: string | null };
  resume: ResumeProjet;
  services: ServiceDossier[];
  taches: TacheDossier[];
  agences: AgenceDepart[];
  vehicules: VehiculeDossier[];
  documents: DocumentsCommande[];
  documents_disponibles: boolean;
}

async function lire<T>(chemin: string): Promise<T> {
  const r = await fetch(chemin, { headers: { Accept: 'application/json' } });
  if (!r.ok) {
    let detail = `erreur ${r.status}`;
    try { const corps = await r.json(); if (typeof corps.detail === 'string') detail = corps.detail; } catch { /* non JSON */ }
    throw new ErreurStats(detail, r.status);
  }
  return r.json() as Promise<T>;
}

export const dossiers = {
  projet: (id: number) => lire<Dossier>(`/api/dossiers/projets/${id}`),
  /** Pièce d'une commande du projet, lue dans Odoo ; consultation journalisée (nom demandé). */
  piece: (projet: number, piece: number) => lireAvecAuteur(`/api/dossiers/projets/${projet}/pieces/${piece}`),
};
