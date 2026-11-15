// Services sur site : tâches Odoo Field Service (lecture seule, créées et modifiées dans Odoo) + réglages de
// planification absents d'Odoo, seuls champs modifiables ici : nombre de techniciens et position du site (les autres
// réglages déjà enregistrés sont renvoyés tels quels).
import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import { Link } from 'react-router-dom';
import { Avertissements, Badge, EtatChargement, initiales, useDonnees } from '../composants';
import { useEcriture } from '../composants/Ecriture';
import { nomVehicule } from '../composants/Vehicule';
import { SynchroOdoo } from '../composants/Statistiques';
import {
  ErreurPlanif, erreursParChamp, LIBELLES_PRECISION, LIBELLES_STATUT_PLANIF,
  planif, type ReglagesPlanif, type Referentiels, type ServicePlanif, type StatutPlanif,
} from '../planification';
import { jourCourt } from '../statistiques';
import { villeDe } from './DossierProjet';

// ---------- mise en forme ----------

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** « 2026-11-16T07:30:00+01:00 » (heure de Paris) → « lun 16/11 07:30 » */
function quand(iso: string | null): string {
  return iso ? `${jourCourt(iso)} ${iso.slice(11, 16)}` : '—';
}

function datesOdoo(s: ServicePlanif): string {
  if (s.planned_date_begin) {
    const memeJour = s.date_deadline?.slice(0, 10) === s.planned_date_begin.slice(0, 10);
    return s.date_deadline
      ? `${quand(s.planned_date_begin)} → ${memeJour ? s.date_deadline.slice(11, 16) : quand(s.date_deadline)}`
      : `à partir du ${quand(s.planned_date_begin)}`;
  }
  return s.date_deadline ? `au plus tard ${quand(s.date_deadline)}` : 'pas de date dans Odoo';
}

