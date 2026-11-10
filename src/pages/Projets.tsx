// Projets ayant des services sur site : avancement, heures, argent, retards ; détail d'un projet.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EtatChargement, useDonnees } from '../composants';
import { BadgeEtat, BadgeSimule, Jauge, TableServices, Tuile } from '../composants/Statistiques';
import { euros, heures, jourCourt, LIBELLES_FACTURATION, nombre, stats, type EtatService, type ResumeProjet } from '../statistiques';

const ORDRE: EtatService[] = ['a_planifier', 'planifie', 'en_retard', 'fait', 'facture'];

function Etats({ p }: { p: ResumeProjet }) {
  return (
    <div className="badges">
      {ORDRE.filter((e) => p.par_etat[e]).map((e) => (
        <span key={e} className="etat-compte"><BadgeEtat etat={e} /> {p.par_etat[e]}</span>
      ))}
    </div>
  );
}

function CarteProjet({ p }: { p: ResumeProjet }) {
  return (
    <article className="carte carte-projet">
      <div className="entete">
        <div>
          <h2>{p.id !== null ? <Link to={`/projets/${p.id}`}>{p.nom}</Link> : p.nom}</h2>
          <div className="muet">{p.client ?? 'client non renseigné'} · {p.services} service(s)</div>
        </div>
        <BadgeSimule simule={p.simule} />
      </div>
      <div><div className="muet">Avancement (faits ou facturés)</div><Jauge pct={p.avancement_pct} /></div>
      <Etats p={p} />
      <dl className="chiffres">
        <div><dt>Heures prév. / passées</dt><dd>{heures(p.heures_prevues)} / {heures(p.heures_passees)}</dd></div>
        <div><dt>CA HT</dt><dd>{euros(p.ca_ht)}</dd></div>
        <div><dt>Marge matériel</dt><dd>{euros(p.marge_materiel)}</dd></div>
        <div><dt>Reste à facturer</dt><dd>{euros(p.reste_a_facturer_ht)}</dd></div>
        <div><dt>Marge estimée</dt><dd>{euros(p.marge_estimee)}</dd></div>
        <div><dt>Prochaine intervention</dt><dd>{jourCourt(p.prochaine_intervention)}</dd></div>
      </dl>
      {p.en_retard.length > 0 && <div className="avertissement">En retard : {p.en_retard.map((x) => x.nom).join(', ')}</div>}
    </article>
  );
}

export function ListeProjets() {
  const [simules, setSimules] = useState(true);
  const liste = useDonnees(() => stats.projets(simules), [simules]);
  return (
    <>
      <div className="entete">
        <div><h1>Projets</h1>
          <div className="sous-titre">Projets Odoo ayant des services sur site · statistiques de leurs services</div></div>
        <label className="case"><input type="checkbox" checked={simules} onChange={(e) => setSimules(e.target.checked)} />
          Inclure les services simulés</label>
      </div>
      <EtatChargement chargement={liste.chargement && !liste.donnees} erreur={liste.erreur} />
      {liste.donnees && !liste.donnees.length && <div className="vide">Aucun projet avec un service sur site actif.
        Les services se créent dans Odoo (Services sur site), puis « Synchroniser » sur la page Statistiques.</div>}
      <div className="grille-projets">{liste.donnees?.map((p) => <CarteProjet key={p.id ?? 'sans'} p={p} />)}</div>
    </>
  );
}

export function DetailProjet() {
  const id = Number(useParams().id);
  const p = useDonnees(() => stats.projet(id), [id]);
  const d = p.donnees;
  return (
    <>
      <div className="entete">
        <div><Link to="/projets" className="muet">‹ Projets</Link>
          <h1>{d?.nom ?? 'Projet'}</h1>
          {d && <div className="sous-titre">{d.client ?? 'client non renseigné'} · {d.services} service(s)</div>}</div>
        {d && <BadgeSimule simule={d.simule} />}
      </div>
      <EtatChargement chargement={p.chargement && !d} erreur={p.erreur} />
      {d && (<>
        <section className="kpis" aria-label="Chiffres du projet">
          <Tuile libelle="Avancement" valeur={d.avancement_pct === null ? '—' : `${nombre(d.avancement_pct)} %`} detail="faits ou facturés" />
          <Tuile libelle="Heures passées" valeur={heures(d.heures_passees)} detail={`prévu ${heures(d.heures_prevues)}`} />
          <Tuile libelle="CA HT" valeur={euros(d.ca_ht)} detail={`commandes ${euros(d.commandes_ht)}`} />
          <Tuile libelle="Marge matériel" valeur={euros(d.marge_materiel)} />
          <Tuile libelle="Reste à facturer" valeur={euros(d.reste_a_facturer_ht)} />
          <Tuile libelle="Marge estimée" valeur={euros(d.marge_estimee)} detail={`coûts estimés ${euros(d.couts_estimes)}`} ton="estime" />
        </section>
        <Etats p={d} />
        <section className="carte" aria-labelledby="titre-services-projet">
          <h2 id="titre-services-projet">Services</h2>
          <TableServices lignes={d.liste} />
        </section>
        <section className="carte" aria-labelledby="titre-commandes">
          <h2 id="titre-commandes">Commandes du projet</h2>
          <p className="muet">Chaque commande comptée une fois, y compris ses lignes qui ne sont rattachées à aucun service.</p>
          {d.commandes.length ? <div className="defilement"><table>
            <thead><tr><th>Commande</th><th className="nombre">Montant HT</th><th className="nombre">Marge</th><th>Facturation</th>
              <th>Type de service</th></tr></thead>
            <tbody>{d.commandes.map((c) => (
              <tr key={c.id}><td><strong>{c.nom}</strong></td><td className="nombre">{euros(c.montant_ht)}</td>
                <td className="nombre">{euros(c.marge)}</td><td>{LIBELLES_FACTURATION[c.facturation ?? ''] ?? c.facturation}</td>
                <td>{c.type_service ?? '—'}</td></tr>))}</tbody>
          </table></div> : <div className="vide">Aucune commande.</div>}
        </section>
      </>)}
    </>
  );
}
