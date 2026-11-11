// Pièces communes à la galerie de la flotte et à la fiche d'un véhicule. Les valeurs affichées sont les valeurs
// retenues : celles d'Odoo, corrigées par le registre flotte de D4B quand Odoo se trompe (ex. « Fiat/Fiat »).
import { useEffect, useState } from 'react';
import { ENERGIES, flotte, type FicheModele, type Retenu, type VehiculeFlotte } from '../flotte';
import Silhouette, { carrosserieDe } from './Silhouette';

export type Famille = 'utilitaire' | 'voiture' | 'deux_roues';
export const FAMILLES: { cle: Famille; libelle: string }[] = [
  { cle: 'utilitaire', libelle: 'Utilitaires' }, { cle: 'voiture', libelle: 'Voitures' },
  { cle: 'deux_roues', libelle: 'Deux-roues' },
];

export function familleDe(v: VehiculeFlotte): Famille {
  const c = (v.retenu.categorie ?? '').toLowerCase();
  return c.includes('commerc') ? 'utilitaire' : c.includes('moto') ? 'deux_roues' : 'voiture';
}
export const titreDe = (v: VehiculeFlotte) => [v.retenu.marque, v.retenu.modele].filter(Boolean).join(' ') || v.name;
export const libelleEnergie = (e: string | null) => (e ? ENERGIES[e] ?? e : null);
export const energieDe = (v: VehiculeFlotte) => libelleEnergie(v.retenu.energie);
export const electrifie = (v: VehiculeFlotte) =>
  ['electric', 'full_hybrid', 'hybrid', 'plug_in_hybrid_gasoline', 'plug_in_hybrid_diesel'].includes(v.retenu.energie ?? '');
export const planifiable = (v: VehiculeFlotte) => v.attribution === 'pool' && v.type_planification !== 'exclu';

/** Valeur d'Odoo remplacée par la valeur retenue (affichée en info-bulle : à corriger dans Odoo). */
export function valeurOdoo(v: VehiculeFlotte, champ: Retenu['corriges'][number]): string {
  const brut = {
    modele: v.model_name?.replace('/', ' '), energie: libelleEnergie(v.energie), categorie: v.categorie,
    couleur: v.couleur, lieu: v.location, annee: v.annee_modele,
    attribution: v.attribution === 'pool' ? 'véhicule de service' : v.conducteur ?? 'attribué à une personne',
  }[champ];
  return brut || 'non renseigné';
}

export const nombre = (n: number, decimales = 1) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: decimales }).format(n);
export const jour = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00`)
  .toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
export function lundiDe(s: string) {
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
export function reperes(v: VehiculeFlotte): string[] {
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

export function Visuel({ v, grande = false }: { v: VehiculeFlotte; grande?: boolean }) {
  const [echec, setEchec] = useState(false);
  useEffect(() => setEchec(false), [v.photo?.version]);
  if (v.photo && !echec) {
    return <img className="fl-photo" src={flotte.urlPhoto(v.id, v.photo, grande ? 'grande' : 'vignette')}
      alt={`${titreDe(v)} ${v.plaque}`} loading="lazy" onError={() => setEchec(true)} />;
  }
  return <Silhouette carrosserie={carrosserieDe(v.fiche?.statut === 'fiche' ? v.fiche : null, v.retenu.categorie)}
    couleur={v.retenu.couleur} titre={`${titreDe(v)} (silhouette, pas encore de photo)`} />;
}

export function Plaque({ plaque }: { plaque: string }) {
  return <span className="fl-plaque" aria-label={`Immatriculation ${plaque}`}><i aria-hidden="true">F</i>{plaque}<i aria-hidden="true" /></span>;
}

export function FicheConstructeur({ f }: { f: FicheModele }) {
  if (f.statut === 'a_preciser') return <div className="avertissement">{f.raison}</div>;
  const c = f.caracteristiques ?? {};
  return (
    <div className="fl-fiche">
      <div className="fl-fiche-tete">
        <div>
          <strong>{f.nom}</strong>
          <span>{f.generation}</span>
        </div>
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