const nombreH = (h: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(h)} h`;
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

type Alerte = { texte: string; ou: 'ici' | 'odoo' };

/** Ce qui empêche ou fausse la planification : à corriger ici (position) ou dans Odoo (temps alloué). */
function alertes(s: ServicePlanif): Alerte[] {
  if (s.archive_odoo) return [];                       // historique : rien à régler ici
  const a: Alerte[] = [];
  if (s.site_lat === null) a.push({ texte: 'Site sans position : les trajets ne peuvent pas être calculés', ou: 'ici' });
  else if (s.site_precision === 'commune') a.push({ texte: 'Position approximative (centre de la commune)', ou: 'ici' });
  if (!s.allocated_hours) a.push({ texte: 'Temps alloué à 0 h dans Odoo : durée inconnue pour le solveur', ou: 'odoo' });
  if (s.statut_planification !== 'publie' && s.date_deadline && new Date(s.date_deadline) < new Date())
    a.push({ texte: `Date limite dépassée (${quand(s.date_deadline)}) et pas encore publié`, ou: 'odoo' });
  return a;
}
const aRegler = (s: ServicePlanif) => !s.archive_odoo && s.statut_planification !== 'publie'
  && alertes(s).some((x) => x.ou === 'ici');

/** Jour à afficher en pavé : jour planifié, sinon début prévu dans Odoo, sinon date limite. */
function jourDe(s: ServicePlanif): { iso: string; legende: string } | null {
  if (s.affectation) return { iso: s.affectation.debut, legende: 'planifié' };
  if (s.planned_date_begin) return { iso: s.planned_date_begin.slice(0, 10), legende: 'prévu' };
  if (s.date_deadline) return { iso: s.date_deadline.slice(0, 10), legende: 'limite' };
  return null;
}

// ---------- réglages d'un service ----------

const CENTRE_FRANCE: [number, number] = [46.6, 2.4];

function ClicCarte({ actif, onClic }: { actif: boolean; onClic: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => { if (actif) onClic(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))); } });
  return null;
}

function reglagesDe(s: ServicePlanif): ReglagesPlanif {
  return { type_service_id: s.type_service_id, nb_techniciens: s.nb_techniciens, competences_requises: s.competences_requises,
    vehicule_requis: s.vehicule_requis, fenetre_debut: s.fenetre_debut, fenetre_fin: s.fenetre_fin,
    site_lat: s.site_lat, site_lng: s.site_lng };
}

function DialogueReglages({ service: s, refs, ecrire, onFini, onConflit }: {
  service: ServicePlanif; refs: Referentiels;
  ecrire: <T>(action: () => Promise<T>) => Promise<T | undefined>;
  onFini: (r: ServicePlanif | null) => void; onConflit: () => void;
}) {
  const [r, setR] = useState<ReglagesPlanif>(() => reglagesDe(s));
  const [corriger, setCorriger] = useState(s.site_lat === null);
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<{ texte: string; conflit: boolean } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const maj = (champs: Partial<ReglagesPlanif>) => {
    setR((x) => ({ ...x, ...champs }));
    setErreurs((e) => Object.fromEntries(Object.entries(e).filter(([k]) =>
      !(k in champs) && !(k === 'position' && 'site_lat' in champs))));
  };
  const publie = s.statut_planification === 'publie';
  const type = refs.types_service.find((t) => t.id === r.type_service_id);
  const position: [number, number] | null = r.site_lat !== null && r.site_lng !== null ? [r.site_lat, r.site_lng] : null;
  const positionModifiee = position !== null && (r.site_lat !== s.site_lat || r.site_lng !== s.site_lng);
  const nb = Number.isFinite(r.nb_techniciens) ? r.nb_techniciens : 1;

  useEffect(() => {
    const touche = (e: KeyboardEvent) => { if (e.key === 'Escape' && !envoi) onFini(null); };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, [envoi, onFini]);

  const choisirType = (id: number | null) => {
    const t = refs.types_service.find((x) => x.id === id);
    maj(t ? { type_service_id: id, nb_techniciens: t.nb_techniciens_defaut, competences_requises: t.competences,
      vehicule_requis: t.vehicule_requis } : { type_service_id: null });
  };
  const basculer = (code: string) => maj({ competences_requises: r.competences_requises.includes(code)
    ? r.competences_requises.filter((c) => c !== code) : [...r.competences_requises, code] });

  const enregistrer = async () => {
    setErreurs({}); setErreur(null);
    const locales: Record<string, string> = {};
    if (!Number.isInteger(r.nb_techniciens) || r.nb_techniciens < 1 || r.nb_techniciens > 10)
      locales.nb_techniciens = 'Entre 1 et 10 techniciens';
    if (corriger && position === null) locales.position = 'Cliquer sur la carte pour placer le site, ou annuler la correction';
    if (Object.keys(locales).length) { setErreurs(locales); return; }
    const corps = { ...r, version: s.version, fenetre_debut: r.fenetre_debut || null, fenetre_fin: r.fenetre_fin || null,
      ...(positionModifiee ? {} : { site_lat: null, site_lng: null }) };       // null = position inchangée
    setEnvoi(true);
    try {
      const fini = await ecrire(() => planif.modifierPlanification(s.id, corps));
      if (fini) onFini(fini);
    } catch (e) {
      const parChamp = erreursParChamp(e);
      setErreurs(parChamp);
      setErreur({ conflit: e instanceof ErreurPlanif && e.statut === 409, texte: Object.keys(parChamp).length
        ? 'Corriger les champs signalés.' : e instanceof Error ? e.message : String(e) });
    } finally { setEnvoi(false); }
  };

  return (
    <div className="voile" role="dialog" aria-modal="true" aria-labelledby="titre-reglages"
         onMouseDown={(e) => { if (e.target === e.currentTarget && !envoi) onFini(null); }}>
      <form className="sv-dialogue" noValidate onSubmit={(e) => { e.preventDefault(); void enregistrer(); }}>
        <header className="sv-d-tete">
          <div className="sv-d-titre">
            <p>Réglages de planification</p>
            <h2 id="titre-reglages">{s.name}</h2>
            <div className="badges">
              {s.simule && <span className="badge b-simulation">simulé</span>}
              {s.priority === '1' && <Badge type="urgent">Urgent</Badge>}
              <Badge type={`planif-${s.statut_planification}`}>{LIBELLES_STATUT_PLANIF[s.statut_planification]}</Badge>
            </div>
          </div>
          <button type="button" className="sv-fermer" aria-label="Fermer" onClick={() => onFini(null)} disabled={envoi}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg></button>
        </header>

        <div className="sv-d-corps">
          <dl className="sv-d-faits">
            <div><dt>Projet</dt><dd>{s.project_name ?? <span className="muet">n° {s.project_id}, pas encore synchronisé</span>}</dd></div>
            <div><dt>Client</dt><dd>{s.partner_name ?? '—'}{s.partner_phone && <small>{s.partner_phone}</small>}</dd></div>
            <div><dt>Priorité</dt><dd>{s.priority === '1' ? 'Urgente' : 'Normale'}</dd></div>
            <div><dt>Dates planifiées</dt><dd>{datesOdoo(s)}</dd></div>
            <div><dt>Temps alloué</dt><dd>{nombreH(s.allocated_hours)}</dd></div>
            <div><dt>Adresse du site</dt><dd>{s.site_adresse ?? '—'}</dd></div>
          </dl>

          {publie && <p className="sv-d-note">Service publié : réglages figés. Pour les modifier, ouvrir
            {' '}<Link to="/planification">Planification</Link>, cliquer sur le service puis « Retirer la publication ».</p>}
          {erreur && (
            <div className="erreur" role="alert">{erreur.texte}
              {erreur.conflit && <> <button type="button" className="btn btn-petit" onClick={onConflit}>Recharger</button></>}
            </div>
          )}

          <fieldset disabled={publie || envoi} className="sv-d-reglages">
            <legend className="visuellement-cache">Réglages de planification</legend>
            <div className="sv-d-equipe">
              <div>
                <span id="libelle-nb" className="sv-d-libelle">Nombre de techniciens</span>
                <small>Taille de l'équipe sur place, absente d'Odoo</small>
              </div>
              <div className="sv-pas" role="group" aria-labelledby="libelle-nb">
                <button type="button" aria-label="Un technicien de moins" disabled={nb <= 1}
                        onClick={() => maj({ nb_techniciens: Math.max(1, nb - 1) })}>−</button>
                <input autoFocus type="number" min={1} max={10} step={1} value={r.nb_techniciens} aria-labelledby="libelle-nb"
                       aria-invalid={!!erreurs.nb_techniciens} onChange={(e) => maj({ nb_techniciens: Number(e.target.value) })} />
                <button type="button" aria-label="Un technicien de plus" disabled={nb >= 10}
                        onClick={() => maj({ nb_techniciens: Math.min(10, nb + 1) })}>+</button>
              </div>
            </div>
            {erreurs.nb_techniciens && <span className="erreur-champ" role="alert">{erreurs.nb_techniciens}</span>}
            {refs.types_service.length > 0 && <label className="champ">Type de service
              <select value={r.type_service_id ?? ''} onChange={(e) => choisirType(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Aucun</option>
                {refs.types_service.map((t) => <option key={t.id} value={t.id}>{t.nom}</option>)}
              </select>
              {type && <span className="muet aide">Valeurs du type appliquées. Durée habituelle {nombreH(type.duree_defaut_h)} ;
                la durée retenue reste le temps alloué dans Odoo.</span>}
            </label>}
            {refs.competences_actives && (
              <div className="cases" role="group" aria-labelledby="titre-competences">
                <span id="titre-competences" className="libelle-groupe">Compétences requises (aucune = tout technicien terrain)</span>
                {refs.competences.map((c) => (
                  <label key={c.code} className="case"><input type="checkbox" checked={r.competences_requises.includes(c.code)}
                    onChange={() => basculer(c.code)} />{c.libelle}</label>
                ))}
              </div>
            )}
          </fieldset>

          <section aria-labelledby="titre-position" className="sv-d-position">
            <div className="sv-d-position-tete">
              <div>
                <h3 id="titre-position" className="sv-d-libelle">Position du site</h3>
                <small className={!positionModifiee && (s.site_lat === null || s.site_precision === 'commune') ? 'precision-faible' : undefined}>
                  {positionModifiee ? `Nouvelle position ${r.site_lat}, ${r.site_lng}, enregistrée comme saisie à la main`
                    : s.site_lat === null ? "Adresse introuvable par le géocodage : placer le site sur la carte, ou corriger l'adresse dans Odoo."
                    : `Géocodée depuis l'adresse Odoo, ${LIBELLES_PRECISION[s.site_precision ?? ''] ?? s.site_precision ?? 'précision inconnue'}`}
                </small>
              </div>
              {!publie && (corriger
                ? s.site_lat !== null && <button type="button" className="btn btn-petit" onClick={() => {
                    setCorriger(false); maj({ site_lat: s.site_lat, site_lng: s.site_lng }); }}>Annuler la correction</button>
                : <button type="button" className="btn btn-petit" onClick={() => setCorriger(true)}>Corriger la position</button>)}
            </div>
            {corriger && <p className="sv-d-aide">Cliquer sur la carte à l'endroit de l'intervention.</p>}
            {erreurs.position && <span className="erreur-champ" role="alert">{erreurs.position}</span>}
            <div className={`carte-site${corriger && !publie ? ' carte-site-active' : ''}`}>
              <MapContainer center={position ?? CENTRE_FRANCE} zoom={position ? 15 : 5} scrollWheelZoom={corriger}
                            style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19}
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
                <ClicCarte actif={corriger && !publie} onClic={(lat, lng) => maj({ site_lat: lat, site_lng: lng })} />
                {position && <CircleMarker center={position} radius={9}
                  pathOptions={{ color: '#fff', weight: 2, fillColor: positionModifiee ? '#eb6834' : '#1d4ed8', fillOpacity: 1 }} />}
              </MapContainer>
            </div>
          </section>
        </div>

        <footer className="sv-d-pied">
          {s.odoo_url && <a className="btn btn-petit" href={s.odoo_url} target="_blank" rel="noreferrer">Modifier dans Odoo ↗</a>}
          <div className="sv-d-boutons">
            <button type="button" className="btn" onClick={() => onFini(null)} disabled={envoi}>{publie ? 'Fermer' : 'Annuler'}</button>
            {!publie && <button type="submit" className="btn btn-primaire" disabled={envoi}>
              {envoi ? 'Enregistrement…' : 'Enregistrer'}</button>}
          </div>
        </footer>
      </form>
    </div>
  );
}

