// Pièces jointes lues dans Odoo à l'ouverture (jamais copiées) ; chaque consultation est journalisée, d'où le nom
// de la personne demandé avant la première ouverture. Partagé par la fiche véhicule (PV) et le dossier projet.
import { useState } from 'react';
import { auteur } from '../planification';
import type { PieceJointe } from '../flotte';
import { useEcriture } from './Ecriture';
import { jour, nombre } from './Vehicule';

export const EN_LIGNE = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export const taille = (o: number) => (o >= 1_048_576 ? `${nombre(o / 1_048_576)} Mo` : `${nombre(Math.max(1, o / 1024), 0)} Ko`);

export function genre(p: PieceJointe) {
  if (p.type === 'application/pdf') return 'PDF';
  if (p.type?.startsWith('image/')) return 'Image';
  return (p.nom.split('.').pop() ?? 'Fichier').toUpperCase().slice(0, 5);
}

/** Ouverture des pièces : `lire` va chercher le contenu (route de la flotte ou du dossier projet). */
export function usePieces(lire: (id: number) => Promise<Blob>) {
  const { ecrire, dialogue } = useEcriture();
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<number | null>(null);

  const telecharger = (url: string, nom: string) => {
    const a = document.createElement('a');
    a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove();
  };
  const ouvrir = async (p: PieceJointe) => {
    setErreur(null); setEnCours(p.id);
    const enLigne = EN_LIGNE.includes(p.type ?? '');
    // onglet ouvert pendant le clic (sinon bloqué comme fenêtre surgissante), rempli une fois la pièce lue
    const onglet = enLigne && auteur() ? window.open('', '_blank') : null;
    try {
      const contenu = await ecrire(() => lire(p.id));
      if (!contenu) { onglet?.close(); return; }
      const url = URL.createObjectURL(contenu);
      if (!enLigne) telecharger(url, p.nom);
      else if (onglet) onglet.location.href = url;
      else if (!window.open(url, '_blank')) telecharger(url, p.nom);
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch (e) {
      onglet?.close();
      setErreur(`${p.nom} : ${e instanceof Error ? e.message : String(e)}`);
    } finally { setEnCours(null); }
  };
  return { ouvrir, enCours, erreur, dialogue };
}
export type Pieces = ReturnType<typeof usePieces>;

export function ListePieces({ liste, pieces, vide = 'Aucune pièce jointe.' }: { liste: PieceJointe[]; pieces: Pieces; vide?: string }) {
  if (!liste.length) return <p className="fv-sans-piece">{vide}</p>;
  return (
    <ul className="fv-pieces">{liste.map((p) => (
      <li key={p.id}>
        <button type="button" className="fv-piece" onClick={() => void pieces.ouvrir(p)} disabled={pieces.enCours === p.id}
          title={EN_LIGNE.includes(p.type ?? '') ? 'Ouvrir dans un nouvel onglet (lu dans Odoo)' : 'Télécharger (lu dans Odoo)'}>
          <span className={`fv-piece-type${genre(p) === 'PDF' ? ' pdf' : ''}`} aria-hidden="true">{genre(p)}</span>
          <span className="fv-piece-nom">{p.nom}</span>
          <span className="fv-piece-meta">{pieces.enCours === p.id ? 'Ouverture…'
            : [taille(p.taille), p.ajoutee_le && `ajoutée le ${jour(p.ajoutee_le)}`].filter(Boolean).join(' · ')}</span>
        </button>
      </li>))}
    </ul>
  );
}

/** Pièce jointe en pastille compacte (nom complet, taille et date en info-bulle) : un clic l'ouvre. */
export function PastillePiece({ p, pieces }: { p: PieceJointe; pieces: Pieces }) {
  return (
    <button type="button" className="fv-pastille-piece" onClick={() => void pieces.ouvrir(p)} disabled={pieces.enCours === p.id}
      title={`${p.nom} · ${taille(p.taille)}${p.ajoutee_le ? ` · ajoutée le ${jour(p.ajoutee_le)}` : ''}`}>
      <span className={`fv-piece-type${genre(p) === 'PDF' ? ' pdf' : ''}`} aria-hidden="true">{genre(p)}</span>
      <span className="fv-pastille-nom">{pieces.enCours === p.id ? 'Ouverture…' : p.nom}</span>
    </button>
  );
}
