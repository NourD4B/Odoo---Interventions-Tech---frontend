// Services sur site : tâches Odoo Field Service (lecture seule, créées et modifiées dans Odoo) + réglages de
// planification, seuls champs modifiables ici (compétences, équipe, véhicule, fenêtre, position du site).
import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import { Link } from 'react-router-dom';
import { Avertissements, Badge, EtatChargement, useDonnees } from '../composants';
import { useEcriture } from '../composants/Ecriture';
import { SynchroOdoo } from '../composants/Statistiques';
import {
  ErreurPlanif, erreursParChamp, LIBELLES_PRECISION, LIBELLES_STATUT_PLANIF,
  planif, type ReglagesPlanif, type Referentiels, type ServicePlanif, type StatutPlanif,
} from '../planification';
import { jourCourt } from '../statistiques';

// ---------- mise en forme ----------

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

function fenetre(s: Pick<ReglagesPlanif, 'fenetre_debut' | 'fenetre_fin'>): string | null {
  if (!s.fenetre_debut && !s.fenetre_fin) return null;
  if (s.fenetre_debut && s.fenetre_fin) return `fenêtre ${jourCourt(s.fenetre_debut)} → ${jourCourt(s.fenetre_fin)}`;
  return s.fenetre_debut ? `fenêtre à partir du ${jourCourt(s.fenetre_debut)}` : `fenêtre jusqu'au ${jourCourt(s.fenetre_fin)}`;
}

