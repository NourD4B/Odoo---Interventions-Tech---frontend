import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { aujourdhui } from '../api';
import { Avertissements, Badge, EtatChargement, useDonnees } from '../composants';
import { useEcriture } from '../composants/Ecriture';
import {
  ErreurPlanif, erreursParChamp, LIBELLES_PRECISION, LIBELLES_STATUT_PLANIF,
  planif, type AdresseClient, type ClientOdoo, type Referentiels, type ServicePlanif, type ServiceSaisie,
} from '../planification';

// ---------- dates ----------

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function lundi(jour: string): Date {
  const d = new Date(`${jour}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
function plus(d: Date, jours: number) { const r = new Date(d); r.setDate(r.getDate() + jours); return r; }
const jj = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
/** « 2026-11-16T07:30:00+01:00 » (Paris) -> valeur d'un <input type="datetime-local"> */
const versSaisie = (s: string | null) => (s ? s.slice(0, 16) : '');

// ---------- formulaire ----------

const VIDE: ServiceSaisie = {
  name: '', project_id: 11, partner_id: null, partner_name: null, partner_phone: null, planned_date_begin: null,
  date_deadline: null, allocated_hours: 2, priority: '0', description: null, tag_ids: [], worksheet_template_id: null,
  under_warranty: false, site_partner_id: null, site_adresse: null, site_lat: null, site_lng: null,
  type_service_id: null, nb_techniciens: 1, competences_requises: [], vehicule_requis: 'indifferent',
  fenetre_debut: null, fenetre_fin: null,
};

/** Champs saisissables d'un service existant (les champs calculés par le serveur sont retirés). */
function saisieDe(s: ServicePlanif): ServiceSaisie {
  const saisie = {} as Record<string, unknown>;
  for (const cle of Object.keys(VIDE)) saisie[cle] = (s as unknown as Record<string, unknown>)[cle];
  return { ...(saisie as unknown as ServiceSaisie), planned_date_begin: versSaisie(s.planned_date_begin),
    date_deadline: versSaisie(s.date_deadline) };
}

function Champ({ libelle, erreur, children, large }: { libelle: string; erreur?: string; children: ReactNode; large?: boolean }) {
  return (
    <label className={`champ${large ? ' champ-large' : ''}`}>
      {libelle}
      {children}
      {erreur && <span className="erreur-champ" role="alert">{erreur}</span>}
    </label>
  );
}

function RechercheClient({ valeur, onChoisir }: { valeur: string | null; onChoisir: (c: ClientOdoo) => void }) {
  const [texte, setTexte] = useState(valeur ?? '');
  const [resultats, setResultats] = useState<ClientOdoo[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState(false);
  useEffect(() => {
    if (!ouvert || texte.trim().length < 2) { setResultats([]); return; }
    const minuterie = window.setTimeout(() => {
      planif.clients(texte.trim()).then((r) => { setResultats(r); setErreur(null); })
        .catch((e: Error) => setErreur(e.message));
    }, 300);
    return () => window.clearTimeout(minuterie);
  }, [texte, ouvert]);
  return (
    <div className="recherche">
      <input value={texte} placeholder="Nom du client (2 lettres min.)" aria-autocomplete="list"
        onChange={(e) => { setTexte(e.target.value); setOuvert(true); }} />
      {erreur && <span className="erreur-champ">{erreur}</span>}
      {ouvert && resultats.length > 0 && (
        <ul className="suggestions" role="listbox">
          {resultats.map((c) => (
            <li key={c.id}>
              <button type="button" role="option" aria-selected="false"
                onClick={() => { onChoisir(c); setTexte(c.nom); setOuvert(false); }}>
                <strong>{c.nom}</strong><span className="muet">{c.adresse}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FormulaireService({ service, refs, ecrire, onFini }: {
  service: ServicePlanif | null; refs: Referentiels;
  ecrire: <T>(action: () => Promise<T>) => Promise<T | undefined>; onFini: (s: ServicePlanif | null) => void;
}) {
  const [s, setS] = useState<ServiceSaisie>(() => (service ? saisieDe(service) : VIDE));
  const [adresses, setAdresses] = useState<AdresseClient[]>([]);
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const maj = (champs: Partial<ServiceSaisie>) => setS((x) => ({ ...x, ...champs }));

  useEffect(() => {
    if (s.partner_id) planif.adressesClient(s.partner_id).then(setAdresses).catch(() => setAdresses([]));
    else setAdresses([]);
  }, [s.partner_id]);

  const basculerEtiquette = (id: number) =>
    maj({ tag_ids: s.tag_ids.includes(id) ? s.tag_ids.filter((v) => v !== id) : [...s.tag_ids, id] });
  const basculerCompetence = (code: string) =>
    maj({ competences_requises: s.competences_requises.includes(code)
      ? s.competences_requises.filter((v) => v !== code) : [...s.competences_requises, code] });

  const choisirType = (id: number | null) => {
    const t = refs.types_service.find((x) => x.id === id);
    maj(t ? { type_service_id: id, allocated_hours: t.duree_defaut_h, competences_requises: t.competences,
      vehicule_requis: t.vehicule_requis, nb_techniciens: t.nb_techniciens_defaut } : { type_service_id: null });
  };

  const enregistrer = async () => {
    setErreurs({}); setErreur(null);
    if (!s.name.trim()) { setErreurs({ name: 'Titre obligatoire' }); return; }
    const adresseChangee = !!service && (s.site_adresse ?? '') !== (service.site_adresse ?? '');
    const corps: ServiceSaisie = { ...s, name: s.name.trim(), planned_date_begin: s.planned_date_begin || null,
      date_deadline: s.date_deadline || null, fenetre_debut: s.fenetre_debut || null, fenetre_fin: s.fenetre_fin || null,
      site_adresse: s.site_adresse?.trim() || null,
      ...(adresseChangee ? { site_lat: null, site_lng: null } : {}) };     // le serveur regéocode
    setEnvoi(true);
    try {
      const r = await ecrire(() => (service ? planif.modifierService(service.id, { ...corps, version: service.version })
        : planif.creerService(corps)));
      if (r) onFini(r);
    } catch (e) {
      const parChamp = erreursParChamp(e);
      setErreurs(parChamp);
      setErreur(Object.keys(parChamp).length ? 'Corriger les champs signalés.'
        : e instanceof ErreurPlanif && e.statut === 409 ? `${e.message} (fermer puis rouvrir le service)`
        : e instanceof Error ? e.message : String(e));
    } finally { setEnvoi(false); }
  };

  return (
    <form className="carte formulaire" onSubmit={(e) => { e.preventDefault(); void enregistrer(); }} noValidate>
      <div className="entete">
        <h2>{service ? `Modifier « ${service.name} »` : 'Nouveau service sur site'}</h2>
        {service?.source === 'simulation' && <Badge type="simulation">Simulation</Badge>}
      </div>
      {erreur && <div className="erreur" role="alert">{erreur}</div>}

      <fieldset>
        <legend>Tâche (champs Odoo Field Service)</legend>
        <div className="grille-champs">
          <Champ libelle="Titre" erreur={erreurs.name} large>
            <input value={s.name} onChange={(e) => maj({ name: e.target.value })} maxLength={300} />
          </Champ>
          <Champ libelle="Projet" erreur={erreurs.project_id}>
            <select value={s.project_id} onChange={(e) => maj({ project_id: Number(e.target.value) })}>
              {refs.projets.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
            </select>
          </Champ>
          <Champ libelle="Client" erreur={erreurs.partner_id}>
            <RechercheClient valeur={s.partner_name} onChoisir={(c) => maj({ partner_id: c.id, partner_name: c.nom,
              partner_phone: c.telephone, site_partner_id: c.id, site_adresse: c.adresse })} />
          </Champ>
          <Champ libelle="Contact (téléphone)" erreur={erreurs.partner_phone}>
            <input value={s.partner_phone ?? ''} onChange={(e) => maj({ partner_phone: e.target.value || null })} />
          </Champ>
          <Champ libelle="Date planifiée : début" erreur={erreurs.planned_date_begin}>
            <input type="datetime-local" value={s.planned_date_begin ?? ''}
              onChange={(e) => maj({ planned_date_begin: e.target.value || null })} />
          </Champ>
          <Champ libelle="Date planifiée : fin" erreur={erreurs.date_deadline}>
            <input type="datetime-local" value={s.date_deadline ?? ''}
              onChange={(e) => maj({ date_deadline: e.target.value || null })} />
          </Champ>
          <Champ libelle="Temps alloué (h, total)" erreur={erreurs.allocated_hours}>
            <input type="number" min={0} step={0.5} value={s.allocated_hours}
              onChange={(e) => maj({ allocated_hours: Number(e.target.value) })} />
          </Champ>
          <Champ libelle="Modèle de feuille de travail" erreur={erreurs.worksheet_template_id}>
            <select value={s.worksheet_template_id ?? ''}
              onChange={(e) => maj({ worksheet_template_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">—</option>
              {refs.modeles_feuille.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
            </select>
          </Champ>
        </div>
        {refs.etiquettes.length > 0 && (
          <div className="cases" role="group" aria-label="Étiquettes">
            <span className="libelle-groupe">Étiquettes</span>
            {refs.etiquettes.map((t) => (
              <label key={t.id} className="case"><input type="checkbox" checked={s.tag_ids.includes(t.id)}
                onChange={() => basculerEtiquette(t.id)} />{t.nom}</label>
            ))}
          </div>
        )}
        <label className="case"><input type="checkbox" checked={s.under_warranty}
          onChange={(e) => maj({ under_warranty: e.target.checked })} />Sous garantie</label>
        <Champ libelle="Description" erreur={erreurs.description} large>
          <textarea rows={3} value={s.description ?? ''} onChange={(e) => maj({ description: e.target.value || null })} />
        </Champ>
      </fieldset>

      <fieldset>
        <legend>Planification</legend>
        <div className="grille-champs">
          {adresses.length > 1 && (
            <Champ libelle="Lieu d'intervention (adresses Odoo du client)" large>
              <select value={s.site_partner_id ?? ''} onChange={(e) => {
                const a = adresses.find((x) => x.id === Number(e.target.value));
                if (a) maj({ site_partner_id: a.id, site_adresse: a.adresse });
              }}>
                {s.site_partner_id === null && <option value="">Adresse saisie à la main</option>}
                {adresses.map((a) => <option key={a.id} value={a.id}>{a.siege ? 'Siège' : a.nom} — {a.adresse}</option>)}
              </select>
            </Champ>
          )}
          <Champ libelle="Adresse du site" erreur={erreurs.site_adresse} large>
            <input value={s.site_adresse ?? ''}
              onChange={(e) => maj({ site_adresse: e.target.value || null, site_partner_id: null })} />
            {service?.site_precision && service.site_adresse === s.site_adresse && (
              <span className={`muet${service.site_precision === 'commune' ? ' precision-faible' : ''}`}>
                Position : {LIBELLES_PRECISION[service.site_precision] ?? service.site_precision}</span>
            )}
          </Champ>
          {refs.types_service.length > 0 && (
            <Champ libelle="Type de service">
              <select value={s.type_service_id ?? ''} onChange={(e) => choisirType(e.target.value ? Number(e.target.value) : null)}>
                <option value="">—</option>
                {refs.types_service.map((t) => <option key={t.id} value={t.id}>{t.nom}</option>)}
              </select>
            </Champ>
          )}
          <Champ libelle="Nombre de techniciens" erreur={erreurs.nb_techniciens}>
            <input type="number" min={1} max={10} value={s.nb_techniciens}
              onChange={(e) => maj({ nb_techniciens: Number(e.target.value) })} />
          </Champ>
          <Champ libelle="Véhicule requis" erreur={erreurs.vehicule_requis}>
            <select value={s.vehicule_requis}
              onChange={(e) => maj({ vehicule_requis: e.target.value as ServiceSaisie['vehicule_requis'] })}>
              <option value="indifferent">Indifférent</option>
              <option value="utilitaire">Utilitaire</option>
            </select>
          </Champ>
          <Champ libelle="Fenêtre : au plus tôt" erreur={erreurs.fenetre_debut}>
            <input type="date" value={s.fenetre_debut ?? ''} onChange={(e) => maj({ fenetre_debut: e.target.value || null })} />
          </Champ>
          <Champ libelle="Fenêtre : au plus tard" erreur={erreurs.fenetre_fin}>
            <input type="date" value={s.fenetre_fin ?? ''} onChange={(e) => maj({ fenetre_fin: e.target.value || null })} />
          </Champ>
          <Champ libelle="Priorité">
            <select value={s.priority} onChange={(e) => maj({ priority: e.target.value as '0' | '1' })}>
              <option value="0">Normale</option>
              <option value="1">Urgente</option>
            </select>
          </Champ>
        </div>
        <div className="cases" role="group" aria-label="Compétences requises">
          <span className="libelle-groupe">Compétences requises</span>
          {refs.competences.map((c) => (
            <label key={c.code} className="case"><input type="checkbox" checked={s.competences_requises.includes(c.code)}
              onChange={() => basculerCompetence(c.code)} />{c.libelle}</label>
          ))}
        </div>
      </fieldset>

      <div className="actions">
        <button type="button" className="btn" onClick={() => onFini(null)}>Annuler</button>
        <button type="submit" className="btn btn-primaire" disabled={envoi}>{envoi ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
    </form>
  );
}

// ---------- liste ----------

function LigneService({ s, refs, onModifier, onSupprimer }: { s: ServicePlanif; refs: Referentiels | null;
  onModifier: () => void; onSupprimer: () => void }) {
  const projet = refs?.projets.find((p) => p.id === s.project_id)?.nom ?? `Projet ${s.project_id}`;
  const quand = s.planned_date_begin ? `le ${jj(s.planned_date_begin.slice(0, 10))} à ${s.planned_date_begin.slice(11, 16)}`
    : s.fenetre_debut ? `entre le ${jj(s.fenetre_debut)} et le ${jj(s.fenetre_fin)}` : 'sans fenêtre';
  const a = s.affectation;
  const positionFaible = s.site_lat === null || s.site_precision === 'commune';
  return (
    <article className="ligne-service">
      <div className="ligne-service-titre">
        <div>
          <strong>{s.name}</strong>
          <div className="muet">{s.partner_name ?? 'client non renseigné'} · {projet}</div>
        </div>
        <div className="badges">
          {s.priority === '1' && <Badge type="urgent">Urgent</Badge>}
          <Badge type={`planif-${s.statut_planification}`}>{LIBELLES_STATUT_PLANIF[s.statut_planification]}</Badge>
          {s.source === 'simulation' && <Badge type="simulation">Simulation</Badge>}
        </div>
      </div>
      <div className="ligne-service-details">
        <span>{quand}</span>
        <span>{s.nb_techniciens} tech. · {s.allocated_hours} h</span>
        {s.competences_requises.length > 0 && <span>{s.competences_requises.map((c) => refs?.competences.find((x) => x.code === c)?.libelle ?? c).join(', ')}</span>}
        {s.vehicule_requis === 'utilitaire' && <span>utilitaire</span>}
        <span className={positionFaible ? 'precision-faible' : ''}>
          {s.site_adresse ?? 'site non renseigné'}
          {s.site_lat === null ? ' (position introuvable)' : s.site_precision === 'commune' ? ' (commune seulement)' : ''}
        </span>
      </div>
      {a && (
        <div className="ligne-service-affectation">
          {a.equipe.join(', ') || 'équipe vide'} · {a.plaque ?? 'sans véhicule'} · {jj(a.debut)}{a.fin !== a.debut ? ` → ${jj(a.fin)}` : ''}
          <span className="muet"> · {a.propose_par === 'dispatcher' ? 'choix du dispatcher' : 'proposé par le solveur'}
            {a.motif_derogation ? ` · dérogation : ${a.motif_derogation}` : ''}</span>
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn" onClick={onModifier}>Modifier</button>
        <button type="button" className="btn" onClick={onSupprimer} disabled={s.statut_planification === 'publie'}
          title={s.statut_planification === 'publie' ? 'Service publié : suppression impossible' : undefined}>Supprimer</button>
      </div>
    </article>
  );
}

export default function Services() {
  const [debut, setDebut] = useState(() => iso(lundi(aujourdhui())));
  const [fin, setFin] = useState(() => iso(plus(lundi(aujourdhui()), 11)));
  const [edition, setEdition] = useState<ServicePlanif | 'nouveau' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [filtre, setFiltre] = useState<'tous' | 'saisie' | 'simulation'>('tous');

  const liste = useDonnees(() => planif.services(debut, fin), [debut, fin]);
  const refs = useDonnees(() => planif.referentiels(), []);
  const services = useMemo(() => (liste.donnees ?? []).filter((s) => filtre === 'tous' || s.source === filtre),
    [liste.donnees, filtre]);

  const { ecrire, dialogue } = useEcriture();

  const supprimer = async (s: ServicePlanif) => {
    setMessage(null);
    try {
      await ecrire(() => planif.supprimerService(s.id));
      liste.recharger();
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <>
      <div className="entete">
        <div>
          <h1>Services sur site</h1>
          <div className="sous-titre">Mêmes champs que les tâches Odoo Field Service · base de planification (Odoo non modifié)</div>
        </div>
        <button type="button" className="btn btn-primaire" onClick={() => setEdition('nouveau')}>Nouveau service</button>
      </div>

      <div className="filtres">
        <label className="champ">Du<input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} /></label>
        <label className="champ">Au<input type="date" value={fin} onChange={(e) => setFin(e.target.value)} /></label>
        <div className="filtres" role="group" aria-label="Origine">
          {(['tous', 'saisie', 'simulation'] as const).map((f) => (
            <button key={f} type="button" className={`btn${filtre === f ? ' btn-primaire' : ''}`} aria-pressed={filtre === f}
              onClick={() => setFiltre(f)}>{{ tous: 'Tous', saisie: 'Saisis', simulation: 'Simulation' }[f]}</button>
          ))}
        </div>
      </div>

      {message && <div className="erreur" role="alert">{message}</div>}
      <Avertissements liste={refs.donnees?.avertissements} />
      {edition && refs.donnees && (
        <FormulaireService key={edition === 'nouveau' ? 'nouveau' : edition.id} service={edition === 'nouveau' ? null : edition}
          refs={refs.donnees} ecrire={ecrire} onFini={(r) => { setEdition(null); if (r) liste.recharger(); }} />
      )}
      <EtatChargement chargement={liste.chargement || refs.chargement} erreur={liste.erreur ?? refs.erreur} />

      <section className="liste-services" aria-label="Services">
        {services.map((s) => (
          <LigneService key={s.id} s={s} refs={refs.donnees} onModifier={() => setEdition(s)} onSupprimer={() => void supprimer(s)} />
        ))}
        {!liste.chargement && !services.length && (
          <div className="vide">Aucun service sur cette période. Créez-en un, ou lancez « python scripts/simuler.py ».</div>
        )}
      </section>

      {dialogue}
    </>
  );
}