// ---------- liste ----------

function LigneService({ s, refs, onRegler }: { s: ServicePlanif; refs: Referentiels | null; onRegler: () => void }) {
  const a = s.affectation;
  const type = refs?.types_service.find((t) => t.id === s.type_service_id)?.nom;
  const competences = s.competences_requises.map((c) => refs?.competences.find((x) => x.code === c)?.libelle ?? c);
  const liste = alertes(s);
  const j = jourDe(s);
  const d = j ? new Date(`${j.iso.slice(0, 10)}T12:00:00`) : null;
  const ville = villeDe(s.site_adresse);
  const statut = s.archive_odoo ? 'archive' : s.statut_planification;
  return (
    <article className={`sv-ligne statut-${statut}`} aria-labelledby={`service-${s.id}`}>
      <div className={`sv-jour${j?.legende === 'limite' ? ' limite' : ''}`} aria-hidden={!d}>
        {d ? <><b>{d.getDate()}</b><span>{MOIS[d.getMonth()]}</span><small>{j!.legende}</small></> : <><b>–</b><small>sans date</small></>}
      </div>

      <div className="sv-contenu">
        <header className="sv-tete">
          <div className="sv-titre">
            <h2 id={`service-${s.id}`}><Link to={`/statistiques/services/${s.id}`}>{s.name}</Link></h2>
            <p>{s.project_name ?? `Projet n° ${s.project_id}, pas encore synchronisé`}
              {s.partner_name && <><span aria-hidden="true">, </span>{s.partner_name}</>}</p>
          </div>
          <div className="badges">
            {s.simule && <span className="badge b-simulation" title="N'existe pas dans Odoo (copie locale)">simulé</span>}
            {s.priority === '1' && <Badge type="urgent">Urgent</Badge>}
            {s.archive_odoo
              ? <span className="badge etat-archive" title="Archivée dans Odoo, gardée en historique (elle a une commande)">Archivée dans Odoo</span>
              : <Badge type={`planif-${s.statut_planification}`}>{LIBELLES_STATUT_PLANIF[s.statut_planification]}</Badge>}
          </div>
        </header>

        <dl className="sv-faits">
          <div><dt>Dans Odoo</dt>
            <dd>{datesOdoo(s)}<small>{nombreH(s.allocated_hours)} alloués{ville ? `, ${ville}` : s.site_adresse ? '' : ', adresse non renseignée'}</small></dd></div>
          <div><dt>Équipe demandée</dt>
            <dd>{pluriel(s.nb_techniciens, 'technicien')}
              {(type || refs?.competences_actives) && <small>{[type, refs?.competences_actives
                ? (competences.length ? competences.join(', ') : 'toutes compétences') : null].filter(Boolean).join(', ')}</small>}</dd></div>
          <div className="sv-planif"><dt>Planification</dt>
            <dd>{a ? (<>
              {a.equipe.length > 0 && <span className="sv-equipe">{a.equipe.map((n) => (
                <span key={n} className="dc-tech"><i aria-hidden="true">{initiales(n)}</i>{n}</span>))}</span>}
              <small>{a.vehicle_id != null ? nomVehicule({ ...a, id: a.vehicle_id }) : 'Sans véhicule'}, {jourCourt(a.debut)}
                {a.fin !== a.debut ? ` au ${jourCourt(a.fin)}` : ''}, {a.propose_par === 'dispatcher' ? 'choix du dispatcher' : 'proposé par le solveur'}
                {a.motif_derogation ? `, dérogation : ${a.motif_derogation}` : ''}</small>
            </>) : <span className="muet">{s.archive_odoo ? 'Historique : ne se planifie pas' : 'Pas encore planifié'}</span>}</dd></div>
        </dl>

        {liste.length > 0 && (
          <ul className="sv-alertes">
            {liste.map((x) => <li key={x.texte}>{x.texte}{x.ou === 'odoo' ? ' (à corriger dans Odoo)' : ''}</li>)}
          </ul>
        )}

        <div className="sv-actions">
          {!s.archive_odoo && <button type="button" className={`btn btn-petit${aRegler(s) ? ' btn-primaire' : ''}`} onClick={onRegler}>
            {s.statut_planification === 'publie' ? 'Voir les réglages' : 'Régler la planification'}</button>}
          {s.odoo_url && <a className="sv-lien" href={s.odoo_url} target="_blank" rel="noreferrer">Ouvrir dans Odoo ↗</a>}
        </div>
      </div>
    </article>
  );
}

