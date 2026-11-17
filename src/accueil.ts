// Accueil du dispatcher : faits du jour calculés par le serveur (GET /api/accueil) et brief écrit depuis ces faits.
export type Niveau = 'urgent' | 'attention' | 'info';
export type Ton = 'urgent' | 'attention' | 'normal' | 'ok';

export interface ElementATraiter {
  service_id: number; nom: string; client: string | null; jour: string | null; semaine: string;
  onglet: 'reglages' | null; detail: string | null;
}
export interface CategorieATraiter {
  cle: string; niveau: Niveau; libelle: string; action: string; nombre: number; elements: ElementATraiter[];
}
export interface ServiceDuJour {
  service_id: number; nom: string; client: string | null; ville: string | null; plaque: string | null;
  etat: string | null; jour_n: number; jours: number; semaine: string;
}
export interface Controles { equipe: boolean; vehicule: boolean; materiel: boolean; site: boolean; publie: boolean }
export interface Accueil {
  jour: string;
  a_traiter: CategorieATraiter[];
  aujourdhui: {
    jour: string; ouvre: boolean; libres: string[]; absents: string[];
    techniciens: { matricule: string; nom: string; agence: string | null; services: ServiceDuJour[] }[];
  };
  prochain: {
    jour: string; etiquette: string;
    services: { service_id: number; nom: string; client: string | null; ville: string | null; semaine: string;
                controles: Controles; pret: boolean }[];
  };
  brief: { texte: string; ton: Ton; actions: { categorie: string; libelle: string }[] }[];
  avertissements: string[];
}

export async function lireAccueil(): Promise<Accueil> {
  const r = await fetch('/api/accueil', { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`accueil : erreur ${r.status}`);
  return r.json() as Promise<Accueil>;
}

/** Fiche du service dans la Planification, sur la bonne semaine (onglet Réglages pour placer un site). */
export const lienFiche = (id: number, semaine: string, onglet: 'reglages' | null = null) =>
  `/planification?semaine=${semaine}&service=${id}${onglet ? `&onglet=${onglet}` : ''}`;
