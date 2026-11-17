// Description d'un service sur site (champ « Description » du formulaire Odoo) : lue dans Odoo à chaque affichage,
// jamais copiée dans la base de l'application (consultation journalisée : le nom est demandé une fois s'il manque).
import { useCallback, useEffect, useRef, useState } from 'react';
import { planif } from '../planification';

type Ecrire = <T>(action: () => Promise<T>) => Promise<T | undefined>;

/** Texte de la description : paragraphes et listes à puces (« • » en début de ligne, posé par le serveur). */
function TexteDescription({ texte }: { texte: string }) {
  const blocs: ({ p: string } | { ul: string[] })[] = [];
  for (const ligne of texte.split('\n')) {
    const dernier = blocs[blocs.length - 1];
    if (!ligne.startsWith('• ')) blocs.push({ p: ligne });
    else if (dernier && 'ul' in dernier) dernier.ul.push(ligne.slice(2));
    else blocs.push({ ul: [ligne.slice(2)] });
  }
  return (
    <div className="pf-description-texte">
      {blocs.map((b, i) => ('ul' in b
        ? <ul key={i}>{b.ul.map((x, j) => <li key={j}>{x}</li>)}</ul> : <p key={i}>{b.p}</p>))}
    </div>
  );
}

export default function DescriptionOdoo({ id, simule, ecrire, titre = true }: {
  id: number; simule: boolean; ecrire: Ecrire;
  titre?: boolean;                       // false : dans un onglet « Description » (le titre est déjà l'onglet)
}) {
  const [texte, setTexte] = useState<string | null | undefined>(undefined);       // undefined : pas encore lue
  const [lecture, setLecture] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const demandee = useRef(false);
  const lire = useCallback(async () => {
    setLecture(true);
    setErreur(null);
    try {
      const r = await ecrire(() => planif.description(id));
      if (r) setTexte(r.texte);
      else setErreur('Nom non saisi : la description est lue dans Odoo et chaque consultation est journalisée.');
    } catch (e) { setErreur(e instanceof Error ? e.message : String(e)); } finally { setLecture(false); }
  }, [ecrire, id]);
  useEffect(() => {                                    // une lecture dans Odoo à chaque affichage
    if (simule || demandee.current) return;
    demandee.current = true;
    void lire();
  }, [simule, lire]);

  return (
    <section className={`pf-description${titre ? '' : ' sans-titre'}`} aria-label="Description" aria-busy={lecture}>
      {titre && <h3 className="pf-description-titre">Description</h3>}
      {simule ? <p className="pf-description-vide">Service simulé : il n'existe pas dans Odoo, donc pas de description.</p>
        : lecture || texte === undefined && !erreur
          ? <div className="pf-description-chargement"><span className="visuellement-cache">Lecture dans Odoo…</span>
            <i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" /></div>
        : erreur ? <p className="pf-description-vide">{erreur}{' '}
          <button type="button" className="lien-bouton" onClick={() => void lire()}>Réessayer</button></p>
        : texte === null ? <p className="pf-description-vide">Aucune description dans Odoo.</p>
        : <TexteDescription texte={texte!} />}
    </section>
  );
}
