// Bouton « Exporter (.xlsx) » : demande le nom si besoin (export journalisé), télécharge, affiche l'erreur éventuelle.
import { useState } from 'react';
import { enregistrerFichier } from '../exports';
import { useEcriture } from './Ecriture';

export function IconeTelechargement() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" className="icone-export">
      <path d="M8 2.5v7.5M4.8 7l3.2 3.2L11.2 7M3 12.5h10" fill="none" stroke="currentColor" strokeWidth="1.7"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BoutonExport({ libelle, nomFichier, lire, className = 'btn btn-export', desactive = false }: {
  libelle: string; nomFichier: string; lire: () => Promise<Blob>; className?: string; desactive?: boolean;
}) {
  const { ecrire, dialogue } = useEcriture();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const exporter = async () => {
    setEnCours(true);
    setErreur(null);
    try {
      const blob = await ecrire(lire);
      if (blob) enregistrerFichier(blob, nomFichier);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <>
      <button type="button" className={className} disabled={desactive || enCours} onClick={() => void exporter()}>
        <IconeTelechargement />{enCours ? 'Préparation du classeur…' : libelle}
      </button>
      {erreur && <span className="export-erreur" role="alert">{erreur}</span>}
      {dialogue}
    </>
  );
}
