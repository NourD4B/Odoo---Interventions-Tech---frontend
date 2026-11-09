import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/** Charge une donnée de l'API, avec état de chargement, erreur et rechargement. */
export function useDonnees<T>(charger: () => Promise<T>, deps: unknown[]) {
  const [donnees, setDonnees] = useState<T | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  const dernier = useRef(0);       // seule la dernière requête lancée met l'écran à jour (semaine changée entre-temps)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recharger = useCallback(() => {
    const numero = ++dernier.current;
    setChargement(true);
    setErreur(null);
    charger()
      .then((d) => { if (numero === dernier.current) setDonnees(d); })
      .catch((e: Error) => { if (numero === dernier.current) setErreur(e.message); })
      .finally(() => { if (numero === dernier.current) setChargement(false); });
  }, deps);

  useEffect(() => { recharger(); }, [recharger]);
  return { donnees, erreur, chargement, recharger };
}

/** Nom de la personne qui modifie la planification (journal), demandé à la première écriture. */
export function DemandeAuteur({ initial, onValider, onAnnuler }: { initial: string | null;
  onValider: (nom: string) => void; onAnnuler: () => void }) {
  const [nom, setNom] = useState(initial ?? '');
  const valide = nom.trim().length >= 2 && nom.trim().length <= 80;
  return (
    <div className="voile" role="dialog" aria-modal="true" aria-labelledby="titre-auteur">
      <form className="dialogue" onSubmit={(e) => { e.preventDefault(); if (valide) onValider(nom.trim()); }}>
        <h2 id="titre-auteur">Votre nom</h2>
        <p className="muet">Chaque modification de la planification est enregistrée dans le journal avec ce nom.</p>
        <label className="champ">Nom
          <input autoFocus value={nom} maxLength={80} onChange={(e) => setNom(e.target.value)} placeholder="Prénom Nom" />
        </label>
        <div className="actions">
          <button type="button" className="btn" onClick={onAnnuler}>Annuler</button>
          <button type="submit" className="btn btn-primaire" disabled={!valide}>Continuer</button>
        </div>
      </form>
    </div>
  );
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
  const mots = nom.split(/\s+/).map((m) => m.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  return ((mots[0]?.[0] ?? '') + (mots[1]?.[0] ?? '')).toUpperCase();
}

export const COULEURS_STATUT: Record<string, string> = {
  sur_site: '#1d4ed8', en_cours: '#1d4ed8', planifiee: '#b45309', a_planifier: '#b45309',
  terminee: '#5b6170', annulee: '#5b6170',
};

export const COULEURS_ACTIVITE: Record<string, string> = {
  sur_site: '#1d4ed8', en_route: '#b45309', termine: '#5b6170', sans_intervention: '#0f766e',
  sans_gps: '#92400e', non_associe: '#8892a6',
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
