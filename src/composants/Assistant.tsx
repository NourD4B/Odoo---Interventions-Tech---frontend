// Assistant flottant, sur toutes les pages : un bouton rond en bas à droite ouvre la conversation dans un panneau.
// Une question libre : le petit modèle local (Ollama, CPU seulement) choisit un outil en lecture seule (programme,
// disponibilités, service, technicien, véhicule…), le serveur calcule, le modèle reformule et chaque nombre est
// vérifié (sinon le résultat du logiciel tel quel). Les suggestions appellent l'outil directement : réponse tout de
// suite, sans modèle. La conversation reste ouverte d'une page à l'autre ; rien n'est enregistré. Le modèle choisi est
// retenu par ce navigateur et sert aussi au brief du jour (contexte partagé).
import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { lireModeles, outilDirect, poserQuestion, SANS_IA, type Modeles } from '../accueil';
import { auteur } from '../planification';

const CLE_MODELE = 'd4b.assistant.modele';
// suggestions : chacune appelle son outil directement (sans modèle)
const SUGGESTIONS: { libelle: string; outil: string; arguments?: Record<string, string> }[] = [
  { libelle: 'Que faut-il traiter ?', outil: 'a_traiter' },
  { libelle: "Programme d'aujourd'hui", outil: 'programme' },
  { libelle: "Qui est libre aujourd'hui ?", outil: 'disponibilites' },
  { libelle: 'Que manque-t-il pour demain ?', outil: 'preparation', arguments: { date: 'demain' } },
  { libelle: 'Programme de la semaine', outil: 'semaine' },
];
const SANS_MODELE: Modeles = { ollama: false, erreur: 'modèles illisibles', defaut: SANS_IA,
  modeles: [{ nom: SANS_IA, libelle: 'Sans IA', taille: null }] };