const nombreH = (h: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(h)} h`;

type Alerte = { texte: string; ou: 'ici' | 'odoo' };

/** Ce qui empêche ou fausse la planification : à corriger ici (position) ou dans Odoo (temps alloué). */
function alertes(s: ServicePlanif): Alerte[] {
  const a: Alerte[] = [];
  if (s.site_lat === null) a.push({ texte: 'Site sans position : les trajets ne peuvent pas être calculés', ou: 'ici' });
  else if (s.site_precision === 'commune') a.push({ texte: 'Position approximative (centre de la commune)', ou: 'ici' });
  if (!s.allocated_hours) a.push({ texte: 'Temps alloué à 0 h dans Odoo : durée inconnue pour le solveur', ou: 'odoo' });
  if (s.statut_planification !== 'publie' && s.date_deadline && new Date(s.date_deadline) < new Date())
    a.push({ texte: `Date limite dépassée (${quand(s.date_deadline)}) et pas encore publié`, ou: 'odoo' });
  return a;
}
const aRegler = (s: ServicePlanif) => s.statut_planification !== 'publie' && alertes(s).some((x) => x.ou === 'ici');

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
      !(k in champs) && !(k === 'position' && 'site_lat' in champs) && !(k === 'fenetre_fin' && 'fenetre_debut' in champs))));
  };
  const publie = s.statut_planification === 'publie';
  const type = refs.types_service.find((t) => t.id === r.type_service_id);
  const position: [number, number] | null = r.site_lat !== null && r.site_lng !== null ? [r.site_lat, r.site_lng] : null;
  const positionModifiee = position !== null && (r.site_lat !== s.site_lat || r.site_lng !== s.site_lng);

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
    if (r.fenetre_debut && r.fenetre_fin && r.fenetre_fin < r.fenetre_debut)
      locales.fenetre_fin = 'La fin de la fenêtre précède son début';
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
      <form className="dialogue dialogue-large" noValidate onSubmit={(e) => { e.preventDefault(); void enregistrer(); }}>
        <div className="entete">
          <div>
            <h2 id="titre-reglages">Réglages de planification</h2>
            <div className="sous-titre">{s.name}</div>
          </div>
          <div className="badges">
            {s.simule && <span className="badge b-simulation">simulé</span>}
            <Badge type={`planif-${s.statut_planification}`}>{LIBELLES_STATUT_PLANIF[s.statut_planification]}</Badge>
          </div>
        </div>

        <section className="bloc-odoo" aria-labelledby="titre-odoo">
          <div className="entete">
            <h3 id="titre-odoo" className="mini-titre">Dans Odoo · lecture seule</h3>
            {s.odoo_url
              ? <a className="btn btn-petit" href={s.odoo_url} target="_blank" rel="noreferrer">Modifier dans Odoo ↗</a>
              : <span className="muet">simulé : n'existe pas dans Odoo</span>}
          </div>
          <dl className="chiffres">
            <div><dt>Projet</dt><dd>{s.project_name ?? `n° ${s.project_id}`}</dd></div>
            <div><dt>Client</dt><dd>{s.partner_name ?? '—'}{s.partner_phone && <div className="muet">{s.partner_phone}</div>}</dd></div>
            <div><dt>Dates planifiées</dt><dd>{datesOdoo(s)}</dd></div>
            <div><dt>Temps alloué</dt><dd>{nombreH(s.allocated_hours)}</dd></div>
            <div><dt>Priorité</dt><dd>{s.priority === '1' ? 'urgente' : 'normale'}</dd></div>
            <div><dt>Adresse du site</dt><dd>{s.site_adresse ?? '—'}</dd></div>
          </dl>
        </section>

        {publie && <div className="avertissement">Service publié : ses réglages sont figés. Retirer la publication dans
          Planification pour les modifier.</div>}
        {erreur && (
          <div className="erreur" role="alert">{erreur.texte}
            {erreur.conflit && <> <button type="button" className="btn btn-petit" onClick={onConflit}>Recharger</button></>}
          </div>
        )}

        <fieldset disabled={publie || envoi} className="champs-reglages">
          <legend className="mini-titre">Réglages (absents d'Odoo)</legend>
          <div className="grille-champs">
            {refs.types_service.length > 0 && <label className="champ">Type de service
              <select value={r.type_service_id ?? ''} onChange={(e) => choisirType(e.target.value ? Number(e.target.value) : null)}>
                <option value="">— aucun —</option>
                {refs.types_service.map((t) => <option key={t.id} value={t.id}>{t.nom}</option>)}
              </select>
              {type && <span className="muet aide">Valeurs du type appliquées (modifiables). Durée habituelle
                {' '}{nombreH(type.duree_defaut_h)} ; la durée retenue reste le temps alloué dans Odoo.</span>}
            </label>}
            <label className="champ">Nombre de techniciens
              <input autoFocus type="number" min={1} max={10} step={1} value={r.nb_techniciens} aria-invalid={!!erreurs.nb_techniciens}
                     onChange={(e) => maj({ nb_techniciens: Number(e.target.value) })} />
              {erreurs.nb_techniciens && <span className="erreur-champ" role="alert">{erreurs.nb_techniciens}</span>}
            </label>
            <div className="champ">Véhicule requis
              <div className="segmente" role="radiogroup" aria-label="Véhicule requis">
                {(['indifferent', 'utilitaire'] as const).map((v) => (
                  <button key={v} type="button" role="radio" aria-checked={r.vehicule_requis === v}
                          className={r.vehicule_requis === v ? 'actif' : ''} onClick={() => maj({ vehicule_requis: v })}>
                    {v === 'indifferent' ? 'Indifférent' : 'Utilitaire'}</button>
                ))}
              </div>
            </div>
            <label className="champ">Fenêtre : au plus tôt
              <input type="date" value={r.fenetre_debut ?? ''} onChange={(e) => maj({ fenetre_debut: e.target.value || null })} />
            </label>
            <label className="champ">Fenêtre : au plus tard
              <input type="date" value={r.fenetre_fin ?? ''} aria-invalid={!!erreurs.fenetre_fin}
                     onChange={(e) => maj({ fenetre_fin: e.target.value || null })} />
              {erreurs.fenetre_fin && <span className="erreur-champ" role="alert">{erreurs.fenetre_fin}</span>}
            </label>
          </div>
          <p className="muet">Fenêtre : jours où le solveur peut placer le service quand Odoo n'a pas de date planifiée.</p>
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

        <section aria-labelledby="titre-position" className="bloc-position">
          <div className="entete">
            <h3 id="titre-position" className="mini-titre">Position du site</h3>
            {!publie && (corriger
              ? s.site_lat !== null && <button type="button" className="btn btn-petit" onClick={() => {
                  setCorriger(false); maj({ site_lat: s.site_lat, site_lng: s.site_lng }); }}>Annuler la correction</button>
              : <button type="button" className="btn btn-petit" onClick={() => setCorriger(true)}>Corriger la position</button>)}
          </div>
          <div className={!positionModifiee && (s.site_lat === null || s.site_precision === 'commune') ? 'precision-faible' : 'muet'}>
            {positionModifiee ? `Nouvelle position ${r.site_lat}, ${r.site_lng} : enregistrée comme saisie à la main`
              : s.site_lat === null ? "Adresse introuvable par le géocodage : placer le site sur la carte (ou corriger l'adresse dans Odoo)."
              : `Géocodée depuis l'adresse Odoo · ${LIBELLES_PRECISION[s.site_precision ?? ''] ?? s.site_precision ?? 'précision inconnue'}`}
          </div>
          {corriger && <div className="muet">Cliquer sur la carte à l'endroit de l'intervention.</div>}
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

        <div className="actions">
          <button type="button" className="btn" onClick={() => onFini(null)} disabled={envoi}>{publie ? 'Fermer' : 'Annuler'}</button>
          {!publie && <button type="submit" className="btn btn-primaire" disabled={envoi}>
            {envoi ? 'Enregistrement…' : 'Enregistrer les réglages'}</button>}
        </div>
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
  const f = fenetre(s);
  return (
    <article className="ligne-service" aria-labelledby={`service-${s.id}`}>
      <div className="ligne-service-titre">
        <div>
          <Link id={`service-${s.id}`} to={`/statistiques/services/${s.id}`}><strong>{s.name}</strong></Link>
          <div className="muet">{s.project_name ?? `Projet n° ${s.project_id}`} · {s.partner_name ?? 'client non renseigné'}
            {s.partner_phone && <> · {s.partner_phone}</>}</div>
        </div>
        <div className="badges">
          {s.simule && <span className="badge b-simulation" title="N'existe pas dans Odoo (copie locale)">simulé</span>}
          {s.priority === '1' && <Badge type="urgent">Urgent</Badge>}
          <Badge type={`planif-${s.statut_planification}`}>{LIBELLES_STATUT_PLANIF[s.statut_planification]}</Badge>
        </div>
      </div>

      <div className="service-colonnes">
        <div>
          <div className="mini-titre">Odoo</div>
          <div>{datesOdoo(s)} · {nombreH(s.allocated_hours)}</div>
          <div className="muet">{s.site_adresse ?? 'adresse non renseignée'}</div>
        </div>
        <div>
          <div className="mini-titre">Réglages</div>
          <div>{s.nb_techniciens} technicien{s.nb_techniciens > 1 ? 's' : ''}{s.vehicule_requis === 'utilitaire' ? ' · utilitaire' : ''}
            {type && <> · {type}</>}</div>
          <div className="muet">{refs?.competences_actives ? (competences.length ? competences.join(', ') : 'toutes compétences')
            : null}{refs?.competences_actives && f ? ' · ' : ''}{f ?? (refs?.competences_actives ? '' : 'sans fenêtre')}</div>
        </div>
        <div>
          <div className="mini-titre">Planification</div>
          {a ? (<>
            <div>{a.equipe.join(', ') || 'équipe vide'} · {a.plaque ?? 'sans véhicule'}</div>
            <div className="muet">{jourCourt(a.debut)}{a.fin !== a.debut ? ` → ${jourCourt(a.fin)}` : ''} ·{' '}
              {a.propose_par === 'dispatcher' ? 'choix du dispatcher' : 'proposé par le solveur'}
              {a.motif_derogation ? ` · dérogation : ${a.motif_derogation}` : ''}</div>
          </>) : <div className="muet">Pas encore planifié</div>}
        </div>
      </div>

      {liste.length > 0 && (
        <ul className="alertes-service">
          {liste.map((x) => <li key={x.texte}>{x.texte}{x.ou === 'odoo' ? ' (à corriger dans Odoo)' : ''}</li>)}
        </ul>
      )}

      <div className="actions">
        <button type="button" className={`btn btn-petit${aRegler(s) ? ' btn-primaire' : ''}`} onClick={onRegler}>
          {s.statut_planification === 'publie' ? 'Voir les réglages' : 'Régler la planification'}</button>
        <Link className="btn btn-petit" to={`/statistiques/services/${s.id}`}>Statistiques</Link>
        {s.odoo_url && <a className="btn btn-petit" href={s.odoo_url} target="_blank" rel="noreferrer">Ouvrir dans Odoo ↗</a>}
      </div>
    </article>
  );
}

