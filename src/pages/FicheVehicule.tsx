// Fiche d'un véhicule de service. Photo, valeurs exactes (Odoo, corrigé par le registre flotte), fiche constructeur,
// missions planifiées (service, site, équipe de techniciens, conducteur désigné) et traçabilité en cas de PV :
// qui conduisait à une date, historique des conducteurs d'Odoo Fleet, pièces jointes (avis de contravention,
// désignations…) lues dans Odoo à chaque ouverture, chaque consultation étant notée dans le journal.
import { useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { aujourdhui } from '../api';
import { Avertissements, EtatChargement, useDonnees } from '../composants';
import { useEcriture } from '../composants/Ecriture';
import {
  electrifie, energieDe, FicheConstructeur, jour, lundiDe, nombre, Plaque, planifiable, titreDe, valeurOdoo, Visuel,
} from '../composants/Vehicule';
import {
  BOITES, flotte, type AffectationFleet, type ConducteurDuJour, type ConducteurVehicule, type DetailVehicule,
  type MissionVehicule, type PieceJointe, type Retenu, type VehiculeFlotte,
} from '../flotte';
import { auteur, LIBELLES_STATUT_PLANIF, type StatutPlanif } from '../planification';

const EN_LIGNE = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const JOUR_MS = 86_400_000;
const date = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00`);
const duree = (debut: string | null, fin: string | null) =>
  debut ? Math.round(((fin ? date(fin) : new Date()).getTime() - date(debut).getTime()) / JOUR_MS) + 1 : null;
const jourCourt = (s: string) => date(s).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
/** « 16 → 19 nov. 2026 », « 15 sept. → 2 oct. 2026 », ou les deux dates complètes sur deux années. */
function plage(debut: string, fin: string) {
  if (debut.slice(0, 10) === fin.slice(0, 10)) return jour(debut);
  const a = date(debut), b = date(fin);
  if (a.getFullYear() !== b.getFullYear()) return `${jour(debut)} → ${jour(fin)}`;
  const format: Intl.DateTimeFormatOptions = a.getMonth() === b.getMonth() ? { day: 'numeric' } : { day: 'numeric', month: 'short' };
  return `${a.toLocaleDateString('fr-FR', format)} → ${jour(fin)}`;
}
const periode = (debut: string | null, fin: string | null) =>
  (debut && fin ? plage(debut, fin) : `${debut ? jour(debut) : 'date inconnue'} → ${fin ? jour(fin) : 'en cours'}`);
const initiales = (nom: string) => nom.split(/\s+/).filter(Boolean).slice(0, 2).map((m) => m[0]).join('').toUpperCase();
const taille = (o: number) => (o >= 1_048_576 ? `${nombre(o / 1_048_576)} Mo` : `${nombre(Math.max(1, o / 1024), 0)} Ko`);
function genre(p: PieceJointe) {
  if (p.type === 'application/pdf') return 'PDF';
  if (p.type?.startsWith('image/')) return 'Image';
  return (p.nom.split('.').pop() ?? 'Fichier').toUpperCase().slice(0, 5);
}

// ---------- pièces jointes : lues dans Odoo, consultation journalisée ----------

function usePieces() {
  const { ecrire, dialogue } = useEcriture();
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<number | null>(null);

  const telecharger = (url: string, nom: string) => {
    const a = document.createElement('a');
    a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove();
  };
  const ouvrir = async (p: PieceJointe) => {
    setErreur(null); setEnCours(p.id);
    const enLigne = EN_LIGNE.includes(p.type ?? '');
    // onglet ouvert pendant le clic (sinon bloqué comme fenêtre surgissante), rempli une fois la pièce lue
    const onglet = enLigne && auteur() ? window.open('', '_blank') : null;
    try {
      const contenu = await ecrire(() => flotte.piece(p.id));
      if (!contenu) { onglet?.close(); return; }
      const url = URL.createObjectURL(contenu);
      if (!enLigne) telecharger(url, p.nom);
      else if (onglet) onglet.location.href = url;
      else if (!window.open(url, '_blank')) telecharger(url, p.nom);
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch (e) {
      onglet?.close();
      setErreur(`${p.nom} : ${e instanceof Error ? e.message : String(e)}`);
    } finally { setEnCours(null); }
  };
  return { ouvrir, enCours, erreur, dialogue };
}
type Pieces = ReturnType<typeof usePieces>;

function ListePieces({ liste, pieces, vide = 'Aucune pièce jointe.' }: { liste: PieceJointe[]; pieces: Pieces; vide?: string }) {
  if (!liste.length) return <p className="fv-sans-piece">{vide}</p>;
  return (
    <ul className="fv-pieces">{liste.map((p) => (
      <li key={p.id}>
        <button type="button" className="fv-piece" onClick={() => void pieces.ouvrir(p)} disabled={pieces.enCours === p.id}
          title={EN_LIGNE.includes(p.type ?? '') ? 'Ouvrir dans un nouvel onglet (lu dans Odoo)' : 'Télécharger (lu dans Odoo)'}>
          <span className={`fv-piece-type${genre(p) === 'PDF' ? ' pdf' : ''}`} aria-hidden="true">{genre(p)}</span>
          <span className="fv-piece-nom">{p.nom}</span>
          <span className="fv-piece-meta">{pieces.enCours === p.id ? 'Ouverture…'
            : [taille(p.taille), p.ajoutee_le && `ajoutée le ${jour(p.ajoutee_le)}`].filter(Boolean).join(' · ')}</span>
        </button>
      </li>))}
    </ul>
  );
}

// ---------- en-tête : photo et valeurs exactes ----------

function Fait({ libelle, valeur, v, champ }: { libelle: string; valeur: ReactNode; v?: VehiculeFlotte; champ?: Retenu['corriges'][number] }) {
  const corrige = v && champ && v.retenu.corriges.includes(champ) ? valeurOdoo(v, champ) : null;
  return (
    <div className={corrige ? 'corrige' : undefined}>
      <dt>{libelle}</dt>
      <dd>{valeur === null || valeur === undefined || valeur === '' ? <span className="muet">non renseigné</span> : valeur}
        {corrige && <span className="fv-corrige" title={`Odoo indique « ${corrige} » : à corriger dans Odoo`}>corrigé</span>}</dd>
    </div>
  );
}

function Photo({ v, onPhoto }: { v: VehiculeFlotte; onPhoto: () => void }) {
  const { ecrire, dialogue } = useEcriture();
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [survol, setSurvol] = useState(false);
  const entree = useRef<HTMLInputElement>(null);
  const envoyer = async (fichier: File | undefined) => {
    if (!fichier) return;
    setErreur(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(fichier.type)) { setErreur('Choisir une photo JPEG, PNG ou WebP.'); return; }
    setEnvoi(true);
    try { if (await ecrire(() => flotte.deposerPhoto(v.id, fichier))) onPhoto(); }
    catch (e) { setErreur(e instanceof Error ? e.message : String(e)); } finally { setEnvoi(false); }
  };
  const retirer = async () => {
    setEnvoi(true); setErreur(null);
    try { await ecrire(() => flotte.retirerPhoto(v.id)); onPhoto(); }
    catch (e) { setErreur(e instanceof Error ? e.message : String(e)); } finally { setEnvoi(false); }
  };
  const deposer = (e: DragEvent) => { e.preventDefault(); setSurvol(false); void envoyer(e.dataTransfer.files[0]); };
  return (
    <div className="fv-photo-bloc">
      <div className={`fv-photo${survol ? ' survol' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setSurvol(true); }} onDragLeave={() => setSurvol(false)} onDrop={deposer}>
        <Visuel v={v} grande />
        <Plaque plaque={v.plaque} />
        <div className="fl-actions-photo">
          <input ref={entree} type="file" accept="image/jpeg,image/png,image/webp" hidden
            onChange={(e) => { void envoyer(e.target.files?.[0]); e.target.value = ''; }} />
          <button type="button" className="btn" disabled={envoi} onClick={() => entree.current?.click()}>
            {envoi ? 'Envoi…' : v.photo ? 'Remplacer la photo' : 'Ajouter une photo'}</button>
          {v.photo && <button type="button" className="btn fl-btn-retirer" disabled={envoi} onClick={() => void retirer()}>Retirer</button>}
        </div>
      </div>
      <p className="fv-photo-note">{v.photo ? `Photo ajoutée par ${v.photo.auteur} le ${jour(v.photo.ajoutee_le)}`
        : 'Glissez une photo sur l’image · réenregistrée sans métadonnées (GPS)'}</p>
      {erreur && <div className="erreur" role="alert">{erreur}</div>}
      {dialogue}
    </div>
  );
}

