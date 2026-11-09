import { useState } from 'react';
import { api, aujourdhui, LIBELLES_STATUT, type Intervention } from '../api';
import { Avertissements, EtatChargement, heure, useDonnees } from '../composants';

const JOURS = ['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.'];

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function lundiDe(jour: string): Date {
  const d = new Date(`${jour}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function decaler(d: Date, jours: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + jours);
  return r;
}

/** Une intervention occupe un jour si ce jour est entre son début et sa fin. */
function couvre(i: Intervention, jour: string): boolean {
  const debut = i.debut?.slice(0, 10);
  const fin = (i.fin ?? i.debut)?.slice(0, 10);
  return !!debut && debut <= jour && (fin ?? debut) >= jour;
}

export default function Planning() {
  const [lundi, setLundi] = useState(() => lundiDe(aujourdhui()));
  const jours = JOURS.map((_, k) => iso(decaler(lundi, k)));
  const auj = aujourdhui();

  const techs = useDonnees(() => api.techniciens('terrain_confirme'), []);
  const interv = useDonnees(() => api.interventions(jours[0], jours[4]), [jours[0]]);

  const liste = interv.donnees?.interventions ?? [];
  const nonAssignees = liste.filter((i) => !i.technicien_ids.length);
  const techniciens = techs.donnees?.techniciens ?? [];

  return (
    <>
      <div className="entete">
        <div>
          <h1>Interventions</h1>
          <div className="sous-titre">Semaine du {jours[0]} au {jours[4]} · interventions réelles Odoo et GestCo, techniciens terrain confirmés</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn" aria-label="Semaine précédente" onClick={() => setLundi(decaler(lundi, -7))}>‹</button>
          <button type="button" className="btn" onClick={() => setLundi(lundiDe(aujourdhui()))}>Cette semaine</button>
          <button type="button" className="btn" aria-label="Semaine suivante" onClick={() => setLundi(decaler(lundi, 7))}>›</button>
        </div>
      </div>

      <EtatChargement chargement={techs.chargement || interv.chargement} erreur={techs.erreur ?? interv.erreur} />
      <Avertissements liste={interv.donnees?.avertissements} />

      <div className="rangee">
        <section className="carte large defilement" aria-label="Planning par technicien" style={{ padding: 0 }}>
          <div className="planning" style={{ gridTemplateColumns: '200px repeat(5, minmax(0, 1fr))' }}>
            <div className="tete nom">Technicien</div>
            {jours.map((j, k) => (
              <div key={j} className={`tete${j === auj ? ' jour-courant' : ''}`}>{JOURS[k]} {j.slice(8)}</div>
            ))}
            {techniciens.map((t) => (
              <Ligne key={t.id} nom={t.nom} detail={t.odoo?.departement ?? t.hfsql?.service ?? ''} jours={jours} auj={auj}
                interventions={liste.filter((i) => i.technicien_ids.includes(t.id))} />
            ))}
          </div>
        </section>

        <aside className="carte etroit" aria-label="Interventions sans technicien">
          <h2>Sans technicien identifié ({nonAssignees.length})</h2>
          <p className="muet">Assignées à un compte d'agence ou à personne : à corriger dans Odoo.</p>
          {nonAssignees.map((i) => (
            <div key={i.id} className="bloc bloc-a_planifier">
              <strong>{i.client ?? i.titre}</strong>
              <span>{i.debut?.slice(0, 10) ?? 'sans date'} · {LIBELLES_STATUT[i.statut]} · {i.techniciens.join(', ') || '—'}</span>
            </div>
          ))}
        </aside>
      </div>
    </>
  );
}

function Ligne({ nom, detail, jours, auj, interventions }:
  { nom: string; detail: string; jours: string[]; auj: string; interventions: Intervention[] }) {
  return (
    <>
      <div className="nom"><strong>{nom}</strong><span className="muet">{detail}</span></div>
      {jours.map((j) => (
        <div key={j} className={j === auj ? 'jour-courant' : ''}>
          {interventions.filter((i) => couvre(i, j)).map((i) => (
            <div key={i.id} className={`bloc bloc-${i.statut}`} title={i.titre}>
              <strong>{i.client ?? i.titre}</strong>
              <span>{heure(i.debut) || '—'} · {LIBELLES_STATUT[i.statut].toLowerCase()}</span>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
