// Plan de charge et congés : chaque technicien jour par jour, interventions croisées avec les congés et les
// fériés ; au-dessus, la capacité de l'équipe par jour. Cliquer une intervention allume toute son équipe ;
// cliquer un jour (Maj+clic pour une période) liste qui est disponible.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { aujourdhui } from '../api';
import { Avertissements, EtatChargement, initiales, useDonnees } from '../composants';
import {
  LIBELLES_STATUT_PLANIF, planif, type JourCharge, type ServiceCharge, type TechnicienCharge,
} from '../planification';

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const LETTRES = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const HORIZONS = [2, 4, 8] as const;
type Horizon = typeof HORIZONS[number];
const LARGEUR: Record<Horizon, [number, number]> = { 2: [64, 22], 4: [38, 14], 8: [24, 9] };   // jour ouvré, repos
type Tri = 'agence' | 'charge' | 'nom';
type Selection = { type: 'service'; id: number } | { type: 'jours'; de: number; a: number } | null;

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function lundiDe(jour: string): Date {
  const d = new Date(`${jour}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
const plusJours = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const jour = (s: string) => new Date(`${s}T12:00:00`);
const court = (s: string) => { const d = jour(s); return `${d.getDate()} ${MOIS[d.getMonth()]}`; };
const long = (s: string) => {
  const d = jour(s);
  return `${['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'][d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}`;
};
/** Numéro de semaine ISO. */
function semaineIso(s: string) {
  const d = jour(s); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const premier = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - premier.getTime()) / 86400000 - 3 + ((premier.getDay() + 6) % 7)) / 7);
}
const nombreH = (h: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(h)} h`;
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x)} %`);

// ---------- cellules ----------

function Cellule({ t, k, jours, services, selection, joursChoisis, auj, onService }: {
  t: TechnicienCharge; k: number; jours: JourCharge[]; services: Record<string, ServiceCharge>;
  selection: Selection; joursChoisis: Set<number>; auj: string; onService: (id: number) => void;
}) {
  const c = t.jours[k], j = jours[k];
  const sids = (i: number): number[] => t.jours[i]?.services ?? [];
  /** Jour de congé du technicien (un conflit un jour ouvré ne peut venir que d'un congé). */
  const enConge = (i: number) => t.jours[i]?.etat === 'conge' || (t.jours[i]?.etat === 'conflit' && !!jours[i]?.ouvre);
  /** Le service continue de l'autre côté d'un week-end ou d'un férié (affiché en pont fin). */
  const pont = (i: number, sid: number) => {
    let p = i - 1, n = i + 1;
    while (p >= 0 && !jours[p].ouvre) p -= 1;
    while (n < jours.length && !jours[n].ouvre) n += 1;
    return p >= 0 && n < jours.length && sids(p).includes(sid) && sids(n).includes(sid);
  };
  const lie = (i: number, sid: number) => sids(i).includes(sid) || (!!jours[i] && !jours[i].ouvre && pont(i, sid));
  const choisi = selection?.type === 'service' ? selection.id : null;
  const libreDansPeriode = joursChoisis.has(k) && c.etat === 'libre';
  const titre = (() => {
    const date = long(j.date);
    if (c.etat === 'weekend') return `${t.nom} — ${date} : week-end`;
    if (c.etat === 'ferie') return `${t.nom} — ${date} : férié (${j.ferie})`;
    if (c.etat === 'conge') return `${t.nom} — ${date} : congé`;
    if (c.etat === 'libre') return `${t.nom} — ${date} : disponible`;
    const noms = c.services.map((s) => `${services[String(s)]?.client ?? ''} – ${services[String(s)]?.nom ?? s}`).join(' ; ');
    const conflit = c.etat !== 'conflit' ? '' : j.ouvre ? 'CONFLIT : affecté pendant un congé — '
      : `CONFLIT : affecté un jour ${j.ferie ? `férié (${j.ferie})` : 'de week-end'} — `;
    return `${t.nom} — ${date} : ${conflit}${noms}`
      + (c.heures ? ` (≈ ${nombreH(c.heures)} sur site)` : '');
  })();

  // pont de week-end ou de férié pour un service à cheval
  const ponts = !j.ouvre && c.services.length === 0
    ? [...new Set([...sids(k - 1), ...sids(k + 1)])].filter((sid) => pont(k, sid)) : [];
  const conge = enConge(k);
  const debutConge = conge && !enConge(k - 1);
  return (
    <div className={`pc-cellule e-${c.etat}${j.ouvre ? '' : ' repos'}${joursChoisis.has(k) ? ' jour-choisi' : ''}`
      + `${libreDansPeriode ? ' libre-choisi' : ''}${j.date === auj ? ' aujourdhui' : ''}${jour(j.date).getDay() === 1 ? ' lundi' : ''}`}
      title={titre}>
      {conge && <span className={`pc-conge${debutConge ? ' debut' : ''}${enConge(k + 1) ? ' suite' : ''}`}>
        {debutConge && c.etat === 'conge' && <em>Congé</em>}</span>}
      {c.services.map((sid) => {
        const s = services[String(sid)];
        return (
          <button key={sid} type="button" className={`pc-bloc etat-${s?.etat ?? 'propose'}`
            + `${lie(k - 1, sid) ? ' lie-g' : ''}${lie(k + 1, sid) ? ' lie-d' : ''}`
            + `${choisi === sid ? ' choisi' : choisi !== null ? ' attenue' : ''}${c.etat === 'conflit' ? ' conflit' : ''}`
            + `${s?.priorite === 'urgente' ? ' urgent' : ''}`}
            aria-label={titre} onClick={() => onService(sid)}>
            {c.etat === 'conflit' && <span className="pc-alerte" aria-hidden="true">!</span>}
          </button>
        );
      })}
      {ponts.map((sid) => <span key={sid} className={`pc-pont etat-${services[String(sid)]?.etat ?? 'propose'}`
        + `${choisi === sid ? ' choisi' : choisi !== null ? ' attenue' : ''}`} />)}
    </div>
  );
}

// ---------- panneaux ----------

function PanneauService({ s, techs, onFermer }: { s: ServiceCharge; techs: Map<string, TechnicienCharge>; onFermer: () => void }) {
  return (
    <aside className="pc-panneau" aria-label="Intervention">
      <header>
        <div>
          <h2>{s.client ?? 'Client non renseigné'}</h2>
          <p>{s.nom}</p>
        </div>
        <button type="button" className="pc-fermer" aria-label="Fermer" onClick={onFermer}>×</button>
      </header>
      <div className="pc-etiquettes">
        <span className={`pc-etat etat-${s.etat}`}>{LIBELLES_STATUT_PLANIF[s.etat]}</span>
        {s.priorite === 'urgente' && <span className="pc-etat urgent">Urgent</span>}
        {s.simule && <span className="badge b-simulation">simulé</span>}
      </div>
      <dl className="pc-faits">
        <div><dt>Dates</dt><dd>{s.debut === s.fin ? long(s.debut) : `${long(s.debut)} → ${long(s.fin)}`}</dd></div>
        <div><dt>Temps alloué</dt><dd>{nombreH(s.allocated_hours)}</dd></div>
        <div><dt>Équipe</dt><dd>{s.matricules.map((m) => techs.get(m)?.nom ?? m).join(', ')}
          {s.matricules.length !== s.nb_techniciens && <span className="pc-ecart"> ({s.matricules.length}/{s.nb_techniciens} demandés)</span>}</dd></div>
        {s.site && <div><dt>Site</dt><dd>{s.site}</dd></div>}
      </dl>
      <div className="pc-liens">
        <Link to={`/planification?semaine=${iso(lundiDe(s.debut))}`}>Ouvrir dans Planification</Link>
        <Link to={`/statistiques/services/${s.id}`}>Statistiques</Link>
      </div>
    </aside>
  );
}

function PanneauJours({ de, a, jours, techs, services, agences, onFermer }: {
  de: number; a: number; jours: JourCharge[]; techs: TechnicienCharge[]; services: Record<string, ServiceCharge>;
  agences: Map<string, string>; onFermer: () => void;
}) {
  const indices = jours.map((_, i) => i).filter((i) => i >= de && i <= a && jours[i].ouvre);
  const titre = de === a ? `le ${long(jours[de].date)}` : `du ${long(jours[de].date)} au ${long(jours[a].date)}`;
  const libres = techs.filter((t) => indices.every((i) => t.jours[i].etat === 'libre'))
    .sort((x, y) => (x.charge_pct ?? 0) - (y.charge_pct ?? 0) || x.nom.localeCompare(y.nom, 'fr'));
  const enConge = techs.filter((t) => indices.some((i) => t.jours[i].etat === 'conge' || t.jours[i].etat === 'conflit'));
  const occupes = techs.filter((t) => !libres.includes(t) && !enConge.includes(t));
  const parAgence = new Map<string, TechnicienCharge[]>();
  for (const t of libres) parAgence.set(t.agence, [...(parAgence.get(t.agence) ?? []), t]);
  const nomsServices = (t: TechnicienCharge) => [...new Set(indices.flatMap((i) => t.jours[i].services))]
    .map((s) => services[String(s)]?.client ?? `n° ${s}`).join(', ');
  return (
    <aside className="pc-panneau" aria-label="Disponibilités">
      <header>
        <div>
          <h2>Disponibles {titre}</h2>
          <p>{indices.length} jour{indices.length > 1 ? 's' : ''} ouvré{indices.length > 1 ? 's' : ''}. Maj+clic sur un autre jour pour une période.</p>
        </div>
        <button type="button" className="pc-fermer" aria-label="Fermer" onClick={onFermer}>×</button>
      </header>
      {!indices.length && <p className="pc-vide">Aucun jour ouvré sur cette sélection.</p>}
      {indices.length > 0 && (<>
        <section>
          <h3><span className="pc-pastille libre" />Libres sur toute la période <b>{libres.length}</b></h3>
          {!libres.length && <p className="pc-vide">Personne n'est libre sur toute la période.</p>}
          {[...parAgence.entries()].map(([code, liste]) => (
            <div key={code} className="pc-groupe">
              <span>{agences.get(code) ?? code}</span>
              <ul>{liste.map((t) => (
                <li key={t.matricule}><span className="pc-avatar">{initiales(t.nom)}</span>{t.nom}
                  <em>{pct(t.charge_pct)} sur la vue</em></li>))}</ul>
            </div>
          ))}
        </section>
        {occupes.length > 0 && (
          <section>
            <h3><span className="pc-pastille occupe" />Pris au moins un jour <b>{occupes.length}</b></h3>
            <ul className="pc-simple">{occupes.map((t) => <li key={t.matricule}>{t.nom}<em>{nomsServices(t)}</em></li>)}</ul>
          </section>
        )}
        {enConge.length > 0 && (
          <section>
            <h3><span className="pc-pastille conge" />En congé <b>{enConge.length}</b></h3>
            <ul className="pc-simple">{enConge.map((t) => <li key={t.matricule}>{t.nom}</li>)}</ul>
          </section>
        )}
        <div className="pc-liens"><Link to={`/planification?semaine=${iso(lundiDe(jours[de].date))}`}>Planifier cette semaine</Link></div>
      </>)}
    </aside>
  );
}

// ---------- page ----------

export default function PlanDeCharge() {
  const [lundi, setLundi] = useState(() => lundiDe(aujourdhui()));
  const [horizon, setHorizon] = useState<Horizon>(4);
  const [agence, setAgence] = useState('');
  const [texte, setTexte] = useState('');
  const [tri, setTri] = useState<Tri>('agence');
  const [selection, setSelection] = useState<Selection>(null);
  const debut = iso(lundi), fin = iso(plusJours(lundi, horizon * 7 - 1));
  const plan = useDonnees(() => planif.charge(debut, fin), [debut, fin]);
  const auj = aujourdhui();
  useEffect(() => { setSelection(null); }, [debut, fin]);
  useEffect(() => {
    const touche = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelection(null); };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, []);

  const d = plan.donnees;
  const jours = useMemo(() => d?.jours ?? [], [d]);
  const agences = useMemo(() => new Map((d?.agences ?? []).map((a) => [a.code, a.nom])), [d]);
  const tous = useMemo(() => d?.techniciens ?? [], [d]);
  const parMatricule = useMemo(() => new Map(tous.map((t) => [t.matricule, t])), [tous]);
  const visibles = useMemo(() => {
    const q = texte.trim().toLowerCase();
    return tous.filter((t) => (!agence || t.agence === agence) && (!q || t.nom.toLowerCase().includes(q)))
      .sort((x, y) => (tri === 'charge' ? (y.charge_pct ?? -1) - (x.charge_pct ?? -1) || x.nom.localeCompare(y.nom, 'fr')
        : tri === 'nom' ? x.nom.localeCompare(y.nom, 'fr')
          : (agences.get(x.agence) ?? x.agence).localeCompare(agences.get(y.agence) ?? y.agence, 'fr')
            || x.nom.localeCompare(y.nom, 'fr')));
  }, [tous, agence, texte, tri, agences]);
  const groupes = useMemo(() => {
    if (tri !== 'agence') return [['', visibles] as [string, TechnicienCharge[]]];
    const g = new Map<string, TechnicienCharge[]>();
    for (const t of visibles) g.set(t.agence, [...(g.get(t.agence) ?? []), t]);
    return [...g.entries()];
  }, [visibles, tri]);
  const agencesPresentes = [...new Set(tous.map((t) => t.agence))]
    .sort((a, b) => (agences.get(a) ?? a).localeCompare(agences.get(b) ?? b, 'fr'));
  const totaux = useMemo(() => {
    const dispo = tous.reduce((n, t) => n + t.ouvres - t.conges, 0);
    const occ = tous.reduce((n, t) => n + t.occupes, 0);
    return { charge: dispo ? (100 * occ) / dispo : null, conges: tous.reduce((n, t) => n + t.conges, 0),
      conflits: tous.reduce((n, t) => n + t.conflits, 0), libres: tous.reduce((n, t) => n + t.libres, 0) };
  }, [tous]);
  const semaines = useMemo(() => {
    const s: { lundi: string; de: number; n: number }[] = [];
    jours.forEach((j, i) => {
      const l = iso(lundiDe(j.date));
      if (!s.length || s[s.length - 1].lundi !== l) s.push({ lundi: l, de: i, n: 1 }); else s[s.length - 1].n += 1;
    });
    return s;
  }, [jours]);

  const [w, wRepos] = LARGEUR[horizon];
  const colonnes: CSSProperties = { gridTemplateColumns: `var(--pc-col-nom) ${jours.map((j) => (j.ouvre ? `minmax(${w}px, 1fr)` : `${wRepos}px`)).join(' ')} var(--pc-col-total)` };
  const joursChoisis = new Set<number>(selection?.type === 'jours'
    ? jours.map((_, i) => i).filter((i) => i >= selection.de && i <= selection.a) : []);
  const equipe = new Map((d?.equipe ?? []).map((e) => [e.date, e]));
  const effectif = Math.max(1, tous.length);

  const choisirJour = (i: number, etendre: boolean) => {
    if (!jours[i]?.ouvre) return;
    setSelection((sel) => (etendre && sel?.type === 'jours'
      ? { type: 'jours', de: Math.min(sel.de, i), a: Math.max(sel.a, i) } : { type: 'jours', de: i, a: i }));
  };
  const serviceChoisi = selection?.type === 'service' ? d?.services[String(selection.id)] : undefined;
  const titrePeriode = jours.length
    ? `${court(jours[0].date)} – ${court(jours[jours.length - 1].date)} ${jour(jours[jours.length - 1].date).getFullYear()}` : '';

  return (
    <div className={`pc h${horizon}${selection ? ' avec-panneau' : ''}`}>
      <div className="pc-outils">
        <p className="pc-periode">Semaines {semaineIso(debut)} à {semaineIso(fin)} · {titrePeriode}</p>
        <nav className="pc-nav" aria-label="Période">
          <button type="button" className="btn" aria-label="Période précédente" onClick={() => setLundi(plusJours(lundi, -7 * horizon))}>‹</button>
          <button type="button" className="btn" onClick={() => setLundi(lundiDe(aujourdhui()))}>Aujourd'hui</button>
          <button type="button" className="btn" aria-label="Période suivante" onClick={() => setLundi(plusJours(lundi, 7 * horizon))}>›</button>
        </nav>
        <div className="segmente" role="radiogroup" aria-label="Horizon">
          {HORIZONS.map((h) => (
            <button key={h} type="button" role="radio" aria-checked={horizon === h} className={horizon === h ? 'actif' : ''}
              onClick={() => setHorizon(h)}>{h} semaines</button>
          ))}
        </div>
      </div>

      <div className="pc-filtres">
        <label className="champ pc-recherche">Technicien
          <input type="search" value={texte} placeholder="Nom" onChange={(e) => setTexte(e.target.value)} /></label>
        <label className="champ">Agence
          <select value={agence} onChange={(e) => setAgence(e.target.value)}>
            <option value="">Toutes</option>
            {agencesPresentes.map((a) => <option key={a} value={a}>{agences.get(a) ?? a}</option>)}
          </select></label>
        <label className="champ">Trier par
          <select value={tri} onChange={(e) => setTri(e.target.value as Tri)}>
            <option value="agence">Agence</option><option value="charge">Charge, la plus forte d'abord</option>
            <option value="nom">Nom</option>
          </select></label>
        <div className="pc-resume" aria-label="Résumé de la période">
          <span><b>{tous.length}</b> techniciens</span>
          <span>charge moyenne <b>{pct(totaux.charge)}</b></span>
          <span><b>{totaux.libres}</b> jours libres</span>
          <span><b>{totaux.conges}</b> jours de congé</span>
          {totaux.conflits > 0 && <span className="pc-resume-conflit"><b>{totaux.conflits}</b> conflit{totaux.conflits > 1 ? 's' : ''}</span>}
        </div>
      </div>

      <div className="pc-legende" aria-label="Légende">
        <span><i className="pc-l bloc-propose" />Proposé</span><span><i className="pc-l bloc-verrouille" />Verrouillé</span>
        <span><i className="pc-l bloc-publie" />Publié</span><span><i className="pc-l conge" />Congé</span>
        <span><i className="pc-l conflit" />Conflit</span><span><i className="pc-l urgent" />Urgent</span>
        <span><i className="pc-l ferie" />Férié</span>
        <span className="muet">Cliquez une intervention pour voir son équipe, un jour pour voir qui est libre.</span>
      </div>

      <EtatChargement chargement={plan.chargement && !d} erreur={plan.erreur} />
      <Avertissements liste={d?.avertissements} />

      {d && (
        <div className="pc-corps">
          <section className="pc-plan" aria-label="Plan de charge">
            <div className="pc-grille" style={{ minWidth: `calc(var(--pc-nom-min) + var(--pc-col-total) + ${jours.reduce((n, j) => n + (j.ouvre ? w : wRepos), 0)}px)` }}>
              <div className="pc-ligne pc-tete-semaines" style={colonnes}>
                <div className="pc-coin" />
                {semaines.map((s) => (
                  <div key={s.lundi} className="pc-semaine" style={{ gridColumn: `${s.de + 2} / span ${s.n}` }}>
                    <strong>S{semaineIso(s.lundi)}</strong>{horizon < 8 && <span> · {court(s.lundi)}</span>}
                  </div>
                ))}
                <div className="pc-coin-d" />
              </div>
              <div className="pc-ligne pc-tete-jours" style={colonnes}>
                <div className="pc-coin">Technicien</div>
                {jours.map((j, i) => (
                  <button key={j.date} type="button" disabled={!j.ouvre}
                    className={`pc-jour${j.ouvre ? '' : ' repos'}${jour(j.date).getDay() === 1 ? ' lundi' : ''}${j.date === auj ? ' aujourdhui' : ''}${joursChoisis.has(i) ? ' choisi' : ''}`
                      + `${j.ferie ? ' ferie' : ''}`}
                    title={j.ferie ? `${long(j.date)} : ${j.ferie}` : j.ouvre ? `${long(j.date)} : qui est libre ?` : long(j.date)}
                    onClick={(e) => choisirJour(i, e.shiftKey)}>
                    {(j.ouvre || horizon === 2) && <span>{LETTRES[jour(j.date).getDay()]}</span>}
                    {(j.ouvre || horizon === 2) && <strong>{jour(j.date).getDate()}</strong>}
                  </button>
                ))}
                <div className="pc-coin-d">Charge</div>
              </div>
              <div className="pc-ligne pc-capacite" style={colonnes}>
                <div className="pc-coin">Équipe <span>occupés, congés, libres</span></div>
                {jours.map((j, i) => {
                  const e = equipe.get(j.date);
                  if (!j.ouvre || !e) return <div key={j.date} className={`pc-cap repos${j.ferie ? ' ferie' : ''}${jour(j.date).getDay() === 1 ? ' lundi' : ''}`} title={j.ferie ?? undefined} />;
                  return (
                    <button key={j.date} type="button" className={`pc-cap${joursChoisis.has(i) ? ' choisi' : ''}${jour(j.date).getDay() === 1 ? ' lundi' : ''}`}
                      title={`${long(j.date)} : ${e.occupes} occupé(s), ${e.conges} en congé, ${e.libres} libre(s)`
                        + `${e.conflits ? `, ${e.conflits} conflit(s)` : ''}`}
                      onClick={(ev) => choisirJour(i, ev.shiftKey)}>
                      <span className="pc-pile">
                        <i className="libre" style={{ height: `${(100 * e.libres) / effectif}%` }} />
                        <i className="conge" style={{ height: `${(100 * e.conges) / effectif}%` }} />
                        <i className="occupe" style={{ height: `${(100 * e.occupes) / effectif}%` }} />
                      </span>
                      {horizon < 8 && <em>{e.libres}</em>}
                    </button>
                  );
                })}
                <div className="pc-coin-d"><strong>{pct(totaux.charge)}</strong></div>
              </div>

              {groupes.map(([code, techs]) => (
                <div key={code || 'tous'} className="pc-groupe-lignes">
                  {code && <div className="pc-agence"><span>{agences.get(code) ?? code}<b>{techs.length}</b></span></div>}
                  {techs.map((t) => (
                    <div key={t.matricule} className="pc-ligne pc-tech" style={colonnes}>
                      <div className="pc-nom">
                        <span className="pc-avatar">{initiales(t.nom)}</span>
                        <span><strong>{t.nom}</strong>
                          {(tri !== 'agence' || t.agence_a_confirmer) && <em>{tri !== 'agence' ? agences.get(t.agence) ?? t.agence : ''}
                            {t.agence_a_confirmer ? `${tri !== 'agence' ? ' · ' : ''}site à confirmer` : ''}</em>}</span>
                      </div>
                      {jours.map((j, k) => (
                        <Cellule key={j.date} t={t} k={k} jours={jours} services={d.services} selection={selection}
                          joursChoisis={joursChoisis} auj={auj} onService={(id) => setSelection({ type: 'service', id })} />
                      ))}
                      <div className="pc-total" title={`${t.occupes} jour(s) occupé(s) sur ${t.ouvres - t.conges} disponible(s) ; ${t.conges} jour(s) de congé`}>
                        <span className="pc-jauge"><i style={{ width: `${Math.min(100, t.charge_pct ?? 0)}%` }} /></span>
                        <strong>{pct(t.charge_pct)}</strong>
                        <em>{t.occupes}/{t.ouvres - t.conges} j{t.conges ? ` · ${t.conges} cg` : ''}</em>
                        {t.conflits > 0 && <span className="pc-conflit-badge" title="Affecté un jour de congé ou férié">{t.conflits} !</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              {!visibles.length && <div className="vide pc-sans">Aucun technicien ne correspond aux filtres.</div>}
            </div>
          </section>

          {serviceChoisi && <PanneauService s={serviceChoisi} techs={parMatricule} onFermer={() => setSelection(null)} />}
          {selection?.type === 'jours' && (
            <PanneauJours de={selection.de} a={selection.a} jours={jours} techs={visibles} services={d.services}
              agences={agences} onFermer={() => setSelection(null)} />
          )}
        </div>
      )}
    </div>
  );
}