const secondes = (ms: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(ms / 1000)} s`;

// ---------- modèle choisi, partagé entre le brief du jour et la conversation ----------

interface ModeleAssistant {
  modeles: Modeles | null; modele: string | null; choisir: (nom: string) => void; libelle: (nom: string) => string;
}
const Contexte = createContext<ModeleAssistant | null>(null);

/** Modèles proposés et modèle choisi (retenu par ce navigateur s'il est encore installé, sinon le défaut du serveur). */
export function ModeleAssistantProvider({ children }: { children: ReactNode }) {
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
  return <Contexte.Provider value={{ modeles, modele, choisir, libelle }}>{children}</Contexte.Provider>;
}

export function useModeleAssistant(): ModeleAssistant {
  const c = useContext(Contexte);
  if (!c) throw new Error('useModeleAssistant : ModeleAssistantProvider manquant');
  return c;
}

// ---------- conversation ----------

type Message = { id: number; qui: 'moi' | 'assistant'; texte: string | null; modele?: string; duree_ms?: number;
  raison?: string | null; enCours?: boolean; source?: 'modele' | 'logiciel' | null };

function Etoile({ taille = 22 }: { taille?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={taille} height={taille} aria-hidden="true">
      <path d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5z" />
      <path d="M19 15.5c.25 1.9 1.1 2.75 3 3-1.9.25-2.75 1.1-3 3-.25-1.9-1.1-2.75-3-3 1.9-.25 2.75-1.1 3-3z" /></svg>
  );
}
const Croix = () => <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" /></svg>;
const Points = () => <span className="as-points" aria-hidden="true"><i /><i /><i /></span>;

export default function Assistant() {
  const { modeles, modele, choisir, libelle } = useModeleAssistant();
  const [ouvert, setOuvert] = useState(false);
  const [nonLu, setNonLu] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const fil = useRef<HTMLDivElement>(null);
  const champ = useRef<HTMLInputElement>(null);
  const lanceur = useRef<HTMLButtonElement>(null);
  const ouvertRef = useRef(ouvert);
  ouvertRef.current = ouvert;
  const suivant = useRef(1);
  const avecIa = !!modele && modele !== SANS_IA;
  const attend = messages.some((m) => m.enCours);
  const prenom = auteur()?.trim().split(/\s+/)[0] ?? null;

  useEffect(() => {
    if (!ouvert) return;
    setNonLu(false);
    champ.current?.focus();
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') fermer(); };
    document.addEventListener('keydown', echap);
    return () => document.removeEventListener('keydown', echap);
  }, [ouvert]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fil.current?.scrollTo({ top: fil.current.scrollHeight, behavior: 'smooth' }); }, [messages, ouvert]);

  // fermé : le bouton revient et reprend le focus (sauf au premier affichage)
  const dejaOuvert = useRef(false);
  useEffect(() => {
    if (ouvert) dejaOuvert.current = true;
    else if (dejaOuvert.current) lanceur.current?.focus();
  }, [ouvert]);
  const fermer = () => setOuvert(false);
  /** Pose la question (bulle), attend la réponse (du modèle ou du logiciel) et la remplace dans la conversation. */
  const demander = async (q: string, reponse: () => Promise<Partial<Message>>, parModele: boolean) => {
    const idQ = suivant.current++, idR = suivant.current++;
    setMessages((m) => [...m, { id: idQ, qui: 'moi', texte: q },
      { id: idR, qui: 'assistant', texte: null, modele: parModele ? modele! : undefined, enCours: true }]);
    try {
      const r = await reponse();
      setMessages((m) => m.map((x) => x.id === idR ? { ...x, ...r, enCours: false } : x));
    } catch (e) {
      setMessages((m) => m.map((x) => x.id === idR ? { ...x, enCours: false, texte: null,
        raison: e instanceof Error ? e.message : String(e) } : x));
    }
    if (!ouvertRef.current) setNonLu(true);              // réponse arrivée panneau fermé : pastille sur le bouton
  };
  const envoyer = (texte: string) => {
    const q = texte.trim();
    if (!q || !avecIa || attend) return;
    setQuestion('');
    void demander(q, async () => {
      const r = await poserQuestion(modele!, q);
      return { texte: r.reponse, source: r.source, duree_ms: r.duree_ms, raison: r.raison };
    }, true);
  };
  const suggerer = (s: (typeof SUGGESTIONS)[number]) => {
    if (attend) return;
    void demander(s.libelle, async () => {
      const r = await outilDirect(s.outil, s.arguments);
      return { texte: r.reponse, source: 'logiciel', duree_ms: r.duree_ms, raison: null };
    }, false);
  };
  const soumettre = (e: FormEvent) => { e.preventDefault(); envoyer(question); };

  return (
    <div className="as-flottant">
      {ouvert && (
        <section className="as-panneau" id="as-panneau" role="dialog" aria-modal="false" aria-labelledby="as-titre">
          <header className="as-tete">
            <span className="as-avatar"><Etoile /></span>
            <div className="as-titres">
              <h2 id="as-titre">Assistant D4B</h2>
              <label className="as-modele">
                <span className="visuellement-cache">Modèle</span>
                <select value={modele ?? SANS_IA} onChange={(e) => choisir(e.target.value)} disabled={!modeles}>
                  {(modeles ?? SANS_MODELE).modeles.map((m) => (
                    <option key={m.nom} value={m.nom}>{m.libelle}{m.taille ? ` · ${m.taille}` : ''}</option>))}
                </select>
              </label>
            </div>
            <button type="button" className="as-fermer" onClick={fermer} aria-label="Fermer l'assistant"><Croix /></button>
          </header>
          {modeles && !modeles.ollama && <p className="as-note">Aucun modèle local détecté (Ollama arrêté ou absent).</p>}

          <div className="as-fil" ref={fil} role="log" aria-live="polite" aria-label="Conversation avec l'assistant">
            <p className="as-bulle assistant">{`Bonjour${prenom ? ` ${prenom}` : ''}, `}{avecIa
              ? 'que voulez-vous savoir sur la planification ?'
              : 'choisissez une suggestion, ou un modèle en haut pour poser vos propres questions.'}</p>
            {messages.map((m) => m.qui === 'moi'
              ? <p key={m.id} className="as-bulle moi">{m.texte}</p>
              : <div key={m.id} className="as-reponse">
                  {m.enCours ? <p className="as-bulle assistant attente"><Points />
                      <span>{m.modele ? `${libelle(m.modele)} cherche dans la planification…` : 'Calcul en cours…'}</span></p>
                    : m.texte ? <><p className="as-bulle assistant">{m.texte}</p>
                        <p className="as-signature">{m.source === 'modele'
                          ? `${libelle(m.modele!)}, ${secondes(m.duree_ms ?? 0)} ; nombres vérifiés`
                          : `Calculé par le logiciel, ${secondes(m.duree_ms ?? 0)}${m.raison ? ` (réponse du modèle écartée : ${m.raison})` : ''}`}</p></>
                    : <p className="as-bulle assistant muet">Pas de réponse fiable : {m.raison}</p>}
                </div>)}
          </div>

          <form className="as-saisie" onSubmit={soumettre}>
            <span className="as-suggestions" aria-label="Suggestions de questions">{SUGGESTIONS.map((s) => (
              <button key={s.libelle} type="button" onClick={() => suggerer(s)} disabled={attend}>{s.libelle}</button>))}</span>
            <span className="as-champ">
              <label className="visuellement-cache" htmlFor="as-question">Question à l'assistant</label>
              <input id="as-question" ref={champ} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={500}
                disabled={!avecIa} placeholder={avecIa ? 'Écrivez votre question…' : 'Choisissez un modèle'} />
              <button type="submit" disabled={!avecIa || !question.trim() || attend} aria-label="Envoyer">
                <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 15.5v-11M5.5 9 10 4.5 14.5 9" /></svg>
              </button>
            </span>
          </form>
        </section>
      )}
      {/* bouton rond : caché panneau ouvert (le panneau a sa croix), comme une bulle de discussion */}
      {!ouvert && <button type="button" ref={lanceur} className="as-lanceur" aria-expanded={false} aria-controls="as-panneau"
        aria-label={nonLu ? "Ouvrir l'assistant (nouvelle réponse)" : "Ouvrir l'assistant"} title="Assistant"
        onClick={() => setOuvert(true)}>
        <Etoile taille={26} />
        {nonLu && <span className="as-pastille" aria-hidden="true" />}
      </button>}
    </div>
  );
}
