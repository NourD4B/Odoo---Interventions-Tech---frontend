// Brief du jour, en haut de l'accueil. En tête : la salutation et, si le modèle local est là, son résumé en deux
// phrases (rédigé une fois par jour et gardé par le serveur ; « Réécrire » en demande un nouveau). Dessous : une ligne
// par sujet (ce qui presse, aujourd'hui, le prochain jour ouvré, le reste à voir), écrite sans IA depuis les faits,
// avec son icône à la couleur du ton et ses boutons d'action. Un résumé écarté (nombre absent des faits, panne, délai)
// laisse les lignes seules.
import { useEffect, useRef, useState } from 'react';
import { demanderBrief, SANS_IA, type BriefModele, type Phrase } from '../accueil';
import { Icone } from './ReponseAssistant';

const heure = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const Points = () => <span className="as-points" aria-hidden="true"><i /><i /><i /></span>;
const ICONES: Record<string, string> = { urgent: 'alerte', attention: 'liste', ok: 'libre', normal: 'calendrier' };

export default function BriefDuJour({ phrases, prenom, modele, libelleModele, libelleAction, onAction }: {
  phrases: Phrase[]; prenom: string | null; modele: string | null; libelleModele: (nom: string) => string;
  libelleAction: (cle: string) => string; onAction: (cle: string) => void;
}) {
  const [etat, setEtat] = useState<{ enCours: boolean; donnees: BriefModele | null; erreur: string | null }>(
    { enCours: false, donnees: null, erreur: null });
  const [rafraichir, setRafraichir] = useState(0);
  const forcer = useRef(false);                 // « Réécrire » : un nouveau résumé, une fois

  useEffect(() => {
    if (!modele || modele === SANS_IA) { setEtat({ enCours: false, donnees: null, erreur: null }); return; }
    const arret = new AbortController();
    const nouveau = forcer.current;
    forcer.current = false;
    setEtat((e) => ({ ...e, enCours: true, erreur: null }));
    demanderBrief(modele, nouveau, arret.signal)
      .then((b) => setEtat({ enCours: false, donnees: b, erreur: null }))
      .catch((e: Error) => { if (!arret.signal.aborted) setEtat({ enCours: false, donnees: null, erreur: e.message }); });
    return () => arret.abort();
  }, [modele, rafraichir]);

  const avecIa = !!modele && modele !== SANS_IA;
  const b = etat.donnees;
  const resume = b && !b.repli ? b.texte : null;

  return (
    <section className="br" aria-labelledby="br-titre" aria-busy={etat.enCours}>
      <header className="br-tete">
        <h2 id="br-titre" className="br-bonjour">Bonjour{prenom ? ` ${prenom}` : ''} 👋</h2>
        {avecIa && !etat.enCours && <button type="button" className="br-reecrire"
          onClick={() => { forcer.current = true; setRafraichir((n) => n + 1); }}>Réécrire</button>}
      </header>

      {(resume || etat.enCours) && (
        <p className={`br-resume${etat.enCours ? ' attente' : ''}`}>
          {etat.enCours ? <><Points /><span>{libelleModele(modele!)} résume la journée…</span></> : resume}
        </p>)}

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

      <p className="br-signature">
        {resume && b ? <>Résumé par {libelleModele(b.modele)}{b.redige_le ? ` à ${heure(b.redige_le)}` : ''} ; chaque nombre
          vérifié dans les faits. Lignes écrites sans IA depuis la planification et Odoo.</>
          : b?.repli ? <>Résumé écarté ({b.raison}) : lignes écrites sans IA depuis la planification et Odoo.</>
          : etat.erreur ? <>Résumé indisponible ({etat.erreur}) : lignes écrites sans IA.</>
          : <>Écrit sans IA, depuis la planification et Odoo.</>}
      </p>
    </section>
  );
}
