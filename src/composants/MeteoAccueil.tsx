// Météo de l'accueil : le temps au siège maintenant et sur 7 jours, et un avertissement pour chaque jour de mauvais
// temps (orages, verglas, neige, rafales, fortes pluies, gel, chaleur) sur un chantier prévu ou au siège. Open-Meteo :
// libre et gratuit, sans clé (code open source, données CC BY 4.0, d'où la mention en bas) ; seules des positions
// arrondies (≈ 1 km) sont envoyées, une requête pour tous les lieux. Hors ligne : la carte le dit, la page marche sans.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { lienFiche, type Chantier } from '../accueil';
import { alertes, meteo, previsions, temps, type Meteo, type PrevisionJour } from '../meteo';
import { jourCourt } from './AValider';
import { Icone } from './ReponseAssistant';

export interface Lieu { nom: string; lat: number; lng: number }
const cle = (lat: number, lng: number) => `${lat.toFixed(2)},${lng.toFixed(2)}`;
const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
function plus(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Avertissement { jour: string; motifs: string[]; ou: string; chantier: Chantier | null }

export default function MeteoAccueil({ siege, jour, chantiers }: { siege: Lieu | null; jour: string; chantiers: Chantier[] }) {
  const [etat, setEtat] = useState<{ siege: PrevisionJour[]; sites: Map<string, PrevisionJour[]> } | null>(null);
  const [maintenant, setMaintenant] = useState<Meteo | null>(null);
  const [erreur, setErreur] = useState(false);
  const fin = plus(jour, 6);
  const nomSiege = siege?.nom.replace(/\s*\(.*\)$/, '') ?? '';
  const sites = useMemo(() => {                  // positions distinctes des chantiers placés
    const m = new Map<string, { lat: number; lng: number }>();
    chantiers.forEach((c) => { if (c.lat !== null && c.lng !== null) m.set(cle(c.lat, c.lng), { lat: c.lat, lng: c.lng }); });
    return [...m.entries()];
  }, [chantiers]);

  useEffect(() => {
    if (!siege) return;
    let vivant = true;
    previsions([siege, ...sites.map(([, p]) => p)], jour, fin)
      .then((r) => { if (vivant) { setEtat({ siege: r[0] ?? [], sites: new Map(sites.map(([k], i) => [k, r[i + 1] ?? []])) }); setErreur(false); } })
      .catch(() => { if (vivant) setErreur(true); });
    meteo(siege.lat, siege.lng, jour, jour).then((m) => { if (vivant) setMaintenant(m); }).catch(() => undefined);
    return () => { vivant = false; };
  }, [siege, jour, fin, sites]);

  const avertissements = useMemo<Avertissement[]>(() => {
    if (!etat) return [];
    const liste: Avertissement[] = [];
    const vus = new Set<string>();
    for (const c of chantiers) {
      if (c.lat === null || c.lng === null) continue;
      for (const p of etat.sites.get(cle(c.lat, c.lng)) ?? []) {
        const motifs = p.jour >= c.debut && p.jour <= c.fin ? alertes(p) : [];
        if (motifs.length) { liste.push({ jour: p.jour, motifs, ou: c.ville ?? 'sur le site', chantier: c }); vus.add(p.jour); }
      }
    }
    for (const p of etat.siege) {               // au siège, les jours sans chantier déjà signalé
      const motifs = alertes(p);
      if (motifs.length && !vus.has(p.jour)) liste.push({ jour: p.jour, motifs, ou: nomSiege, chantier: null });
    }
    return liste.sort((a, b) => a.jour.localeCompare(b.jour));
  }, [etat, chantiers, nomSiege]);
  const joursEnAlerte = new Set(avertissements.map((a) => a.jour));

  const actuel = maintenant?.actuelle;
  const auj = etat?.siege.find((p) => p.jour === jour);
  return (
    <section className="ac-carte mt" aria-labelledby="mt-titre">
      <header><h2 id="mt-titre">Météo{nomSiege && <small>{nomSiege}</small>}</h2>
        {avertissements.length > 0 && <span className="mt-compte">{avertissements.length} alerte{avertissements.length > 1 ? 's' : ''}</span>}
      </header>
      {!siege ? <p className="ac-vide">Position du siège inconnue (Réglages).</p>
        : erreur ? <p className="ac-vide">Prévisions indisponibles (hors ligne ?). Le reste de la page fonctionne.</p>
        : !etat ? <p className="ac-vide">Prévisions…</p>
        : <>
          {(actuel || auj) && <div className="mt-maintenant">
            <span className="mt-ciel" aria-hidden="true">{temps(actuel?.code ?? auj!.code).icone}</span>
            <span className="mt-temp">{Math.round(actuel?.temperature ?? auj!.max)}°</span>
            <span className="mt-libelle">{temps(actuel?.code ?? auj!.code).libelle}
              {auj && <small>max {Math.round(auj.max)}° · min {Math.round(auj.min)}°</small>}</span>
          </div>}
          <ol className="mt-jours" aria-label="Prévisions sur 7 jours au siège">
            {etat.siege.map((p) => {
              const t = temps(p.code), alerte = joursEnAlerte.has(p.jour);
              return (
                <li key={p.jour} className={alerte ? 'alerte' : undefined}>
                  <span className="mt-j">{p.jour === jour ? 'Auj.' : JOURS[new Date(`${p.jour}T12:00:00`).getDay()]}</span>
                  <span className="mt-ic" role="img" aria-label={t.libelle}>{t.icone}</span>
                  <span className="mt-t">{Math.round(p.max)}°<small>{Math.round(p.min)}°</small></span>
                  {alerte && <span className="visuellement-cache">mauvais temps prévu</span>}
                </li>);
            })}
          </ol>
          {avertissements.length > 0
            ? <ul className="mt-alertes">{avertissements.slice(0, 5).map((a, i) => (
              <li key={`${a.jour}-${a.chantier?.service_id ?? 'siege'}-${i}`}>
                <span className="mt-alerte-ic"><Icone nom="alerte" taille={15} /></span>
                <p><strong>{jourCourt(a.jour)} · {a.motifs.join(', ')}</strong>
                  <small>{a.chantier ? <>à {a.ou} : <Link to={lienFiche(a.chantier.service_id, a.chantier.semaine)}>{a.chantier.nom}</Link></>
                    : <>{a.ou ? `à ${a.ou} (siège)` : 'au siège'}</>}</small></p>
              </li>))}</ul>
            : <p className="ac-vide ok">Pas de mauvais temps prévu sur les chantiers des 7 prochains jours.</p>}
        </>}
      <p className="ac-pied">Prévisions <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a></p>
    </section>
  );
}
