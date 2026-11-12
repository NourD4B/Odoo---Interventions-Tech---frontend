// Exports : classeurs Excel (.xlsx) des projets, du dossier d'un projet et de la planification.
// Chaque carte dit ce que contient le classeur (ses feuilles) ; chaque export est noté dans le journal.
import { useMemo, useState, type ReactNode } from 'react';
import { aujourdhui } from '../api';
import { useDonnees } from '../composants';
import { BoutonExport } from '../composants/BoutonExport';
import { exportations, nomFichier } from '../exports';
import { stats } from '../statistiques';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const date = (s: string) => new Date(`${s}T12:00:00`);
const decaler = (s: string, n: number) => { const d = date(s); d.setDate(d.getDate() + n); return iso(d); };
const lundiDe = (s: string) => { const d = date(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
const joursEntre = (a: string, b: string) => Math.round((date(b).getTime() - date(a).getTime()) / 86400000) + 1;
const MAX_JOURS_PLANIF = 92;

type ChoixPlanif = 'semaine' | 'suivante' | 'quatre' | 'periode';
const CHOIX: { cle: ChoixPlanif; libelle: string }[] = [
  { cle: 'semaine', libelle: 'Semaine' }, { cle: 'suivante', libelle: 'Suivante' },
  { cle: 'quatre', libelle: '4 semaines' }, { cle: 'periode', libelle: 'Période' },
];

function IconeClasseur() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 9h17M3.5 14.5h17M9 3.5v17" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function Carte({ titre, description, feuilles, children }: {
  titre: string; description: string; feuilles: string[]; children: ReactNode;
}) {
  return (
    <section className="ex-carte" aria-label={titre}>
      <header className="ex-tete">
        <span className="ex-icone"><IconeClasseur /></span>
        <div><h2>{titre}</h2><p>{description}</p></div>
      </header>
      <div className="ex-corps">{children}</div>
      <ul className="ex-onglets" aria-label="Feuilles du classeur">
        {feuilles.map((f, i) => <li key={f} className={i === 0 ? 'premier' : ''}>{f}</li>)}
      </ul>
    </section>
  );
}

function Periode({ debut, fin, onDebut, onFin }: {
  debut: string; fin: string; onDebut: (v: string) => void; onFin: (v: string) => void;
}) {
  return (
    <div className="ex-periode">
      <label className="champ">Du<input type="date" value={debut} onChange={(e) => e.target.value && onDebut(e.target.value)} /></label>
      <label className="champ">Au<input type="date" value={fin} onChange={(e) => e.target.value && onFin(e.target.value)} /></label>
    </div>
  );
}

