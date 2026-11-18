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

// ---------- assistant : petit modèle local (Ollama, CPU seulement), vérifié par le serveur ----------

export const SANS_IA = 'sans_ia';
export interface ModeleAssistant { nom: string; libelle: string; taille: string | null }
export interface Modeles { ollama: boolean; erreur: string | null; defaut: string; modeles: ModeleAssistant[] }
export type Phrase = Accueil['brief'][number];
/** Brief d'un modèle : gardé par le serveur pour la journée (`en_cache`), `redige_le` = heure de rédaction. */
export interface BriefModele {
  modele: string; phrases: Phrase[]; texte: string | null; duree_ms: number; repli: boolean; raison: string | null;
  en_cache: boolean; redige_le: string | null;
}
/** Réponse à une question : `source` « modele » (reformulée, nombres vérifiés) ou « logiciel » (résultat de l'outil tel
 * quel, ou ce que l'assistant sait faire). `outils` : outils choisis par le modèle (lecture seule). */
export interface ReponseModele {
  modele: string; reponse: string | null; duree_ms: number; repli: boolean; raison: string | null;
  source: 'modele' | 'logiciel' | null; outils: { nom: string; arguments: Record<string, string> }[];
  donnees: string | null;                        // résultat des outils, mis en forme sous la phrase du modèle
}
export interface ReponseOutil { outil: string; reponse: string; source: 'logiciel'; duree_ms: number }

async function envoyer<T>(chemin: string, corps: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`/api/accueil${chemin}`, { method: 'POST', signal,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
  if (!r.ok) throw new Error(`assistant : erreur ${r.status}`);
  return r.json() as Promise<T>;
}
export async function lireModeles(): Promise<Modeles> {
  const r = await fetch('/api/accueil/modeles', { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`modèles : erreur ${r.status}`);
  return r.json() as Promise<Modeles>;
}
/** Brief du jour : celui gardé par le serveur (tout de suite), ou un nouveau avec `rafraichir` (« Réécrire »). */
export const demanderBrief = (modele: string, rafraichir = false, signal?: AbortSignal) =>
  envoyer<BriefModele>('/assistant/brief', { modele, rafraichir }, signal);
/** Question libre ; `historique` : derniers échanges de la conversation (3 au plus), pour « et demain ? ». */
export interface Echange { question: string; reponse: string }
export const poserQuestion = (modele: string, question: string, historique: Echange[] = [], signal?: AbortSignal) =>
  envoyer<ReponseModele>('/assistant/question', { modele, question, historique }, signal);
/** Suggestion : l'outil répond directement, sans modèle (tout de suite, même sans Ollama). */
export const outilDirect = (outil: string, args: Record<string, string> = {}, signal?: AbortSignal) =>
  envoyer<ReponseOutil>('/assistant/outil', { outil, arguments: args }, signal);

/** Fiche du service dans la Planification, sur la bonne semaine (onglet Réglages pour placer un site). */
export const lienFiche = (id: number, semaine: string, onglet: 'reglages' | null = null) =>
  `/planification?semaine=${semaine}&service=${id}${onglet ? `&onglet=${onglet}` : ''}`;
