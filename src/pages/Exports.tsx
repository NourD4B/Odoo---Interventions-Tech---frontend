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

  // dossiers et interventions
  const [toutesDates, setToutesDates] = useState(true);
  const [pDebut, setPDebut] = useState(lundi);
  const [pFin, setPFin] = useState(decaler(lundi, 4));
  const pInverse = !toutesDates && pFin < pDebut;

  // dossier d'une commande (ou d'une intervention sans commande)
  const dossiers = useDonnees(() => stats.dossiers(true), []);
  const choixDossiers = useMemo(() => [...(dossiers.donnees ?? [])]
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr')), [dossiers.donnees]);
  const [cle, setCle] = useState<string | null>(null);
  const dossier = choixDossiers.find((d) => d.cle === cle) ?? null;

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
          <div className="sous-titre">Classeurs Excel des dossiers d'intervention et de la planification, prêts à trier et
            à filtrer.</div>
        </div>
      </div>

      <div className="ex-grille">
        <Carte titre="Dossiers et interventions" feuilles={['Dossiers', 'Interventions']}
          description="Une ligne par dossier (commande client, ou intervention sans commande), puis chaque intervention : dates, équipe, véhicule et modèle, heures, coûts, marge, CO2e.">
          <div className="segmente ex-choix" role="radiogroup" aria-label="Interventions exportées">
            <button type="button" role="radio" aria-checked={toutesDates} className={toutesDates ? 'actif' : ''}
              onClick={() => setToutesDates(true)}>Toutes les dates</button>
            <button type="button" role="radio" aria-checked={!toutesDates} className={!toutesDates ? 'actif' : ''}
              onClick={() => setToutesDates(false)}>Période</button>
          </div>
          {!toutesDates && <Periode debut={pDebut} fin={pFin} onDebut={setPDebut} onFin={setPFin} />}
          {pInverse && <p className="ex-alerte">La fin précède le début.</p>}
          <BoutonExport libelle="Télécharger les dossiers" desactive={pInverse}
            nomFichier={nomFichier('dossiers', toutesDates ? 'tout' : `${pDebut}_${pFin}`)}
            lire={() => (toutesDates ? exportations.dossiers() : exportations.dossiers(pDebut, pFin))} />
        </Carte>

        <Carte titre="Dossier d'intervention" feuilles={['Résumé', 'Interventions', 'Véhicules', 'Tâches', 'Pièces jointes']}
          description="Tout le dossier d'une commande : résumé, interventions, véhicules et conducteurs désignés, tâches Odoo, noms des pièces jointes.">
          <label className="champ">Dossier
            <select value={cle ?? ''} onChange={(e) => setCle(e.target.value || null)}>
              <option value="">{dossiers.chargement && !dossiers.donnees ? 'Chargement…' : 'Choisir un dossier'}</option>
              {choixDossiers.map((d) => (
                <option key={d.cle} value={d.cle}>{d.type === 'commande' ? d.nom : `${d.nom} (sans commande)`}
                  {d.client ? ` · ${d.client}` : ''}{d.simule ? ', simulé' : ''}</option>
              ))}
            </select>
          </label>
          {dossier && <p className="ex-detail">{dossier.services} intervention{dossier.services > 1 ? 's' : ''}
            {dossier.prochaine_intervention ? `, prochaine le ${jj(dossier.prochaine_intervention)}` : ''}</p>}
          <BoutonExport libelle="Télécharger le dossier" desactive={!dossier}
            nomFichier={nomFichier('dossier', dossier?.nom ?? '')}
            lire={() => exportations.dossier(dossier!.type, dossier!.id)} />
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
