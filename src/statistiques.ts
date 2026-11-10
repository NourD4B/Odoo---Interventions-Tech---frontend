// Client de l'API /api/statistiques (lecture seule) et /api/synchro (copie locale d'Odoo).
// Noms de champs identiques à l'API ; montants en euros HT sauf mention ; dates « AAAA-MM-JJ ».

export type EtatService = 'a_planifier' | 'planifie' | 'en_retard' | 'fait' | 'facture';

export interface LigneService {
  id: number; nom: string; simule: boolean; projet: { id: number; nom: string } | null; client: string | null;
  societe: string | null; etat: EtatService; etat_libelle: string; priorite: 'normale' | 'urgente';
  debut: string | null; fin: string | null; techniciens: string[]; vehicule: string | number | null;
  heures_prevues: number | null; heures_passees: number | null; km_estimes: number | null; ca_ht: number | null;
  marge_materiel: number | null; reste_a_facturer_ht: number | null; pct_livre: number | null;
  facturation: string | null; feuille_signee: boolean; sans_position: boolean;
}

export interface Argent {
  ca_ht: number; cout_materiel: number; marge_materiel: number; facture_ht: number; reste_a_facturer_ht: number;
  couts_estimes: number; marge_estimee: number;
}

export interface Tableau {
  periode: { debut: string; fin: string; jours_ouvres: number };
  compteurs: { planifies: number; faits: number; a_planifier: number; en_retard: number; total: number; dont_simules: number };
  par_jour: { date: string; planifies: number; techniciens: number; faits: number }[];
  par_technicien: { matricule: string; nom: string; agence: string | null; jours_planifies: number; services: number;
                    heures_passees: number; km_estimes: number; jours_ouvres: number; taux_charge_pct: number | null }[];
  autres_employes: { nom: string; heures_passees: number }[];
  par_vehicule: { vehicle_id: number; plaque: string | null; jours: number; services: number; km_estimes: number;
                  cout_estime: number }[];
  argent: Argent & { reste_a_facturer_faits_ht: number };
  par_projet: (Argent & { nom: string; services: number; faits: number })[];
  par_client: (Argent & { nom: string; services: number; faits: number })[];
  par_type_service: (Argent & { nom: string; services: number; faits: number })[];
  a_surveiller: Record<'en_retard' | 'faits_sans_feuille_signee' | 'faits_non_factures' | 'materiel_non_livre' |
                       'sans_position', LigneService[]>;
  services: LigneService[];
}

export interface Commande { id: number; nom: string; etat: string | null; montant_ht: number; montant_ttc?: number;
  marge: number | null; facturation: string | null; type_service: string | null }

export interface ResumeProjet extends Argent {
  id: number | null; nom: string; client: string | null; simule: boolean; services: number;
  par_etat: Record<EtatService, number>; avancement_pct: number | null; heures_prevues: number; heures_passees: number;
  km_estimes: number; commandes: Commande[]; commandes_ht: number; prochaine_intervention: string | null;
  en_retard: { id: number; nom: string }[];
}
export interface DetailProjet extends ResumeProjet { liste: LigneService[] }

export interface FicheService {
  id: number; nom: string; simule: boolean; odoo_url: string | null; projet: { id: number; nom: string } | null;
  client: string | null; societe: string | null; telephone: string | null;
  site: { adresse: string | null; lat: number | null; lng: number | null; precision: string | null };
  type_service: string | null; priorite: 'normale' | 'urgente'; etat: EtatService; etat_libelle: string;
  prevu: { debut: string | null; fin: string | null; fenetre: [string, string | null] | null; heures: number | null };
  planification: {
    statut: string; jours: string[]; debut: string | null; fin: string | null;
    techniciens: { matricule: string; nom: string; agence: string | null; jours: number }[];
    vehicule: { id: number; plaque: string | null } | null;
    trajet: { par_technicien: { matricule: string; jours: number; km: number | null; heures_route: number | null;
                                grand_deplacement: boolean | null; km_aller?: number; cause?: string }[];
              km_vehicule: number | null; heures_route: number | null; estime: boolean };
  };
  realise: {
    fait: boolean; fait_le: string | null; heures_passees: number | null;
    par_employe: { employee_id: number | null; nom: string | null; matricule: string | null; heures: number }[];
    depassement_h: number | null;
    sous_taches: { total: number; terminees: number; liste: { id: number; nom: string; terminee: boolean }[] };
    feuille: { modele_id: number | null; remplie: boolean; signee: boolean; envoyee: boolean };
  };
  materiel: {
    lignes: { id: number; commande: string | null; produit: string; type: string | null; quantite: number; livre: number;
              facture: number; prix_unitaire: number; sous_total_ht: number; cout_unitaire: number; cout_total: number;
              marge: number }[];
    quantite: number; livre: number; pct_livre: number | null;
    livraisons: { nom: string; etat: string | null; prevue: string | null; faite: string | null; type: string | null }[];
  };
  argent: {
    ca_ht: number; cout_materiel: number; marge_materiel: number; facture_ht: number; reste_a_facturer_ht: number;
    statut_facturation: string | null; statut_facturation_libelle: string | null; commandes: Commande[];
    factures: { id: number; nom: string; type: 'facture' | 'avoir'; etat: string | null; date: string | null;
                montant_ht: number; montant_ttc: number; reste_a_payer: number; paiement: string | null }[];
    factures_net_ht: number; reste_a_payer: number;
  };
  couts_estimes: { heures_travail: number; base_heures: 'passees' | 'prevues'; cout_horaire_moyen: number;
                   travail: number; route: number; vehicule: number; cout_km: number | null; total: number;
                   marge_estimee: number; estime: boolean; hors: string };
}

