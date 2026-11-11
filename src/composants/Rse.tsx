// Briques du score RSE : note A à E (étiquette façon étiquette énergie), choix du mode de transport d'une mission,
// détail du calcul, méthode et sources, consommation réelle d'un véhicule.
import { useState, type FormEvent } from 'react';
import { useEcriture } from './Ecriture';
import { co2, MODES, NOTES, rse, SOURCES, type BilanRse, type MethodeRse, type ModeTransport, type NoteRse,
         type ProfilVehicule, type RseMission } from '../rse';

const PLAGES: Record<NoteRse, string> = {
  A: '75 % évités ou plus', B: '50 à 75 %', C: '25 à 50 %', D: '0 à 25 %', E: 'plus émetteur',
};
const nombre = (n: number, d = 1) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d }).format(n);

export function IconeMode({ mode }: { mode: ModeTransport | null }) {
  const trait = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg className="rs-icone" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      {(mode === 'car_thermal' || mode === 'car_electric' || mode === null) && <>
        <path {...trait} d="M3 13.5V10l1.6-3.6A1.5 1.5 0 0 1 6 5.5h8a1.5 1.5 0 0 1 1.4.9L17 10v3.5H3zM3 10h14" />
        <circle {...trait} cx="6.5" cy="14" r="1.5" /><circle {...trait} cx="13.5" cy="14" r="1.5" />
        {mode === 'car_electric' && <path d="M10.6 6.2 8.6 9h2l-1 2.6 2.2-3.1h-2z" fill="currentColor" />}</>}
      {mode === 'plane' && <path {...trait} d="M2.5 11.5 17 6.5a1.4 1.4 0 0 1 .8 2.6L5.5 14l-3-2.5zM8 9.6 6 4h2.2l4 4.4M7.5 12.6 9 16h2l.5-4.6" />}
      {mode === 'public_transport' && <>
        <rect {...trait} x="5" y="2.5" width="10" height="12" rx="2.5" /><path {...trait} d="M5 8.5h10M7 17.5l1.5-3M13 17.5l-1.5-3" />
        <circle cx="7.8" cy="11.5" r=".9" fill="currentColor" /><circle cx="12.2" cy="11.5" r=".9" fill="currentColor" /></>}
      {mode === 'walk' && <>
        <circle {...trait} cx="10.5" cy="3.6" r="1.6" />
        <path {...trait} d="M9.8 7 8 11.5l2.5 2 1 4.5M9.8 7l3 3 2.2.5M9 7l-2.5 2.2-.5 2.3M8 11.5 6.5 17.5" /></>}
    </svg>
  );
}

/** Note RSE en pastille carrée (lettre toujours écrite : jamais la couleur seule). */
export function PastilleNote({ note, grande = false, titre }: { note: NoteRse | null; grande?: boolean; titre?: string }) {
  return (
    <span className={`rs-note ${note ? `rs-${note}` : 'rs-vide'}${grande ? ' grande' : ''}`}
      title={titre ?? (note ? `Score RSE ${note} : ${PLAGES[note]}` : 'Pas de score : mode de transport à renseigner')}>
      {note ?? '–'}</span>
  );
}

/** Étiquette en escalier, la note du projet ressortie (lecture familière de l'étiquette énergie). */
export function Etiquette({ note }: { note: NoteRse | null }) {
  return (
    <ol className="rs-etiquette" aria-label={note ? `Score RSE : ${note}` : 'Pas encore de score RSE'}>
      {NOTES.map((n, i) => (
        <li key={n} className={`rs-${n}${n === note ? ' actif' : ''}`} style={{ width: `${46 + i * 11}%` }}>
          <span className="rs-lettre">{n}</span><span className="rs-plage">{PLAGES[n]}</span>
        </li>))}
    </ol>
  );
}

