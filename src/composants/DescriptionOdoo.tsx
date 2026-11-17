// Description d'un service sur site (onglet « Description » du formulaire Odoo) : lue dans Odoo à l'affichage, jamais
// copiée dans la base de l'application (consultation journalisée, nom demandé si besoin). Mémoire de l'onglet du
// navigateur seulement : une lecture par service et par visite, « Relire » pour la relire.
import { useCallback, useEffect, useRef, useState } from 'react';
import { auteur, planif } from '../planification';

type Ecrire = <T>(action: () => Promise<T>) => Promise<T | undefined>;

const descriptionsLues = new Map<number, string | null>();

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
  const [texte, setTexte] = useState<string | null | undefined>(() => descriptionsLues.get(id));   // undefined : pas lue
  const [lecture, setLecture] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const demandee = useRef(false);
  const lire = useCallback(async () => {
    setLecture(true);
    setErreur(null);
    try {
      const r = await ecrire(() => planif.description(id));
      if (r) { descriptionsLues.set(id, r.texte); setTexte(r.texte); }
      else setErreur('Lecture annulée : chaque consultation est journalisée, le nom est donc demandé.');
    } catch (e) { setErreur(e instanceof Error ? e.message : String(e)); } finally { setLecture(false); }
  }, [ecrire, id]);
  useEffect(() => {                  // une seule lecture à l'affichage, si le nom est connu (sinon bouton : pas de surprise)
    if (simule || demandee.current || descriptionsLues.has(id) || !auteur()) return;
    demandee.current = true;
    void lire();
  }, [simule, id, lire]);

  return (
    <section className={`pf-description${titre ? '' : ' sans-titre'}`} aria-label="Description (Odoo)" aria-busy={lecture}>
      <div className="pf-description-tete">
        {titre && <h3>Description</h3>}
        <span className="pf-aide">{simule ? 'service simulé' : 'lue dans Odoo, jamais copiée'}</span>
        {!simule && texte !== undefined && !lecture && (
          <button type="button" className="lien-bouton" onClick={() => void lire()}>Relire</button>)}
      </div>
      {simule ? <p className="pf-description-vide">Service simulé : il n'existe pas dans Odoo, donc pas de description.</p>
        : lecture ? <div className="pf-description-chargement"><span className="visuellement-cache">Lecture dans Odoo…</span>
          <i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" /></div>
        : erreur ? <p className="pf-description-vide">{erreur}{' '}
          <button type="button" className="lien-bouton" onClick={() => void lire()}>Réessayer</button></p>
        : texte === undefined ? <p className="pf-description-vide">
          <button type="button" className="btn btn-petit" onClick={() => void lire()}>Lire la description</button>
          {' '}Consultation journalisée : votre nom sera demandé une fois.</p>
        : texte === null ? <p className="pf-description-vide">Aucune description dans Odoo.</p>
        : <TexteDescription texte={texte} />}
    </section>
  );
}