function Entete({ v, onPhoto }: { v: VehiculeFlotte; onPhoto: () => void }) {
  const r = v.retenu;
  const fiche = v.fiche?.statut === 'fiche' ? v.fiche : null;
  return (
    <section className="fv-entete" aria-label="Le véhicule">
      <Photo v={v} onPhoto={onPhoto} />
      <div className="fv-identite">
        <div className="fv-titre">
          <h1>{titreDe(v)}</h1>
          <div className="fv-puces">
            {energieDe(v) && <span className={`fl-energie statique${electrifie(v) ? ' electrifie' : ''}`}>{energieDe(v)}</span>}
            <span className={`fv-puce ${planifiable(v) ? 'ok' : 'non'}`}>{planifiable(v) ? 'Planifiable' : 'Hors planification'}</span>
            <span className="fv-puce">Véhicule de service</span>
          </div>
          <p className="fv-sous">{[fiche?.generation, r.annee, r.lieu].filter(Boolean).join(' · ')}</p>
        </div>
        <dl className="fv-faits">
          <Fait libelle="Modèle" valeur={titreDe(v)} v={v} champ="modele" />
          <Fait libelle="Catégorie" valeur={r.categorie} v={v} champ="categorie" />
          <Fait libelle="Énergie" valeur={energieDe(v)} v={v} champ="energie" />
          <Fait libelle="Couleur" valeur={r.couleur} v={v} champ="couleur" />
          <Fait libelle="Année" valeur={r.annee} v={v} champ="annee" />
          <Fait libelle="Lieu" valeur={r.lieu} v={v} champ="lieu" />
          <Fait libelle="Immatriculé le" valeur={v.date_immatriculation && jour(v.date_immatriculation)} />
          <Fait libelle="État (Odoo)" valeur={v.etat} />
          <Fait libelle="Places" valeur={v.places || null} />
          <Fait libelle="Boîte" valeur={v.boite ? BOITES[v.boite] ?? v.boite : null} />
          <Fait libelle="Puissance" valeur={[v.puissance_ch && `${v.puissance_ch} ch`, v.puissance_kw && `${v.puissance_kw} kW`]
            .filter(Boolean).join(' · ') || null} />
          <Fait libelle="Compteur" valeur={v.compteur ? `${nombre(v.compteur, 0)} ${v.compteur_unite === 'miles' ? 'mi' : 'km'}` : null} />
        </dl>
        {v.a_verifier.length > 0 && (
          <details className="fv-corrections">
            <summary>{v.a_verifier.length} correction{v.a_verifier.length > 1 ? 's' : ''} à reporter dans Odoo</summary>
            <ul>{v.a_verifier.map((a) => <li key={a}>{a}</li>)}</ul>
          </details>
        )}
      </div>
    </section>
  );
}

