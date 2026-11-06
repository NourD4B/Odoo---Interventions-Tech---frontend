import { useCallback, useEffect, useState, type ReactNode } from 'react';

/** Charge une donnée de l'API, avec état de chargement, erreur et rechargement. */
export function useDonnees<T>(charger: () => Promise<T>, deps: unknown[]) {
  const [donnees, setDonnees] = useState<T | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recharger = useCallback(() => {
    setChargement(true);
    setErreur(null);
    charger()
      .then(setDonnees)
      .catch((e: Error) => setErreur(e.message))
      .finally(() => setChargement(false));
  }, deps);

  useEffect(() => { recharger(); }, [recharger]);
  return { donnees, erreur, chargement, recharger };
}

export function Badge({ type, children }: { type: string; children: ReactNode }) {
  return <span className={`badge b-${type}`}>{children}</span>;
}

export function Avertissements({ liste }: { liste: string[] | undefined }) {
  if (!liste?.length) return null;
  return (
    <div className="avertissements" role="status">
      {liste.map((a) => <div key={a} className="avertissement">{a}</div>)}
    </div>
  );
}

export function EtatChargement({ chargement, erreur }: { chargement: boolean; erreur: string | null }) {
  if (erreur) return <div className="erreur" role="alert">{erreur}</div>;
  if (chargement) return <div className="vide">Chargement…</div>;
  return null;
}

export function initiales(nom: string): string {
  const mots = nom.split(/\s+/).filter(Boolean);
  return ((mots[0]?.[0] ?? '') + (mots[1]?.[0] ?? '')).toUpperCase();
}

export const COULEURS_STATUT: Record<string, string> = {
  sur_site: '#1d4ed8', en_cours: '#1d4ed8', planifiee: '#b45309', a_planifier: '#b45309',
  terminee: '#5b6170', annulee: '#5b6170',
};

export function heure(iso: string | null): string {
  if (!iso || iso.length < 16) return '';
  return iso.slice(11, 16);
}

/** Affiche « Odoo / HFSQL » pour une valeur qui diffère entre les deux sources. */
export function ListeEcarts({ ecarts }: { ecarts: { champ: string; odoo: string | null; hfsql: string | null; message: string }[] }) {
  if (!ecarts.length) return null;
  return (
    <ul className="ecarts">
      {ecarts.map((e) => (
        <li key={e.champ}>{e.message}{(e.odoo || e.hfsql) && ` — Odoo : ${e.odoo ?? '—'} · HFSQL : ${e.hfsql ?? '—'}`}</li>
      ))}
    </ul>
  );
}
