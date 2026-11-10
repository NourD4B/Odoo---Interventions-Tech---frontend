// Flotte : chaque véhicule avec sa photo (ou sa silhouette), son modèle réel (registre flotte de D4B), ses
// caractéristiques Odoo, la fiche constructeur du modèle (sources citées), son rôle dans la planification et les
// corrections à faire dans Odoo. Odoo reste en lecture seule ; les photos sont ajoutées ici.
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, type Affectation } from '../api';
import { Avertissements, EtatChargement, useDonnees } from '../composants';
import { useEcriture } from '../composants/Ecriture';
import Silhouette, { carrosserieDe } from '../composants/Silhouette';
import { BOITES, ENERGIES, flotte, ROLES, type FicheModele, type VehiculeFlotte } from '../flotte';
import { LIBELLES_STATUT_PLANIF, type StatutPlanif } from '../planification';

type Famille = 'utilitaire' | 'voiture' | 'deux_roues';
const FAMILLES: { cle: Famille; libelle: string }[] = [
  { cle: 'utilitaire', libelle: 'Utilitaires' }, { cle: 'voiture', libelle: 'Voitures' },
  { cle: 'deux_roues', libelle: 'Deux-roues' },
];

function familleDe(v: VehiculeFlotte): Famille {
  const t = v.registre?.type;
  if (t === 'UL') return 'utilitaire';
  if (t === 'SC') return 'deux_roues';
  if (t === 'VL') return 'voiture';
  const c = (v.categorie ?? '').toLowerCase();
  return c.includes('commerc') ? 'utilitaire' : c.includes('moto') ? 'deux_roues' : 'voiture';
}
const titreDe = (v: VehiculeFlotte) => (v.registre ? `${v.registre.constructeur} ${v.registre.modele}`
  : [v.marque, v.modele].filter(Boolean).join(' ') || v.name);
const energieDe = (v: VehiculeFlotte) => (v.registre?.carburant_libelle
  ? v.registre.carburant_libelle.charAt(0).toUpperCase() + v.registre.carburant_libelle.slice(1)
  : v.energie ? ENERGIES[v.energie] ?? v.energie : null);
/** Électrique ou hybride : d'après le registre quand le véhicule y figure (Odoo se trompe parfois d'énergie). */
const electrifie = (v: VehiculeFlotte) => (v.registre ? v.registre.carburant.includes('EL')
  : ['electric', 'full_hybrid', 'hybrid', 'plug_in_hybrid_gasoline', 'plug_in_hybrid_diesel'].includes(v.energie ?? ''));

