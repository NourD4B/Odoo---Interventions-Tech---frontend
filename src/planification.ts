// Client de l'API /api/planification. Noms de champs identiques à l'API (= champs Odoo project.task).
// Écritures : en-tête X-Auteur (nom de la personne, encodé URL pour les accents), demandé à la première écriture.

export type StatutPlanif = 'a_planifier' | 'propose' | 'verrouille' | 'publie';
export type EtatAffectation = 'propose' | 'verrouille' | 'publie';
export type VehiculeRequis = 'indifferent' | 'utilitaire';

export interface AffectationResume {
  matricules: string[]; equipe: string[]; vehicle_id: number | null; plaque: string | null;
  debut: string; fin: string; etat: EtatAffectation; propose_par: 'solveur' | 'dispatcher';
  raison: string | null; motif_derogation: string | null;
}

/** Réglages de planification (absents d'Odoo), seuls champs modifiables ici. Dates « AAAA-MM-JJ ».
 *  Position du site : seulement pour corriger un géocodage absent ou faux (précision « saisie »). */
export interface ReglagesPlanif {
  type_service_id: number | null; nb_techniciens: number; competences_requises: string[];
  vehicule_requis: VehiculeRequis; fenetre_debut: string | null; fenetre_fin: string | null;
  site_lat: number | null; site_lng: number | null;
}

/** Service sur site = tâche Odoo Field Service (id = id de la tâche) + réglages de planification.
 *  Les champs Odoo (nom, projet, client, dates, heures, priorité, adresse) se modifient dans Odoo. Dates-heures :
 *  ISO avec décalage, heure de Paris. */
export interface ServicePlanif extends ReglagesPlanif {
  id: number; name: string; project_id: number; project_name: string | null; company_id: number | null;
  partner_id: number | null; partner_name: string | null; partner_phone: string | null;
  planned_date_begin: string | null; date_deadline: string | null; allocated_hours: number; priority: '0' | '1';
  tag_ids: number[]; worksheet_template_id: number | null; under_warranty: boolean;
  sale_order_id: number | null; sale_line_id: number | null;
  site_partner_id: number | null; site_adresse: string | null; site_precision: string | null;
  stage: number; statut_planification: StatutPlanif; source: string; odoo_task_id: number | null;
  odoo_url: string | null; simule: boolean; version: number; affectation: AffectationResume | null;
  archive_odoo?: boolean;            // archivée dans Odoo, gardée en historique (commande) : jamais planifiée
  violations?: Violation[];                    // règles obligatoires enfreintes (réponse de planif.affecter seulement)
}

export interface TechnicienPlanif {
  matricule: string; nom: string; fonction: string; agence: string; agence_a_confirmer: boolean; note: string | null;
  employee_id: number | null; competences: string[]; absences: { du: string; au: string }[];
}
export interface VehiculeRessource {
  vehicle_id: number; plaque: string; libelle: string; type: 'voiture' | 'utilitaire' | 'exclu';
  attribution: 'pool' | 'attitre' | 'exclu'; conducteur: string | null; agence: string | null; places: number;
  electrique: boolean; immatricule: boolean;
}
export interface Ressources {
  avertissements: string[]; agences: { code: string; nom: string; lat: number | null; lng: number | null }[];
  feries: { date: string; nom: string }[];               // jours fériés de la période (affichés sur la grille)
  techniciens: TechnicienPlanif[]; vehicules: VehiculeRessource[];
}

export interface AffectationProposee {
  service_id: number; service: string; matricules: string[]; equipe: string[]; vehicle_id: number | null;
  vehicule: string | null; debut: string; fin: string; km_aller_retour: number | null;   // null : distance inconnue
  cout_estime: number | null;
  raison_techniciens: string; raison_vehicule: string;
}
export interface Proposition {
  statut: 'optimal' | 'limite_de_temps' | 'echec'; affectations: AffectationProposee[];
  non_planifies: { service_id: number; service: string; cause: string }[]; avertissements: string[];
}

export interface Violation { code: string; message: string }
export interface ChoixVehicule {
  vehicle_id: number; plaque: string; libelle: string; type_planification: string; attribution: string;
  conforme: boolean; rang: number; raison: string; violations: Violation[];
}
export interface CorpsAffectation {
  matricules: string[]; vehicle_id: number | null; debut: string; fin: string; verrouiller: boolean;
  motif: string | null; version: number;
}

