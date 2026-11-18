// Brief du jour, sur la page d'accueil (hors de la conversation). Tout de suite : les phrases du modèle de phrases
// (sans IA). Avec un modèle choisi : son brief, rédigé une fois par jour et gardé par le serveur, donc rendu tout de
// suite aux ouvertures suivantes ; « Réécrire » en demande un nouveau. Un brief écarté (nombre absent des faits,
// panne, délai) laisse les phrases du modèle de phrases.
import { useEffect, useRef, useState } from 'react';
import { demanderBrief, SANS_IA, type BriefModele, type Phrase } from '../accueil';

const heure = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const secondes = (ms: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(ms / 1000)} s`;
const Points = () => <span className="as-points" aria-hidden="true"><i /><i /><i /></span>;

export default function BriefDuJour({ phrases, prenom, modele, libelleModele, libelleAction, onAction }: {
  phrases: Phrase[]; prenom: string | null; modele: string | null; libelleModele: (nom: string) => string;
  libelleAction: (cle: string) => string; onAction: (cle: string) => void;
}) {
  const [etat, setEtat] = useState<{ enCours: boolean; donnees: BriefModele | null; erreur: string | null }>(
    { enCours: false, donnees: null, erreur: null });
  const [rafraichir, setRafraichir] = useState(0);
  const forcer = useRef(false);                 // « Réécrire » : un nouveau brief, une fois (pas au changement de modèle)

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
  const texte = b && !b.repli ? b.texte : null;
  const actions = [...new Map(phrases.flatMap((p) => p.actions).map((a) => [a.categorie, a])).values()];

  return (
    <section className="br" aria-labelledby="br-titre" aria-busy={etat.enCours}>
      <h2 id="br-titre" className="br-bonjour">Bonjour{prenom ? ` ${prenom}` : ''}.</h2>
      {texte
        ? <p className="br-texte">{texte}</p>
        : <ul className="br-phrases">{phrases.map((p) => <li key={p.texte} className={`ton-${p.ton}`}>{p.texte}</li>)}</ul>}
      {actions.length > 0 && <span className="br-actions">{actions.map((a) => (
        <button key={a.categorie} type="button" onClick={() => onAction(a.categorie)}>{libelleAction(a.categorie)}</button>))}
      </span>}
      <footer className="br-pied">
        <p className="br-signature">
          {etat.enCours ? <><Points />{libelleModele(modele!)} rédige le brief du jour…</>
            : texte && b ? <>Rédigé par {libelleModele(b.modele)}{b.redige_le ? ` à ${heure(b.redige_le)}` : ''}
                {b.en_cache ? '' : ` en ${secondes(b.duree_ms)}`} ; chaque nombre vérifié dans les faits.</>
            : b?.repli ? <>{libelleModele(b.modele)} écarté ({b.raison}) : phrases écrites sans IA.</>
            : etat.erreur ? <>{libelleModele(modele!)} indisponible ({etat.erreur}) : phrases écrites sans IA.</>
            : <>Écrit sans IA, depuis la planification et Odoo.</>}
        </p>
        {avecIa && !etat.enCours && <button type="button" className="br-reecrire" onClick={() => { forcer.current = true; setRafraichir((n) => n + 1); }}>
          Réécrire</button>}
      </footer>
    </section>
  );
}