export default function Exports() {
  const auj = aujourdhui();
  const lundi = lundiDe(auj);

  // projets et missions
  const [toutesDates, setToutesDates] = useState(true);
  const [pDebut, setPDebut] = useState(lundi);
  const [pFin, setPFin] = useState(decaler(lundi, 4));
  const pInverse = !toutesDates && pFin < pDebut;

  // dossier d'un projet
  const projets = useDonnees(() => stats.projets(true), []);
  const choixProjets = useMemo(() => (projets.donnees ?? []).filter((p) => p.id !== null)
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr')), [projets.donnees]);
  const [projetId, setProjetId] = useState<number | null>(null);
  const projet = choixProjets.find((p) => p.id === projetId) ?? null;

  // planification
  const [choix, setChoix] = useState<ChoixPlanif>('semaine');
  const [dDebut, setDDebut] = useState(lundi);
  const [dFin, setDFin] = useState(decaler(lundi, 25));
  const [debut, fin] = choix === 'semaine' ? [lundi, decaler(lundi, 4)]
    : choix === 'suivante' ? [decaler(lundi, 7), decaler(lundi, 11)]
      : choix === 'quatre' ? [lundi, decaler(lundi, 25)] : [dDebut, dFin];
  const planifInverse = fin < debut;
  const planifTropLongue = !planifInverse && joursEntre(debut, fin) > MAX_JOURS_PLANIF;
  const jj = (s: string) => date(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  return (
    <div className="ex">
      <div className="entete">
        <div>
          <h1>Exports</h1>
          <div className="sous-titre">Classeurs Excel des projets, des dossiers et de la planification, prêts à trier et à
            filtrer.</div>
        </div>
      </div>

      <div className="ex-grille">
        <Carte titre="Projets et missions" feuilles={['Projets', 'Missions']}
          description="Une ligne par projet, puis chaque mission : dates, équipe, véhicule et modèle, heures, coûts, marge, CO2e.">
          <div className="segmente ex-choix" role="radiogroup" aria-label="Missions exportées">
            <button type="button" role="radio" aria-checked={toutesDates} className={toutesDates ? 'actif' : ''}
              onClick={() => setToutesDates(true)}>Toutes les dates</button>
            <button type="button" role="radio" aria-checked={!toutesDates} className={!toutesDates ? 'actif' : ''}
              onClick={() => setToutesDates(false)}>Période</button>
          </div>
          {!toutesDates && <Periode debut={pDebut} fin={pFin} onDebut={setPDebut} onFin={setPFin} />}
          {pInverse && <p className="ex-alerte">La fin précède le début.</p>}
          <BoutonExport libelle="Télécharger les projets" desactive={pInverse}
            nomFichier={nomFichier('projets', toutesDates ? 'tout' : `${pDebut}_${pFin}`)}
            lire={() => (toutesDates ? exportations.projets() : exportations.projets(pDebut, pFin))} />
        </Carte>

        <Carte titre="Dossier d'un projet" feuilles={['Résumé', 'Missions', 'Véhicules', 'Tâches', 'Pièces jointes']}
          description="Tout le dossier d'un projet : résumé, missions, véhicules et conducteurs désignés, tâches Odoo, noms des pièces jointes.">
          <label className="champ">Projet
            <select value={projetId ?? ''} onChange={(e) => setProjetId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">{projets.chargement && !projets.donnees ? 'Chargement…' : 'Choisir un projet'}</option>
              {choixProjets.map((p) => (
                <option key={p.id} value={p.id ?? ''}>{p.nom}{p.client ? ` (${p.client})` : ''}{p.simule ? ', simulé' : ''}</option>
              ))}
            </select>
          </label>
          {projet && <p className="ex-detail">{projet.services} mission{projet.services > 1 ? 's' : ''}
            {projet.prochaine_intervention ? `, prochaine le ${jj(projet.prochaine_intervention)}` : ''}</p>}
          <BoutonExport libelle="Télécharger le dossier" desactive={!projet}
            nomFichier={nomFichier('dossier', projet?.nom ?? '')}
            lire={() => exportations.dossier(projetId!)} />
        </Carte>

        <Carte titre="Planification" feuilles={['Grille', 'Affectations', 'Charge', 'À planifier']}
          description="Qui fait quoi, jour par jour : grille des techniciens avec congés et fériés, affectations, charge, services à planifier.">
          <div className="segmente ex-choix" role="radiogroup" aria-label="Période">
            {CHOIX.map((c) => (
              <button key={c.cle} type="button" role="radio" aria-checked={choix === c.cle} className={choix === c.cle ? 'actif' : ''}
                onClick={() => setChoix(c.cle)}>{c.libelle}</button>
            ))}
          </div>
          {choix === 'periode' ? <Periode debut={dDebut} fin={dFin} onDebut={setDDebut} onFin={setDFin} />
            : <p className="ex-detail">Du {jj(debut)} au {jj(fin)}</p>}
          {planifInverse && <p className="ex-alerte">La fin précède le début.</p>}
          {planifTropLongue && <p className="ex-alerte">{MAX_JOURS_PLANIF} jours au plus.</p>}
          <BoutonExport libelle="Télécharger la planification" desactive={planifInverse || planifTropLongue}
            nomFichier={nomFichier('planification', `${debut}_${fin}`)} lire={() => exportations.planification(debut, fin)} />
        </Carte>
      </div>

      <p className="ex-note">Chaque export est noté dans le journal avec votre nom. Jamais exportés : signatures, nom du
        signataire, montants des feuilles de temps, vitesses.</p>
    </div>
  );
}