// ---------- PV : qui conduisait ce jour-là ? ----------

function RecherchePV({ v, pieces, historique, onDate }: { v: VehiculeFlotte; pieces: Pieces; historique: AffectationFleet[];
  onDate: (d: string | null) => void }) {
  const [quand, setQuand] = useState(aujourdhui());
  const [resultat, setResultat] = useState<ConducteurDuJour | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [recherche, setRecherche] = useState(false);
  const chercher = (e: FormEvent) => {
    e.preventDefault();
    setErreur(null); setRecherche(true);
    flotte.conducteurLe(v.id, quand)
      .then((r) => { setResultat(r); onDate(r.date); })
      .catch((err: Error) => { setResultat(null); onDate(null); setErreur(err.message); })
      .finally(() => setRecherche(false));
  };
  const parId = new Map(historique.map((h) => [h.id, h]));
  return (
    <section className="fv-pv" aria-label="Recherche du conducteur pour un PV">
      <div className="fv-pv-tete">
        <h2>Qui conduisait ce véhicule ?</h2>
        <p>Pour un avis de contravention : le conducteur est à désigner sous 45 jours (article L121-6 du Code de la route).</p>
      </div>
      <form className="fv-pv-form" onSubmit={chercher}>
        <label className="champ">Date de l’infraction
          <input type="date" value={quand} max={aujourdhui()} onChange={(e) => setQuand(e.target.value)} required /></label>
        <button type="submit" className="btn btn-primaire" disabled={recherche}>{recherche ? 'Recherche…' : 'Rechercher'}</button>
      </form>
      {erreur && <div className="erreur" role="alert">{erreur}</div>}
      {resultat && (
        <div className={`fv-pv-resultat ${resultat.conducteur ? 'identifie' : 'inconnu'}`} aria-live="polite">
          <div className="fv-pv-qui">
            <span>Le {jour(resultat.date)}</span>
            <strong>{resultat.conducteur ?? 'Conducteur non identifié'}</strong>
            <em>{resultat.message}</em>
          </div>
          {resultat.affectations.map((a) => (
            <div key={a.id} className="fv-pv-preuve">
              <h3>Affectation Odoo Fleet <span>{periode(a.debut, a.fin)}</span></h3>
              <p>{a.employe ?? (a.pool ? 'Véhicule de service, conducteur non renseigné' : a.conducteur)}</p>
              <ListePieces liste={parId.get(a.id)?.pieces ?? a.pieces} pieces={pieces} />
            </div>
          ))}
          {resultat.missions.map((m) => (
            <div key={`${m.service_id}-${m.debut}`} className="fv-pv-preuve">
              <h3>Mission planifiée <span>{plage(m.debut, m.fin)}</span></h3>
              <p><strong>{m.client ?? m.service}</strong> · {m.service}{m.site ? ` · ${m.site}` : ''}</p>
              <p className="muet">Conducteur désigné : {m.conducteur ?? 'aucun'} · équipe ce jour : {m.equipe.join(', ') || 'aucun créneau'}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------- frise et fiches des conducteurs (Odoo Fleet) ----------

function Frise({ historique, groupes, repere, onChoisir }: {
  historique: AffectationFleet[]; groupes: { cle: string; nom: string; ids: number[] }[]; repere: string | null;
  onChoisir: (id: number) => void;
}) {
  const datees = historique.filter((h) => h.debut);
  if (!datees.length) return null;
  const debut = Math.min(...datees.map((h) => date(h.debut!).getTime()));
  const fin = Math.max(Date.now(), ...datees.map((h) => (h.fin ? date(h.fin).getTime() : Date.now())));
  const pos = (t: number) => ((t - debut) / Math.max(fin - debut, JOUR_MS)) * 100;
  const mois: Date[] = [];
  for (let d = new Date(new Date(debut).getFullYear(), new Date(debut).getMonth() + 1, 1); d.getTime() <= fin;
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) mois.push(d);
  const pas = Math.max(1, Math.ceil(mois.length / 10));
  const parId = new Map(historique.map((h) => [h.id, h]));
  return (
    <div className="fv-frise" role="group" aria-label="Frise des conducteurs">
      <div className="fv-frise-axe" aria-hidden="true">
        {mois.map((m, i) => i % pas === 0 && (
          <span key={m.getTime()} style={{ left: `${pos(m.getTime())}%` }}>
            {m.toLocaleDateString('fr-FR', { month: 'short', year: m.getMonth() === 0 || i === 0 ? '2-digit' : undefined })}</span>))}
      </div>
      {groupes.map((g) => (
        <div key={g.cle} className="fv-frise-ligne">
          <span className="fv-frise-nom" title={g.nom}>{g.nom}</span>
          <div className="fv-frise-piste">
            {mois.map((m, i) => i % pas === 0 && <i key={m.getTime()} className="fv-frise-mois" style={{ left: `${pos(m.getTime())}%` }} />)}
            {g.ids.map((id) => {
              const h = parId.get(id);
              if (!h?.debut) return null;
              const a = pos(date(h.debut).getTime());
              const b = pos(h.fin ? date(h.fin).getTime() + JOUR_MS : Date.now());
              return (
                <button key={id} type="button" className={`fv-frise-barre${h.pieces.length ? ' avec-pieces' : ''}${h.fin ? '' : ' en-cours'}`}
                  style={{ left: `${a}%`, width: `${Math.max(b - a, 0.8)}%` }} onClick={() => onChoisir(id)}
                  title={`${g.nom} · ${periode(h.debut, h.fin)}${h.pieces.length ? ` · ${h.pieces.length} pièce(s) jointe(s)` : ''}`}
                  aria-label={`${g.nom}, ${periode(h.debut, h.fin)}${h.pieces.length ? `, ${h.pieces.length} pièce(s)` : ''}`}>
                  {h.pieces.length > 0 && <span>{h.pieces.length}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {repere && <i className={`fv-frise-repere${pos(date(repere).getTime()) > 75 ? ' gauche' : ''}`}
        style={{ left: `calc(var(--fv-nom) + (100% - var(--fv-nom)) * ${pos(date(repere).getTime()) / 100})` }}
        title={`PV du ${jour(repere)}`}><b>PV {jour(repere)}</b></i>}
    </div>
  );
}

function FicheConducteur({ c, historique, pieces, choisi }: { c: ConducteurVehicule | { nom: string; anonyme: true; ids: number[] };
  historique: Map<number, AffectationFleet>; pieces: Pieces; choisi: number | null }) {
  const ids = 'anonyme' in c ? c.ids : c.affectations.map((a) => a.id);
  const lignes = ids.map((id) => historique.get(id)).filter((h): h is AffectationFleet => !!h);
  const noms = 'anonyme' in c ? [] : [...new Set(lignes.map((h) => h.employe).filter(Boolean))] as string[];
  const nbPieces = lignes.reduce((n, h) => n + h.pieces.length, 0);
  return (
    <article className={`fv-personne${'anonyme' in c ? ' anonyme' : ''}`}>
      <header>
        <span className="fv-initiales" aria-hidden="true">{'anonyme' in c ? '?' : initiales(c.nom)}</span>
        <div className="fv-personne-nom">
          <h3>{c.nom}</h3>
          {'anonyme' in c ? <p>Affectations « Véhicule de service » sans employé renseigné dans Odoo</p>
            : <p>{[c.departement, c.societe].filter(Boolean).join(' · ') || 'Département non renseigné'}</p>}
        </div>
        {!('anonyme' in c) && c.matricule && <span className="fv-tag" title="Technicien terrain (SPOC)">
          Technicien · {c.matricule}{c.agence ? ` · ${c.agence}` : ''}</span>}
      </header>
      <p className="fv-personne-resume">{lignes.length} affectation{lignes.length > 1 ? 's' : ''} · {nbPieces} pièce
        {nbPieces > 1 ? 's' : ''} jointe{nbPieces > 1 ? 's' : ''}
        {noms.length > 1 && <> · {noms.length} fiches employé dans Odoo ({noms.join(', ')})</>}</p>
      <ol className="fv-periodes">
        {lignes.map((h) => (
          <li key={h.id} id={`affectation-${h.id}`} className={choisi === h.id ? 'choisi' : undefined}>
            <div className="fv-periode"><strong>{periode(h.debut, h.fin)}</strong>
              {duree(h.debut, h.fin) && <em>{duree(h.debut, h.fin)} jour{(duree(h.debut, h.fin) ?? 0) > 1 ? 's' : ''}</em>}</div>
            <ListePieces liste={h.pieces} pieces={pieces} />
          </li>
        ))}
      </ol>
    </article>
  );
}

// ---------- missions planifiées ----------

const PROPOSE_PAR: Record<string, string> = { solveur: 'le solveur', dispatcher: 'un dispatcher' };

function Mission({ m }: { m: MissionVehicule }) {
  const aujourd = aujourdhui();
  const moment = m.fin < aujourd ? 'passee' : m.debut > aujourd ? 'avenir' : 'encours';
  return (
    <li>
      <details className={`fv-mission ${moment}`}>
        <summary>
          <span className="fv-mission-dates">{plage(m.debut, m.fin)}
            <em>{moment === 'encours' ? 'en cours' : moment === 'avenir' ? 'à venir' : `${m.jours_ouvres} j ouvré${m.jours_ouvres > 1 ? 's' : ''}`}</em></span>
          <span className="fv-mission-titre"><strong>{m.client ?? m.service}</strong><span>{m.service}</span></span>
          <span className="fv-mission-pilote">{m.conducteur ? <>Conducteur <strong>{m.conducteur}</strong></> : 'Conducteur non désigné'}
            <em>{m.equipe.length} technicien{m.equipe.length > 1 ? 's' : ''}</em></span>
          <span className={`fv-etat ${m.etat}`}>{LIBELLES_STATUT_PLANIF[m.etat as StatutPlanif] ?? m.etat}</span>
        </summary>
        <div className="fv-mission-corps">
          <dl className="fv-mission-infos">
            <div><dt>Site d’intervention</dt><dd>{m.site ?? <span className="muet">non renseigné</span>}</dd></div>
            <div><dt>Statut du service</dt><dd>{LIBELLES_STATUT_PLANIF[m.statut as StatutPlanif] ?? m.statut}</dd></div>
            <div><dt>Durée</dt><dd>{m.jours_ouvres} jour{m.jours_ouvres > 1 ? 's' : ''} ouvré{m.jours_ouvres > 1 ? 's' : ''}</dd></div>
            <div><dt>Véhicule proposé par</dt><dd>{PROPOSE_PAR[m.propose_par] ?? m.propose_par}{m.raison ? ` · ${m.raison}` : ''}</dd></div>
            {m.motif && <div className="large"><dt>Motif de dérogation</dt><dd>{m.motif}</dd></div>}
          </dl>
          {m.equipe.length ? (
            <table className="fv-equipe">
              <thead><tr><th scope="col">Technicien</th><th scope="col">Agence</th><th scope="col">Jours sur la mission</th><th scope="col">Rôle</th></tr></thead>
              <tbody>{m.equipe.map((e) => (
                <tr key={e.matricule}>
                  <td><strong>{e.nom}</strong> <small>{e.matricule}</small></td>
                  <td>{e.agence ?? '—'}</td>
                  <td>{e.jours.map(jourCourt).join(', ')}</td>
                  <td>{e.conducteur ? <span className="fv-tag conducteur">Conducteur</span> : 'Équipier'}</td>
                </tr>))}
              </tbody>
            </table>
          ) : <p className="muet">Aucun technicien affecté sur ces dates.</p>}
          <Link className="fv-lien" to={`/planification?semaine=${lundiDe(m.debut)}`}>Ouvrir la semaine dans la planification →</Link>
        </div>
      </details>
    </li>
  );
}

// ---------- page ----------

export default function FicheVehicule() {
  const { id } = useParams();
  const vid = Number(id);
  const donnees = useDonnees<DetailVehicule>(() => flotte.vehicule(vid), [vid]);
  const pieces = usePieces();
  const [choisi, setChoisi] = useState<number | null>(null);
  const [repere, setRepere] = useState<string | null>(null);
  const d = donnees.donnees;

  const historique = useMemo(() => new Map((d?.historique ?? []).map((h) => [h.id, h])), [d]);
  const anonymes = useMemo(() => (d?.historique ?? []).filter((h) => !h.employe && h.pool).map((h) => h.id), [d]);
  const groupes = useMemo(() => [
    ...(d?.conducteurs ?? []).map((c) => ({ cle: c.nom, nom: c.nom, ids: c.affectations.map((a) => a.id) })),
    ...(anonymes.length ? [{ cle: '?', nom: 'Non renseigné', ids: anonymes }] : []),
  ], [d, anonymes]);
  const choisir = (idAffectation: number) => {
    setChoisi(idAffectation);
    document.getElementById(`affectation-${idAffectation}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  if (!d) {
    return (
      <div className="fv">
        <Link className="fv-retour" to="/vehicules">← Parc véhicules</Link>
        <EtatChargement chargement={donnees.chargement} erreur={donnees.erreur} />
      </div>
    );
  }
  const v = d.vehicule;
  const nbPieces = d.historique.reduce((n, h) => n + h.pieces.length, 0);
  return (
    <div className="fv">
      <Link className="fv-retour" to="/vehicules">← Parc véhicules</Link>
      <Avertissements liste={d.avertissements} />
      <Entete v={v} onPhoto={donnees.recharger} />
      {pieces.erreur && <div className="erreur" role="alert">{pieces.erreur}</div>}

      <div className="fv-colonnes">
        <div className="fv-principale">
          <RecherchePV v={v} pieces={pieces} historique={d.historique} onDate={setRepere} />

          <section className="fv-section" aria-label="Conducteurs et pièces jointes">
            <h2>Conducteurs et pièces jointes <span className="fl-source">Odoo Fleet</span>
              <small>{d.historique.length} affectation{d.historique.length > 1 ? 's' : ''} · {nbPieces} pièce{nbPieces > 1 ? 's' : ''}</small></h2>
            {!d.historique_disponible && <p className="muet">Odoo injoignable : historique et pièces jointes indisponibles.</p>}
            {d.historique_disponible && !d.historique.length && <p className="muet">Aucune affectation enregistrée dans Odoo Fleet.</p>}
            <Frise historique={d.historique} groupes={groupes} repere={repere} onChoisir={choisir} />
            <div className="fv-personnes">
              {d.conducteurs.map((c) => <FicheConducteur key={c.nom} c={c} historique={historique} pieces={pieces} choisi={choisi} />)}
              {anonymes.length > 0 && <FicheConducteur c={{ nom: 'Conducteur non renseigné', anonyme: true, ids: anonymes }}
                historique={historique} pieces={pieces} choisi={choisi} />}
            </div>
          </section>

          <section className="fv-section" aria-label="Missions planifiées">
            <h2>Missions planifiées <span className="fl-source">Planification</span>
              <small>{d.missions.length} mission{d.missions.length > 1 ? 's' : ''}</small></h2>
            {d.missions.length
              ? <ol className="fv-missions">{d.missions.map((m) => <Mission key={m.id} m={m} />)}</ol>
              : <p className="muet">Ce véhicule n’a encore été affecté à aucune mission.</p>}
          </section>
        </div>

        <aside className="fv-cote">
          <section className="fv-section" aria-label="Documents du véhicule">
            <h2>Documents du véhicule <span className="fl-source">Odoo</span></h2>
            <ListePieces liste={d.documents} pieces={pieces} vide="Aucun document joint au véhicule dans Odoo." />
          </section>
          <section className="fv-section" aria-label="Fiche constructeur">
            <h2>Fiche constructeur</h2>
            {v.fiche ? <FicheConstructeur f={v.fiche} /> : <p className="muet">Pas de fiche pour ce modèle.</p>}
          </section>
        </aside>
      </div>
      {pieces.dialogue}
    </div>
  );
}
