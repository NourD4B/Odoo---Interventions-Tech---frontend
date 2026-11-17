// Fiche d'un service : tout, planifié et réalisé. Tête bleu nuit comme le dossier du projet (identité, dates, site),
// équation de la marge, planification (équipe, véhicule, trajets) et réalisé (étapes, heures, sous-tâches), puis
// matériel, argent, coûts estimés et score RSE.
import { Link, useParams } from 'react-router-dom';
import { EtatChargement, initiales, useDonnees } from '../composants';
import { ChoixMode, DetailRse, PastilleNote } from '../composants/Rse';
import { Plaque } from '../composants/Vehicule';
import { Barre, Jauge } from '../composants/Statistiques';
import { co2 } from '../rse';
import { dateHeure, euros, heures, jourCourt, LIBELLES_ETAT, LIBELLES_FACTURATION, LIBELLES_LIVRAISON, LIBELLES_PAIEMENT, lienDossier,
         nombre, stats } from '../statistiques';

const STATUTS_PLANIF: Record<string, string> = {
  a_planifier: 'À planifier', propose: 'Proposé par le solveur', verrouille: 'Verrouillé', publie: 'Publié',
};
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const date = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);

/** Une étape du réalisé : faite (coche) ou à venir (cercle vide). */
function Etape({ faite, titre, detail }: { faite: boolean; titre: string; detail?: string }) {
  return (
    <li className={faite ? 'faite' : undefined}>
      <span className="sf-coche" aria-hidden="true">{faite && <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3.5 8.5l3 3 6-7" /></svg>}</span>
      <span><strong>{titre}</strong>{detail && <small>{detail}</small>}</span>
      <span className="visuellement-cache">{faite ? 'fait' : 'pas encore'}</span>
    </li>
  );
}

export default function FicheService() {
  const id = Number(useParams().id);
  const f = useDonnees(() => stats.service(id), [id]);
  const d = f.donnees;
  if (!d) return <><Link to="/services" className="muet">‹ Services sur site</Link><EtatChargement chargement={f.chargement} erreur={f.erreur} /></>;
  const { planification: p, realise: r, materiel: m, argent: a, couts_estimes: c } = d;
  const maxHeures = Math.max(d.prevu.heures ?? 0, r.heures_passees ?? 0, 1);
  const maxCout = Math.max(c.travail, c.route, c.vehicule, a.cout_materiel, 1);
  const [premier, legende] = p.jours[0] ? [p.jours[0], 'planifié'] : d.prevu.debut ? [d.prevu.debut, 'prévu']
    : d.prevu.fin ? [d.prevu.fin, 'limite'] : [null, null];
  const jour = premier ? date(premier) : null;
  const dernier = p.jours.length > 1 ? p.jours[p.jours.length - 1] : null;
  const etapes = [r.fait, r.feuille.remplie, r.feuille.signee, r.feuille.envoyee].filter(Boolean).length;

  return (
    <>
      <header className="sf-tete">
        <div className="sf-haut">
          <Link to={lienDossier(d.dossier)} className="dp-retour">
            ‹ {d.dossier.type === 'commande' ? `Dossier ${d.dossier.nom}` : 'Dossier de l\'intervention'}</Link>
          {d.odoo_url && <a className="dp-odoo" href={d.odoo_url} target="_blank" rel="noreferrer">Ouvrir dans Odoo</a>}
        </div>
        <div className="sf-identite">
          <div className={`sf-jour${jour ? '' : ' vide'}${legende === 'limite' ? ' limite' : ''}`} aria-hidden="true">
            {jour ? <><b>{jour.getDate()}</b><span>{MOIS[jour.getMonth()]}</span>
              <small>{legende}</small></> : <><b>–</b><small>sans date</small></>}
          </div>
          <div className="sf-titre">
            <p className="dc-client">{d.societe ?? d.client ?? 'Client non renseigné'}{d.simule && <span className="dc-simule">simulé</span>}</p>
            <h1>{d.nom}</h1>
            <div className="sf-badges">
              <span className={`sf-etat e-${d.etat}`}>{LIBELLES_ETAT[d.etat]}</span>
              {d.priorite === 'urgente' && <span className="sf-etat urgent">Urgent</span>}
              {d.type_service && <span className="sf-etat">{d.type_service}</span>}
              {d.archive_odoo && <span className="sf-etat">Archivée dans Odoo</span>}
            </div>
          </div>
        </div>
        <dl className="sf-faits">
          <div><dt>Commande</dt><dd>{d.dossier.type === 'commande' ? d.dossier.nom : 'Non facturable (sans commande)'}</dd></div>
          <div><dt>Prévu dans Odoo</dt><dd>{d.prevu.debut ? `${dateHeure(d.prevu.debut)} au ${dateHeure(d.prevu.fin)}` : `au plus tard ${dateHeure(d.prevu.fin)}`}</dd></div>
          <div><dt>Durée prévue</dt><dd>{heures(d.prevu.heures)}</dd></div>
          <div><dt>Site</dt><dd>{d.site.adresse ?? '—'}{d.site.lat === null && <small>sans position</small>}</dd></div>
          {(d.client || d.telephone) && <div><dt>Contact du site</dt><dd>{d.client ?? '—'}{d.telephone && <small>{d.telephone}</small>}</dd></div>}
        </dl>
      </header>

      <section className="dp-equation" aria-label="Coûts et marge estimée du service">
        <div className="dp-termes">
          <div className="dp-terme"><span>Chiffre d'affaires HT</span><strong>{euros(a.ca_ht)}</strong>
            <small>{a.commandes.length} commande{a.commandes.length > 1 ? 's' : ''}, {euros(a.facture_ht)} facturés</small></div>
          <span className="dp-op" aria-hidden="true">−</span>
          <div className="dp-terme"><span>Matériel</span><strong>{euros(a.cout_materiel)}</strong><small>coût d'achat</small></div>
          <span className="dp-op" aria-hidden="true">−</span>
          <div className="dp-terme"><span>Coûts estimés</span><strong>{euros(c.total)}</strong>
            <small>travail {euros(c.travail)}, route {euros(c.route)}, véhicule {euros(c.vehicule)}</small></div>
          <span className="dp-op" aria-hidden="true">=</span>
          <div className={`dp-terme dp-resultat${c.marge_estimee < 0 ? ' negatif' : ''}`}><span>Marge estimée</span>
            <strong>{euros(c.marge_estimee)}</strong>{c.hors && <small>hors {c.hors}</small>}</div>
        </div>
        <dl className="dp-chiffres">
          <div><dt>Reste à facturer</dt><dd>{euros(a.reste_a_facturer_ht)} {a.statut_facturation_libelle && <small>{a.statut_facturation_libelle.toLowerCase()}</small>}</dd></div>
          <div><dt>Heures passées</dt><dd>{heures(r.heures_passees)} <small>sur {heures(d.prevu.heures)} prévues
            {r.depassement_h ? `, ${heures(r.depassement_h)} de dépassement` : ''}</small></dd></div>
          <div><dt>Matériel livré</dt><dd>{m.pct_livre === null ? '—' : `${nombre(m.pct_livre)} %`} <small>{nombre(m.livre)} sur {nombre(m.quantite)}</small></dd></div>
        </dl>
      </section>

      <div className="sf-grille">
        <section className="carte sf-bloc" aria-labelledby="t-planif">
          <div className="sf-bloc-tete">
            <h2 id="t-planif">Planification</h2>
            {!d.archive_odoo && <span className={`badge b-planif-${p.statut}`}>{STATUTS_PLANIF[p.statut] ?? p.statut}</span>}
          </div>
          {d.archive_odoo
            ? <p className="muet">Archivée dans Odoo : gardée ici comme historique (commande, matériel, temps), jamais planifiée.</p>
            : <p className="sf-dates">{p.jours.length
              ? <>{jourCourt(p.jours[0])}{dernier ? ` au ${jourCourt(dernier)}` : ''} <small>{p.jours.length} jour{p.jours.length > 1 ? 's' : ''} planifié{p.jours.length > 1 ? 's' : ''}</small></>
              : <span className="muet">Aucun jour planifié</span>}</p>}

          {p.techniciens.length ? (
            <ul className="sf-equipe">{p.techniciens.map((t) => {
              const tr = p.trajet.par_technicien.find((x) => x.matricule === t.matricule);
              return (
                <li key={t.matricule}>
                  <i aria-hidden="true">{initiales(t.nom)}</i>
                  <span className="sf-qui"><strong>{t.nom}</strong><small>{t.agence ? `depuis ${t.agence.charAt(0).toUpperCase()}${t.agence.slice(1)}` : 'agence non renseignée'}, {t.jours} jour{t.jours > 1 ? 's' : ''}</small></span>
                  <span className="sf-trajet">{tr?.km !== null && tr?.km !== undefined ? <>{nombre(tr.km)} km<small>{heures(tr.heures_route)} de route
                    {tr.grand_deplacement ? ', grand déplacement' : ''}</small></> : <small>{tr?.cause ?? 'trajet inconnu'}</small>}</span>
                </li>
              );
            })}</ul>
          ) : <p className="vide">{d.archive_odoo ? 'Aucune affectation dans l\'application.' : 'Personne n\'est encore affecté.'}</p>}

          <div className="sf-vehicule">
            <span className="sf-libelle">Véhicule</span>
            {p.vehicule
              ? <Link to={`/vehicules/${p.vehicule.id}`} className="sf-veh-lien">
                  <strong>{p.vehicule.modele ?? 'Modèle non renseigné'}</strong>
                  {p.vehicule.plaque ? <Plaque plaque={p.vehicule.plaque} /> : <small>n° {p.vehicule.id}</small>}
                  {p.trajet.km_vehicule !== null && <small>{nombre(p.trajet.km_vehicule)} km estimés</small>}</Link>
              : <span className="muet">Aucun véhicule</span>}
          </div>
        </section>

        <section className="carte sf-bloc" aria-labelledby="t-realise">
          <div className="sf-bloc-tete">
            <h2 id="t-realise">Réalisé</h2>
            <span className="sf-compte">{etapes} sur 4 étapes</span>
          </div>
          <ol className="sf-etapes">
            <Etape faite={r.fait} titre="Intervention faite" detail={r.fait ? `le ${jourCourt(r.fait_le)}` : 'pas encore'} />
            <Etape faite={r.feuille.remplie} titre="Feuille d'intervention remplie" />
            <Etape faite={r.feuille.signee} titre="Feuille signée par le client" />
            <Etape faite={r.feuille.envoyee} titre="Rapport envoyé" />
          </ol>
          <div className="sf-heures">
            <span className="sf-libelle">Heures</span>
            <Barre valeur={d.prevu.heures ?? 0} max={maxHeures} texte={`${heures(d.prevu.heures)} prévues`} />
            <Barre valeur={r.heures_passees ?? 0} max={maxHeures} texte={`${heures(r.heures_passees)} passées`} serie={2} />
          </div>
          {r.par_employe.length > 0 && <ul className="sf-temps">{r.par_employe.map((e) => (
            <li key={`${e.employee_id}-${e.nom}`}><span>{e.nom}{!e.matricule && <small>pas un technicien terrain</small>}</span>
              <strong>{heures(e.heures)}</strong></li>))}</ul>}
          <div className="sf-taches">
            <span className="sf-libelle">Sous-tâches, {r.sous_taches.terminees} sur {r.sous_taches.total} terminée{r.sous_taches.terminees > 1 ? 's' : ''}</span>
            {r.sous_taches.liste.length > 0 && <ul>{r.sous_taches.liste.map((x) => (
              <li key={x.id} className={x.terminee ? 'faite' : undefined}><span className="sf-coche" aria-hidden="true">
                {x.terminee && <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3.5 8.5l3 3 6-7" /></svg>}</span>{x.nom}</li>))}</ul>}
          </div>
        </section>
      </div>

      <section className="carte sf-bloc" aria-labelledby="t-materiel">
        <div className="sf-bloc-tete">
          <h2 id="t-materiel">Matériel</h2>
          <div className="sf-jauge"><Jauge pct={m.pct_livre} texte={m.pct_livre === null ? undefined : `${nombre(m.pct_livre)} % livré`} /></div>
        </div>
        {m.lignes.length ? <div className="defilement"><table>
          <thead><tr><th>Produit</th><th className="nombre">Qté</th><th className="nombre">Livré</th><th className="nombre">Facturé</th>
            <th className="nombre">Prix unit.</th><th className="nombre">Total HT</th><th className="nombre">Coût</th><th className="nombre">Marge</th></tr></thead>
          <tbody>{m.lignes.map((l) => (
            <tr key={l.id}><td>{l.produit}<div className="muet">{l.commande}</div></td><td className="nombre">{nombre(l.quantite)}</td>
              <td className="nombre">{nombre(l.livre)}</td><td className="nombre">{nombre(l.facture)}</td><td className="nombre">{euros(l.prix_unitaire, true)}</td>
              <td className="nombre">{euros(l.sous_total_ht, true)}</td><td className="nombre">{euros(l.cout_total, true)}</td>
              <td className={`nombre${l.marge < 0 ? ' negatif' : ''}`}>{euros(l.marge, true)}</td></tr>))}</tbody>
        </table></div> : <p className="vide">Aucun matériel rattaché à ce service.</p>}
        {m.livraisons.length > 0 && <ul className="sf-livraisons">{m.livraisons.map((x) => (
          <li key={x.nom}><strong>{x.nom}</strong> {LIBELLES_LIVRAISON[x.etat ?? ''] ?? x.etat}{x.faite ? `, le ${dateHeure(x.faite)}` : ''}
            {x.transporteur && <> · {x.transporteur}</>}
            {x.suivi && <> · suivi {x.suivi_url
              ? <a href={x.suivi_url} target="_blank" rel="noreferrer">{x.suivi}</a> : x.suivi}</>}</li>))}</ul>}
      </section>

      <div className="sf-grille sf-grille-argent">
        <section className="carte sf-bloc" aria-labelledby="t-argent">
          <div className="sf-bloc-tete"><h2 id="t-argent">Commandes et factures</h2></div>
          {a.commandes.length ? <div className="defilement"><table>
            <thead><tr><th>Commande</th><th className="nombre">Montant HT</th><th className="nombre">Marge</th><th>Facturation</th></tr></thead>
            <tbody>{a.commandes.map((x) => (
              <tr key={x.id}><td><strong>{x.nom}</strong></td><td className="nombre">{euros(x.montant_ht, true)}</td>
                <td className="nombre">{euros(x.marge, true)}</td><td>{LIBELLES_FACTURATION[x.facturation ?? ''] ?? x.facturation}</td></tr>))}</tbody>
          </table></div> : <p className="vide">Aucune commande.</p>}
          {a.factures.length ? <div className="defilement"><table>
            <thead><tr><th>Facture ou avoir</th><th>Date</th><th className="nombre">Montant HT</th><th>Paiement</th><th className="nombre">Reste à payer</th></tr></thead>
            <tbody>{a.factures.map((x) => (
              <tr key={x.id}><td><strong>{x.nom}</strong> <span className="muet">{x.type}</span></td><td>{jourCourt(x.date)}</td>
                <td className="nombre">{euros(x.montant_ht, true)}</td><td>{LIBELLES_PAIEMENT[x.paiement ?? ''] ?? x.paiement}</td>
                <td className="nombre">{euros(x.reste_a_payer, true)}</td></tr>))}</tbody>
          </table></div> : <p className="vide">Aucune facture ni avoir.</p>}
          <dl className="sf-totaux">
            <div><dt>Facturé HT</dt><dd>{euros(a.facture_ht, true)}</dd></div>
            {a.factures.length > 0 && <div><dt>Net (factures − avoirs)</dt><dd>{euros(a.factures_net_ht, true)}</dd></div>}
            <div><dt>Reste à payer</dt><dd>{euros(a.reste_a_payer, true)}</dd></div>
            <div><dt>Marge matériel</dt><dd className={a.marge_materiel < 0 ? 'negatif' : undefined}>{euros(a.marge_materiel, true)}</dd></div>
          </dl>
        </section>

        <section className="carte sf-bloc" aria-labelledby="t-couts">
          <div className="sf-bloc-tete"><h2 id="t-couts">Coûts estimés</h2></div>
          <div className="sf-couts">
            <span>Matériel</span><Barre valeur={a.cout_materiel} max={maxCout} texte={euros(a.cout_materiel)} />
            <span>Travail <small>{heures(c.heures_travail)}</small></span><Barre valeur={c.travail} max={maxCout} texte={euros(c.travail)} />
            <span>Route</span><Barre valeur={c.route} max={maxCout} texte={euros(c.route)} />
            <span>Véhicule</span><Barre valeur={c.vehicule} max={maxCout} texte={euros(c.vehicule)} />
          </div>
          <p className="sf-note">Règles du solveur : heures {c.base_heures === 'passees' ? 'passées' : 'prévues'} × {euros(c.cout_horaire_moyen, true)}/h
            {c.cout_km !== null && <>, véhicule {euros(c.cout_km, true)}/km</>}. {c.hors ? `${c.hors.charAt(0).toUpperCase()}${c.hors.slice(1)} non comptés.` : ''}</p>
        </section>
      </div>

      <section className="carte sf-bloc" aria-labelledby="t-rse">
        <div className="sf-bloc-tete"><h2 id="t-rse">Score RSE du déplacement</h2></div>
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
    </>
  );
}
