// Types et appels de l'API FastAPI (lecture seule).

export type Rapprochement = 'concordant' | 'ecart' | 'odoo_seul' | 'hfsql_seul' | 'ambigu';
export type Classification = 'terrain_confirme' | 'a_confirmer' | 'exclu';
export type StatutIntervention = 'a_planifier' | 'planifiee' | 'en_cours' | 'sur_site' | 'terminee' | 'annulee';

export interface Ecart { champ: string; odoo: string | null; hfsql: string | null; message: string }

export interface Technicien {
  id: string;
  nom: string;
  rapprochement: Rapprochement;
  classification: Classification;
  motif_classification: string;
  odoo: { employee_id: number; nom: string; poste: string | null; departement: string | null;
          societe: string | null; user_id: number | null } | null;
  hfsql: { code: string; nom: string; service: string | null; fonction: string | null;
           localisation: string | null; actif: boolean } | null;
  vehicule: { vehicule_id: number; plaque: string | null; libelle: string; depuis: string | null } | null;
  ecarts: Ecart[];
}

export interface Vehicule {
  plaque: string;
  rapprochement: Rapprochement;
  odoo: { vehicule_id: number; libelle: string; plaque: string | null; marque: string | null;
          modele: string | null; energie: string | null; conducteur: string | null; pool: boolean;
          compteur: number | null; societe: string | null } | null;
  hfsql: { id: string; plaque: string | null; marque: string | null; modele: string | null;
           energie: string | null; attribue: boolean } | null;
  ecarts: Ecart[];
}

export interface Affectation { vehicule_id: number; plaque: string | null; conducteur: string | null;
  pool: boolean; debut: string | null; fin: string | null }

export interface ResultatPV { plaque: string; date: string; affectations: Affectation[];
  conducteur_identifie: string | null; message: string }

export interface Intervention {
  id: string;
  source: 'odoo' | 'hfsql';
  titre: string;
  client: string | null;
  adresse: string | null;
  ville: string | null;
  debut: string | null;
  fin: string | null;
  statut: StatutIntervention;
  etape: string | null;
  techniciens: string[];
  technicien_ids: string[];
  societe: string | null;
  heures: number | null;
  position: Position | null;
}

/** Position d'un site ; `precision` : adresse | rue | lieu-dit | commune | null (inconnue). */
export interface Position { lat: number; lng: number; origine: 'odoo' | 'geocodage'; precision: string | null }

export interface Interventions { debut: string; fin: string; odoo: number; hfsql: number;
  avertissements: string[]; interventions: Intervention[] }

/** Dernière position GPS d'un appareil Traccar (pas de vitesse : interdit par la CNIL). */
export interface PositionLive { id: string; nom: string; lat: number; lng: number; horodatage: string | null;
  precision_m: number | null; batterie: number | null; statut: string | null }

export type Activite = 'sur_site' | 'en_route' | 'termine' | 'sans_intervention' | 'sans_gps' | 'non_associe';

/** Passage sur un site, déduit du GPS. `depart` null : encore sur place. */
export interface VisiteSite { intervention_id: string; client: string | null; arrivee: string;
  depart: string | null; duree_min: number }

export interface InterventionProche { id: string; titre: string; client: string | null; ville: string | null;
  debut: string | null; statut: StatutIntervention; position: Position | null; distance_km: number | null }

export interface ActiviteTechnicien {
  cle: string;
  technicien_id: string | null;
  nom: string;
  activite: Activite;
  en_direct: boolean;
  appareil: PositionLive | null;
  intervention: InterventionProche | null;
  total: number;
  terminees: number;
  visites: VisiteSite[];
  alertes: string[];
}

export interface ActiviteReponse { date: string; rayon_m: number; avertissements: string[];
  techniciens: ActiviteTechnicien[] }

/** Lien Google Maps (gratuit, sans clé) pour démarrer le trajet vers une destination. */
export function lienItineraire(i: { position: { lat: number; lng: number } | null; adresse: string | null;
  ville: string | null }): string | null {
  const destination = i.position
    ? `${i.position.lat},${i.position.lng}`
    : [i.adresse, i.ville].filter(Boolean).join(', ');
  if (!destination) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}

export interface EtatSource { nom: string; ok: boolean; detail: string }
export interface Synthese { entite: string; total: number; concordant: number; ecart: number;
  odoo_seul: number; hfsql_seul: number; ambigu: number }

export class ErreurApi extends Error {}

async function lire<T>(chemin: string, params?: Record<string, string | undefined>): Promise<T> {
  const url = new URL(chemin, window.location.origin);
  Object.entries(params ?? {}).forEach(([k, v]) => { if (v) url.searchParams.set(k, v); });
  const reponse = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!reponse.ok) {
    let detail = `${reponse.status}`;
    try { detail = (await reponse.json()).detail ?? detail; } catch { /* corps non JSON */ }
    throw new ErreurApi(`Erreur ${chemin} : ${detail}`);
  }
  return reponse.json() as Promise<T>;
}

export const api = {
  etat: () => lire<{ sources: EtatSource[] }>('/api/etat'),
  techniciens: (classification?: Classification) =>
    lire<{ avertissements: string[]; techniciens: Technicien[] }>('/api/techniciens', { classification }),
  vehicules: () => lire<{ avertissements: string[]; vehicules: Vehicule[] }>('/api/vehicules'),
  affectations: (id: number) => lire<Affectation[]>(`/api/vehicules/${id}/affectations`),
  pv: (plaque: string, date: string) => lire<ResultatPV>('/api/pv', { plaque, date }),
  interventions: (debut: string, fin?: string) => lire<Interventions>('/api/interventions', { debut, fin }),
  positionsLive: () => lire<PositionLive[]>('/api/positions/live'),
  activite: () => lire<ActiviteReponse>('/api/activite'),
  reconciliation: () => lire<Synthese[]>('/api/reconciliation'),
  viderCache: () => fetch('/api/cache/vider', { method: 'POST' }),
};

export const aujourdhui = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const LIBELLES_STATUT: Record<StatutIntervention, string> = {
  a_planifier: 'À planifier', planifiee: 'Planifiée', en_cours: 'En cours',
  sur_site: 'Sur site', terminee: 'Terminée', annulee: 'Annulée',
};

export const LIBELLES_ACTIVITE: Record<Activite, string> = {
  sur_site: 'Sur site', en_route: 'En route', termine: 'Terminé', sans_intervention: 'Disponible',
  sans_gps: 'Sans GPS', non_associe: 'Non associé',
};

export const LIBELLES_RAPPROCHEMENT: Record<Rapprochement, string> = {
  concordant: 'Concordant', ecart: 'Écart', odoo_seul: 'Odoo seul', hfsql_seul: 'HFSQL seul', ambigu: 'Ambigu',
};

export const LIBELLES_CLASSIFICATION: Record<Classification, string> = {
  terrain_confirme: 'Terrain confirmé', a_confirmer: 'À confirmer', exclu: 'Exclu',
};
