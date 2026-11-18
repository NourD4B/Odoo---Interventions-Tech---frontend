// Brief du jour, en haut de l'accueil. En tête : la salutation et, si le modèle local est là, son résumé en deux
// phrases, synchronisé avec les données : redemandé à chaque mise à jour de l'accueil (synchronisation Odoo,
// affectation…) ; le serveur le garde tant que les faits ne changent pas et en fait rédiger un nouveau sinon. Pendant
// la rédaction, le résumé précédent reste affiché (ni attente ni bouton). Dessous : une ligne par sujet (ce qui presse,
// aujourd'hui, le prochain jour ouvré, le reste à voir), écrite sans IA depuis les faits, avec son icône à la couleur du
// ton et ses boutons d'action. Un résumé écarté (nombre absent des faits, panne, délai) laisse les lignes seules.
import { useEffect, useState } from 'react';
import { demanderBrief, SANS_IA, type Phrase } from '../accueil';
import { Icone } from './ReponseAssistant';

const ICONES: Record<string, string> = { urgent: 'alerte', attention: 'liste', ok: 'libre', normal: 'calendrier' };

export default function BriefDuJour({ phrases, prenom, modele, version, libelleAction, onAction }: {
  phrases: Phrase[]; prenom: string | null; modele: string | null; version: unknown;
  libelleAction: (cle: string) => string; onAction: (cle: string) => void;
}) {
  const [resume, setResume] = useState<string | null>(null);

  useEffect(() => {                              // à chaque mise à jour des données : le résumé qui leur correspond
    if (!modele || modele === SANS_IA) { setResume(null); return; }
    const arret = new AbortController();
    demanderBrief(modele, false, arret.signal)
      .then((b) => setResume(b.repli ? null : b.texte))
      .catch(() => { if (!arret.signal.aborted) setResume(null); });
    return () => arret.abort();
  }, [modele, version]);

  return (
    <section className="br" aria-labelledby="br-titre">
      <header className="br-tete">
        <h2 id="br-titre" className="br-bonjour">Bonjour{prenom ? ` ${prenom}` : ''} 👋</h2>
      </header>

      {resume && <p key={resume} className="br-resume">{resume}</p>}

      <ul className="br-lignes">
        {phrases.map((p) => (
          <li key={p.texte} className={`br-ligne ton-${p.ton}`}>
            <span className="br-pastille" aria-hidden="true">
              <Icone nom={p.texte.startsWith('À voir aussi') ? 'cloche' : ICONES[p.ton] ?? 'calendrier'} taille={16} /></span>
            <p>{p.texte}</p>
            {p.actions.length > 0 && <span className="br-actions">{p.actions.map((a) => (
              <button key={a.categorie} type="button" onClick={() => onAction(a.categorie)}>{libelleAction(a.categorie)}</button>))}
            </span>}
          </li>))}
      </ul>
    </section>
  );
}