type Filtre = 'tous' | StatutPlanif | 'a_regler' | 'archive';
const FILTRES: { cle: Filtre; libelle: string }[] = [
  { cle: 'tous', libelle: 'Tous' }, { cle: 'a_regler', libelle: 'À régler' },
  { cle: 'a_planifier', libelle: LIBELLES_STATUT_PLANIF.a_planifier }, { cle: 'propose', libelle: LIBELLES_STATUT_PLANIF.propose },
  { cle: 'verrouille', libelle: LIBELLES_STATUT_PLANIF.verrouille }, { cle: 'publie', libelle: LIBELLES_STATUT_PLANIF.publie },
  { cle: 'archive', libelle: 'Archivées' },
];
/** Archivées (historique) : seulement dans « Tous » et « Archivées », jamais comptées à planifier. */
const garde = (f: Filtre, s: ServicePlanif) => f === 'tous' || (f === 'archive' ? !!s.archive_odoo
  : !s.archive_odoo && (f === 'a_regler' ? aRegler(s) : s.statut_planification === f));
const sansAccents = (x: string) => x.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const ORDRE: Record<StatutPlanif, number> = { a_planifier: 0, propose: 1, verrouille: 2, publie: 3 };
/** À traiter d'abord (à planifier, proposé, verrouillé), publiés ensuite ; puis par date. */
const cleTri = (s: ServicePlanif) => `${s.archive_odoo ? 9 : ORDRE[s.statut_planification]}`
  + (s.planned_date_begin?.slice(0, 10) ?? s.fenetre_debut ?? s.date_deadline?.slice(0, 10) ?? '9999');

