// Parc véhicules : les véhicules de service (pool) utilisés pour les services, avec leur photo (ou leur silhouette),
// leur modèle exact (Odoo, corrigé par le registre flotte de D4B quand Odoo se trompe), quelques repères de la
// fiche constructeur et leur occupation. Un clic ouvre la fiche du véhicule (traçabilité en cas de PV).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avertissements, EtatChargement, useDonnees } from '../composants';
import {
  electrifie, energieDe, FAMILLES, familleDe, Plaque, planifiable, reperes, titreDe, Visuel, type Famille,
} from '../composants/Vehicule';
import { flotte, type VehiculeFlotte } from '../flotte';

function Carte({ v, lieu }: { v: VehiculeFlotte; lieu: string | null }) {
  const occupation = Math.min(1, v.jours_reserves_30j / 22);
  const ok = planifiable(v);
  return (
    <Link to={`/vehicules/${v.id}`} className="fl-carte" aria-label={`${titreDe(v)}, ${v.plaque} : ouvrir la fiche`}>
      <div className="fl-visuel">
        <Visuel v={v} />
        <Plaque plaque={v.plaque} />
        {energieDe(v) && <span className={`fl-energie${electrifie(v) ? ' electrifie' : ''}`}>{energieDe(v)}</span>}
        {v.a_verifier.length > 0 && <span className="fl-a-corriger" title={v.a_verifier.join('\n')}>
          {v.a_verifier.length} à corriger</span>}
      </div>
      <div className="fl-corps">
        <strong className="fl-titre">{titreDe(v)}</strong>
        <span className="fl-sous">{[v.fiche?.statut === 'fiche' ? v.fiche.generation : null, v.retenu.annee]
          .filter(Boolean).join(' · ')}</span>
        <span className="fl-reperes">{reperes(v).map((r) => <span key={r}>{r}</span>)}</span>
        <span className="fl-role" title={ok ? 'Proposé par le solveur de planification'
          : 'Pas proposé par le solveur : données Odoo à corriger (catégorie, conducteur « Véhicule de service »…)'}>
          <span className={`fl-pastille ${ok ? 'pool' : ''}`} aria-hidden="true" />
          <span className="fl-qui">{ok ? 'Planifiable' : 'Hors planification'}</span>
          <span className="fl-lieu">{lieu ?? ''}</span>
        </span>
        <span className="fl-occupation" title={`${v.jours_reserves_30j} jour(s) ouvré(s) réservé(s) sur les 30 prochains jours`}>
          <span className="fl-jauge"><i style={{ width: `${occupation * 100}%` }} /></span>
          <em>{v.jours_reserves_30j ? `${v.jours_reserves_30j} j réservés / 30 j` : 'libre ces 30 jours'}</em>
        </span>
      </div>
    </Link>
  );
}

