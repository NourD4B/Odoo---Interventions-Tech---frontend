import { useMemo, useState, type DragEvent } from 'react';
import { aujourdhui } from '../api';
import { Avertissements, Badge, EtatChargement, initiales, useDonnees } from '../composants';
import DialogueDerogation from '../composants/DialogueDerogation';
import { useEcriture } from '../composants/Ecriture';
import MenuVehicule from '../composants/MenuVehicule';
import {
  ErreurPlanif, LIBELLES_STATUT_PLANIF, planif, type AffectationProposee, type CorpsAffectation, type Proposition,
  type ServicePlanif, type TechnicienPlanif, type Violation,
} from '../planification';

const JOURS = ['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.'];
const CONFLIT = "Modifié par quelqu'un d'autre entre-temps : rechargez la page avant de modifier.";

// ---------- dates (jours ouvrés lundi–vendredi) ----------

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function lundiDe(jour: string): Date {
  const d = new Date(`${jour}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
function decaler(d: Date, jours: number): Date { const r = new Date(d); r.setDate(r.getDate() + jours); return r; }
/** `n` jours ouvrés après `jour` (0 = le jour même). */
function plusOuvres(jour: string, n: number): string {
  const d = new Date(`${jour}T12:00:00`);
  let reste = n;
  while (reste > 0) { d.setDate(d.getDate() + 1); if (d.getDay() % 6 !== 0) reste -= 1; }
  return iso(d);
}
/** Jours ouvrés de `debut` (exclu) à `fin` (inclus) : 0 pour un service d'un jour. */
function ouvresApres(debut: string, fin: string): number {
  let n = 0;
  const d = new Date(`${debut}T12:00:00`);
  while (iso(d) < fin) { d.setDate(d.getDate() + 1); if (d.getDay() % 6 !== 0) n += 1; }
  return n;
}
const jj = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
/** Durée (jours) d'un service non encore affecté : heures par technicien / 8 h. */
const dureeService = (s: ServicePlanif) => Math.max(1, Math.ceil(s.allocated_hours / Math.max(1, s.nb_techniciens) / 8));

// ---------- carte d'un service ----------

type Glisse = { serviceId: number; depuis: string | null };

function CarteService({ s, jour, depuis, propose, onOuvrir, onVerrou }: {
  s: ServicePlanif; jour: string | null; depuis: string | null; propose: AffectationProposee | undefined;
  onOuvrir: () => void; onVerrou?: () => void;
}) {
  const a = s.affectation;
  const suite = !!(a && jour && jour > a.debut);
  const etat = a?.etat ?? 'a_planifier';
  return (
    <div className={`carte-service etat-${etat}${s.priority === '1' ? ' urgente' : ''}`} draggable={etat !== 'publie'}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/json', JSON.stringify({ serviceId: s.id, depuis } satisfies Glisse));
        e.dataTransfer.effectAllowed = 'move';
      }}
      title={[s.name, propose?.raison_techniciens, propose?.raison_vehicule, a?.motif_derogation ? `Dérogation : ${a.motif_derogation}` : '']
        .filter(Boolean).join('\n')}>
      <button type="button" className="carte-service-corps" onClick={onOuvrir}>
        <strong>{suite ? '↳ ' : ''}{s.partner_name ?? s.name}</strong>
        {!suite && <span>{s.name.split(' – ')[0]}</span>}
        {!suite && a && (
          <span className="muet">
            {a.plaque ?? 'sans véhicule'}{propose ? ` · ${Math.round(propose.km_aller_retour)} km A/R` : ''}
            {propose?.cout_estime != null ? ` · ≈ ${Math.round(propose.cout_estime)} €` : ''}
            {a.motif_derogation ? ' · dérogation' : ''}
          </span>
        )}
      </button>
      {onVerrou && a && etat !== 'publie' && !suite && (
        <button type="button" className="cadenas" onClick={onVerrou}
          aria-label={etat === 'verrouille' ? 'Déverrouiller' : 'Verrouiller'} aria-pressed={etat === 'verrouille'}
          title={etat === 'verrouille' ? 'Verrouillé : le solveur ne le change plus' : 'Verrouiller'}>
          {etat === 'verrouille' ? '🔒' : '🔓'}
        </button>
      )}
    </div>
  );
}

// ---------- panneau d'affectation (aussi utilisable au doigt, sans glisser) ----------

function PanneauAffectation({ s, techniciens, propose, enregistrer, onFermer }: {
  s: ServicePlanif; techniciens: TechnicienPlanif[]; propose: AffectationProposee | undefined;
  enregistrer: (s: ServicePlanif, corps: Omit<CorpsAffectation, 'version' | 'motif'>) => Promise<boolean>;
  onFermer: () => void;
}) {
  const a = s.affectation;
  const [equipe, setEquipe] = useState<string[]>(a?.matricules ?? []);
  const [debut, setDebut] = useState(a?.debut ?? s.fenetre_debut ?? aujourdhui());
  const [jours, setJours] = useState(a ? ouvresApres(a.debut, a.fin) + 1 : dureeService(s));
  const [vehicule, setVehicule] = useState<number | null>(a?.vehicle_id ?? null);
  const [verrou, setVerrou] = useState(a?.etat === 'verrouille');
  const fin = plusOuvres(debut, Math.max(1, jours) - 1);
  const publie = s.statut_planification === 'publie';
  const basculer = (m: string) => setEquipe((x) => (x.includes(m) ? x.filter((y) => y !== m) : [...x, m]));

  return (
    <aside className="carte panneau" aria-label={`Affectation de ${s.name}`}>
      <div className="entete">
        <div>
          <h2>{s.name}</h2>
          <div className="muet">{s.site_adresse ?? 'site non renseigné'} · {s.nb_techniciens} tech. · {s.allocated_hours} h
            {s.competences_requises.length ? ` · ${s.competences_requises.join(', ')}` : ''}
            {s.vehicule_requis === 'utilitaire' ? ' · utilitaire requis' : ''}</div>
        </div>
        <button type="button" className="btn" onClick={onFermer}>Fermer</button>
      </div>
      {propose && <p className="raisons">{propose.raison_techniciens}<br />{propose.raison_vehicule}
        {propose.cout_estime != null && <><br />Coût estimé : ≈ {Math.round(propose.cout_estime)} € (hors hôtel et repas)</>}</p>}
      {a?.motif_derogation && <p className="avertissement">Dérogation : {a.motif_derogation}</p>}
      {publie ? <p className="muet">Publié : l'affectation ne se modifie plus ici.</p> : (<>
        <div className="grille-champs">
          <label className="champ">Premier jour<input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} /></label>
          <label className="champ">Jours ouvrés<input type="number" min={1} max={20} value={jours}
            onChange={(e) => setJours(Number(e.target.value))} /></label>
          <div className="champ">Dernier jour<span className="valeur">{jj(fin)}</span></div>
        </div>
        <fieldset className="cases">
          <legend className="libelle-groupe">Équipe ({equipe.length}/{s.nb_techniciens})</legend>
          {techniciens.map((t) => (
            <label key={t.matricule} className="case">
              <input type="checkbox" checked={equipe.includes(t.matricule)} onChange={() => basculer(t.matricule)} />
              {t.nom}<span className="muet"> · {t.competences.join(', ')}</span>
            </label>
          ))}
        </fieldset>
        <div className="libelle-groupe">Véhicule</div>
        <MenuVehicule serviceId={s.id} matricules={equipe} debut={debut} fin={fin} actuel={vehicule}
          onChoisir={(v) => setVehicule(v?.vehicle_id ?? null)} />
        <label className="case"><input type="checkbox" checked={verrou} onChange={(e) => setVerrou(e.target.checked)} />
          Verrouiller (le solveur ne le changera plus)</label>
        <div className="actions">
          <button type="button" className="btn btn-primaire" disabled={!equipe.length}
            onClick={async () => { if (await enregistrer(s, { matricules: equipe, vehicle_id: vehicule, debut, fin, verrouiller: verrou })) onFermer(); }}>
            Enregistrer l'affectation</button>
        </div>
      </>)}
    </aside>
  );
}

// ---------- page ----------

export default function Planification() {
  const [lundi, setLundi] = useState(() => lundiDe(aujourdhui()));
  const jours = JOURS.map((_, k) => iso(decaler(lundi, k)));
  const [debut, fin] = [jours[0], jours[4]];
  const auj = aujourdhui();

  const services = useDonnees(() => planif.services(debut, fin), [debut]);
  const ressources = useDonnees(() => planif.ressources(debut, fin), [debut]);
  const [proposition, setProposition] = useState<Proposition | null>(null);
  const [ouvert, setOuvert] = useState<number | null>(null);
  const [message, setMessage] = useState<{ type: 'erreur' | 'ok'; texte: string } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [derogation, setDerogation] = useState<{ violations: Violation[]; resoudre: (motif: string | null) => void } | null>(null);
  const [confirmerPublication, setConfirmerPublication] = useState(false);
  const [survol, setSurvol] = useState<string | null>(null);
  const { ecrire, dialogue } = useEcriture();

  const liste = useMemo(() => services.donnees ?? [], [services.donnees]);
  const techniciens = ressources.donnees?.techniciens ?? [];
  const agences = ressources.donnees?.agences ?? [];
  const parId = useMemo(() => new Map(liste.map((s) => [s.id, s])), [liste]);
  const proposes = useMemo(() => new Map((proposition?.affectations ?? []).map((a) => [a.service_id, a])), [proposition]);
  const causes = useMemo(() => new Map((proposition?.non_planifies ?? []).map((n) => [n.service_id, n.cause])), [proposition]);
  const aPlanifier = liste.filter((s) => !s.affectation);
  const aPublier = liste.filter((s) => s.affectation && s.statut_planification !== 'publie');
  const groupes = useMemo(() => {
    const par = new Map<string, TechnicienPlanif[]>();
    for (const t of [...techniciens].sort((x, y) => x.nom.localeCompare(y.nom))) par.set(t.agence, [...(par.get(t.agence) ?? []), t]);
    return [...par.entries()];
  }, [techniciens]);

  const recharger = () => { services.recharger(); };
  const erreurTexte = (e: unknown) =>
    (e instanceof ErreurPlanif && e.statut === 409 ? CONFLIT : e instanceof Error ? e.message : String(e));

  /** Enregistre un choix du dispatcher ; règles enfreintes -> dialogue de dérogation (motif) puis renvoi. */
  const enregistrer = async (s: ServicePlanif, corps: Omit<CorpsAffectation, 'version' | 'motif'>): Promise<boolean> => {
    setMessage(null);
    const envoyer = (motif: string | null) => planif.affecter(s.id, { ...corps, motif, version: s.version });
    try {
      await ecrire(() => envoyer(null));
    } catch (e) {
      const violations = e instanceof ErreurPlanif && e.statut === 422
        ? (e.detail as { violations?: Violation[] } | null)?.violations : undefined;
      if (!violations) {
        setMessage({ type: 'erreur', texte: erreurTexte(e) });
        if (e instanceof ErreurPlanif && e.statut === 409) recharger();
        return false;
      }
      const motif = await new Promise<string | null>((resoudre) => setDerogation({ violations, resoudre }));
      setDerogation(null);
      if (!motif) return false;
      try { await ecrire(() => envoyer(motif)); } catch (e2) { setMessage({ type: 'erreur', texte: erreurTexte(e2) }); return false; }
    }
    recharger();
    return true;
  };

  const deposer = async (e: DragEvent, matricule: string, jour: string) => {
    e.preventDefault(); setSurvol(null);
    let glisse: Glisse;
    try { glisse = JSON.parse(e.dataTransfer.getData('application/json')) as Glisse; } catch { return; }
    const s = parId.get(glisse.serviceId);
    if (!s || s.statut_planification === 'publie') return;
    const a = s.affectation;
    const equipe = a ? [...new Set(a.matricules.map((m) => (m === glisse.depuis ? matricule : m)))] : [matricule];
    const finAff = plusOuvres(jour, a ? ouvresApres(a.debut, a.fin) : dureeService(s) - 1);
    // Équipe ou jours changés : garder le véhicule s'il reste conforme, sinon prendre le premier conforme
    let vehicule = a?.vehicle_id ?? null;
    const inchange = !!a && a.debut === jour && [...a.matricules].sort().join() === [...equipe].sort().join();
    if (!inchange) {
      try {
        const choix = await planif.vehicules(s.id, { matricules: equipe.join(','), debut: jour, fin: finAff });
        const actuel = choix.find((v) => v.vehicle_id === vehicule && v.conforme);
        vehicule = actuel?.vehicle_id ?? choix.find((v) => v.conforme)?.vehicle_id ?? vehicule;
      } catch { /* liste indisponible : véhicule actuel gardé, la règle le signalera si besoin */ }
    }
    await enregistrer(s, { matricules: equipe, vehicle_id: vehicule, debut: jour, fin: finAff, verrouiller: a?.etat === 'verrouille' });
  };

  const basculerVerrou = (s: ServicePlanif) => {
    const a = s.affectation!;
    void enregistrer(s, { matricules: a.matricules, vehicle_id: a.vehicle_id, debut: a.debut, fin: a.fin,
      verrouiller: a.etat !== 'verrouille' });
  };

  const proposer = async () => {
    setMessage(null); setOccupe(true);
    try {
      const p = await ecrire(() => planif.proposer(debut, fin));
      if (p) {
        setProposition(p);
        setMessage({ type: 'ok', texte: `${p.affectations.length} service(s) proposé(s), ${p.non_planifies.length} non planifié(s) — calcul ${p.statut}.` });
        recharger();
      }
    } catch (e) { setMessage({ type: 'erreur', texte: erreurTexte(e) }); } finally { setOccupe(false); }
  };

  const publier = async () => {
    setConfirmerPublication(false); setMessage(null); setOccupe(true);
    try {
      const r = await ecrire(() => planif.publier(debut, fin));
      if (r) { setMessage({ type: 'ok', texte: `${r.services} service(s) publié(s).` }); recharger(); }
    } catch (e) { setMessage({ type: 'erreur', texte: erreurTexte(e) }); } finally { setOccupe(false); }
  };

  const servicesDe = (matricule: string, jour: string) =>
    liste.filter((s) => s.affectation?.matricules.includes(matricule) && s.affectation.debut <= jour && s.affectation.fin >= jour);
  const absent = (t: TechnicienPlanif, jour: string) => t.absences.some((a) => a.du <= jour && a.au >= jour);
  const selection = ouvert !== null ? parId.get(ouvert) : undefined;

  return (
    <>
      <div className="entete">
        <div>
          <h1>Planification</h1>
          <div className="sous-titre">Semaine du {jj(debut)} au {jj(fin)} · le solveur propose, vous décidez (glisser une carte, ou cliquer dessus)</div>
        </div>
        <div className="actions">
          <button type="button" className="btn" aria-label="Semaine précédente" onClick={() => setLundi(decaler(lundi, -7))}>‹</button>
          <button type="button" className="btn" onClick={() => setLundi(lundiDe(aujourdhui()))}>Cette semaine</button>
          <button type="button" className="btn" aria-label="Semaine suivante" onClick={() => setLundi(decaler(lundi, 7))}>›</button>
          <button type="button" className="btn btn-primaire" disabled={occupe} onClick={() => void proposer()}>
            {occupe ? 'Calcul…' : 'Proposer'}</button>
          <button type="button" className="btn" disabled={occupe || !aPublier.length} onClick={() => setConfirmerPublication(true)}>
            Publier la semaine ({aPublier.length})</button>
        </div>
      </div>

      {message && <div className={message.type === 'erreur' ? 'erreur' : 'succes'} role={message.type === 'erreur' ? 'alert' : 'status'}>{message.texte}</div>}
      <EtatChargement chargement={services.chargement || ressources.chargement} erreur={services.erreur ?? ressources.erreur} />
      <Avertissements liste={[...(ressources.donnees?.avertissements ?? []), ...(proposition?.avertissements ?? [])]} />
      <div className="legende" aria-label="Légende">
        <span className="carte-service etat-propose">Proposé (pointillé)</span>
        <span className="carte-service etat-verrouille">Verrouillé</span>
        <span className="carte-service etat-publie">Publié</span>
        <span className="cellule-absente legende-absent">Absent</span>
      </div>

      {selection && (
        <PanneauAffectation key={`${selection.id}-${selection.version}`} s={selection} techniciens={techniciens}
          propose={proposes.get(selection.id)} enregistrer={enregistrer} onFermer={() => setOuvert(null)} />
      )}

      <div className="rangee">
        <section className="carte large defilement" aria-label="Tableau de planification" style={{ padding: 0 }}>
          <div className="tableau">
            <div className="tete nom">Technicien</div>
            {jours.map((j, k) => <div key={j} className={`tete${j === auj ? ' jour-courant' : ''}`}>{JOURS[k]} {j.slice(8)}</div>)}
            {groupes.map(([code, techs]) => (
              <div key={code} style={{ display: 'contents' }}>
                <div className="tete-agence">{agences.find((a) => a.code === code)?.nom ?? code}</div>
                {techs.map((t) => (
                  <div key={t.matricule} style={{ display: 'contents' }}>
                    <div className="nom">
                      <span className="pastille" style={{ background: '#5b6170' }}>{initiales(t.nom)}</span>
                      <span><strong>{t.nom}</strong>
                        <span className="muet">{t.competences.join(', ')}</span>
                        {t.agence_a_confirmer && <Badge type="a_confirmer">agence à confirmer</Badge>}</span>
                    </div>
                    {jours.map((j) => {
                      const cle = `${t.matricule}|${j}`;
                      const estAbsent = absent(t, j);
                      return (
                        <div key={j} data-matricule={t.matricule} data-jour={j}
                          className={`cellule${j === auj ? ' jour-courant' : ''}${estAbsent ? ' cellule-absente' : ''}${survol === cle ? ' survol' : ''}`}
                          onDragOver={(e) => { e.preventDefault(); if (survol !== cle) setSurvol(cle); }}
                          onDragLeave={() => setSurvol(null)} onDrop={(e) => void deposer(e, t.matricule, j)}>
                          {estAbsent && <span className="muet">Absent</span>}
                          {servicesDe(t.matricule, j).map((s) => (
                            <CarteService key={s.id} s={s} jour={j} depuis={t.matricule} propose={proposes.get(s.id)}
                              onOuvrir={() => setOuvert(s.id)} onVerrou={() => basculerVerrou(s)} />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        <aside className="carte etroit colonne-a-planifier" aria-label="À planifier">
          <h2>À planifier ({aPlanifier.length})</h2>
          <p className="muet">Glissez une carte sur un technicien et un jour, ou cliquez dessus.</p>
          {aPlanifier.map((s) => (
            <div key={s.id} className="a-planifier">
              <CarteService s={s} jour={null} depuis={null} propose={undefined} onOuvrir={() => setOuvert(s.id)} />
              <div className="muet">
                {s.planned_date_begin ? `le ${jj(s.planned_date_begin)} (imposé)` : s.fenetre_debut ? `${jj(s.fenetre_debut)} → ${jj(s.fenetre_fin ?? s.fenetre_debut)}` : ''}
                {' · '}{s.nb_techniciens} tech. · {s.allocated_hours} h · {LIBELLES_STATUT_PLANIF[s.statut_planification]}
              </div>
              {causes.get(s.id) && <div className="cause">{causes.get(s.id)}</div>}
            </div>
          ))}
          {!aPlanifier.length && <div className="vide">Tout est planifié.</div>}
        </aside>
      </div>

      {confirmerPublication && (
        <div className="voile" role="dialog" aria-modal="true" aria-labelledby="titre-publier">
          <div className="dialogue">
            <h2 id="titre-publier">Publier la semaine ?</h2>
            <p>{aPublier.length} service(s) passeront à l'étape « Planned » (90). Ils ne seront plus recalculés ni supprimables.
              Odoo n'est pas modifié.</p>
            <div className="actions">
              <button type="button" className="btn" onClick={() => setConfirmerPublication(false)}>Annuler</button>
              <button type="button" className="btn btn-primaire" onClick={() => void publier()}>Publier</button>
            </div>
          </div>
        </div>
      )}
      {derogation && (
        <DialogueDerogation violations={derogation.violations} onConfirmer={(m) => derogation.resoudre(m)}
          onAnnuler={() => derogation.resoudre(null)} />
      )}
      {dialogue}
    </>
  );
}
