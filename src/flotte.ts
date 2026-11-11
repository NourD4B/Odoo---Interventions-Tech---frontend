// API /api/flotte : véhicules (copie Odoo fleet.vehicle), fiche constructeur du modèle, rôle dans la planification,
// photos ajoutées dans l'application (Odoo n'a que les logos des marques). Écritures : en-tête X-Auteur.
import { auteur, AuteurManquant, ErreurPlanif } from './planification';

export interface PhotoVehicule { version: number; largeur: number; hauteur: number; auteur: string; ajoutee_le: string }

export interface SourceFiche { titre: string; url: string }
export interface FicheModele {
  statut: 'fiche' | 'a_preciser';
  // fiche
  id?: string; nom?: string; generation?: string; carrosserie?: Carrosserie; energie?: string;
  version_reference?: string; caracteristiques?: Record<string, number>; variantes?: string;
  sources?: SourceFiche[]; remarque?: string;
  // à préciser
  odoo?: string | string[]; raison?: string;
}
export type Carrosserie = 'citadine' | 'compacte' | 'break' | 'suv' | 'fourgonnette' | 'fourgon' | 'scooter';

export interface AffectationVehicule {
  service_id: number; service: string; client: string | null; debut: string; fin: string; etat: string;
}

export interface VehiculeFlotte {
  id: number; plaque: string; name: string; marque: string | null; modele: string | null; model_name: string | null;
  categorie: string | null; type_planification: 'voiture' | 'utilitaire' | 'exclu';
  attribution: 'pool' | 'attitre' | 'exclu'; conducteur: string | null; conducteur_matricule: string | null;
  agence_code: string | null; location: string | null; etat: string | null; immatricule: boolean;
  energie: string | null; boite: string | null; places: number; portes: number; couleur: string | null;
  annee_modele: string | null; date_immatriculation: string | null; puissance_ch: number | null;
  puissance_kw: number | null; co2_g_km: number | null; compteur: number | null; compteur_unite: string | null;
  autonomie_km: number | null; attelage: boolean; photo: PhotoVehicule | null; fiche: FicheModele | null;
  a_verifier: string[]; registre: LigneRegistre | null; retenu: Retenu; prochaines: AffectationVehicule[];
  jours_reserves_30j: number;
}

/** Valeur exacte de chaque champ : Odoo, corrigé par le registre flotte quand Odoo se trompe (`corriges`). */
export interface Retenu {
  marque: string | null; modele: string | null; energie: string | null; categorie: string | null;
  couleur: string | null; lieu: string | null; annee: number | null; service: boolean; restitue: boolean;
  corriges: ('modele' | 'energie' | 'categorie' | 'couleur' | 'lieu' | 'annee' | 'attribution')[];
}

// ---------- traçabilité (PV) ----------

/** Pièce jointe Odoo (avis de contravention, désignation, carte grise…), ouverte à la demande. */
export interface PieceJointe { id: number; nom: string; type: string | null; taille: number; ajoutee_le: string | null }

/** Affectation Odoo Fleet : `employe` = conducteur réel, y compris pour un véhicule de service. */
export interface AffectationFleet {
  id: number; conducteur: string | null; pool: boolean; employe_id: number | null; employe: string | null;
  debut: string | null; fin: string | null; pieces: PieceJointe[];
}

export interface ConducteurVehicule {
  nom: string; employe_ids: number[]; departement: string | null; societe: string | null;
  matricule: string | null; agence: string | null; nb_pieces: number;
  fonction: string | null;            // fonction SPOC
  technicien: boolean;                // technicien terrain (profil de planification : matricule et agence)
  parti: boolean;                     // « Inactif » dans SPOC
  fiche_archivee: boolean;            // seulement des fiches employé archivées dans Odoo
  affectations: { id: number; debut: string | null; fin: string | null; nb_pieces: number }[];
}

export interface MembreEquipe { matricule: string; nom: string; agence: string | null; jours: string[]; etat: string; conducteur: boolean }

export interface MissionVehicule {
  id: number; service_id: number; service: string; client: string | null; site: string | null; statut: string;
  debut: string; fin: string; jours_ouvres: number; etat: string; propose_par: string; raison: string | null;
  motif: string | null; conducteur: string | null; conducteur_matricule: string | null; equipe: MembreEquipe[];
}

export interface DetailVehicule {
  avertissements: string[]; vehicule: VehiculeFlotte; missions: MissionVehicule[]; historique: AffectationFleet[];
  conducteurs: ConducteurVehicule[]; documents: PieceJointe[]; historique_disponible: boolean;
}

