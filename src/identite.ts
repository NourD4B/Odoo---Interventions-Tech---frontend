// Mode Odoo (« npm run build:odoo ») : l'application est servie par le module Odoo d4b_interventions, sous
// /d4b_interventions/app, avec les mêmes écrans. Ses appels /api/… passent par Odoo (/d4b_interventions/api/…), qui
// vérifie la session Odoo, ajoute l'identité signée de l'utilisateur connecté et les relaie au backend : aucun nom à
// saisir, et le nom envoyé par le navigateur est ignoré. Le nom affiché (« Bonjour … ») vient de la page servie par
// Odoo (window.__D4B_ODOO__). Hors mode Odoo (npm run build, npm run dev) : rien ne change.
export const DANS_ODOO = import.meta.env.MODE === 'odoo';
export const RACINE = DANS_ODOO ? '/d4b_interventions/app' : '';          // racine des écrans (React Router)
const API_ODOO = '/d4b_interventions/api';
const ENTETE_APPEL = 'X-D4B-Interventions';                               // appel de l'application (contre le CSRF)

interface ConfigOdoo { nom?: string }
declare global { interface Window { __D4B_ODOO__?: ConfigOdoo } }

/** Nom de l'utilisateur Odoo connecté (mode Odoo) ; sinon null. */
export function nomOdoo(): string | null {
  return DANS_ODOO ? (window.__D4B_ODOO__?.nom ?? '').trim() || null : null;
}

/** Adresse d'un appel /api/… (mode Odoo : par le relais d'Odoo), pour ce qui n'est pas un fetch (image…). */
export function adresseApi(chemin: string): string {
  return DANS_ODOO && chemin.startsWith('/api/') ? API_ODOO + chemin.slice(4) : chemin;
}

/** En-tête d'identité d'une écriture hors d'Odoo (nom saisi) ; dans Odoo, le relais le remplace par l'utilisateur
 * connecté. */
export function entetesAuteur(nom: string): Record<string, string> {
  return { 'X-Auteur': encodeURIComponent(nom) };
}

/** Mode Odoo, au démarrage : chaque fetch vers /api/… de la même origine passe par le relais d'Odoo, avec l'en-tête
 * d'appel de l'application ; session Odoo terminée (renvoi vers la connexion) : la page Odoo est rechargée. */
export function installerModeOdoo(): void {
  if (!DANS_ODOO) return;
  const fetchNatif = window.fetch.bind(window);
  window.fetch = async (entree: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (entree instanceof Request) return fetchNatif(entree, init);
    const url = new URL(String(entree), window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return fetchNatif(entree, init);
    url.pathname = API_ODOO + url.pathname.slice(4);
    const entetes = new Headers(init?.headers);
    entetes.set(ENTETE_APPEL, '1');
    const reponse = await fetchNatif(url.href, { ...init, headers: entetes, credentials: 'same-origin' });
    if (reponse.redirected && new URL(reponse.url).pathname.startsWith('/web/login')) {
      window.top?.location.reload();                                       // reconnexion à Odoo
    }
    return reponse;
  };
}