const nombre = (n: number, decimales = 1) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: decimales }).format(n);
const jour = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
function lundiDe(s: string) {
  const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- fiche constructeur : libellés et unités ----------

const GROUPES: { titre: string; champs: [string, string, string, number?][] }[] = [
  { titre: 'Dimensions', champs: [['longueur_mm', 'Longueur', 'mm', 0], ['largeur_mm', 'Largeur', 'mm', 0],
    ['hauteur_mm', 'Hauteur', 'mm', 0], ['empattement_mm', 'Empattement', 'mm', 0], ['hauteur_selle_mm', 'Hauteur de selle', 'mm', 0]] },
  { titre: 'Chargement', champs: [['volume_utile_m3', 'Volume utile', 'm³'], ['volume_utile_max_m3', 'Volume utile maxi', 'm³'],
    ['longueur_utile_mm', 'Longueur utile', 'mm', 0], ['largeur_utile_mm', 'Largeur utile', 'mm', 0],
    ['hauteur_utile_mm', 'Hauteur utile', 'mm', 0], ['charge_utile_kg', 'Charge utile', 'kg', 0],
    ['charge_utile_max_kg', 'Charge utile maxi', 'kg', 0], ['ptac_kg', 'PTAC', 'kg', 0], ['coffre_l', 'Coffre', 'l', 0],
    ['remorquable_kg', 'Remorquable', 'kg', 0]] },
  { titre: 'Motorisation', champs: [['puissance_ch', 'Puissance', 'ch'], ['puissance_kw', 'Puissance', 'kW'],
    ['puissance_thermique_ch', 'Moteur thermique', 'ch', 0], ['puissance_crete_kw', 'Puissance crête', 'kW'],
    ['cylindree_cm3', 'Cylindrée', 'cm³', 0], ['couple_nm', 'Couple', 'Nm']] },
  { titre: 'Consommation', champs: [['conso_l_100km', 'Consommation mixte', 'l/100 km'], ['co2_g_km', 'CO2', 'g/km', 0],
    ['reservoir_l', 'Réservoir', 'l', 0]] },
  { titre: 'Électrique', champs: [['batterie_kwh', 'Batterie', 'kWh'], ['autonomie_km', 'Autonomie', 'km', 0],
    ['autonomie_electrique_km', 'Autonomie électrique', 'km', 0], ['charge_ac_kw', 'Recharge AC', 'kW'],
    ['charge_dc_kw', 'Recharge rapide DC', 'kW', 0]] },
  { titre: 'Divers', champs: [['places', 'Places', '', 0], ['poids_vide_kg', 'Poids à vide', 'kg', 0]] },
];

function valeurFiche(c: Record<string, number>, cle: string, unite: string, dec = 1): string | null {
  const plage = (a?: number, b?: number) => (a === undefined ? null : a === b || b === undefined
    ? `${nombre(a, dec)} ${unite}` : `${nombre(a, dec)} à ${nombre(b, dec)} ${unite}`);
  if (cle === 'conso_l_100km') return plage(c.conso_l_100km ?? c.conso_l_100km_min, c.conso_l_100km ?? c.conso_l_100km_max);
  if (cle === 'co2_g_km') return plage(c.co2_g_km ?? c.co2_g_km_min, c.co2_g_km ?? c.co2_g_km_max);
  return c[cle] === undefined ? null : `${nombre(c[cle], dec)}${unite ? ` ${unite}` : ''}`;
}

/** Deux ou trois chiffres utiles sur la carte : volume et charge d'un utilitaire, coffre d'une voiture, autonomie. */
function reperes(v: VehiculeFlotte): string[] {
  const c = v.fiche?.statut === 'fiche' ? v.fiche.caracteristiques ?? {} : {};
  const r: string[] = [];
  if (v.places) r.push(`${v.places} place${v.places > 1 ? 's' : ''}`);
  if (c.volume_utile_m3) r.push(`${nombre(c.volume_utile_m3)}${c.volume_utile_max_m3 ? `–${nombre(c.volume_utile_max_m3)}` : ''} m³`);
  else if (c.volume_utile_max_m3) r.push(`jusqu'à ${nombre(c.volume_utile_max_m3)} m³`);
  if (c.charge_utile_kg) r.push(`${nombre(c.charge_utile_kg, 0)} kg utiles`);
  if (!c.volume_utile_m3 && !c.volume_utile_max_m3 && c.coffre_l) r.push(`coffre ${nombre(c.coffre_l, 0)} l`);
  const autonomie = c.autonomie_km ?? c.autonomie_electrique_km;
  if (autonomie) r.push(`${nombre(autonomie, 0)} km${c.autonomie_electrique_km ? ' en électrique' : ''}`);
  if (c.cylindree_cm3) r.push(`${nombre(c.cylindree_cm3, 0)} cm³`);
  return r.slice(0, 3);
}

// ---------- visuel ----------

function Visuel({ v, grande = false }: { v: VehiculeFlotte; grande?: boolean }) {
  const [echec, setEchec] = useState(false);
  useEffect(() => setEchec(false), [v.photo?.version]);
  if (v.photo && !echec) {
    return <img className="fl-photo" src={flotte.urlPhoto(v.id, v.photo, grande ? 'grande' : 'vignette')}
      alt={`${titreDe(v)} ${v.plaque}`} loading="lazy" onError={() => setEchec(true)} />;
  }
  return <Silhouette carrosserie={carrosserieDe(v.fiche?.statut === 'fiche' ? v.fiche : null, v.categorie)}
    couleur={v.registre?.couleur ?? v.couleur} titre={`${titreDe(v)} (silhouette, pas encore de photo)`} />;
}

function Plaque({ plaque }: { plaque: string }) {
  return <span className="fl-plaque" aria-label={`Immatriculation ${plaque}`}><i aria-hidden="true">F</i>{plaque}<i aria-hidden="true" /></span>;
}

// ---------- carte ----------

function Carte({ v, agence, choisi, onOuvrir }: { v: VehiculeFlotte; agence: string | null; choisi: boolean; onOuvrir: () => void }) {
  const occupation = Math.min(1, v.jours_reserves_30j / 22);
  return (
    <button type="button" className={`fl-carte${choisi ? ' choisi' : ''}`} onClick={onOuvrir}
      aria-label={`${titreDe(v)}, ${v.plaque}`}>
      <div className="fl-visuel">
        <Visuel v={v} />
        <Plaque plaque={v.plaque} />
        {energieDe(v) && <span className={`fl-energie${electrifie(v) ? ' electrifie' : ''}`}>{energieDe(v)}</span>}
        {v.a_verifier.length > 0 && <span className="fl-a-corriger" title={v.a_verifier.join('\n')}>
          {v.a_verifier.length} à corriger</span>}
        {v.registre?.commentaire && <span className="fl-commentaire">{v.registre.commentaire}</span>}
      </div>
      <div className="fl-corps">
        <strong className="fl-titre">{titreDe(v)}</strong>
        <span className="fl-sous">{[v.fiche?.statut === 'fiche' ? v.fiche.generation : null,
          v.registre?.annee ?? v.annee_modele].filter(Boolean).join(' · ')}</span>
        <span className="fl-reperes">{reperes(v).map((r) => <span key={r}>{r}</span>)}</span>
        <span className="fl-role" title={`${ROLES[v.attribution]}${v.conducteur ? ` · ${v.conducteur}` : ''}`}>
          <span className={`fl-pastille ${v.attribution}`} aria-hidden="true" />
          <span className="fl-qui">{v.attribution === 'pool' ? 'Pool'
            : v.attribution === 'attitre' ? `Attitré · ${v.conducteur ?? ''}` : v.conducteur ?? ROLES.exclu}</span>
          <span className="fl-lieu">{agence ?? v.registre?.localisation ?? v.location ?? ''}</span>
        </span>
        <span className="fl-occupation" title={`${v.jours_reserves_30j} jour(s) ouvré(s) réservé(s) sur les 30 prochains jours`}>
          <span className="fl-jauge"><i style={{ width: `${occupation * 100}%` }} /></span>
          <em>{v.jours_reserves_30j ? `${v.jours_reserves_30j} j réservés / 30 j` : 'libre ces 30 jours'}</em>
        </span>
      </div>
    </button>
  );
}

// ---------- panneau ----------

function Ligne({ libelle, registre, odoo, alerte }: { libelle: string; registre?: ReactNode; odoo: ReactNode; alerte?: boolean }) {
  const vide = <span className="muet">non renseigné</span>;
  return (
    <tr className={alerte ? 'fl-ecart' : ''}>
      <th scope="row">{libelle}{alerte && <span className="fl-ecart-icone" aria-label="écart avec Odoo">!</span>}</th>
      {registre !== undefined && <td>{registre ?? vide}</td>}
      <td>{odoo === null || odoo === undefined || odoo === '' ? vide : odoo}</td>
    </tr>
  );
}

function FicheConstructeur({ f }: { f: FicheModele }) {
  if (f.statut === 'a_preciser') return <div className="avertissement">{f.raison}</div>;
  const c = f.caracteristiques ?? {};
  return (
    <div className="fl-fiche">
      <div className="fl-fiche-tete">
        <div>
          <strong>{f.nom}</strong>
          <span>{f.generation}</span>
        </div>
        <span className="fl-badge-source">Données constructeur · à confirmer</span>
      </div>
      <p className="fl-reference">Version de référence : {f.version_reference}</p>
      <div className="fl-groupes">
        {GROUPES.map((g) => {
          const lignes = g.champs.map(([cle, libelle, unite, dec]) => [libelle, valeurFiche(c, cle, unite, dec)] as const)
            .filter(([, val]) => val !== null);
          if (!lignes.length) return null;
          return (
            <dl key={g.titre} className="fl-groupe">
              <dt className="fl-groupe-titre">{g.titre}</dt>
              {lignes.map(([libelle, val]) => <div key={libelle}><dt>{libelle}</dt><dd>{val}</dd></div>)}
            </dl>
          );
        })}
      </div>
      {f.variantes && <p className="fl-note"><strong>Variantes.</strong> {f.variantes}</p>}
      {f.remarque && <p className="fl-note">{f.remarque}</p>}
      {!!f.sources?.length && (
        <p className="fl-sources">Sources : {f.sources.map((s, i) => (
          <span key={s.url}>{i > 0 && ' · '}<a href={s.url} target="_blank" rel="noreferrer">{s.titre}</a></span>))}</p>
      )}
    </div>
  );
}

function Panneau({ v, agence, onFermer, onPhoto }: {
  v: VehiculeFlotte; agence: string | null; onFermer: () => void; onPhoto: () => void;
}) {
  const { ecrire, dialogue } = useEcriture();
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [survol, setSurvol] = useState(false);
  const [historique, setHistorique] = useState<Affectation[] | null | 'erreur'>(null);
  const entree = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setHistorique(null); setErreur(null);
    let actif = true;
    api.affectations(v.id).then((h) => { if (actif) setHistorique(h); }).catch(() => { if (actif) setHistorique('erreur'); });
    return () => { actif = false; };
  }, [v.id]);
  const r = v.registre;
  const ecart = (mot: string) => v.a_verifier.some((a) => a.startsWith(mot));

  const envoyer = async (fichier: File | undefined) => {
    if (!fichier) return;
    setErreur(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(fichier.type)) {
      setErreur('Choisir une photo JPEG, PNG ou WebP.'); return;
    }
    setEnvoi(true);
    try {
      if (await ecrire(() => flotte.deposerPhoto(v.id, fichier))) onPhoto();
    } catch (e) { setErreur(e instanceof Error ? e.message : String(e)); } finally { setEnvoi(false); }
  };
  const retirer = async () => {
    setEnvoi(true); setErreur(null);
    try { await ecrire(() => flotte.retirerPhoto(v.id)); onPhoto(); }
    catch (e) { setErreur(e instanceof Error ? e.message : String(e)); } finally { setEnvoi(false); }
  };
  const deposer = (e: DragEvent) => { e.preventDefault(); setSurvol(false); void envoyer(e.dataTransfer.files[0]); };

  return (
    <div className="fl-voile" role="presentation" onClick={onFermer}>
      <aside className="fl-panneau" role="dialog" aria-modal="true" aria-label={`${titreDe(v)} ${v.plaque}`}
        onClick={(e) => e.stopPropagation()}>
        <header className="fl-panneau-tete">
          <div>
            <h2>{titreDe(v)}</h2>
            <div className="fl-panneau-sous"><Plaque plaque={v.plaque} />
              {energieDe(v) && <span className={`fl-energie statique${electrifie(v) ? ' electrifie' : ''}`}>{energieDe(v)}</span>}
              {r?.commentaire && <span className="fl-commentaire statique">{r.commentaire}</span>}
            </div>
          </div>
          <button type="button" className="fl-fermer" aria-label="Fermer" onClick={onFermer}>×</button>
        </header>

        <div className={`fl-grand-visuel${survol ? ' survol' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setSurvol(true); }} onDragLeave={() => setSurvol(false)} onDrop={deposer}>
          <Visuel v={v} grande />
          <div className="fl-actions-photo">
            <input ref={entree} type="file" accept="image/jpeg,image/png,image/webp" hidden
              onChange={(e) => { void envoyer(e.target.files?.[0]); e.target.value = ''; }} />
            <button type="button" className="btn" disabled={envoi} onClick={() => entree.current?.click()}>
              {envoi ? 'Envoi…' : v.photo ? 'Remplacer la photo' : 'Ajouter une photo'}</button>
            {v.photo && <button type="button" className="btn fl-btn-retirer" disabled={envoi} onClick={() => void retirer()}>Retirer</button>}
          </div>
          {!v.photo && <span className="fl-glisser">Glissez une photo ici · réenregistrée sans métadonnées (GPS)</span>}
          {v.photo && <span className="fl-glisser">Photo ajoutée par {v.photo.auteur} le {jour(v.photo.ajoutee_le)}</span>}
        </div>
        {erreur && <div className="erreur" role="alert">{erreur}</div>}

        {v.a_verifier.length > 0 && (
          <section className="fl-section fl-corrections" aria-label="À corriger dans Odoo">
            <h3>À corriger dans Odoo <span>{v.a_verifier.length}</span></h3>
            <ul>{v.a_verifier.map((a) => <li key={a}>{a}</li>)}</ul>
          </section>
        )}

        <section className="fl-section">
          <h3>Identité</h3>
          <table className="fl-table">
            <thead><tr><th />{r && <th scope="col">Registre D4B</th>}<th scope="col">Odoo</th></tr></thead>
            <tbody>
              <Ligne libelle="Modèle" registre={r ? `${r.constructeur} ${r.modele}` : undefined}
                odoo={v.model_name?.replace('/', ' ')} alerte={ecart('Modèle')} />
              <Ligne libelle="Énergie" registre={r ? r.carburant_libelle : undefined}
                odoo={v.energie ? ENERGIES[v.energie] ?? v.energie : null} alerte={ecart('Énergie')} />
              <Ligne libelle="Type / catégorie" registre={r ? r.type_libelle : undefined} odoo={v.categorie}
                alerte={ecart('Catégorie') || ecart('Pas de catégorie')} />
              <Ligne libelle="Couleur" registre={r ? r.couleur : undefined} odoo={v.couleur} alerte={ecart('Couleur')} />
              <Ligne libelle="Année" registre={r ? r.annee : undefined}
                odoo={[v.annee_modele && `modèle ${v.annee_modele}`, v.date_immatriculation && `immatriculé le ${jour(v.date_immatriculation)}`]
                  .filter(Boolean).join(' · ')} />
              <Ligne libelle="Lieu" registre={r ? r.localisation : undefined} odoo={v.location} alerte={ecart('Lieu')} />
              <Ligne libelle="Attribution" registre={r ? (r.attribution === 'service' ? 'Véhicule de service' : 'Nominatif') : undefined}
                odoo={v.attribution === 'pool' ? 'Véhicule de service' : v.conducteur} alerte={ecart('Registre : véhicule') || ecart('Registre : attribué')} />
              <Ligne libelle="État" registre={r ? '' : undefined} odoo={v.etat} alerte={ecart('État')} />
            </tbody>
          </table>
        </section>

        <section className="fl-section">
          <h3>Caractéristiques dans Odoo</h3>
          <dl className="fl-odoo">
            {([['Places', v.places || null], ['Portes', v.portes || null], ['Boîte', v.boite ? BOITES[v.boite] ?? v.boite : null],
              ['Puissance', [v.puissance_ch && `${v.puissance_ch} ch`, v.puissance_kw && `${v.puissance_kw} kW`].filter(Boolean).join(' · ') || null],
              ['CO2', v.co2_g_km ? `${nombre(v.co2_g_km, 0)} g/km` : null],
              ['Compteur', v.compteur ? `${nombre(v.compteur, 0)} ${v.compteur_unite === 'miles' ? 'mi' : 'km'}` : null],
              ['Autonomie', v.autonomie_km ? `${v.autonomie_km} km` : null], ['Attelage', v.attelage ? 'Oui' : null],
            ] as [string, ReactNode][]).map(([libelle, val]) => (
              <div key={libelle}><dt>{libelle}</dt><dd>{val ?? <span className="muet">non renseigné</span>}</dd></div>
            ))}
          </dl>
        </section>

        <section className="fl-section">
          <h3>Fiche constructeur</h3>
          {v.fiche ? <FicheConstructeur f={v.fiche} /> : <p className="muet">Pas de fiche pour ce modèle.</p>}
        </section>

        <section className="fl-section">
          <h3>Planification</h3>
          <p className="fl-planif">
            <span className={`fl-pastille ${v.attribution}`} aria-hidden="true" />{ROLES[v.attribution]}
            {v.attribution === 'attitre' && v.conducteur ? ` à ${v.conducteur}` : ''}
            {' · '}{v.type_planification === 'exclu' ? 'non proposé par le solveur' : v.type_planification}
            {agence ? ` · agence ${agence}` : ''}
          </p>
          {v.prochaines.length ? (
            <ul className="fl-prochaines">{v.prochaines.map((a) => (
              <li key={`${a.service_id}-${a.debut}`}>
                <Link to={`/planification?semaine=${lundiDe(a.debut)}`}>{a.client ?? a.service}</Link>
                <span>{a.service}</span>
                <em>{a.debut === a.fin ? jour(a.debut) : `${jour(a.debut)} → ${jour(a.fin)}`} ·{' '}
                  {LIBELLES_STATUT_PLANIF[a.etat as StatutPlanif] ?? a.etat}</em>
              </li>))}</ul>
          ) : <p className="muet">Aucune affectation à venir.</p>}
        </section>

        <section className="fl-section">
          <h3>Historique des conducteurs <span className="fl-source">Odoo</span></h3>
          {historique === null && <p className="muet">Chargement…</p>}
          {historique === 'erreur' && <p className="muet">Odoo injoignable : historique indisponible.</p>}
          {Array.isArray(historique) && !historique.length && <p className="muet">Aucun conducteur enregistré.</p>}
          {Array.isArray(historique) && historique.length > 0 && (
            <ul className="fl-historique">{historique.map((a, k) => (
              <li key={k}><strong>{a.pool ? 'Véhicule de service' : a.conducteur}</strong>
                <span>{a.debut ? jour(a.debut) : '?'} → {a.fin ? jour(a.fin) : 'en cours'}</span></li>))}</ul>
          )}
        </section>
        {dialogue}
      </aside>
    </div>
  );
}

// ---------- page ----------

export default function Flotte() {
  const donnees = useDonnees(() => flotte.vehicules(), []);
  const [texte, setTexte] = useState('');
  const [famille, setFamille] = useState<Famille | ''>('');
  const [lieu, setLieu] = useState('');
  const [energie, setEnergie] = useState('');
  const [aCorriger, setACorriger] = useState(false);
  const [ouvert, setOuvert] = useState<number | null>(null);
  useEffect(() => {
    const touche = (e: KeyboardEvent) => { if (e.key === 'Escape') setOuvert(null); };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, []);

  const d = donnees.donnees;
  const tous = useMemo(() => d?.vehicules ?? [], [d]);
  const agences = useMemo(() => new Map((d?.agences ?? []).map((a) => [a.code, a.nom])), [d]);
  const lieuDe = (v: VehiculeFlotte) => (v.agence_code ? agences.get(v.agence_code) ?? v.agence_code : null);
  const lieux = [...new Set(tous.map((v) => lieuDe(v) ?? v.registre?.localisation ?? v.location ?? '').filter(Boolean))].sort();
  const energies = [...new Set(tous.map((v) => energieDe(v) ?? '').filter(Boolean))].sort();
  const visibles = tous.filter((v) => {
    const q = texte.trim().toLowerCase();
    return (!famille || familleDe(v) === famille) && (!aCorriger || v.a_verifier.length > 0)
      && (!lieu || (lieuDe(v) ?? v.registre?.localisation ?? v.location) === lieu) && (!energie || energieDe(v) === energie)
      && (!q || [v.plaque, titreDe(v), v.conducteur, v.model_name].filter(Boolean).join(' ').toLowerCase().includes(q));
  });
  const compte = (f: Famille) => tous.filter((v) => familleDe(v) === f).length;
  const nbCorriger = tous.filter((v) => v.a_verifier.length).length;
  const choisi = tous.find((v) => v.id === ouvert) ?? null;

  return (
    <div className="fl">
      <div className="fl-kpis" aria-label="La flotte en chiffres">
        <div><strong>{tous.length}</strong><span>véhicules actifs dans Odoo</span></div>
        {FAMILLES.map((f) => <div key={f.cle}><strong>{compte(f.cle)}</strong><span>{f.libelle.toLowerCase()}</span></div>)}
        <div><strong>{tous.filter(electrifie).length}</strong><span>électriques ou hybrides</span></div>
        <div><strong>{tous.filter((v) => v.attribution === 'pool').length}</strong><span>véhicules de service (pool)</span></div>
        <button type="button" className={`fl-kpi-corriger${aCorriger ? ' actif' : ''}`} aria-pressed={aCorriger}
          onClick={() => setACorriger((x) => !x)} disabled={!nbCorriger}>
          <strong>{nbCorriger}</strong><span>à corriger dans Odoo</span></button>
      </div>

      <div className="filtres fl-filtres" role="search">
        <label className="champ champ-recherche">Rechercher
          <input type="search" value={texte} placeholder="Plaque, modèle, conducteur" onChange={(e) => setTexte(e.target.value)} /></label>
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
              {liste.map((v) => <Carte key={v.id} v={v} agence={lieuDe(v)} choisi={v.id === ouvert} onOuvrir={() => setOuvert(v.id)} />)}
            </div>
          </section>
        );
      })}
      {d && !visibles.length && <div className="vide">Aucun véhicule ne correspond aux filtres.</div>}

      {choisi && <Panneau key={choisi.id} v={choisi} agence={lieuDe(choisi)} onFermer={() => setOuvert(null)} onPhoto={donnees.recharger} />}
    </div>
  );
}