export default function Services() {
  const liste = useDonnees(() => planif.services(undefined, undefined, true), []);   // même liste que Projets
  const refs = useDonnees(() => planif.referentiels(), []);
  const [filtre, setFiltre] = useState<Filtre>('tous');
  const [texte, setTexte] = useState('');
  const [projet, setProjet] = useState<number | ''>('');
  const [simules, setSimules] = useState(true);
  const [edition, setEdition] = useState<ServicePlanif | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { ecrire, dialogue } = useEcriture();

  const base = useMemo(() => (liste.donnees ?? []).filter((s) => simules || !s.simule)
    .sort((a, b) => cleTri(a).localeCompare(cleTri(b)) || a.name.localeCompare(b.name, 'fr')), [liste.donnees, simules]);
  /** Projets présents dans la liste (project_id Odoo), avec leur nombre de services, par nom. */
  const projets = useMemo(() => {
    const m = new Map<number, { id: number; nom: string; n: number }>();
    for (const s of base) {
      const p = m.get(s.project_id) ?? { id: s.project_id, nom: s.project_name ?? `Projet n° ${s.project_id} (pas encore synchronisé)`, n: 0 };
      p.n += 1;
      m.set(s.project_id, p);
    }
    return [...m.values()].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  }, [base]);
  const projetActif = projet !== '' && projets.some((p) => p.id === projet) ? projet : '';
  const dansProjet = useMemo(() => base.filter((s) => projetActif === '' || s.project_id === projetActif), [base, projetActif]);
  const services = useMemo(() => {
    const q = sansAccents(texte.trim());
    return dansProjet.filter((s) => garde(filtre, s)
      && (!q || sansAccents([s.name, s.partner_name, s.project_name, s.site_adresse].filter(Boolean).join(' ')).includes(q)));
  }, [dansProjet, filtre, texte]);
  const nbSimules = (liste.donnees ?? []).filter((s) => s.simule).length;

  return (
    <>
      <header className="dc-entete">
        <div>
          <h1>Services sur site</h1>
          <p className="sous-titre">Créés et modifiés dans Odoo (application Services sur site), puis « Synchroniser ». Ici, seulement
            ce qu'Odoo ne connaît pas : le nombre de techniciens et, si besoin, la position du site.</p>
        </div>
        <SynchroOdoo onFini={liste.recharger} />
      </header>

      <div className="dc-outils" role="search">
        <label className="dc-recherche">
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.75" />
            <path d="m13 13 4.5 4.5" /></svg>
          <span className="visuellement-cache">Rechercher</span>
          <input type="search" value={texte} placeholder="Service, client, projet, adresse" onChange={(e) => setTexte(e.target.value)} />
        </label>
        <label className="sv-projet">
          <span className="visuellement-cache">Projet</span>
          <select value={projetActif} onChange={(e) => setProjet(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Tous les projets ({base.length})</option>
            {projets.map((p) => <option key={p.id} value={p.id}>{p.nom} ({p.n})</option>)}
          </select>
        </label>
        {nbSimules > 0 && <label className="dc-bascule">
          <input type="checkbox" checked={simules} onChange={(e) => setSimules(e.target.checked)} />
          <span className="pl-piste" aria-hidden="true" />Services simulés ({nbSimules})
        </label>}
      </div>

      <div className="sv-onglets" role="radiogroup" aria-label="Statut de planification">
        {FILTRES.filter((f) => f.cle !== 'archive' || base.some((s) => s.archive_odoo)).map((f) => {
          const n = dansProjet.filter((s) => garde(f.cle, s)).length;
          return (
            <button key={f.cle} type="button" role="radio" aria-checked={filtre === f.cle}
                    className={`${filtre === f.cle ? 'actif' : ''}${f.cle === 'a_regler' && n > 0 ? ' a-regler' : ''}`}
                    onClick={() => setFiltre(f.cle)}>
              {f.libelle}<span className="compteur">{n}</span></button>
          );
        })}
      </div>

      {message && <div className="succes" role="status">{message}</div>}
      <Avertissements liste={refs.donnees?.avertissements} />
      <EtatChargement chargement={(liste.chargement && !liste.donnees) || (refs.chargement && !refs.donnees)}
                      erreur={liste.erreur ?? refs.erreur} />

      <section className="sv-liste" aria-label="Services">
        {services.map((s) => (
          <LigneService key={s.id} s={s} refs={refs.donnees} onRegler={() => { setMessage(null); setEdition(s); }} />
        ))}
        {liste.donnees && !liste.donnees.length && (
          <div className="vide">Aucun service sur site actif dans la copie Odoo. Le créer dans Odoo (Services sur site),
            puis « Synchroniser ».</div>
        )}
        {liste.donnees && liste.donnees.length > 0 && !services.length && (
          <div className="vide">Aucun service ne correspond aux filtres.</div>
        )}
      </section>

      {edition && refs.donnees && (
        <DialogueReglages key={edition.id} service={edition} refs={refs.donnees} ecrire={ecrire}
          onConflit={() => { setEdition(null); liste.recharger(); }}
          onFini={(r) => {
            setEdition(null);
            if (r) { setMessage(`Réglages de « ${r.name} » enregistrés.`); liste.recharger(); }
          }} />
      )}
      {dialogue}
    </>
  );
}