/** Bandeau du projet : étiquette, émissions, part évitée, répartition par mode, missions notées, méthode. */
export function BandeauRse({ b }: { b: BilanRse }) {
  const max = Math.max(1, ...b.par_mode.map((p) => p.kg_co2e));
  return (
    <section className="rs-bandeau" aria-label="Score RSE des déplacements">
      <div className="rs-bandeau-note">
        <PastilleNote note={b.note} grande />
        <div><h2>Score RSE des déplacements</h2>
          <p>{b.notees} mission{b.notees > 1 ? 's' : ''} notée{b.notees > 1 ? 's' : ''} sur {b.missions}
            {b.sans_mode > 0 && <>, {b.sans_mode} sans mode de transport</>}</p></div>
      </div>
      <Etiquette note={b.note} />
      <dl className="rs-chiffres">
        <div><dt>Émissions estimées</dt><dd>{co2(b.kg_co2e)}</dd></div>
        <div><dt>Par rapport à chacun seul en voiture thermique</dt>
          <dd className={b.evite_pct !== null && b.evite_pct < 0 ? 'negatif' : ''}>{b.evite_pct === null ? '—'
            : b.evite_pct >= 0 ? `${nombre(b.evite_pct, 0)} % évités` : `${nombre(-b.evite_pct, 0)} % de plus`}
            {b.reference_kg !== null && <small>référence {co2(b.reference_kg)}</small>}</dd></div>
      </dl>
      <div className="rs-modes">
        {b.par_mode.length ? b.par_mode.map((p) => (
          <div key={p.mode} className="rs-mode-ligne">
            <span className="rs-mode-nom"><IconeMode mode={p.mode} />{p.libelle}<small>{p.missions} mission{p.missions > 1 ? 's' : ''}</small></span>
            <span className="rs-mode-barre"><i style={{ width: `${Math.max(2, (100 * p.kg_co2e) / max)}%` }} /></span>
            <span className="rs-mode-kg">{co2(p.kg_co2e)}</span>
          </div>))
          : <p className="muet">Aucune mission notée : choisir le mode de transport des missions.</p>}
      </div>
      <Methode />
    </section>
  );
}

