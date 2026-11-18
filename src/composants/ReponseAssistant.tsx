// Mise en forme d'une réponse de l'assistant. Les outils du serveur répondent en lignes simples : un titre (« Programme
// du lundi 16/11/2026 : »), des lignes « - libellé : valeur », des notes (« Absences : aucune. »), des blocs séparés
// par une ligne vide (plusieurs services). On en fait une carte par sorte de réponse : en-tête (icône, titre, date),
// lignes avec icône, avatar ou pastille de jour, noms en pastilles, état en couleur. Une phrase du modèle reste un
// paragraphe. Icônes en SVG dans la page (formes Lucide, licence ISC) : ni police ni bibliothèque, reprises telles
// quelles dans le module Odoo (gabarits OWL), avec les mêmes classes « ra- ».
import type { ReactNode } from 'react';

type Ligne = { libelle: string | null; valeur: string };
type Bloc = { titre: string | null; lignes: Ligne[]; notes: Ligne[] };
type Genre = 'programme' | 'dispo' | 'traiter' | 'preparation' | 'semaine' | 'vehicule' | 'technicien' | 'service' | 'autre';

// ---------- icônes (traits, 24 × 24) ----------

const TRACES: Record<string, ReactNode> = {
  calendrier: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  planifie: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18m-12 6 2 2 4-4" /></>,
  equipe: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  alerte: <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4m0 4h.01" /></>,
  liste: <><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2m1 10 2 2 4-4" /></>,
  outil: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />,
  camion: <><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2m10 0H9m10 0h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14" /><circle cx="17" cy="18" r="2" /><circle cx="7" cy="18" r="2" /></>,
  personne: <><circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 0 0-16 0" /></>,
  commande: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8m8 4H8" /></>,
  etape: <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><path d="M4 22v-7" /></>,
  horloge: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  lieu: <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>,
  sablier: <path d="M5 22h14M5 2h14m-2 20v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2" />,
  colis: <><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5M12 22V12m-4.5-7.73 9 5.15" /></>,
  cloche: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
  libre: <><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>,
  absent: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="m17 8 5 5m0-5-5 5" /></>,
  terrain: <><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>,
  recherche: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
};
function Icone({ nom, taille = 16 }: { nom: string; taille?: number }) {
  return <svg className="ra-svg" viewBox="0 0 24 24" width={taille} height={taille} aria-hidden="true">{TRACES[nom] ?? TRACES.liste}</svg>;
}

const ICONE_GENRE: Record<Genre, string> = {
  programme: 'calendrier', dispo: 'equipe', traiter: 'alerte', preparation: 'liste', semaine: 'calendrier',
  vehicule: 'camion', technicien: 'personne', service: 'outil', autre: 'recherche' };
const ICONE_LIBELLE: Record<string, string> = {
  Commande: 'commande', 'Étape Odoo': 'etape', Planification: 'planifie', Équipe: 'equipe', 'Date prévue dans Odoo': 'calendrier',
  'Date limite': 'horloge', Site: 'lieu', 'Temps alloué': 'sablier', Matériel: 'colis', 'Activités Odoo': 'cloche',
  'Sur le terrain': 'terrain', Libres: 'libre', Absents: 'absent', Absences: 'absent' };
const URGENT = /^(Urgents|Échéance|Absence sur)/;
const ATTENTION = /^(Pas encore publié|Matériel|Site à placer|Activités)/;
const ETATS = ['à planifier', 'proposé', 'verrouillé', 'publié'];

// ---------- lecture du texte ----------

/** « libellé : valeur » sur le premier « : » entouré d'espaces (les heures 09:00 ne coupent pas). */
function couper(texte: string): Ligne {
  const i = texte.indexOf(' : ');
  return i > 0 && i < 100 ? { libelle: texte.slice(0, i).trim(), valeur: texte.slice(i + 3).trim() }
    : { libelle: null, valeur: texte.trim() };
}

export function structurer(texte: string): Bloc[] | null {
  const blocs = texte.split(/\n\s*\n/).map((b) => b.split('\n').filter((l) => l.trim()));
  if (!blocs.some((b) => b.some((l) => l.startsWith('- ')))) return null;        // prose : paragraphe simple
  return blocs.map((lignes) => {
    const bloc: Bloc = { titre: null, lignes: [], notes: [] };
    lignes.forEach((l, i) => {
      if (l.startsWith('- ')) bloc.lignes.push(couper(l.slice(2)));
      else if (i === 0) bloc.titre = l.replace(/\s*:\s*$/, '');
      else bloc.notes.push(couper(l));
    });
    return bloc;
  });
}

