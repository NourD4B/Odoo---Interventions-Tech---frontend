// Exports Excel (.xlsx) : projets et missions, dossier d'un projet, planification d'une période.
// Chaque export est journalisé côté serveur : en-tête X-Auteur (nom demandé une fois, comme pour les écritures).
import { lireAvecAuteur } from './flotte';

const requete = (params: Record<string, string>) => {
  const q = new URLSearchParams(params).toString();
  return q ? `?${q}` : '';
};

export const exportations = {
  projets: (debut?: string, fin?: string) =>
    lireAvecAuteur(`/api/exports/projets.xlsx${requete(debut && fin ? { debut, fin } : {})}`),
  dossier: (projectId: number) => lireAvecAuteur(`/api/exports/dossiers/${projectId}.xlsx`),
  planification: (debut: string, fin: string) => lireAvecAuteur(`/api/exports/planification.xlsx${requete({ debut, fin })}`),
};

/** Nom de fichier sans accents ni caractères spéciaux : « dossier_Deploiement-postes.xlsx ». */
export function nomFichier(...morceaux: string[]): string {
  const texte = morceaux.filter(Boolean).join('_').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${texte.slice(0, 80)}.xlsx`;
}

/** Propose le fichier au téléchargement. */
export function enregistrerFichier(blob: Blob, nom: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
