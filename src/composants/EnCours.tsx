// « En cours » (accueil) : les interventions verrouillées ou publiées dont la période comprend aujourd'hui, avec leur
// avancement d'après le planning seulement (heures de 8 h à 18 h écoulées sur la période) : ni GPS, ni temps passé, ni
// jugement sur le travail des techniciens. Chaque ligne ouvre la fiche de planification ; la position en direct est sur
// la Carte live.
import { Link } from 'react-router-dom';
import { lienFiche, type EnCours as Intervention } from '../accueil';
import { initiales } from '../composants';
import { jourCourt } from './AValider';

const MAX = 5;

function finPrevue(fin: string, jour: string): string {
  if (fin === jour) return 'Fin prévue ce soir';
  const demain = new Date(`${jour}T12:00:00`);
  demain.setDate(demain.getDate() + 1);
  return demain.toISOString().slice(0, 10) === fin ? 'Fin prévue demain' : `Fin prévue ${jourCourt(fin)}`;
}

export default function EnCours({ interventions, jour }: { interventions: Intervention[]; jour: string }) {
  return (
    <section className="ac-carte ec" aria-labelledby="ec-titre">
      <header>
        <h2 id="ec-titre">En cours{interventions.length > 0 && <span className="ac-compte">{interventions.length}</span>}</h2>
        <Link className="ac-lien" to="/carte">Carte live</Link>
      </header>
      {interventions.length === 0
        ? <p className="ac-vide">Aucune intervention en cours aujourd'hui.</p>
        : <ul className="ec-liste">{interventions.slice(0, MAX).map((x) => (
          <li key={x.service_id}>
            <Link to={lienFiche(x.service_id, x.semaine)} className="ec-ligne">
              <span className="ec-avatars" aria-hidden="true">
                {(x.equipe.length ? x.equipe : ['?']).slice(0, 2).map((n) => <i key={n}>{initiales(n)}</i>)}
              </span>
              <span className="ec-texte">
                <strong>{x.nom}</strong>
                <small>
                  <span>Jour {x.jour_n} sur {x.jours}</span>
                  {x.ville && <span>{x.ville}</span>}
                  {!x.publie && <span className="ec-non-publie">pas encore publié</span>}
                </small>
                {x.equipe.length > 0 && <span className="av-equipe">{x.equipe.join(', ')}</span>}
              </span>
              <span className="ec-avance">
                <span className="ec-barre" role="progressbar" aria-valuemin={0} aria-valuemax={100}
                  aria-valuenow={x.progression} aria-label={`Avancement prévu : ${x.progression} %`}>
                  <i style={{ width: `${Math.min(100, x.progression)}%` }} /></span>
                <small>{finPrevue(x.fin, jour)}</small>
              </span>
            </Link>
          </li>))}</ul>}
      {interventions.length > MAX && <p className="ac-suite">{interventions.length - MAX} autre{interventions.length - MAX > 1 ? 's' : ''} en cours</p>}
    </section>
  );
}
