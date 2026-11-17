// Assistant de l'accueil, en conversation. Premier message : le brief du jour, écrit par le modèle de phrases (tout de
// suite), puis reformulé par le modèle choisi s'il y en a un (petit modèle local, Ollama, CPU seulement). Le serveur
// vérifie chaque réponse : un nombre absent des faits, une panne ou un délai dépassé, et le brief du modèle de phrases
// reste. Ensuite, des questions sur les faits du jour. Rien n'est enregistré ; seul le modèle choisi est retenu par
// ce navigateur.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { demanderBrief, lireModeles, poserQuestion, SANS_IA, type BriefModele, type Modeles, type Phrase } from '../accueil';

const CLE_MODELE = 'd4b.assistant.modele';
const SUGGESTIONS = ["Qui est libre aujourd'hui ?", 'Que manque-t-il pour demain ?', 'Quelles sont les urgences ?'];
const secondes = (ms: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(ms / 1000)} s`;

type Message = { id: number; qui: 'moi' | 'assistant'; texte: string | null; modele?: string; duree_ms?: number;
  repli?: boolean; raison?: string | null; enCours?: boolean };

function Etoile() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5z" />
      <path d="M19 15.5c.25 1.9 1.1 2.75 3 3-1.9.25-2.75 1.1-3 3-.25-1.9-1.1-2.75-3-3 1.9-.25 2.75-1.1 3-3z" /></svg>
  );
}
const Points = () => <span className="as-points" aria-hidden="true"><i /><i /><i /></span>;

export default function Assistant({ phrases, prenom, libelleAction, onAction }: {
  phrases: Phrase[]; prenom: string | null; libelleAction: (cle: string) => string; onAction: (cle: string) => void;
}) {
  const [modeles, setModeles] = useState<Modeles | null>(null);
  const [modele, setModele] = useState<string>(SANS_IA);
  const [brief, setBrief] = useState<{ enCours: boolean; donnees: BriefModele | null; erreur: string | null }>(
    { enCours: false, donnees: null, erreur: null });
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const fil = useRef<HTMLDivElement>(null);
  const suivant = useRef(1);

  // modèles proposés : celui retenu par ce navigateur s'il est encore installé, sinon le défaut du serveur
  useEffect(() => {
    lireModeles().then((m) => {
      setModeles(m);
      let retenu: string | null = null;
      try { retenu = localStorage.getItem(CLE_MODELE); } catch { /* stockage indisponible */ }
      setModele(retenu && m.modeles.some((x) => x.nom === retenu) ? retenu : m.defaut);
    }).catch(() => setModeles({ ollama: false, erreur: 'modèles illisibles', defaut: SANS_IA,
      modeles: [{ nom: SANS_IA, libelle: 'Sans IA (modèle de phrases)', taille: null }] }));
  }, []);

  // brief reformulé à chaque changement de modèle (ou sur demande)
  const [tour, setTour] = useState(0);
  useEffect(() => {
    if (!modeles || modele === SANS_IA) { setBrief({ enCours: false, donnees: null, erreur: null }); return; }
    const arret = new AbortController();
    setBrief({ enCours: true, donnees: null, erreur: null });
    demanderBrief(modele, arret.signal)
      .then((b) => setBrief({ enCours: false, donnees: b, erreur: null }))
      .catch((e: Error) => { if (!arret.signal.aborted) setBrief({ enCours: false, donnees: null, erreur: e.message }); });
    return () => arret.abort();
  }, [modele, modeles, tour]);

  useEffect(() => { fil.current?.scrollTo({ top: fil.current.scrollHeight, behavior: 'smooth' }); }, [messages]);

  const choisir = (nom: string) => {
    setModele(nom);
    try { localStorage.setItem(CLE_MODELE, nom); } catch { /* stockage indisponible */ }
  };
  const envoyer = async (texte: string) => {
    const q = texte.trim();
    if (!q || modele === SANS_IA) return;
    const idQ = suivant.current++, idR = suivant.current++;
    setQuestion('');
    setMessages((m) => [...m, { id: idQ, qui: 'moi', texte: q }, { id: idR, qui: 'assistant', texte: null, modele, enCours: true }]);
    try {
      const r = await poserQuestion(modele, q);
      setMessages((m) => m.map((x) => x.id === idR ? { ...x, enCours: false, texte: r.reponse, duree_ms: r.duree_ms,
        repli: r.repli, raison: r.raison } : x));
    } catch (e) {
      setMessages((m) => m.map((x) => x.id === idR ? { ...x, enCours: false, texte: null, repli: true,
        raison: e instanceof Error ? e.message : String(e) } : x));
    }
  };
  const soumettre = (e: FormEvent) => { e.preventDefault(); void envoyer(question); };

  const libelleModele = (nom: string) => modeles?.modeles.find((x) => x.nom === nom)?.libelle ?? nom;
  const avecIa = modele !== SANS_IA;
  const texteModele = brief.donnees && !brief.donnees.repli ? brief.donnees.texte : null;
  const actions = [...new Map(phrases.flatMap((p) => p.actions).map((a) => [a.categorie, a])).values()];

  return (
    <section className="as" aria-labelledby="as-titre">
      <header className="as-tete">
        <span className="as-etoile"><Etoile /></span>
        <h2 id="as-titre">Assistant</h2>
        <label className="as-modele">
          <span>Modèle</span>
          <select value={modele} onChange={(e) => choisir(e.target.value)} disabled={!modeles}>
            {(modeles?.modeles ?? [{ nom: SANS_IA, libelle: 'Sans IA (modèle de phrases)', taille: null }]).map((m) => (
              <option key={m.nom} value={m.nom}>{m.libelle}{m.taille ? ` · ${m.taille}` : ''}</option>))}
          </select>
        </label>
        {avecIa && !brief.enCours && <button type="button" className="as-reecrire" onClick={() => setTour((t) => t + 1)}>
          Réécrire</button>}
      </header>
      {modeles && !modeles.ollama && <p className="as-note">Aucun modèle local détecté (Ollama arrêté ou absent) : le brief
        vient du modèle de phrases, sans IA.</p>}

      <div className="as-fil" ref={fil} role="log" aria-live="polite" aria-label="Conversation avec l'assistant">
        {/* 1er message : le brief du jour */}
        <article className="as-msg assistant">
          <p className="as-bonjour">Bonjour{prenom ? ` ${prenom}` : ''}.</p>
          {texteModele
            ? <p className="as-texte">{texteModele}</p>
            : <ul className="as-phrases">{phrases.map((p) => (
              <li key={p.texte} className={`ton-${p.ton}`}>{p.texte}</li>))}</ul>}
          {actions.length > 0 && <span className="as-actions">{actions.map((a) => (
            <button key={a.categorie} type="button" onClick={() => onAction(a.categorie)}>{libelleAction(a.categorie)}</button>))}
          </span>}
          <p className="as-signature">
            {brief.enCours ? <><Points />{libelleModele(modele)} rédige le brief…</>
              : texteModele ? <>Rédigé par {libelleModele(modele)} en {secondes(brief.donnees!.duree_ms)} ; chaque nombre vérifié dans les faits.</>
              : brief.donnees?.repli ? <>{libelleModele(modele)} écarté ({brief.donnees.raison}) : brief du modèle de phrases.</>
              : brief.erreur ? <>{libelleModele(modele)} indisponible ({brief.erreur}) : brief du modèle de phrases.</>
              : <>Écrit par le modèle de phrases à partir de la planification et d'Odoo, sans IA.</>}
          </p>
        </article>

        {messages.map((m) => m.qui === 'moi'
          ? <article key={m.id} className="as-msg moi"><p>{m.texte}</p></article>
          : <article key={m.id} className="as-msg assistant">
              {m.enCours ? <p className="as-signature"><Points />{libelleModele(m.modele!)} cherche dans les faits du jour…</p>
                : m.texte ? <><p className="as-texte">{m.texte}</p>
                    <p className="as-signature">{libelleModele(m.modele!)}, {secondes(m.duree_ms ?? 0)} ; nombres vérifiés.</p></>
                : <p className="as-texte muet">Pas de réponse fiable : {m.raison}</p>}
            </article>)}
      </div>

      <form className="as-saisie" onSubmit={soumettre}>
        {avecIa && messages.length === 0 && <span className="as-suggestions">{SUGGESTIONS.map((s) => (
          <button key={s} type="button" onClick={() => void envoyer(s)}>{s}</button>))}</span>}
        <span className="as-champ">
          <label className="visuellement-cache" htmlFor="as-question">Question à l'assistant</label>
          <input id="as-question" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={500}
            disabled={!avecIa} placeholder={avecIa ? 'Posez une question sur la journée'
              : 'Choisissez un modèle pour poser une question'} />
          <button type="submit" disabled={!avecIa || !question.trim()} aria-label="Envoyer">
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3.5 10h12M11 5.5 15.5 10 11 14.5" /></svg>
          </button>
        </span>
      </form>
    </section>
  );
}