/** Méthode et sources (lues à l'ouverture). */
export function Methode() {
  const [m, setM] = useState<MethodeRse | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const ouvrir = (ouvert: boolean) => {
    if (ouvert && !m) rse.methode().then(setM).catch((e: Error) => setErreur(e.message));
  };
  return (
    <details className="rs-methode" onToggle={(e) => ouvrir((e.target as HTMLDetailsElement).open)}>
      <summary>Méthode et sources</summary>
      {erreur && <p className="erreur">{erreur}</p>}
      {m && <div className="rs-methode-corps">
        <p>Émissions « du puits à la roue » (carburant produit, transporté et brûlé ; fabrication des véhicules non
          comptée), en kg CO2e. Référence : {m.reference.toLowerCase()}, {nombre(m.reference_kg_par_km, 3)} kg CO2e/km par
          personne. Voiture : consommation saisie, sinon constructeur × {nombre(m.ecart_usage_reel, 2)} (usage réel),
          × pertes de recharge {nombre(m.pertes_recharge, 2)} pour l'électrique ; comptée une fois par voiture.</p>
        <ul>{m.carburants.map((c) => <li key={c.cle}>{c.libelle} : {nombre(c.kg_co2e, 3)} kg CO2e/{c.unite}</li>)}</ul>
        <ul>{m.modes.filter((x) => x.tranches && x.tranches.some((t) => t.kg_co2e_par_km > 0)).map((x) => (
          <li key={x.cle}>{x.libelle}, par personne : {x.tranches!.map((t, i) => `${t.libelle} ${t.jusqu_a_km
            ? `(jusqu'à ${nombre(t.jusqu_a_km, 0)} km)` : `(au-delà de ${nombre(x.tranches![i - 1]?.jusqu_a_km ?? 0, 0)} km)`} ${nombre(t.kg_co2e_par_km, 4)}`)
            .join(', ')} kg CO2e/km</li>))}</ul>
        <p className="muet">Avion : distance à vol d'oiseau plus la correction de l'OACI, un aller-retour par personne, traînées
          de condensation incluses ; trajets vers les aéroports non comptés.</p>
        <ul className="rs-sources">{m.sources.map((x) => <li key={x.titre}>{x.url
          ? <a href={x.url} target="_blank" rel="noreferrer">{x.titre}</a> : x.titre}</li>)}</ul>
        <p className="muet">Version des facteurs : {m.version}.</p>
      </div>}
    </details>
  );
}

/** Choix du mode de transport d'une mission (même clé que la future sélection Odoo). */
export function ChoixMode({ serviceId, r, onChange }: { serviceId: number; r: RseMission; onChange: () => void }) {
  const { ecrire, dialogue } = useEcriture();
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const odoo = r.source === 'odoo';
  const actuel = r.source === 'saisie' ? r.mode_choisi : null;
  const choisir = async (mode: ModeTransport | null) => {
    if (odoo || envoi || mode === actuel) return;
    setErreur(null); setEnvoi(true);
    try {
      if (await ecrire(() => rse.choisirMode(serviceId, mode))) onChange();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally { setEnvoi(false); }
  };
  return (
    <div className="rs-choix">
      <div className="rs-segments" role="radiogroup" aria-label="Mode de transport de la mission">
        <button type="button" role="radio" aria-checked={actuel === null} disabled={odoo || envoi}
          className={actuel === null ? 'actif' : ''} onClick={() => void choisir(null)}
          title="Mode déduit de la planification (voiture si un véhicule est affecté)">Automatique</button>
        {MODES.map((m) => (
          <button key={m.cle} type="button" role="radio" aria-checked={actuel === m.cle} disabled={odoo || envoi}
            className={actuel === m.cle || (odoo && r.mode === m.cle) ? 'actif' : ''} onClick={() => void choisir(m.cle)}>
            <IconeMode mode={m.cle} />{m.libelle}</button>))}
      </div>
      <p className="muet">{r.source ? <>Mode {SOURCES[r.source]}{odoo && ' : il se modifie dans Odoo'}.</>
        : 'Aucun mode : pas de véhicule affecté, choisir le mode de transport.'}</p>
      {erreur && <p className="erreur">{erreur}</p>}
      {dialogue}
    </div>
  );
}

/** Détail du calcul d'une mission. */
export function DetailRse({ r }: { r: RseMission }) {
  return (
    <div className="rs-detail">
      {r.detail.length > 0 && <ul>{r.detail.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      {r.alertes.map((a, i) => <p key={i} className="rs-alerte">{a}</p>)}
    </div>
  );
}

/** Consommation réelle d'un véhicule (fiche véhicule) : prime sur la valeur du constructeur. */
export function ConsommationVehicule({ id, profil, onChange }: { id: number; profil: ProfilVehicule; onChange: (p: ProfilVehicule) => void }) {
  const { ecrire, dialogue } = useEcriture();
  const [valeur, setValeur] = useState(profil.source_consommation === 'saisie' ? String(profil.consommation) : '');
  const [erreur, setErreur] = useState<string | null>(null);
  const enregistrer = async (conso: number | null) => {
    setErreur(null);
    try {
      const p = await ecrire(() => rse.saisirConsommation(id, conso));
      if (p) { onChange(p); setValeur(conso === null ? '' : String(conso)); }
    } catch (err) { setErreur(err instanceof Error ? err.message : String(err)); }
  };
  const nombreSaisi = Number(valeur.replace(',', '.'));
  const origine = { saisie: 'saisie (réelle)', constructeur: `constructeur ${nombre(profil.consommation_constructeur ?? 0, 1)} × écart d'usage réel`,
                    defaut: 'moyenne de son énergie' }[profil.source_consommation];
  return (
    <div className="rs-conso">
      <dl className="rs-conso-faits">
        <div><dt>Énergie</dt><dd>{profil.famille}, {profil.carburant.toLowerCase()}</dd></div>
        <div><dt>Consommation retenue</dt><dd>{nombre(profil.consommation, 2)} {profil.unite}<small>{origine}</small></dd></div>
        <div><dt>Émissions</dt><dd>{nombre(profil.kg_co2e_par_km, 3)} kg CO2e/km</dd></div>
      </dl>
      <form className="rs-conso-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void enregistrer(nombreSaisi); }}>
        <label className="champ">Consommation réelle ({profil.unite})
          <input inputMode="decimal" value={valeur} onChange={(e) => setValeur(e.target.value)} placeholder="ex. 7,4" /></label>
        <button type="submit" className="btn btn-petit" disabled={!valeur || !(nombreSaisi > 0)}>Enregistrer</button>
        {profil.source_consommation === 'saisie' && <button type="button" className="btn btn-petit"
          onClick={() => void enregistrer(null)}>Revenir au constructeur</button>}
      </form>
      {erreur && <p className="erreur">{erreur}</p>}
      {dialogue}
    </div>
  );
}
