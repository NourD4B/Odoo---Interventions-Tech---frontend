// Accueil du dispatcher (page d'entrée). L'assistant résume la journée en quelques phrases écrites depuis les faits
// calculés par le serveur (aucune IA, aucun nombre inventé), puis les mêmes faits à parcourir : à traiter (par
// urgence), aujourd'hui (qui est sur quel service, libres, absents) et le prochain jour ouvré (ce qui manque à chaque
// intervention). Chaque ligne ouvre l'écran où l'on agit. Les statistiques restent dans la page Statistiques.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { lienFiche, lireAccueil, type CategorieATraiter, type Controles } from '../accueil';
import { EtatChargement, initiales, useDonnees } from '../composants';
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
const ETATS: Record<string, string> = { propose: 'proposé', verrouille: 'verrouillé', publie: 'publié' };

function Chevron() {
  return <svg className="ac-chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m5 6 3 3 3-3" /></svg>;
}

/** Une catégorie « à traiter » : nombre, libellé, action ; dépliée, ses services, chacun ouvrant sa fiche. */
function Categorie({ c, ouverte, onBasculer }: { c: CategorieATraiter; ouverte: boolean; onBasculer: () => void }) {
  const seul = c.elements.length === 1 ? c.elements[0] : null;
  return (
    <li id={`ac-cat-${c.cle}`} className={`ac-cat niveau-${c.niveau}${ouverte ? ' ouverte' : ''}`}>
      <div className="ac-cat-ligne">
        <button type="button" className="ac-cat-titre" aria-expanded={ouverte} aria-controls={`ac-liste-${c.cle}`}
          onClick={onBasculer}>
          <span className="ac-cat-point" aria-hidden="true" /><strong className="ac-cat-nombre">{c.nombre}</strong>
          <span className="ac-cat-libelle">{c.libelle}</span><Chevron /></button>
        {seul
          ? <Link className="ac-cat-action" to={lienFiche(seul.service_id, seul.semaine, seul.onglet)}>{c.action}</Link>
          : <button type="button" className="ac-cat-action" onClick={onBasculer}>{ouverte ? 'Masquer' : 'Voir'}</button>}
      </div>
      {ouverte && (
        <ul className="ac-elements" id={`ac-liste-${c.cle}`}>
          {c.elements.map((e) => (
            <li key={e.service_id}>
              <Link to={lienFiche(e.service_id, e.semaine, e.onglet)}>
                <span className="ac-el-nom"><strong>{e.nom}</strong>
                  <small>{[e.client, e.detail].filter(Boolean).join(' · ')}</small></span>
                {e.jour && <span className="ac-el-jour">{jj(e.jour)}</span>}
              </Link>
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
  /** Action d'une phrase du brief : déplie la catégorie et y mène. */
  const allerA = (cle: string) => {
    if (cle !== 'prochain') setOuvertes((o) => new Set(o).add(cle));
    window.requestAnimationFrame(() => document.getElementById(cle === 'prochain' ? 'ac-prochain' : `ac-cat-${cle}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
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
  const nbAujourdhui = d ? new Set(d.aujourdhui.techniciens.flatMap((t) => t.services.map((x) => x.service_id))).size : 0;
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
        {/* l'assistant : phrases écrites depuis les faits ; chaque action mène à la liste concernée */}
        <section className="ac-brief" aria-labelledby="ac-bonjour">
          <div className="ac-brief-tete">
            <span className="ac-etoile" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5z" />
                <path d="M19 15.5c.25 1.9 1.1 2.75 3 3-1.9.25-2.75 1.1-3 3-.25-1.9-1.1-2.75-3-3 1.9-.25 2.75-1.1 3-3z" /></svg></span>
            <h2 id="ac-bonjour">Bonjour{prenom ? ` ${prenom}` : ''}.</h2>
          </div>
          <ul className="ac-phrases">
            {d.brief.map((p) => (
              <li key={p.texte} className={`ton-${p.ton}`}>
                <p>{p.texte}</p>
                {p.actions.length > 0 && <span className="ac-phrase-actions">{p.actions.map((a) => (
                  <button key={a.categorie} type="button" onClick={() => allerA(a.categorie)}>{libelleAction(a.categorie)}</button>))}
                </span>}
              </li>
            ))}
          </ul>
          <p className="ac-brief-pied">Écrit à partir de la planification et de la copie d'Odoo. Aucun chiffre n'est estimé.</p>
        </section>

        <div className="ac-grille">
          <section className="ac-carte ac-traiter" aria-labelledby="ac-titre-traiter">
            <header><h2 id="ac-titre-traiter">À traiter</h2>
              {d.a_traiter.length > 0 && <span>{d.a_traiter.reduce((t, c) => t + c.nombre, 0)} points</span>}</header>
            {d.a_traiter.length
              ? <ul className="ac-cats">{d.a_traiter.map((c) => (
                <Categorie key={c.cle} c={c} ouverte={ouvertes.has(c.cle)} onBasculer={() => basculer(c.cle)} />))}</ul>
              : <p className="ac-vide ok">Rien à traiter. Tout est en ordre.</p>}
          </section>

          <section className="ac-carte ac-jour" aria-labelledby="ac-titre-jour">
            <header><h2 id="ac-titre-jour">Aujourd'hui</h2>
              <span>{nbAujourdhui ? `${nbAujourdhui} intervention${nbAujourdhui > 1 ? 's' : ''}` : ''}</span></header>
            {d.aujourdhui.techniciens.length
              ? <ul className="ac-techs">{d.aujourdhui.techniciens.map((t) => (
                <li key={t.matricule}>
                  <span className="ac-avatar" aria-hidden="true">{initiales(t.nom)}</span>
                  <div className="ac-tech">
                    <strong>{t.nom}</strong>
                    {t.services.map((x) => (
                      <Link key={x.service_id} className="ac-mission" to={lienFiche(x.service_id, x.semaine)}>
                        <span>{x.nom}{x.etat && x.etat !== 'publie' && <em>{ETATS[x.etat] ?? x.etat}</em>}</span>
                        <small>{[x.ville, x.jours > 1 ? `jour ${x.jour_n} sur ${x.jours}` : null, x.plaque].filter(Boolean).join(' · ')}</small>
                      </Link>
                    ))}
                  </div>
                </li>))}</ul>
              : <p className="ac-vide">{d.aujourdhui.ouvre ? "Aucune intervention aujourd'hui." : 'Jour non travaillé.'}</p>}
            <footer className="ac-dispo">
              <p><span>Libres</span>{d.aujourdhui.libres.length
                ? d.aujourdhui.libres.map((n) => <span key={n} className="ac-libre">{n}</span>) : <em>personne</em>}</p>
              {d.aujourdhui.absents.length > 0 && <p><span>Absents</span>{d.aujourdhui.absents.map((n) => (
                <span key={n} className="ac-absent">{n}</span>))}</p>}
              {/* libres et absents dépendent des congés : dire s'ils n'ont pas pu être lus */}
              {d.avertissements.length > 0 && <ul className="ac-avertissements">{d.avertissements.map((a) => <li key={a}>{a}</li>)}</ul>}
            </footer>
          </section>
        </div>

        <section className="ac-carte ac-prochain" id="ac-prochain" aria-labelledby="ac-titre-prochain">
          <header><h2 id="ac-titre-prochain">{d.prochain.etiquette}<small>{dateLongue(d.prochain.jour)}</small></h2>
            {d.prochain.services.length > 0 && <span className={prets === d.prochain.services.length ? 'ok' : ''}>
              {prets} sur {d.prochain.services.length} prêt{prets > 1 ? 's' : ''}</span>}</header>
          {d.prochain.services.length
            ? <ul className="ac-tuiles">{d.prochain.services.map((x) => (
              <li key={x.service_id}>
                <Link to={lienFiche(x.service_id, x.semaine)} className={`ac-tuile${x.pret ? ' pret' : ''}`}>
                  <strong>{x.nom}</strong>
                  <small>{[x.client, x.ville].filter(Boolean).join(' · ')}</small>
                  <span className="ac-controles">{CONTROLES.map(([k, libelle]) => (
                    <span key={k} className={x.controles[k] ? 'oui' : 'non'}>
                      <span aria-hidden="true">{x.controles[k] ? '✓' : '✗'}</span>{libelle}
                      <span className="visuellement-cache">{x.controles[k] ? ' : prêt' : ' : manquant'}</span></span>))}
                  </span>
                </Link>
              </li>))}</ul>
            : <p className="ac-vide">Aucune intervention prévue.</p>}
        </section>
      </>}
    </div>
  );
}
