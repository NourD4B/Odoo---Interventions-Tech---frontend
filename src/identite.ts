// Identité quand l'application est ouverte dans Odoo (module d4b_interventions). Odoo passe un jeton signé (utilisateur
// connecté) dans le fragment de l'adresse (#odoo_jeton=…&odoo_origine=…), jamais envoyé au serveur : il est gardé
// pour l'onglet (sessionStorage, sinon en mémoire), retiré de l'adresse, puis renouvelé par Odoo toutes les 20 minutes
// (message accepté de l'origine d'Odoo seulement). Chaque écriture l'envoie (en-tête X-Odoo-Jeton) : le serveur le
// vérifie et journalise sous le nom Odoo. Le nom lu ici sert seulement à l'affichage (« Bonjour … ») et à ne plus
// demander de nom. Hors d'Odoo : rien ne change (nom saisi, en-tête X-Auteur).
const CLE_JETON = 'd4b.odoo.jeton';
const CLE_ORIGINE = 'd4b.odoo.origine';
let jetonMemoire: string | null = null;
let origineMemoire: string | null = null;

function lire(cle: string): string | null {
  try { return sessionStorage.getItem(cle); } catch { return null; }
}
function ecrire(cle: string, valeur: string): void {
  try { sessionStorage.setItem(cle, valeur); } catch { /* stockage indisponible : mémoire seule */ }
}

export const jetonOdoo = (): string | null => jetonMemoire ?? lire(CLE_JETON);
export const origineOdoo = (): string | null => origineMemoire ?? lire(CLE_ORIGINE);

/** Nom de l'utilisateur Odoo d'après le jeton (affichage seulement : la signature est vérifiée par le serveur). */
export function nomOdoo(): string | null {
  const jeton = jetonOdoo();
  if (!jeton) return null;
  try {
    const b64 = jeton.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const octets = Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const nom = String((JSON.parse(new TextDecoder().decode(octets)) as { nom?: unknown }).nom ?? '').trim();
    return nom || null;
  } catch { return null; }
}

/** En-têtes d'identité d'une écriture : le nom (X-Auteur) et, dans Odoo, le jeton signé qui le remplace côté serveur. */
export function entetesAuteur(nom: string): Record<string, string> {
  const jeton = jetonOdoo();
  return { 'X-Auteur': encodeURIComponent(nom), ...(jeton ? { 'X-Odoo-Jeton': jeton } : {}) };
}

/** Au chargement de l'application : reprend le jeton passé par Odoo et écoute ses renouvellements. */
export function capterIdentiteOdoo(): void {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const jeton = fragment.get('odoo_jeton');
  const origine = fragment.get('odoo_origine');
  if (jeton !== null || origine !== null) {
    if (jeton) { jetonMemoire = jeton; ecrire(CLE_JETON, jeton); }
    if (origine) { origineMemoire = origine; ecrire(CLE_ORIGINE, origine); }
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }
  window.addEventListener('message', (e: MessageEvent) => {
    const attendue = origineOdoo();
    const d = e.data as { type?: unknown; jeton?: unknown } | null;
    if (!attendue || e.origin !== attendue || !d || d.type !== 'd4b-odoo-jeton' || typeof d.jeton !== 'string') return;
    jetonMemoire = d.jeton;
    ecrire(CLE_JETON, d.jeton);
  });
}