export interface Regle {
  code: string; libelle: string; niveau: 'obligatoire' | 'preference' | 'inactive'; poids: number;
  valeur: number | null; statut: 'a_confirmer' | 'validee';
  categorie: 'obligatoire' | 'preference' | 'parametre'; unite: string | null;
}
export interface EntreeJournal {
  id: number; horodatage: string; auteur: string; action: string; objet_type: string; objet_id: string | null;
  avant: Record<string, unknown> | null; apres: Record<string, unknown> | null; motif: string | null;
}

export interface Referentiels {
  competences_actives: boolean;            // règle « compétences » active (sinon les écrans les masquent)
  competences: { code: string; libelle: string }[];
  types_service: { id: number; nom: string; duree_defaut_h: number; competences: string[];
                   vehicule_requis: VehiculeRequis; nb_techniciens_defaut: number }[];
  avertissements: string[];
}
/** Plan de charge : un jour par date de la période ; une cellule par technicien et par jour. */
export type EtatJour = 'libre' | 'intervention' | 'conge' | 'conflit' | 'ferie' | 'weekend';
export interface JourCharge { date: string; ouvre: boolean; ferie: string | null; weekend: boolean }
export interface CelluleCharge { etat: EtatJour; heures: number; services: number[] }
export interface TechnicienCharge {
  matricule: string; nom: string; agence: string; agence_a_confirmer: boolean; jours: CelluleCharge[];
  ouvres: number; conges: number; occupes: number; conflits: number; libres: number; charge_pct: number | null;
  semaines: { lundi: string; charge_pct: number | null; occupes: number; disponibles: number }[];
}
export interface ServiceCharge {
  id: number; nom: string; client: string | null; etat: StatutPlanif; priorite: 'normale' | 'urgente'; simule: boolean;
  debut: string; fin: string; matricules: string[]; nb_techniciens: number; allocated_hours: number; site: string | null;
}
export interface PlanDeCharge {
  periode: { debut: string; fin: string }; avertissements: string[]; agences: { code: string; nom: string }[];
  jours: JourCharge[]; techniciens: TechnicienCharge[]; services: Record<string, ServiceCharge>;
  equipe: { date: string; occupes: number; conges: number; libres: number; conflits: number }[];
  semaines: { lundi: string; ouvres: number }[];
}

export interface AgencePlanif {
  code: string; nom: string; id_entrepot: number | null; adresse: string; statut: 'active' | 'a_confirmer';
  lat: number | null; lng: number | null; precision: string | null;
  company_id: number | null; societe: string | null; warehouse_id: number | null; entrepot_odoo: string | null;
}

// ---------- auteur (journal) ----------

const CLE_AUTEUR = 'd4b.auteur';
let auteurMemoire: string | null = null;

export function auteur(): string | null {
  try { return localStorage.getItem(CLE_AUTEUR) ?? auteurMemoire; } catch { return auteurMemoire; }
}

export function definirAuteur(nom: string): void {
  auteurMemoire = nom.trim();
  try { localStorage.setItem(CLE_AUTEUR, auteurMemoire); } catch { /* stockage indisponible : mémoire seule */ }
}

// ---------- appels ----------

/** Erreur de l'API : statut HTTP + `detail` brut (422 : liste pydantic). */
export class ErreurPlanif extends Error {
  constructor(message: string, readonly statut: number, readonly detail: unknown) { super(message); }
}

export class AuteurManquant extends Error {}

function texteDetail(detail: unknown, statut: number): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((d) => (d as { msg?: string }).msg ?? '').filter(Boolean).join(' · ');
  if (detail && typeof detail === 'object' && 'message' in detail) return String((detail as { message: string }).message);
  return `erreur ${statut}`;
}

