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

/** Champs saisis (POST / PUT). Dates-heures : « AAAA-MM-JJTHH:MM » = heure de Paris. */
export interface ServiceSaisie {
  name: string; project_id: number; partner_id: number | null; partner_name: string | null;
  partner_phone: string | null; planned_date_begin: string | null; date_deadline: string | null;
  allocated_hours: number; priority: '0' | '1'; description: string | null; tag_ids: number[];
  worksheet_template_id: number | null; under_warranty: boolean;
  site_partner_id: number | null; site_adresse: string | null; site_lat: number | null; site_lng: number | null;
  type_service_id: number | null; nb_techniciens: number; competences_requises: string[];
  vehicule_requis: VehiculeRequis; fenetre_debut: string | null; fenetre_fin: string | null;
}

export interface ServicePlanif extends ServiceSaisie {
  id: number; company_id: number | null; stage: number; statut_planification: StatutPlanif;
  source: 'saisie' | 'simulation' | 'odoo'; site_precision: string | null; odoo_task_id: number | null;
  version: number; sale_order_id: number | null; sale_line_id: number | null;
  affectation: AffectationResume | null;
}

export interface TechnicienPlanif {
  matricule: string; nom: string; fonction: string; agence: string; agence_a_confirmer: boolean;
  employee_id: number | null; competences: string[]; absences: { du: string; au: string }[];
}
export interface VehiculeRessource {
  vehicle_id: number; plaque: string; libelle: string; type: 'voiture' | 'utilitaire' | 'exclu';
  attribution: 'pool' | 'attitre' | 'exclu'; conducteur: string | null; agence: string | null; places: number;
  electrique: boolean; immatricule: boolean;
}
export interface Ressources {
  avertissements: string[]; agences: { code: string; nom: string; lat: number | null; lng: number | null }[];
  techniciens: TechnicienPlanif[]; vehicules: VehiculeRessource[];
}

export interface AffectationProposee {
  service_id: number; service: string; matricules: string[]; equipe: string[]; vehicle_id: number | null;
  vehicule: string | null; debut: string; fin: string; km_aller_retour: number; cout_estime: number | null;
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
  projets: { id: number; nom: string; company_id: number }[];
  modeles_feuille: { id: number; nom: string }[];
  etiquettes: { id: number; nom: string }[];
  competences: { code: string; libelle: string }[];
  types_service: { id: number; nom: string; duree_defaut_h: number; competences: string[];
                   vehicule_requis: VehiculeRequis; nb_techniciens_defaut: number }[];
  avertissements: string[];
}
export interface AgencePlanif {
  code: string; nom: string; adresse: string; statut: 'active' | 'a_confirmer'; lat: number | null; lng: number | null;
  company_id: number | null; warehouse_id: number | null;
}
export interface ClientOdoo { id: number; nom: string; telephone: string | null; adresse: string }
export interface AdresseClient { id: number; nom: string; adresse: string; siege: boolean }

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

/** Erreur de l'API : statut HTTP + `detail` brut (422 : liste pydantic, ou { violations } pour une dérogation). */
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

/** Erreurs 422 de validation, par champ : { project_id: "…" }. */
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
  services: (debut?: string, fin?: string) => appel<ServicePlanif[]>('GET', '/services', { params: { debut, fin } }),
  creerService: (s: ServiceSaisie) => appel<ServicePlanif>('POST', '/services', { corps: s }),
  modifierService: (id: number, s: ServiceSaisie & { version: number }) =>
    appel<ServicePlanif>('PUT', `/services/${id}`, { corps: s }),
  supprimerService: (id: number) => appel<void>('DELETE', `/services/${id}`),
  ressources: (debut: string, fin: string) => appel<Ressources>('GET', '/ressources', { params: { debut, fin } }),
  proposer: (debut: string, fin: string) => appel<Proposition>('POST', '/proposer', { corps: { debut, fin } }),
  vehicules: (serviceId: number, params?: { matricules?: string; debut?: string; fin?: string }) =>
    appel<ChoixVehicule[]>('GET', `/vehicules/${serviceId}`, { params }),
  affecter: (serviceId: number, corps: CorpsAffectation) =>
    appel<ServicePlanif>('PUT', `/affectations/${serviceId}`, { corps }),
  publier: (debut: string, fin: string) =>
    appel<{ services: number; ids: number[] }>('POST', '/publier', { corps: { debut, fin } }),
  regles: () => appel<Regle[]>('GET', '/regles'),
  modifierRegle: (code: string, corps: Partial<Pick<Regle, 'niveau' | 'poids' | 'valeur'>>) =>
    appel<Regle>('PUT', `/regles/${code}`, { corps }),
  journal: (filtre: { objet_type?: string; objet_id?: string; limite?: number } = {}) =>
    appel<EntreeJournal[]>('GET', '/journal', { params: filtre }),
  referentiels: () => appel<Referentiels>('GET', '/referentiels'),
  agences: () => appel<AgencePlanif[]>('GET', '/agences'),
  clients: (q: string) => appel<ClientOdoo[]>('GET', '/clients', { params: { q } }),
  adressesClient: (id: number) => appel<AdresseClient[]>('GET', `/clients/${id}/adresses`),
};

export const LIBELLES_STATUT_PLANIF: Record<StatutPlanif, string> = {
  a_planifier: 'À planifier', propose: 'Proposé', verrouille: 'Verrouillé', publie: 'Publié',
};
export const LIBELLES_PRECISION: Record<string, string> = {
  adresse: 'adresse exacte', rue: 'rue', 'lieu-dit': 'lieu-dit', commune: 'commune seulement', saisie: 'saisie à la main',
};