export interface ConducteurDuJour {
  date: string; conducteur: string | null; message: string; affectations: AffectationFleet[];
  missions: { service_id: number; service: string; client: string | null; site: string | null; debut: string;
    fin: string; etat: string; conducteur: string | null; equipe: string[] }[];
}

/** Ligne du registre flotte de D4B (référence du modèle réel ; aucun nom de conducteur). */
export interface LigneRegistre {
  constructeur: string; modele: string; couleur: string | null; carburant: string; carburant_libelle: string;
  type: 'VL' | 'UL' | 'SC' | string; type_libelle: string; annee: number | null; localisation: string | null;
  attribution: 'service' | 'nominatif' | string; commentaire: string | null;
}

export interface Flotte {
  avertissements: string[]; agences: { code: string; nom: string }[]; vehicules: VehiculeFlotte[];
  masques: number;                    // véhicules attribués à une personne ou restitués (hors périmètre)
}

export const ENERGIES: Record<string, string> = {
  gasoline: 'Essence', diesel: 'Diesel', electric: 'Électrique', full_hybrid: 'Hybride', hybrid: 'Hybride',
  plug_in_hybrid_gasoline: 'Hybride rechargeable essence', plug_in_hybrid_diesel: 'Hybride rechargeable diesel',
  lpg: 'GPL', cng: 'GNV', hydrogen: 'Hydrogène',
};
export const BOITES: Record<string, string> = { manual: 'Manuelle', automatic: 'Automatique' };
export const ROLES: Record<VehiculeFlotte['attribution'], string> = {
  pool: 'Pool', attitre: 'Attitré', exclu: 'Hors planification',
};

async function envoyer<T>(methode: string, chemin: string, corps?: Blob, type?: string): Promise<T> {
  const entetes: Record<string, string> = { Accept: 'application/json' };
  if (methode !== 'GET') {
    const nom = auteur();
    if (!nom) throw new AuteurManquant('Indiquez votre nom (journal des modifications)');
    entetes['X-Auteur'] = encodeURIComponent(nom);
  }
  if (type) entetes['Content-Type'] = type;
  const reponse = await fetch(`/api/flotte${chemin}`, { method: methode, headers: entetes, body: corps });
  if (!reponse.ok) {
    let detail: unknown = null;
    try { detail = (await reponse.json()).detail; } catch { /* corps non JSON */ }
    throw new ErreurPlanif(typeof detail === 'string' ? detail : `erreur ${reponse.status}`, reponse.status, detail);
  }
  return (reponse.status === 204 ? undefined : await reponse.json()) as T;
}

/** Pièce jointe lue dans Odoo ; consultation journalisée, donc nom de la personne obligatoire (X-Auteur). */
export async function lireAvecAuteur(url: string): Promise<Blob> {
  const nom = auteur();
  if (!nom) throw new AuteurManquant('Indiquez votre nom : chaque consultation de pièce est journalisée');
  const reponse = await fetch(url, { headers: { 'X-Auteur': encodeURIComponent(nom) } });
  if (!reponse.ok) {
    let detail: unknown = null;
    try { detail = (await reponse.json()).detail; } catch { /* corps non JSON */ }
    throw new ErreurPlanif(typeof detail === 'string' ? detail : `erreur ${reponse.status}`, reponse.status, detail);
  }
  return reponse.blob();
}

export const flotte = {
  vehicules: () => envoyer<Flotte>('GET', '/vehicules'),
  vehicule: (id: number) => envoyer<DetailVehicule>('GET', `/vehicules/${id}`),
  conducteurLe: (id: number, jour: string) =>
    envoyer<ConducteurDuJour>('GET', `/vehicules/${id}/conducteur?date=${encodeURIComponent(jour)}`),
  piece: (id: number) => lireAvecAuteur(`/api/flotte/pieces/${id}`),
  deposerPhoto: (id: number, fichier: File) => envoyer<PhotoVehicule>('PUT', `/vehicules/${id}/photo`, fichier,
    fichier.type || 'image/jpeg'),
  retirerPhoto: (id: number) => envoyer<void>('DELETE', `/vehicules/${id}/photo`),
  urlPhoto: (id: number, photo: PhotoVehicule, taille: 'vignette' | 'grande' = 'vignette') =>
    `/api/flotte/vehicules/${id}/photo?taille=${taille}&v=${photo.version}`,
};