type Filtre = 'tous' | StatutPlanif | 'a_regler';
const FILTRES: { cle: Filtre; libelle: string }[] = [
  { cle: 'tous', libelle: 'Tous' }, { cle: 'a_regler', libelle: 'À régler' },
  { cle: 'a_planifier', libelle: LIBELLES_STATUT_PLANIF.a_planifier }, { cle: 'propose', libelle: LIBELLES_STATUT_PLANIF.propose },
  { cle: 'verrouille', libelle: LIBELLES_STATUT_PLANIF.verrouille }, { cle: 'publie', libelle: LIBELLES_STATUT_PLANIF.publie },
];
const garde = (f: Filtre, s: ServicePlanif) => f === 'tous' || (f === 'a_regler' ? aRegler(s) : s.statut_planification === f);
const sansAccents = (x: string) => x.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const ORDRE: Record<StatutPlanif, number> = { a_planifier: 0, propose: 1, verrouille: 2, publie: 3 };
/** À traiter d'abord (à planifier, proposé, verrouillé), publiés ensuite ; puis par date. */
const cleTri = (s: ServicePlanif) => `${ORDRE[s.statut_planification]}`
  + (s.planned_date_begin?.slice(0, 10) ?? s.fenetre_debut ?? s.date_deadline?.slice(0, 10) ?? '9999');

