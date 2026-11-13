// Client de l'API /api/stock (lecture seule de la copie Odoo) : page « Matériel et traçabilité ».
// Noms de champs identiques à l'API ; quantités en unités ; « sorti » et « retour » = 30 derniers jours.

export interface CarteAgence {
  cle: string; nom: string; agence: string | null; unites: number; articles: number; reserve: number;
  sorti: number; retour: number; negatifs: number;
}

// sorti / retour : faits sur 30 jours ; reserve : en attente (préparation et livraison d'une ligne comptées une fois)
export interface InterventionProduit {
  id: number; nom: string; sorti: number; retour: number; reserve: number; etat: 'reserve' | 'sorti';
}

export interface ProduitAgence {
  produit: { id: number; nom: string; reference: string | null };
  stock: number; reserve: number; sorti: number; retour: number; negatif: boolean;
  interventions: InterventionProduit[];
}

export interface Tracabilite {
  a_jour_le: string | null; fenetre_jours: number; cle: string; cartes: CarteAgence[]; produits: ProduitAgence[];
}

export type TypeEvenement = 'recu' | 'transfert' | 'reserve' | 'livre' | 'retour' | 'ajustement';

export interface Evenement {
  type: TypeEvenement; titre: string; texte: string; date: string | null; jour: string; document: string | null;
  intervention: { id: number; nom: string } | null;
}

export interface Parcours {
  id: number; nom: string; reference: string | null; suivi_stock: boolean; total: number; reserve: number;
  sorti: number; fenetre_jours: number; cle: string;
  repartition: { cle: string; nom: string; stock: number; emplacements: string[] }[];
  parcours: Evenement[];
}

async function lire<T>(chemin: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(chemin, window.location.origin);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!r.ok) {
    let detail = `${r.status}`;
    try { detail = (await r.json()).detail ?? detail; } catch { /* corps non JSON */ }
    throw new Error(`Erreur ${chemin} : ${detail}`);
  }
  return r.json() as Promise<T>;
}

export const stock = {
  tracabilite: (agence: string) => lire<Tracabilite>('/api/stock/tracabilite', { agence }),
  parcours: (id: number, agence: string) => lire<Parcours>(`/api/stock/tracabilite/produits/${id}`, { agence }),
};

const NOMBRE = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
export const qte = (x: number) => NOMBRE.format(x).replace('-', '−');