export default function Flotte() {
  const donnees = useDonnees(() => flotte.vehicules(), []);
  const [texte, setTexte] = useState('');
  const [famille, setFamille] = useState<Famille | ''>('');
  const [lieu, setLieu] = useState('');
  const [energie, setEnergie] = useState('');
  const [aCorriger, setACorriger] = useState(false);

  const d = donnees.donnees;
  const tous = useMemo(() => d?.vehicules ?? [], [d]);
  const agences = useMemo(() => new Map((d?.agences ?? []).map((a) => [a.code, a.nom])), [d]);
  const lieuDe = (v: VehiculeFlotte) => (v.agence_code ? agences.get(v.agence_code) ?? v.agence_code : null) ?? v.retenu.lieu;
  const lieux = [...new Set(tous.map((v) => lieuDe(v) ?? '').filter(Boolean))].sort();
  const energies = [...new Set(tous.map((v) => energieDe(v) ?? '').filter(Boolean))].sort();
  const visibles = tous.filter((v) => {
    const q = texte.trim().toLowerCase();
    return (!famille || familleDe(v) === famille) && (!aCorriger || v.a_verifier.length > 0)
      && (!lieu || lieuDe(v) === lieu) && (!energie || energieDe(v) === energie)
      && (!q || [v.plaque, titreDe(v), v.model_name].filter(Boolean).join(' ').toLowerCase().includes(q));
  });
  const compte = (f: Famille) => tous.filter((v) => familleDe(v) === f).length;
  const nbCorriger = tous.filter((v) => v.a_verifier.length).length;

  return (
    <div className="fl">
      <div className="fl-kpis fl-kpis-service" aria-label="Les véhicules de service en chiffres">
        <div><strong>{tous.length}</strong><span>véhicules de service</span></div>
        {FAMILLES.map((f) => <div key={f.cle}><strong>{compte(f.cle)}</strong><span>{f.libelle.toLowerCase()}</span></div>)}
        <div><strong>{tous.filter(electrifie).length}</strong><span>électriques ou hybrides</span></div>
        <button type="button" className={`fl-kpi-corriger${aCorriger ? ' actif' : ''}`} aria-pressed={aCorriger}
          onClick={() => setACorriger((x) => !x)} disabled={!nbCorriger}>
          <strong>{nbCorriger}</strong><span>à corriger dans Odoo</span></button>
      </div>
      {!!d?.masques && <p className="fl-perimetre">Véhicules partagés pour les services seulement : {d.masques} véhicule
        {d.masques > 1 ? 's' : ''} attribué{d.masques > 1 ? 's' : ''} à une personne ou restitué{d.masques > 1 ? 's' : ''} non
        affiché{d.masques > 1 ? 's' : ''}.</p>}

      <div className="filtres fl-filtres" role="search">
        <label className="champ champ-recherche">Rechercher
          <input type="search" value={texte} placeholder="Plaque, modèle" onChange={(e) => setTexte(e.target.value)} /></label>
        <div className="segmente" role="radiogroup" aria-label="Type de véhicule">
          <button type="button" role="radio" aria-checked={famille === ''} className={famille === '' ? 'actif' : ''}
            onClick={() => setFamille('')}>Tous <span className="compteur">{tous.length}</span></button>
          {FAMILLES.map((f) => (
            <button key={f.cle} type="button" role="radio" aria-checked={famille === f.cle} className={famille === f.cle ? 'actif' : ''}
              onClick={() => setFamille(f.cle)}>{f.libelle} <span className="compteur">{compte(f.cle)}</span></button>
          ))}
        </div>
        <label className="champ">Lieu
          <select value={lieu} onChange={(e) => setLieu(e.target.value)}>
            <option value="">Tous</option>{lieux.map((l) => <option key={l}>{l}</option>)}</select></label>
        <label className="champ">Énergie
          <select value={energie} onChange={(e) => setEnergie(e.target.value)}>
            <option value="">Toutes</option>{energies.map((l) => <option key={l}>{l}</option>)}</select></label>
      </div>

      <EtatChargement chargement={donnees.chargement && !d} erreur={donnees.erreur} />
      <Avertissements liste={d?.avertissements} />

      {FAMILLES.filter((f) => !famille || famille === f.cle).map((f) => {
        const liste = visibles.filter((v) => familleDe(v) === f.cle)
          .sort((a, b) => titreDe(a).localeCompare(titreDe(b), 'fr') || a.plaque.localeCompare(b.plaque));
        if (!liste.length) return null;
        return (
          <section key={f.cle} className="fl-famille" aria-label={f.libelle}>
            <h2>{f.libelle} <span>{liste.length}</span></h2>
            <div className="fl-grille">
              {liste.map((v) => <Carte key={v.id} v={v} lieu={lieuDe(v)} />)}
            </div>
          </section>
        );
      })}
      {d && !visibles.length && <div className="vide">Aucun véhicule ne correspond aux filtres.</div>}
    </div>
  );
}