async function appel<T>(methode: string, chemin: string, options: { corps?: unknown;
  params?: Record<string, string | number | undefined | null> } = {}): Promise<T> {
  const url = new URL(`/api/planification${chemin}`, window.location.origin);
  Object.entries(options.params ?? {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v)); });
  const entetes: Record<string, string> = { Accept: 'application/json' };
  if (methode !== 'GET') {
    const nom = auteur();
    if (!nom) throw new AuteurManquant('Indiquez votre nom (journal des modifications)');
    entetes['X-Auteur'] = encodeURIComponent(nom);
  }
  if (options.corps !== undefined) entetes['Content-Type'] = 'application/json';
  const reponse = await fetch(url.toString(), { method: methode, headers: entetes,
    body: options.corps === undefined ? undefined : JSON.stringify(options.corps) });
  if (!reponse.ok) {
    let detail: unknown = null;
    try { detail = (await reponse.json()).detail; } catch { /* corps non JSON */ }
    throw new ErreurPlanif(texteDetail(detail, reponse.status), reponse.status, detail);
  }
  return (reponse.status === 204 ? undefined : await reponse.json()) as T;
}

/** Erreurs 422 de validation, par champ : { fenetre_fin: "…" }. */
export function erreursParChamp(e: unknown): Record<string, string> {
  if (!(e instanceof ErreurPlanif) || e.statut !== 422 || !Array.isArray(e.detail)) return {};
  const champs: Record<string, string> = {};
  for (const d of e.detail as { loc?: (string | number)[]; msg?: string }[]) {
    const champ = String(d.loc?.[d.loc.length - 1] ?? '');
    if (champ) champs[champ] = (d.msg ?? '').replace(/^Value error, /, '');
  }
  return champs;
}

export const planif = {
  services: (debut?: string, fin?: string, historique?: boolean) =>
    appel<ServicePlanif[]>('GET', '/services', { params: { debut, fin, historique: historique ? 'true' : undefined } }),
  modifierPlanification: (id: number, corps: ReglagesPlanif & { version: number }) =>
    appel<ServicePlanif>('PUT', `/services/${id}/planification`, { corps }),
  ressources: (debut: string, fin: string) => appel<Ressources>('GET', '/ressources', { params: { debut, fin } }),
  charge: (debut: string, fin: string) => appel<PlanDeCharge>('GET', '/charge', { params: { debut, fin } }),
  proposer: (debut: string, fin: string) => appel<Proposition>('POST', '/proposer', { corps: { debut, fin } }),
  vehicules: (serviceId: number, params?: { matricules?: string; debut?: string; fin?: string }) =>
    appel<ChoixVehicule[]>('GET', `/vehicules/${serviceId}`, { params }),
  affecter: (serviceId: number, corps: CorpsAffectation) =>
    appel<ServicePlanif>('PUT', `/affectations/${serviceId}`, { corps }),
  depublier: (serviceId: number, version: number, motif: string | null) =>
    appel<ServicePlanif>('POST', `/services/${serviceId}/depublier`, { corps: { version, motif } }),
  retirerAffectation: (serviceId: number, version: number) =>
    appel<ServicePlanif>('DELETE', `/affectations/${serviceId}`, { params: { version } }),
  retirerPropositions: (debut: string, fin: string) =>
    appel<{ services: number; ids: number[] }>('DELETE', '/affectations', { params: { debut, fin } }),
  publier: (debut: string, fin: string) =>
    appel<{ services: number; ids: number[] }>('POST', '/publier', { corps: { debut, fin } }),
  regles: () => appel<Regle[]>('GET', '/regles'),
  modifierRegle: (code: string, corps: Partial<Pick<Regle, 'niveau' | 'poids' | 'valeur'>>) =>
    appel<Regle>('PUT', `/regles/${code}`, { corps }),
  journal: (filtre: { objet_type?: string; objet_id?: string; limite?: number } = {}) =>
    appel<EntreeJournal[]>('GET', '/journal', { params: filtre }),
  referentiels: () => appel<Referentiels>('GET', '/referentiels'),
  agences: () => appel<{ avertissements: string[]; agences: AgencePlanif[] }>('GET', '/agences'),
};

export const LIBELLES_STATUT_PLANIF: Record<StatutPlanif, string> = {
  a_planifier: 'À planifier', propose: 'Proposé', verrouille: 'Verrouillé', publie: 'Publié',
};
export const LIBELLES_PRECISION: Record<string, string> = {
  adresse: 'adresse exacte', rue: 'rue', 'lieu-dit': 'lieu-dit', commune: 'commune seulement', saisie: 'saisie à la main',
};
