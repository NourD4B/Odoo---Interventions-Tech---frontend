// Fiche d'un service : tout, planifié et réalisé (techniciens, véhicule, temps passé, matériel, argent, coûts).
import { Link, useParams } from 'react-router-dom';
import { EtatChargement, useDonnees } from '../composants';
import { ChoixMode, DetailRse, PastilleNote } from '../composants/Rse';
import { Barre, BadgeEtat, BadgeSimule, Jauge, Tuile } from '../composants/Statistiques';
import { co2 } from '../rse';
import { dateHeure, euros, heures, jourCourt, LIBELLES_FACTURATION, LIBELLES_LIVRAISON, LIBELLES_PAIEMENT, nombre,
         stats } from '../statistiques';

const STATUTS_PLANIF: Record<string, string> = {
  a_planifier: 'à planifier', propose: 'proposé par le solveur', verrouille: 'verrouillé', publie: 'publié',
};

function Oui({ oui, texte }: { oui: boolean; texte: string }) {
  return <span className={`badge ${oui ? 'b-concordant' : 'b-a_planifier'}`}>{oui ? '✓' : '—'} {texte}</span>;
}

export default function FicheService() {
  const id = Number(useParams().id);
  const f = useDonnees(() => stats.service(id), [id]);
  const d = f.donnees;
  if (!d) return <><Link to="/statistiques" className="muet">‹ Statistiques</Link><EtatChargement chargement={f.chargement} erreur={f.erreur} /></>;
  const { planification: p, realise: r, materiel: m, argent: a, couts_estimes: c } = d;
  const maxHeures = Math.max(d.prevu.heures ?? 0, r.heures_passees ?? 0, 1);
  const maxCout = Math.max(c.travail, c.route, c.vehicule, a.cout_materiel, 1);

  return (
    <>
      <div className="entete">
        <div>
          <Link to="/statistiques" className="muet">‹ Statistiques</Link>
          <h1>{d.nom}</h1>
          <div className="sous-titre">
            {d.projet ? <><Link to={`/projets/${d.projet.id}`}>{d.projet.nom}</Link>{d.projet.archive ? ' (projet archivé dans Odoo)' : ''}</> : 'sans projet'} · {d.societe ?? '—'}
            {d.type_service && <> · {d.type_service}</>} · service n° {d.id}</div>
          <div className="badges"><BadgeEtat etat={d.etat} /><BadgeSimule simule={d.simule} />
            {d.priorite === 'urgente' && <span className="badge b-urgent">urgent</span>}</div>
        </div>
        {d.odoo_url && <a className="btn btn-petit" href={d.odoo_url} target="_blank" rel="noreferrer">Ouvrir dans Odoo</a>}
      </div>

      <section className="kpis" aria-label="Chiffres du service">
        <Tuile libelle="Heures passées" valeur={heures(r.heures_passees)}
               detail={`prévu ${heures(d.prevu.heures)} · ${r.depassement_h ? `dépassement ${heures(r.depassement_h)}` : 'pas de dépassement'}`}
               ton={r.depassement_h ? 'alerte' : undefined} />
        <Tuile libelle="Matériel livré" valeur={m.pct_livre === null ? '—' : `${nombre(m.pct_livre)} %`}
               detail={`${nombre(m.livre)} / ${nombre(m.quantite)}`} />
        <Tuile libelle="CA HT" valeur={euros(a.ca_ht)} detail={`marge matériel ${euros(a.marge_materiel)}`} />
        <Tuile libelle="Reste à facturer" valeur={euros(a.reste_a_facturer_ht)} detail={a.statut_facturation_libelle ?? '—'} />
        <Tuile libelle="Coûts estimés" valeur={euros(c.total)} detail="hors hôtel et repas" ton="estime" />
        <Tuile libelle="Marge estimée" valeur={euros(c.marge_estimee)} detail="CA − matériel − coûts estimés" ton="estime" />
      </section>

      <div className="rangee">
        <section className="carte etroit" aria-labelledby="t-prevu">
          <h2 id="t-prevu">Prévu et site</h2>
          <dl className="chiffres colonne">
            <div><dt>Client (site)</dt><dd>{d.client ?? '—'}{d.telephone && <div className="muet">{d.telephone}</div>}</dd></div>
            <div><dt>Adresse</dt><dd>{d.site.adresse ?? '—'}<div className="muet">{d.site.lat !== null
              ? `${d.site.lat.toFixed(5)}, ${d.site.lng?.toFixed(5)} (${d.site.precision})` : 'sans position'}</div></dd></div>
            <div><dt>Dates prévues (Odoo)</dt><dd>{dateHeure(d.prevu.debut)} → {dateHeure(d.prevu.fin)}</dd></div>
            {d.prevu.fenetre && <div><dt>Fenêtre</dt><dd>{jourCourt(d.prevu.fenetre[0])} → {jourCourt(d.prevu.fenetre[1])}</dd></div>}
            <div><dt>Heures prévues</dt><dd>{heures(d.prevu.heures)}</dd></div>
          </dl>
        </section>

        <section className="carte large" aria-labelledby="t-planif">
          <h2 id="t-planif">Planification</h2>
          {d.archive_odoo
            ? <div className="muet">Archivée dans Odoo : gardée ici comme historique (commande, matériel, temps), jamais planifiée.</div>
            : <div className="muet">Statut : {STATUTS_PLANIF[p.statut] ?? p.statut} · {p.jours.length ? p.jours.map(jourCourt).join(', ') : 'aucun jour planifié'}</div>}
          {p.techniciens.length ? <div className="defilement"><table>
            <thead><tr><th>Technicien</th><th>Agence</th><th>Jours</th><th>Km aller-retour (estimé)</th><th>Route (estimée)</th></tr></thead>
            <tbody>{p.techniciens.map((t) => {
              const tr = p.trajet.par_technicien.find((x) => x.matricule === t.matricule);
              return (<tr key={t.matricule}><td><strong>{t.nom}</strong><div className="muet">{t.matricule}</div></td>
                <td>{t.agence ?? '—'}</td><td>{t.jours}</td>
                <td>{tr?.km !== null && tr?.km !== undefined ? `${nombre(tr.km)} km` : <span className="muet">{tr?.cause ?? '—'}</span>}
                  {tr?.grand_deplacement && <div className="muet">grand déplacement (un aller-retour)</div>}</td>
                <td>{heures(tr?.heures_route)}</td></tr>);
            })}</tbody>
          </table></div> : <div className="vide">{d.archive_odoo ? 'Aucune affectation dans l\'application.' : 'Personne n\'est encore affecté.'}</div>}
          <div>Véhicule : <strong>{p.vehicule ? (p.vehicule.plaque ?? `n° ${p.vehicule.id}`) : '—'}</strong>
            {p.trajet.km_vehicule !== null && <span className="muet"> · {nombre(p.trajet.km_vehicule)} km estimés</span>}</div>
        </section>
      </div>

      <div className="rangee">
        <section className="carte etroit" aria-labelledby="t-realise">
          <h2 id="t-realise">Réalisé</h2>
          <div className="badges">
            <Oui oui={r.fait} texte={r.fait ? `fait le ${jourCourt(r.fait_le)}` : 'pas encore fait'} />
            <Oui oui={r.feuille.remplie} texte="feuille remplie" /><Oui oui={r.feuille.signee} texte="signée" />
            <Oui oui={r.feuille.envoyee} texte="rapport envoyé" />
          </div>
          <div className="muet">Heures</div>
          <Barre valeur={d.prevu.heures ?? 0} max={maxHeures} texte={`${heures(d.prevu.heures)} prévues`} />
          <Barre valeur={r.heures_passees ?? 0} max={maxHeures} texte={`${heures(r.heures_passees)} passées`} serie={2} />
          {r.par_employe.length > 0 && <table>
            <thead><tr><th>Temps passé (feuilles de temps)</th><th className="nombre">Heures</th></tr></thead>
            <tbody>{r.par_employe.map((e) => <tr key={`${e.employee_id}-${e.nom}`}><td>{e.nom}
              {!e.matricule && <div className="muet">pas un technicien terrain</div>}</td><td className="nombre nowrap">{heures(e.heures)}</td></tr>)}</tbody>
          </table>}
          <div className="muet">Sous-tâches : {r.sous_taches.terminees} / {r.sous_taches.total} terminée(s)</div>
          {r.sous_taches.liste.length > 0 && <ul className="liste-cochee">{r.sous_taches.liste.map((x) => (
            <li key={x.id} className={x.terminee ? 'cochee' : ''}>{x.terminee ? '✓' : '○'} {x.nom}</li>))}</ul>}
        </section>

        <section className="carte large" aria-labelledby="t-materiel">
          <h2 id="t-materiel">Matériel</h2>
          <Jauge pct={m.pct_livre} texte={m.pct_livre === null ? undefined : `${nombre(m.pct_livre)} % livré`} />
          {m.lignes.length ? <div className="defilement"><table>
            <thead><tr><th>Produit</th><th>Qté</th><th>Livré</th><th>Facturé</th><th className="nombre">Prix unit.</th><th className="nombre">Total HT</th>
              <th className="nombre">Coût</th><th className="nombre">Marge</th></tr></thead>
            <tbody>{m.lignes.map((l) => (
              <tr key={l.id}><td>{l.produit}<div className="muet">{l.commande}</div></td><td>{nombre(l.quantite)}</td>
                <td>{nombre(l.livre)}</td><td>{nombre(l.facture)}</td><td className="nombre">{euros(l.prix_unitaire, true)}</td>
                <td className="nombre">{euros(l.sous_total_ht, true)}</td><td className="nombre">{euros(l.cout_total, true)}</td>
                <td className="nombre">{euros(l.marge, true)}</td></tr>))}</tbody>
          </table></div> : <div className="vide">Aucun matériel rattaché à ce service.</div>}
          {m.livraisons.length > 0 && <div className="muet">Livraisons : {m.livraisons.map((x) =>
            `${x.nom} ${LIBELLES_LIVRAISON[x.etat ?? ''] ?? x.etat}${x.faite ? ` le ${dateHeure(x.faite)}` : ''}`).join(' · ')}</div>}
        </section>
      </div>

      <div className="rangee">
        <section className="carte large" aria-labelledby="t-argent">
          <h2 id="t-argent">Argent</h2>
          <dl className="chiffres">
            <div><dt>CA HT (lignes du service)</dt><dd>{euros(a.ca_ht, true)}</dd></div>
            <div><dt>Coût matériel</dt><dd>{euros(a.cout_materiel, true)}</dd></div>
            <div><dt>Marge matériel</dt><dd>{euros(a.marge_materiel, true)}</dd></div>
            <div><dt>Facturé HT</dt><dd>{euros(a.facture_ht, true)}</dd></div>
            <div><dt>Reste à facturer</dt><dd>{euros(a.reste_a_facturer_ht, true)}</dd></div>
            <div><dt>Reste à payer</dt><dd>{euros(a.reste_a_payer, true)}</dd></div>
          </dl>
          {a.commandes.length ? <div className="defilement"><table>
            <thead><tr><th>Commande</th><th className="nombre">Montant HT</th><th className="nombre">Marge</th>
              <th>Facturation</th></tr></thead>
            <tbody>{a.commandes.map((x) => (
              <tr key={x.id}><td><strong>{x.nom}</strong></td><td className="nombre">{euros(x.montant_ht, true)}</td>
                <td className="nombre">{euros(x.marge, true)}</td><td>{LIBELLES_FACTURATION[x.facturation ?? ''] ?? x.facturation}</td></tr>))}</tbody>
          </table></div> : <div className="vide">Aucune commande.</div>}
          {a.factures.length ? <div className="defilement"><table>
            <thead><tr><th>Facture / avoir</th><th>Date</th><th className="nombre">Montant HT</th><th>Paiement</th>
              <th className="nombre">Reste à payer</th></tr></thead>
            <tbody>{a.factures.map((x) => (
              <tr key={x.id}><td><strong>{x.nom}</strong> <span className="muet">{x.type}</span></td><td>{jourCourt(x.date)}</td>
                <td className="nombre">{euros(x.montant_ht, true)}</td><td>{LIBELLES_PAIEMENT[x.paiement ?? ''] ?? x.paiement}</td>
                <td className="nombre">{euros(x.reste_a_payer, true)}</td></tr>))}</tbody>
          </table></div> : <div className="vide">Aucune facture ni avoir.</div>}
          {a.factures.length > 0 && <div className="muet">Net facturé (factures − avoirs) : {euros(a.factures_net_ht, true)} HT</div>}
        </section>

        <section className="carte etroit" aria-labelledby="t-couts">
          <h2 id="t-couts">Coûts estimés</h2>
          <p className="muet">Estimation (règles du solveur), {c.hors} non comptés. Travail sur les heures {c.base_heures === 'passees'
            ? 'passées' : 'prévues'} × {euros(c.cout_horaire_moyen, true)}/h{c.cout_km !== null && <> · véhicule {euros(c.cout_km, true)}/km</>}.</p>
          <div className="muet">Matériel</div><Barre valeur={a.cout_materiel} max={maxCout} texte={euros(a.cout_materiel)} />
          <div className="muet">Travail ({heures(c.heures_travail)})</div><Barre valeur={c.travail} max={maxCout} texte={euros(c.travail)} />
          <div className="muet">Route</div><Barre valeur={c.route} max={maxCout} texte={euros(c.route)} />
          <div className="muet">Véhicule</div><Barre valeur={c.vehicule} max={maxCout} texte={euros(c.vehicule)} />
          <dl className="chiffres colonne">
            <div><dt>Coût total estimé (hors matériel)</dt><dd>{euros(c.total, true)}</dd></div>
            <div><dt>Marge estimée</dt><dd className={c.marge_estimee < 0 ? 'negatif' : ''}>{euros(c.marge_estimee, true)}</dd></div>
          </dl>
        </section>

        <section className="carte large" aria-labelledby="t-rse">
          <h2 id="t-rse">Score RSE des déplacements</h2>
          <div className="rs-service">
            <PastilleNote note={d.rse.note} grande />
            <dl className="chiffres">
              <div><dt>Mode</dt><dd>{d.rse.mode_libelle ?? 'à choisir'}</dd></div>
              <div><dt>Émissions estimées</dt><dd>{co2(d.rse.kg_co2e)}</dd></div>
              <div><dt>Par rapport à chacun seul en voiture thermique</dt><dd>{d.rse.evite_pct === null ? '—'
                : d.rse.evite_pct >= 0 ? `${nombre(d.rse.evite_pct)} % évités` : `${nombre(-d.rse.evite_pct)} % de plus`}</dd></div>
            </dl>
          </div>
          <ChoixMode serviceId={d.id} r={d.rse} onChange={f.recharger} />
          <DetailRse r={d.rse} />
        </section>
      </div>
    </>
  );
}
