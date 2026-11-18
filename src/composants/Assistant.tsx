// Assistant de l'accueil : la conversation seulement (le brief du jour est sur la page, `BriefDuJour`). Questions sur
// les faits du jour, réponses d'un petit modèle local (Ollama, CPU seulement) ; le serveur vérifie chaque réponse (un
// nombre absent des faits l'écarte). Suggestions de questions toujours visibles. Rien n'est enregistré ; seul le
// modèle choisi est retenu par ce navigateur, et sert aussi au brief.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { lireModeles, poserQuestion, SANS_IA, type Modeles } from '../accueil';

const CLE_MODELE = 'd4b.assistant.modele';
const SUGGESTIONS = ["Qui est libre aujourd'hui ?", "Qui est absent aujourd'hui ?", 'Quelles sont les urgences ?',
  'Que manque-t-il pour demain ?', "Qui est sur le terrain aujourd'hui ?"];
const SANS_MODELE: Modeles = { ollama: false, erreur: 'modèles illisibles', defaut: SANS_IA,
  modeles: [{ nom: SANS_IA, libelle: 'Sans IA (modèle de phrases)', taille: null }] };
const secondes = (ms: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(ms / 1000)} s`;

/** Modèles proposés et modèle choisi (retenu par ce navigateur s'il est encore installé, sinon le défaut du serveur). */
export function useModeleAssistant() {
  const [modeles, setModeles] = useState<Modeles | null>(null);
  const [modele, setModele] = useState<string | null>(null);
  useEffect(() => {
    lireModeles().then((m) => {
      setModeles(m);
      let retenu: string | null = null;
      try { retenu = localStorage.getItem(CLE_MODELE); } catch { /* stockage indisponible */ }
      setModele(retenu && m.modeles.some((x) => x.nom === retenu) ? retenu : m.defaut);
    }).catch(() => { setModeles(SANS_MODELE); setModele(SANS_IA); });
  }, []);
  const choisir = (nom: string) => {
    setModele(nom);
    try { localStorage.setItem(CLE_MODELE, nom); } catch { /* stockage indisponible */ }
  };
  const libelle = (nom: string) => modeles?.modeles.find((x) => x.nom === nom)?.libelle ?? nom;
  return { modeles, modele, choisir, libelle };
}

type Message = { id: number; qui: 'moi' | 'assistant'; texte: string | null; modele?: string; duree_ms?: number;
  raison?: string | null; enCours?: boolean };

function Etoile() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5z" />
      <path d="M19 15.5c.25 1.9 1.1 2.75 3 3-1.9.25-2.75 1.1-3 3-.25-1.9-1.1-2.75-3-3 1.9-.25 2.75-1.1 3-3z" /></svg>
  );
}
const Points = () => <span className="as-points" aria-hidden="true"><i /><i /><i /></span>;

export default function Assistant({ modeles, modele, onModele, libelleModele }: {
  modeles: Modeles | null; modele: string | null; onModele: (nom: string) => void; libelleModele: (nom: string) => string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const fil = useRef<HTMLDivElement>(null);
  const suivant = useRef(1);
  const avecIa = !!modele && modele !== SANS_IA;
  const attend = messages.some((m) => m.enCours);

  useEffect(() => { fil.current?.scrollTo({ top: fil.current.scrollHeight, behavior: 'smooth' }); }, [messages]);

  const envoyer = async (texte: string) => {
    const q = texte.trim();
    if (!q || !avecIa || attend) return;
    const idQ = suivant.current++, idR = suivant.current++;
    setQuestion('');
    setMessages((m) => [...m, { id: idQ, qui: 'moi', texte: q }, { id: idR, qui: 'assistant', texte: null, modele: modele!, enCours: true }]);
    try {
      const r = await poserQuestion(modele!, q);
      setMessages((m) => m.map((x) => x.id === idR ? { ...x, enCours: false, texte: r.repli ? null : r.reponse,
        duree_ms: r.duree_ms, raison: r.raison } : x));
    } catch (e) {
      setMessages((m) => m.map((x) => x.id === idR ? { ...x, enCours: false, texte: null,
        raison: e instanceof Error ? e.message : String(e) } : x));
    }
  };
  const soumettre = (e: FormEvent) => { e.preventDefault(); void envoyer(question); };

  return (
    <section className="as" aria-labelledby="as-titre">
      <header className="as-tete">
        <span className="as-etoile"><Etoile /></span>
        <h2 id="as-titre">Assistant</h2>
        <label className="as-modele">
          <span>Modèle</span>
          <select value={modele ?? SANS_IA} onChange={(e) => onModele(e.target.value)} disabled={!modeles}>
            {(modeles ?? SANS_MODELE).modeles.map((m) => (
              <option key={m.nom} value={m.nom}>{m.libelle}{m.taille ? ` · ${m.taille}` : ''}</option>))}
          </select>
        </label>
      </header>
      {modeles && !modeles.ollama && <p className="as-note">Aucun modèle local détecté (Ollama arrêté ou absent) :
        choisissez un modèle une fois Ollama démarré.</p>}

      <div className="as-fil" ref={fil} role="log" aria-live="polite" aria-label="Conversation avec l'assistant">
        {messages.length === 0
          ? <p className="as-vide">{avecIa
              ? 'Posez une question sur la journée : qui est libre, ce qui manque pour demain, les urgences. Les réponses viennent des faits du jour, chaque nombre est vérifié.'
              : 'Choisissez un modèle pour poser des questions sur la journée.'}</p>
          : messages.map((m) => m.qui === 'moi'
            ? <article key={m.id} className="as-msg moi"><p>{m.texte}</p></article>
            : <article key={m.id} className="as-msg assistant">
                {m.enCours ? <p className="as-signature"><Points />{libelleModele(m.modele!)} cherche dans les faits du jour…</p>
                  : m.texte ? <><p className="as-texte">{m.texte}</p>
                      <p className="as-signature">{libelleModele(m.modele!)}, {secondes(m.duree_ms ?? 0)} ; nombres vérifiés.</p></>
                  : <p className="as-texte muet">Pas de réponse fiable : {m.raison}</p>}
              </article>)}
      </div>

      <form className="as-saisie" onSubmit={soumettre}>
        {avecIa && <span className="as-suggestions" aria-label="Suggestions de questions">{SUGGESTIONS.map((s) => (
          <button key={s} type="button" onClick={() => void envoyer(s)} disabled={attend}>{s}</button>))}</span>}
        <span className="as-champ">
          <label className="visuellement-cache" htmlFor="as-question">Question à l'assistant</label>
          <input id="as-question" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={500}
            disabled={!avecIa} placeholder={avecIa ? 'Posez une question sur la journée'
              : 'Choisissez un modèle pour poser une question'} />
          <button type="submit" disabled={!avecIa || !question.trim() || attend} aria-label="Envoyer">
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3.5 10h12M11 5.5 15.5 10 11 14.5" /></svg>
          </button>
        </span>
      </form>
    </section>
  );
}
