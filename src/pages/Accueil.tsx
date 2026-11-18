// Accueil du dispatcher (page d'entrée), pensé pour plusieurs planificateurs. En haut le brief du jour (lignes écrites
// sans IA depuis les faits, résumé du modèle local en exergue). Puis : à traiter (par urgence), chaque ligne pouvant être
// prise en charge (« je m'en occupe », journalisé) ; depuis votre dernière visite (collègues et Odoo) ; prêt pour le
// prochain jour ouvré (ce qui manque à chaque intervention). Le détail (qui est où, une semaine, un technicien…) est
// dans l'assistant. Chaque ligne ouvre l'écran où l'on agit. Les statistiques restent dans la page Statistiques.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { lienFiche, lireAccueil, prendreEnCharge, type CategorieATraiter, type Controles, type ElementATraiter } from '../accueil';
import { EtatChargement, initiales, useDonnees } from '../composants';
import { useModeleAssistant } from '../composants/Assistant';
import BriefDuJour from '../composants/BriefDuJour';
import NouveautesEquipe from '../composants/NouveautesEquipe';
import { meteo, temps, type Meteo } from '../meteo';
import { auteur, planif } from '../planification';
import { ErreurStats, stats } from '../statistiques';

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre',
  'décembre'];
const date = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);
const dateLongue = (iso: string) => { const d = date(iso); return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}`; };
const jj = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** Numéro de semaine ISO 8601. */
function semaine(iso: string): number {
  const d = date(iso);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const premier = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - premier.getTime()) / 86_400_000 - 3 + ((premier.getDay() + 6) % 7)) / 7);
}
function depuisQuand(iso: string, maintenant: Date): string {
  const min = Math.max(0, Math.round((maintenant.getTime() - new Date(iso).getTime()) / 60_000));
  return min < 1 ? "à l'instant" : min < 60 ? `il y a ${min} min` : `il y a ${Math.round(min / 60)} h`;
}
const CONTROLES: [keyof Controles, string][] = [
  ['equipe', 'Équipe'], ['vehicule', 'Véhicule'], ['materiel', 'Matériel'], ['site', 'Site'], ['publie', 'Publié']];

function Chevron() {
  return <svg className="ac-chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m5 6 3 3 3-3" /></svg>;
}

/** Qui s'occupe d'une ligne : « Je m'en occupe » si personne, « Vous · Laisser » si c'est moi, le collègue sinon. */
function Prise({ e, moi, onPrendre }: { e: ElementATraiter; moi: string | null; onPrendre: (oui: boolean) => void }) {
  const p = e.pris_par;
  if (p && p.auteur === moi) {
    return <span className="ac-prise moi"><span className="ac-prise-av" aria-hidden="true">{initiales(p.auteur)}</span>Vous
      <button type="button" onClick={() => onPrendre(false)}>Laisser</button></span>;
  }
  if (p) {
    return <span className="ac-prise"><span className="ac-prise-av" aria-hidden="true">{initiales(p.auteur.replace(/\s*\(simulé\)$/, ''))}</span>
      {p.auteur} s'en occupe</span>;
  }
  return <button type="button" className="ac-prendre" onClick={() => onPrendre(true)} disabled={!moi}
    title={moi ? 'Indiquer aux collègues que vous vous en occupez' : 'Indiquez votre nom (Planification) pour prendre en charge'}>
    Je m'en occupe</button>;
}

/** Une catégorie « à traiter » : nombre, libellé, action ; dépliée, ses services, chacun ouvrant sa fiche et pouvant
 * être pris en charge. Repliée, les initiales de qui s'en occupe déjà. */
function Categorie({ c, ouverte, onBasculer, moi, onPrendre }: {
  c: CategorieATraiter; ouverte: boolean; onBasculer: () => void; moi: string | null;
  onPrendre: (e: ElementATraiter, oui: boolean) => void;
}) {
  const seul = c.elements.length === 1 ? c.elements[0] : null;
  const pris = c.elements.filter((e) => e.pris_par);
  return (
    <li id={`ac-cat-${c.cle}`} className={`ac-cat niveau-${c.niveau}${ouverte ? ' ouverte' : ''}`}>
      <div className="ac-cat-ligne">
        <button type="button" className="ac-cat-titre" aria-expanded={ouverte} aria-controls={`ac-liste-${c.cle}`}
          onClick={onBasculer}>
          <span className="ac-cat-point" aria-hidden="true" /><strong className="ac-cat-nombre">{c.nombre}</strong>
          <span className="ac-cat-libelle">{c.libelle}</span>
          {pris.length > 0 && <span className="ac-cat-pris" title={`${pris.length} sur ${c.elements.length} pris en charge`}>
            {pris.slice(0, 3).map((e) => <i key={e.service_id}>{initiales(e.pris_par!.auteur.replace(/\s*\(simulé\)$/, ''))}</i>)}</span>}
          <Chevron /></button>
        {seul
          ? <Link className="ac-cat-action" to={lienFiche(seul.service_id, seul.semaine, seul.onglet)}>{c.action}</Link>
          : <button type="button" className="ac-cat-action" onClick={onBasculer}>{ouverte ? 'Masquer' : 'Voir'}</button>}
      </div>
      {ouverte && (
        <ul className="ac-elements" id={`ac-liste-${c.cle}`}>
          {c.elements.map((e) => (
            <li key={e.service_id} className="ac-element">
              <Link to={lienFiche(e.service_id, e.semaine, e.onglet)}>
                <span className="ac-el-nom"><strong>{e.nom}</strong>
                  <small>{[e.client, e.detail].filter(Boolean).join(' · ')}</small></span>
                {e.jour && <span className="ac-el-jour">{jj(e.jour)}</span>}
              </Link>
              <Prise e={e} moi={moi} onPrendre={(oui) => onPrendre(e, oui)} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function Accueil() {
  const navigate = useNavigate();
  const accueil = useDonnees(() => lireAccueil(), []);
  const d = accueil.donnees;
  const ia = useModeleAssistant();
  const [maintenant, setMaintenant] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setMaintenant(new Date()), 60_000); return () => window.clearInterval(t); }, []);

  // Odoo : copie mise à jour à l'ouverture et toutes les 2 minutes (sautée si récente), ou par le bouton ; un
  // changement relit les faits.
  const [synchro, setSynchro] = useState<{ fin: string | null; enCours: boolean; erreur: string | null }>(
    { fin: null, enCours: false, erreur: null });
  const synchroniser = async (bouton: boolean) => {
    setSynchro((x) => ({ ...x, enCours: true }));
    try {
      const r = await stats.synchroniser(bouton ? undefined : 60);
      setSynchro({ fin: r.dernier_cycle ?? null, enCours: false, erreur: null });
      const b = r.services;
      if (bouton || (b && b.ajoutes.length + b.mis_a_jour.length + b.sortis.length > 0)) accueil.actualiser();
    } catch (e) {
      const deja = e instanceof ErreurStats && e.statut === 409;
      setSynchro((x) => ({ ...x, enCours: false, erreur: deja ? null : e instanceof Error ? e.message : String(e) }));
    }
  };
  const synchroRef = useRef(synchroniser);
  synchroRef.current = synchroniser;
  useEffect(() => {
    void synchroRef.current(false);
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void synchroRef.current(false); }, 120_000);
    const auRetour = () => { if (document.visibilityState === 'visible') void synchroRef.current(false); };
    document.addEventListener('visibilitychange', auRetour);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', auRetour); };
  }, []);

  // météo au siège (Open-Meteo, libre et sans clé ; seule la position du siège est envoyée)
  const agences = useDonnees(() => planif.agences(), []);
  const siege = useMemo(() => {
    const placees = (agences.donnees?.agences ?? []).filter((a) => a.lat !== null && a.lng !== null);
    return placees.find((a) => a.code === 'noisy') ?? placees[0] ?? null;
  }, [agences.donnees]);
  const [ciel, setCiel] = useState<Meteo | null>(null);
  useEffect(() => {
    if (!siege || !d) return;
    let vivant = true;
    meteo(siege.lat!, siege.lng!, d.jour, d.jour).then((m) => { if (vivant) setCiel(m); }).catch(() => undefined);
    return () => { vivant = false; };
  }, [siege, d?.jour]); // eslint-disable-line react-hooks/exhaustive-deps

  const [ouvertes, setOuvertes] = useState<Set<string>>(() => new Set());
  const basculer = (cle: string) => setOuvertes((o) => { const n = new Set(o); if (n.has(cle)) n.delete(cle); else n.add(cle); return n; });
  /** Action d'une phrase du brief : le prochain jour ouvré s'ouvre dans l'assistant (ce qui manque, intervention par
   * intervention) ; une catégorie à traiter se déplie et la page y mène. */
  const allerA = (cle: string) => {
    if (cle === 'prochain') {
      ia.ouvrir({ libelle: `Que manque-t-il pour ${d?.prochain.etiquette.toLowerCase() ?? 'demain'} ?`, outil: 'preparation' });
      return;
    }
    setOuvertes((o) => new Set(o).add(cle));
    window.requestAnimationFrame(() => document.getElementById(`ac-cat-${cle}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };
  // « je m'en occupe » : écrit dans le journal sous mon nom, puis les faits sont relus
  const moi = auteur()?.trim() || null;
  const prendre = (cle: string, e: ElementATraiter, oui: boolean) => {
    if (!moi) return;
    prendreEnCharge(moi, cle, e.service_id, oui).then(() => accueil.actualiser()).catch(() => undefined);
  };
  const [recherche, setRecherche] = useState('');
  const chercher = (e: FormEvent) => {
    e.preventDefault();
    if (recherche.trim()) navigate(`/dossiers?q=${encodeURIComponent(recherche.trim())}`);
  };

  const prenom = auteur()?.trim().split(/\s+/)[0] ?? null;
  const actuel = ciel?.actuelle ? temps(ciel.actuelle.code) : null;
  const libelleAction = (cle: string) => cle === 'prochain' ? `Voir ${d?.prochain.etiquette.toLowerCase()}`
    : d?.a_traiter.find((c) => c.cle === cle)?.libelle ?? cle;
  const prets = d ? d.prochain.services.filter((x) => x.pret).length : 0;

  return (
    <div className="ac">
      <header className="ac-tete">
        <div className="ac-date">
          <h1>{d ? dateLongue(d.jour) : 'Accueil'}</h1>
          {d && <span>Semaine {semaine(d.jour)}</span>}
        </div>
        <form className="ac-recherche" role="search" onSubmit={chercher}>
          <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.75" /><path d="m13 13 4.5 4.5" /></svg>
          <label className="visuellement-cache" htmlFor="ac-q">Rechercher dans les dossiers</label>
          <input id="ac-q" type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)}
            placeholder="Service, client, technicien, véhicule" />
        </form>
        <div className="ac-etat">
          {actuel && siege && <span className="ac-meteo" title={`${actuel.libelle} à ${siege.nom}`}>
            <span aria-hidden="true">{actuel.icone}</span>{Math.round(ciel!.actuelle!.temperature)}°<small>{siege.nom.replace(/\s*\(.*\)$/, '')}</small></span>}
          <button type="button" className={`ac-synchro${synchro.enCours ? ' en-cours' : ''}${synchro.erreur ? ' erreur' : ''}`}
            onClick={() => void synchroniser(true)} disabled={synchro.enCours} title={synchro.erreur ?? 'Synchroniser avec Odoo'}>
            <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M16.2 8.3A6.5 6.5 0 0 0 4.4 6.6" />
              <path d="M3.8 11.7a6.5 6.5 0 0 0 11.8 1.7" /><path d="M4.2 3.2v3.6h3.6" /><path d="M15.8 16.8v-3.6h-3.6" /></svg>
            {synchro.enCours ? 'Synchronisation…' : synchro.erreur ? 'Odoo injoignable' : synchro.fin
              ? <>Odoo <small>{depuisQuand(synchro.fin, maintenant)}</small></> : 'Odoo'}
          </button>
        </div>
      </header>

      <EtatChargement chargement={accueil.chargement && !d} erreur={accueil.erreur} />
      {d && <>
        {/* le brief du jour (gardé pour la journée) ; la conversation est dans l'assistant flottant (bouton en bas) */}
        <BriefDuJour phrases={d.brief} prenom={prenom} modele={ia.modele} version={d}
          libelleAction={libelleAction} onAction={allerA} />

        <div className="ac-grille">
          <section className="ac-carte ac-traiter" aria-labelledby="ac-titre-traiter">
            <header><h2 id="ac-titre-traiter">À traiter</h2>
              {d.a_traiter.length > 0 && <span>{d.a_traiter.reduce((t, c) => t + c.nombre, 0)} points</span>}</header>
            {d.a_traiter.length
              ? <ul className="ac-cats">{d.a_traiter.map((c) => (
                <Categorie key={c.cle} c={c} ouverte={ouvertes.has(c.cle)} onBasculer={() => basculer(c.cle)} moi={moi}
                  onPrendre={(e, oui) => prendre(c.cle, e, oui)} />))}</ul>
              : <p className="ac-vide ok">Rien à traiter. Tout est en ordre.</p>}
          </section>

          <div className="ac-colonne">
            <NouveautesEquipe auteur={moi} version={d} />

            {/* prochain jour ouvré : chaque intervention et ce qui lui manque (le détail : bouton du brief, assistant) */}
            <section className="ac-carte ac-pret" id="ac-prochain" aria-labelledby="ac-titre-prochain">
              <header><h2 id="ac-titre-prochain">Prêt pour {d.prochain.etiquette.toLowerCase()}
                <small>{dateLongue(d.prochain.jour)}</small></h2>
                {d.prochain.services.length > 0 && <span className={`ac-pret-compte${prets === d.prochain.services.length ? ' ok' : ''}`}>
                  {prets}/{d.prochain.services.length} prête{prets > 1 ? 's' : ''}</span>}</header>
              {d.prochain.services.length
                ? <ul className="ac-pret-liste">{d.prochain.services.map((x) => (
                  <li key={x.service_id}>
                    <Link to={lienFiche(x.service_id, x.semaine)} className="ac-pret-ligne">
                      <span className="ac-pret-nom"><strong>{x.nom}</strong>
                        <small>{[x.client, x.ville].filter(Boolean).join(' · ')}</small></span>
                      {x.pret ? <span className="ac-pret-ok">✓ prête</span>
                        : <span className="ac-pret-manques"><span className="visuellement-cache">manque :</span>
                          {CONTROLES.filter(([k]) => !x.controles[k]).map(([k, libelle]) => <span key={k}>{libelle}</span>)}</span>}
                    </Link>
                  </li>))}</ul>
                : <p className="ac-vide">Aucune intervention prévue.</p>}
            </section>
          </div>
        </div>

        {/* libres, absents et techniciens dépendent des congés et d'Odoo : dire s'ils n'ont pas pu être lus */}
        {d.avertissements.length > 0 && <ul className="ac-avertissements ac-note">{d.avertissements.map((a) => <li key={a}>{a}</li>)}</ul>}
      </>}
    </div>
  );
}
