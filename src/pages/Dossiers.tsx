// Liste des dossiers projets : une ligne par projet (services par état, avancement, prochaine intervention, argent),
// chaque ligne ouvre le dossier complet du projet.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { aujourdhui } from '../api';
import { EtatChargement, useDonnees } from '../composants';
import { BoutonExport } from '../composants/BoutonExport';
import { exportations, nomFichier } from '../exports';
import { PastilleNote } from '../composants/Rse';
import { co2 } from '../rse';
import { euros, LIBELLES_ETAT, stats, type EtatService, type ResumeProjet } from '../statistiques';

const ORDRE: EtatService[] = ['facture', 'fait', 'planifie', 'en_retard', 'a_planifier'];
const plier = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const date = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);
const jour = (iso: string) => date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
function relatif(iso: string) {
  const n = Math.round((date(iso).getTime() - date(aujourdhui()).getTime()) / 86_400_000);
  return n === 0 ? "aujourd'hui" : n === 1 ? 'demain' : n > 1 ? `dans ${n} jours` : `il y a ${-n} jour${n < -1 ? 's' : ''}`;
}

function BarreEtats({ p }: { p: ResumeProjet }) {
  const total = Math.max(1, p.services);
  return (
    <div className="dl-barre" role="img"
      aria-label={ORDRE.filter((e) => p.par_etat[e]).map((e) => `${p.par_etat[e]} ${LIBELLES_ETAT[e].toLowerCase()}`).join(', ')}>
      {ORDRE.filter((e) => p.par_etat[e]).map((e) => (
        <span key={e} className={`e-${e}`} style={{ flexGrow: p.par_etat[e] / total }}
          title={`${p.par_etat[e]} ${LIBELLES_ETAT[e].toLowerCase()}`} />))}
    </div>
  );
}

export default function Dossiers() {
  const [simules, setSimules] = useState(true);
  const [texte, setTexte] = useState('');
  const liste = useDonnees(() => stats.projets(simules), [simules]);
  const projets = useMemo(() => {
    const q = plier(texte.trim());
    return (liste.donnees ?? [])
      .filter((p): p is ResumeProjet & { id: number } => p.id !== null)
      .filter((p) => !q || plier(`${p.nom} ${p.client ?? ''}`).includes(q))
      .sort((a, b) => Number(b.par_etat.en_retard > 0) - Number(a.par_etat.en_retard > 0)
        || (a.prochaine_intervention ?? '9999').localeCompare(b.prochaine_intervention ?? '9999') || a.nom.localeCompare(b.nom));
  }, [liste.donnees, texte]);

  return (
    <>
      <div className="entete">
        <div><h1>Dossiers projets</h1>
          <div className="sous-titre">Tout sur un projet au même endroit : missions, équipes, véhicules, tâches, coûts, carte,
            itinéraires, PV et pièces jointes.</div></div>
        <div className="filtres">
          <label className="champ">Rechercher<input type="search" value={texte} onChange={(e) => setTexte(e.target.value)}
            placeholder="Projet ou client" /></label>
          <label className="case"><input type="checkbox" checked={simules} onChange={(e) => setSimules(e.target.checked)} />
            Inclure les services simulés</label>
          <BoutonExport libelle="Exporter les projets" nomFichier={nomFichier('projets', 'tout')}
            lire={() => exportations.projets()} />
        </div>
      </div>
      <EtatChargement chargement={liste.chargement && !liste.donnees} erreur={liste.erreur} />
      {liste.donnees && (
        <section className="carte dl">
          <div className="dl-tete" aria-hidden="true">
            <span>Projet</span>
            <span className="dl-legende">Services {ORDRE.map((e) => <span key={e}><i className={`e-${e}`} />{LIBELLES_ETAT[e].toLowerCase()}</span>)}</span>
            <span>Prochaine intervention</span><span className="nombre">CA HT</span><span className="nombre">Marge estimée</span>
            <span>Score RSE</span>
          </div>
          <ul className="dl-liste">
            {projets.map((p) => (
              <li key={p.id}>
                <Link to={`/dossiers/${p.id}`} className="dl-ligne">
                  <span className="dl-nom"><strong>{p.nom}</strong><small>{p.client ?? 'client non renseigné'}</small></span>
                  <span className="dl-etats"><BarreEtats p={p} />
                    <small>{p.services} service{p.services > 1 ? 's' : ''}{p.par_etat.en_retard > 0 &&
                      <b>, {p.par_etat.en_retard} en retard</b>}</small></span>
                  <span className="dl-date">{p.prochaine_intervention
                    ? <>{jour(p.prochaine_intervention)}<small>{relatif(p.prochaine_intervention)}</small></>
                    : <span className="muet">aucune</span>}</span>
                  <span className="nombre">{euros(p.ca_ht)}</span>
                  <span className={`nombre${p.marge_estimee < 0 ? ' negatif' : ''}`}>{euros(p.marge_estimee)}</span>
                  <span className="dl-rse"><PastilleNote note={p.rse.note} />
                    <small>{p.rse.kg_co2e === null ? 'à renseigner' : co2(p.rse.kg_co2e)}</small></span>
                </Link>
              </li>))}
          </ul>
          {!projets.length && <p className="vide">{texte ? 'Aucun projet ne correspond à la recherche.'
            : 'Aucun projet avec un service sur site actif. Les services se créent dans Odoo (Services sur site).'}</p>}
        </section>
      )}
    </>
  );
}