/** Sorte de réponse, titre court, sous-titre (date, période) et badge, d'après le titre de l'outil. */
function entete(b: Bloc): { genre: Genre; titre: string; sous?: string; badge?: string; marques?: string[] } {
  const t = b.titre ?? '';
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^Programme du (.+?)( \(jour non travaillé\))?$/))) return { genre: 'programme', titre: 'Programme', sous: m[1], badge: m[2] ? 'jour non travaillé' : undefined };
  if ((m = t.match(/^Disponibilités du (.+)$/))) return { genre: 'dispo', titre: 'Disponibilités', sous: m[1] };
  if ((m = t.match(/^À traiter \((.+)\)$/))) return { genre: 'traiter', titre: 'À traiter', sous: m[1] };
  if ((m = t.match(/^Préparation du (.+?) : (\d+) sur (\d+) prêtes?$/))) return { genre: 'preparation', titre: 'Préparation', sous: m[1], badge: `${m[2]}/${m[3]} prête${Number(m[2]) > 1 ? 's' : ''}` };
  if ((m = t.match(/^Semaine du (.+)$/))) return { genre: 'semaine', titre: 'Semaine', sous: m[1] };
  if ((m = t.match(/^Véhicule (.+?), du (.+)$/))) return { genre: 'vehicule', titre: `Véhicule ${m[1]}`, sous: `du ${m[2]}` };
  if ((m = t.match(/^(.+?)(?: \(agence (.+?)\))?, du (.+)$/))) return { genre: 'technicien', titre: m[1], sous: [m[2] && `agence ${m[2]}`, `du ${m[3]}`].filter(Boolean).join(' · ') };
  if (b.lignes.some((l) => l.libelle === 'Planification')) {
    const [nom, ...marques] = t.split(' — ');
    const n = nom.match(/^(.+?) \((.+)\)$/);
    return { genre: 'service', titre: n ? n[1] : nom, sous: n?.[2], marques };
  }
  return { genre: 'autre', titre: t };
}

// ---------- morceaux d'affichage ----------

const initiales = (nom: string) => nom.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
const muet = (v: string) => v === 'personne' || /^(aucun|rien)/.test(v);

function Etat({ texte }: { texte: string }) {
  const cle = texte.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_');
  return <span className={`ra-etat e-${cle}`}>{texte}</span>;
}

/** « Service (client, ville), détails, état » : service en gras, client et détails en dessous, état en pastille. */
function Service({ valeur }: { valeur: string }) {
  const m = valeur.match(/^([^(]{3,}?) \(([^)]+)\)(?:, (.+))?$/s);
  if (!m) return <span>{valeur}</span>;
  const details = (m[3] ?? '').split(', ').filter(Boolean);
  const etat = details.length && ETATS.includes(details[details.length - 1]) ? details.pop()! : null;
  return (
    <span className="ra-service">
      <span className="ra-service-tete"><b>{m[1]}</b>{etat && <Etat texte={etat} />}</span>
      <small>{[m[2], ...details].join(' · ')}</small>
    </span>
  );
}

function Noms({ valeur }: { valeur: string }) {
  return <span className="ra-noms">{valeur.split(', ').map((n) => <span key={n} className="ra-nom">{n}</span>)}</span>;
}