export interface EtatSynchro {
  intervalle_s: number; en_cours: boolean;
  modeles: { modele: string; derniere_synchro: string | null; dernier_write_date: string | null; nb_odoo: number | null;
             nb_local: number | null; nb_lus: number | null; duree_s: number | null; erreur: string | null }[];
}

export class ErreurStats extends Error {
  constructor(message: string, readonly statut: number) { super(message); }
}

async function lire<T>(chemin: string, params: Record<string, string | number | boolean | undefined> = {},
                       methode: 'GET' | 'POST' = 'GET'): Promise<T> {
  const url = new URL(chemin, window.location.origin);
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.set(k, String(v)); });
  const r = await fetch(url.toString(), { method: methode, headers: { Accept: 'application/json' } });
  if (!r.ok) {
    let detail = `erreur ${r.status}`;
    try { const corps = await r.json(); if (typeof corps.detail === 'string') detail = corps.detail; } catch { /* non JSON */ }
    throw new ErreurStats(detail, r.status);
  }
  return r.json() as Promise<T>;
}

export const stats = {
  tableau: (debut: string, fin: string, simules: boolean) =>
    lire<Tableau>('/api/statistiques/tableau', { debut, fin, simules }),
  projets: (simules: boolean) => lire<ResumeProjet[]>('/api/statistiques/projets', { simules }),
  projet: (id: number) => lire<DetailProjet>(`/api/statistiques/projets/${id}`),
  service: (id: number) => lire<FicheService>(`/api/statistiques/services/${id}`),
  synchro: () => lire<EtatSynchro>('/api/synchro'),
  synchroniser: () => lire<EtatSynchro>('/api/synchro', {}, 'POST'),
};

// ---------- mise en forme ----------

const EUROS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const EUROS_PRECIS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const NOMBRE = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const JOURS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];

export const euros = (x: number | null | undefined, precis = false) =>
  x === null || x === undefined ? '—' : (precis ? EUROS_PRECIS : EUROS).format(x);
export const nombre = (x: number | null | undefined) => (x === null || x === undefined ? '—' : NOMBRE.format(x));
export const heures = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${NOMBRE.format(x)} h`);
export function jourCourt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [a, m, j] = iso.slice(0, 10).split('-').map(Number);
  return `${JOURS[new Date(a, m - 1, j).getDay()]} ${String(j).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}
export function dateHeure(iso: string | null | undefined): string {
  if (!iso) return '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.length > 10 ? iso.slice(11, 16) : ''}`.trim();
}
export const LIBELLES_ETAT: Record<EtatService, string> = {
  a_planifier: 'À planifier', planifie: 'Planifié', en_retard: 'En retard', fait: 'Fait', facture: 'Facturé',
};
export const LIBELLES_FACTURATION: Record<string, string> = {
  no: 'rien à facturer', 'to invoice': 'à facturer', invoiced: 'facturé', upselling: 'vente additionnelle',
};
export const LIBELLES_LIVRAISON: Record<string, string> = {
  draft: 'brouillon', waiting: 'en attente', confirmed: 'en attente', assigned: 'prête', done: 'livrée', cancel: 'annulée',
};
export const LIBELLES_PAIEMENT: Record<string, string> = {
  not_paid: 'non payée', in_payment: 'en paiement', paid: 'payée', partial: 'partiellement payée',
  reversed: 'annulée par avoir', invoicing_legacy: 'historique',
};
