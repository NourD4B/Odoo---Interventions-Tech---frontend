import { useState, type ReactNode } from 'react';
import { DemandeAuteur } from '../composants';
import { auteur, AuteurManquant, definirAuteur } from '../planification';

/** Écritures de la planification : si le nom de l'auteur manque, le demande (dialogue) puis relance l'action. */
export function useEcriture(): { ecrire: <T>(action: () => Promise<T>) => Promise<T | undefined>; dialogue: ReactNode } {
  const [attente, setAttente] = useState<null | ((nom: string | null) => void)>(null);

  const ecrire = async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await action();
    } catch (e) {
      if (!(e instanceof AuteurManquant)) throw e;
      const nom = await new Promise<string | null>((resolve) => setAttente(() => resolve));
      setAttente(null);
      if (!nom) return undefined;
      definirAuteur(nom);
      return action();
    }
  };

  const dialogue = attente
    ? <DemandeAuteur initial={auteur()} onValider={(nom) => attente(nom)} onAnnuler={() => attente(null)} />
    : null;
  return { ecrire, dialogue };
}
