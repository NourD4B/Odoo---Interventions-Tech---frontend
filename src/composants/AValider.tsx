// « À valider » (accueil) : les affectations proposées (par le solveur, ou choisies sans verrou) qui attendent un
// planificateur. « Valider » les publie telles quelles (équipe, dates, véhicule) ; « Refuser » retire la proposition après une confirmation sur la ligne (le service repasse à planifier).
// Chaque action passe par l'API de la planification (journalisée sous le nom saisi) ; Odoo n'est jamais modifié.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { lienFiche, type Proposition } from '../accueil';
import { planif } from '../planification';

const MAX = 4;                                        // lignes montrées ; le reste dans la planification
const JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
export const jourCourt = (iso: string) =>
  `${JOURS_COURTS[new Date(`${iso}T12:00:00`).getDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const periodeCourte = (debut: string, fin: string) =>
  debut === fin ? jourCourt(debut) : `${jourCourt(debut)} → ${jourCourt(fin)}`;

function Etincelle() {
  return <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
    <path d="M12 3.5 13.9 9a2 2 0 0 0 1.2 1.2l5.4 1.8-5.4 1.9a2 2 0 0 0-1.2 1.2L12 20.5l-1.9-5.4a2 2 0 0 0-1.2-1.2L3.5 12l5.4-1.8A2 2 0 0 0 10.1 9z" />
  </svg>;
}

export default function AValider({ propositions, moi, onFait }: {
  propositions: Proposition[]; moi: string | null; onFait: () => void;
}) {
  const [occupe, setOccupe] = useState<number | null>(null);
  const [aConfirmer, setAConfirmer] = useState<number | null>(null);
  const [traites, setTraites] = useState<Set<number>>(() => new Set());
  const [erreur, setErreur] = useState<{ id: number; texte: string } | null>(null);
  const [annonce, setAnnonce] = useState('');

  const agir = async (p: Proposition, valider: boolean) => {
    setOccupe(p.service_id); setErreur(null);
    try {
      if (valider) await planif.valider(p.service_id, p.version);
      else await planif.retirerAffectation(p.service_id, p.version);
      setTraites((t) => new Set(t).add(p.service_id));
      setAConfirmer(null);
      setAnnonce(valider ? `« ${p.nom} » validée et publiée.`
        : `Proposition retirée : « ${p.nom} » repasse à planifier.`);
      onFait();
    } catch (e) {
      setErreur({ id: p.service_id, texte: e instanceof Error ? e.message : String(e) });
    } finally { setOccupe(null); }
  };

  const restantes = propositions.filter((p) => !traites.has(p.service_id));
  const premiere = restantes[0];
  return (
    <section className="ac-carte av" aria-labelledby="av-titre">
      <header>
        <h2 id="av-titre">À valider{restantes.length > 0 && <span className="ac-compte">{restantes.length}</span>}</h2>
        {premiere && <Link className="ac-lien" to={`/planification?semaine=${premiere.semaine}`}>Voir la planification</Link>}
      </header>
      {restantes.length === 0
        ? <p className="ac-vide ok">Aucune proposition en attente.</p>
        : <ul className="av-liste">{restantes.slice(0, MAX).map((p) => {
          const confirmer = aConfirmer === p.service_id;
          const bloque = !moi || occupe !== null;
          return (
            <li key={p.service_id} className={`av-ligne${confirmer ? ' confirmer' : ''}`}>
              <span className={`av-icone ${p.propose_par === 'solveur' ? 'solveur' : 'choix'}`}
                title={p.propose_par === 'solveur' ? 'Proposé par le solveur' : 'Choisi sans verrou'}>
                {p.propose_par === 'solveur' ? <Etincelle /> : <svg viewBox="0 0 24 24" width="16" height="16"
                  aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 0 0-16 0" /></svg>}
              </span>
              <div className="av-texte">
                <Link to={lienFiche(p.service_id, p.semaine)} className="av-nom">{p.nom}
                  {p.client && <small>{p.client}</small>}</Link>
                <p className="av-meta">
                  <span>{p.propose_par === 'solveur' ? 'Solveur' : 'Choix sans verrou'}</span>
                  <span>{periodeCourte(p.debut, p.fin)}</span>
                  {p.plaque && <span>{p.plaque}</span>}
                </p>
                <p className="av-equipe">{p.equipe.length ? p.equipe.join(', ') : 'Sans équipe'}</p>
              </div>
              <div className="av-actions">
                {confirmer ? <>
                  <span className="av-question">Retirer la proposition ?</span>
                  <button type="button" className="av-bouton" onClick={() => setAConfirmer(null)}>Annuler</button>
                  <button type="button" className="av-bouton danger" disabled={bloque}
                    onClick={() => void agir(p, false)}>{occupe === p.service_id ? 'Retrait…' : 'Retirer'}</button>
                </> : <>
                  <button type="button" className="av-bouton" disabled={bloque} onClick={() => setAConfirmer(p.service_id)}
                    title={moi ? 'Retirer cette proposition' : 'Indiquez votre nom (Planification) pour agir'}>Refuser</button>
                  <button type="button" className="av-bouton valider" disabled={bloque} onClick={() => void agir(p, true)}
                    title={moi ? 'Publier telle quelle (équipe, dates, véhicule)' : 'Indiquez votre nom (Planification) pour agir'}>
                    {occupe === p.service_id ? 'Publication…' : 'Valider'}</button>
                </>}
              </div>
              {erreur?.id === p.service_id && <p className="av-erreur" role="alert">{erreur.texte}</p>}
            </li>);
        })}</ul>}
      {restantes.length > MAX && premiere && <p className="ac-suite">
        <Link to={`/planification?semaine=${premiere.semaine}`}>{restantes.length - MAX} autre{restantes.length - MAX > 1 ? 's' : ''} dans la planification</Link></p>}
      <p className="visuellement-cache" aria-live="polite">{annonce}</p>
    </section>
  );
}