export default function Services() {
  const liste = useDonnees(() => planif.services(), []);
  const refs = useDonnees(() => planif.referentiels(), []);
  const [filtre, setFiltre] = useState<Filtre>('tous');
  const [texte, setTexte] = useState('');
  const [simules, setSimules] = useState(true);
  const [edition, setEdition] = useState<ServicePlanif | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { ecrire, dialogue } = useEcriture();

  const base = useMemo(() => (liste.donnees ?? []).filter((s) => simules || !s.simule)
    .sort((a, b) => cleTri(a).localeCompare(cleTri(b)) || a.name.localeCompare(b.name, 'fr')), [liste.donnees, simules]);
  const services = useMemo(() => {
    const q = sansAccents(texte.trim());
    return base.filter((s) => garde(filtre, s)
      && (!q || sansAccents([s.name, s.partner_name, s.project_name, s.site_adresse].filter(Boolean).join(' ')).includes(q)));
  }, [base, filtre, texte]);
  const nbSimules = (liste.donnees ?? []).filter((s) => s.simule).length;

  return (
    <>
      <div className="entete">
        <div>
          <h1>Services sur site</h1>
          <div className="sous-titre">Créés et modifiés dans Odoo (Services sur site) · ici, seulement les réglages de planification</div>
        </div>
        <SynchroOdoo onFini={liste.recharger} />
      </div>

      <div className="info">Nouveau service : le créer dans Odoo (application Services sur site), puis « Synchroniser ».
        Il arrive ici « À planifier » ; régler ensuite ce qu'Odoo ne connaît pas : taille d'équipe, véhicule, fenêtre.</div>

      <div className="filtres" role="search">
        <label className="champ champ-recherche">Rechercher
          <input type="search" value={texte} placeholder="Service, client, projet, adresse" onChange={(e) => setTexte(e.target.value)} />
        </label>
        <div className="segmente" role="radiogroup" aria-label="Statut de planification">
          {FILTRES.map((f) => (
            <button key={f.cle} type="button" role="radio" aria-checked={filtre === f.cle}
                    className={filtre === f.cle ? 'actif' : ''} onClick={() => setFiltre(f.cle)}>
              {f.libelle} <span className="compteur">{base.filter((s) => garde(f.cle, s)).length}</span></button>
          ))}
        </div>
        {nbSimules > 0 && <label className="case"><input type="checkbox" checked={simules} onChange={(e) => setSimules(e.target.checked)} />
          Inclure les services simulés ({nbSimules})</label>}
      </div>

      {message && <div className="succes" role="status">{message}</div>}
      <Avertissements liste={refs.donnees?.avertissements} />
      <EtatChargement chargement={(liste.chargement && !liste.donnees) || (refs.chargement && !refs.donnees)}
                      erreur={liste.erreur ?? refs.erreur} />

      <section className="liste-services" aria-label="Services">
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