/** Valeur mise en forme selon son allure. */
function Valeur({ libelle, valeur }: Ligne) {
  if (muet(valeur)) return <em className="ra-muet">{valeur}</em>;
  if (libelle && ['Libres', 'Absents', 'Sur le terrain'].includes(libelle)) return <Noms valeur={valeur} />;
  const compte = valeur.match(/^(\d+) — (.*)$/s);
  if (compte) {
    return <span className="ra-compte"><b className="ra-badge">{compte[1]}</b>
      <span className="ra-elements">{compte[2].split(' ; ').map((x, i) => <span key={i}>{x}</span>)}</span></span>;
  }
  if (valeur === 'prête') return <span className="ra-etat e-pret">✓ prête</span>;
  if (valeur.startsWith('manque ')) {
    return <span className="ra-noms"><span className="ra-muet">manque</span>
      {valeur.slice(7).split(', ').map((m) => <span key={m} className="ra-etat e-manque">{m}</span>)}</span>;
  }
  if (libelle === 'Planification' && ETATS.includes(valeur)) return <Etat texte={valeur} />;
  // « Équipe : A, B, du 09/11/2026 au 10/11/2026, véhicule X (publié) » : noms, dates et véhicule, état
  const equipe = libelle === 'Équipe' ? valeur.match(/^(.+?), du (\S+) au (\S+), (.+) \((.+)\)$/) : null;
  if (equipe) {
    return <span className="ra-service"><Noms valeur={equipe[1]} />
      <span className="ra-service-tete"><small>du {equipe[2]} au {equipe[3]} · {equipe[4]}</small><Etat texte={equipe[5]} /></span></span>;
  }
  if (/\(dépassée\)$/.test(valeur)) return <span className="ra-retard">{valeur.replace(' (dépassée)', '')} <Etat texte="dépassée" /></span>;
  if (/^[^(]{3,}? \([^)]+\)/.test(valeur)) return <Service valeur={valeur} />;
  if (valeur.includes(' ; ')) return <span className="ra-elements">{valeur.split(' ; ').map((x, i) => <span key={i}>{x}</span>)}</span>;
  return <span>{valeur}</span>;
}

/** Début de ligne selon la sorte de réponse : avatar, pastille de jour, point de gravité, icône. */
function Repere({ genre, libelle }: { genre: Genre; libelle: string }) {
  if (genre === 'programme') return <span className="ra-avatar" aria-hidden="true">{initiales(libelle)}</span>;
  if (genre === 'semaine') {
    const [jour, date] = libelle.split(' ');
    return <span className="ra-jour" aria-hidden="true"><b>{jour.slice(0, 3)}</b>{date}</span>;
  }
  if (genre === 'traiter') return <span className={`ra-gravite gv-${URGENT.test(libelle) ? 'urgent' : ATTENTION.test(libelle) ? 'attention' : 'info'}`} aria-hidden="true" />;
  if (genre === 'preparation') return <span className="ra-icone-ligne" aria-hidden="true"><Icone nom="outil" taille={14} /></span>;
  const icone = ICONE_LIBELLE[libelle];
  return icone ? <span className="ra-icone-ligne" aria-hidden="true"><Icone nom={icone} taille={14} /></span> : null;
}

function Carte({ b }: { b: Bloc }) {
  const e = entete(b);
  return (
    <section className={`ra-carte g-${e.genre}`}>
      {b.titre && (
        <header className="ra-tete">
          <span className="ra-icone"><Icone nom={ICONE_GENRE[e.genre]} taille={18} /></span>
          <span className="ra-titres">
            <h3>{e.titre}</h3>
            {e.sous && <small>{e.sous}</small>}
          </span>
          {e.badge && <span className="ra-badge-tete">{e.badge}</span>}
          {e.marques?.map((x) => <Etat key={x} texte={x} />)}
        </header>
      )}
      {b.lignes.length > 0 && (
        <ul className="ra-lignes">
          {b.lignes.map((l, j) => (
            <li key={j} className="ra-ligne">
              {l.libelle && <Repere genre={e.genre} libelle={l.libelle} />}
              <div className="ra-corps">
                {l.libelle && e.genre !== 'semaine' && (
                  <span className="ra-libelle">{e.genre === 'preparation' ? <Service valeur={l.libelle} /> : l.libelle}</span>)}
                {l.libelle && e.genre === 'semaine' && <span className="visuellement-cache">{l.libelle}</span>}
                <span className="ra-valeur"><Valeur {...l} /></span>
              </div>
            </li>))}
        </ul>
      )}
      {b.notes.map((n, j) => (
        <p key={j} className="ra-note">
          {n.libelle && ICONE_LIBELLE[n.libelle] && <Icone nom={ICONE_LIBELLE[n.libelle]} taille={13} />}
          {n.libelle ? <><b>{n.libelle}</b> {n.valeur}</> : n.valeur}
        </p>))}
    </section>
  );
}

export default function ReponseAssistant({ texte }: { texte: string }) {
  const blocs = structurer(texte);
  if (!blocs) return <p className="as-bulle assistant">{texte}</p>;
  return <div className="as-bulle assistant ra">{blocs.map((b, i) => <Carte key={i} b={b} />)}</div>;
}
