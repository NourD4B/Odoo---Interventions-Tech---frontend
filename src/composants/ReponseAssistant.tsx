// Mise en forme d'une réponse de l'assistant. Les outils du serveur répondent en lignes simples : un titre (« Programme
// du lundi 16/11/2026 : »), des lignes « - libellé : valeur », des notes (« Absences : aucune. »), des blocs séparés
// par une ligne vide (plusieurs services). On en fait des cartes lisibles : titre, tableau libellé | valeur, noms en
// pastilles, nombres en badge, « prête » / « manque … » en couleur. Une phrase du modèle reste un paragraphe.

type Ligne = { libelle: string | null; valeur: string };
type Bloc = { titre: string | null; lignes: Ligne[]; notes: Ligne[] };

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

const NOMS = new Set(['Libres', 'Absents', 'Sur le terrain', 'Équipe']);
const muet = (v: string) => v === 'personne' || /^(aucun|rien)/.test(v);

/** Valeur mise en forme : noms en pastilles, « N — … » avec un badge, état prête / manque en couleur. */
function Valeur({ libelle, valeur }: Ligne) {
  if (muet(valeur)) return <em className="ra-muet">{valeur}</em>;
  if (libelle && NOMS.has(libelle) && !valeur.includes('(')) {
    return <span className="ra-noms">{valeur.split(', ').map((n) => <span key={n} className="ra-nom">{n}</span>)}</span>;
  }
  const compte = valeur.match(/^(\d+) — (.*)$/s);
  if (compte) {
    return <span className="ra-compte"><b className="ra-badge">{compte[1]}</b>
      <span className="ra-elements">{compte[2].split(' ; ').map((x, i) => <span key={i}>{x}</span>)}</span></span>;
  }
  if (valeur === 'prête') return <span className="ra-etat ok">prête</span>;
  if (valeur.startsWith('manque ')) {
    return <span className="ra-noms"><span className="ra-muet">manque</span>
      {valeur.slice(7).split(', ').map((m) => <span key={m} className="ra-etat manque">{m}</span>)}</span>;
  }
  // « Service (client, ville), détails » : le service en gras, le reste en dessous, plus discret
  const service = valeur.match(/^([^(]{3,}?) \(([^)]+)\)(?:, (.+))?$/s);
  if (service) {
    return <span className="ra-service"><b>{service[1]}</b>
      <small>{[service[2], service[3]].filter(Boolean).join(' · ')}</small></span>;
  }
  // plusieurs parties « a ; b » : une par ligne
  if (valeur.includes(' ; ')) return <span className="ra-elements">{valeur.split(' ; ').map((x, i) => <span key={i}>{x}</span>)}</span>;
  return <span>{valeur}</span>;
}

export default function ReponseAssistant({ texte }: { texte: string }) {
  const blocs = structurer(texte);
  if (!blocs) return <p className="as-bulle assistant">{texte}</p>;
  return (
    <div className="as-bulle assistant ra">
      {blocs.map((b, i) => (
        <section key={i} className="ra-bloc">
          {b.titre && <h3 className="ra-titre">{b.titre}</h3>}
          {b.lignes.length > 0 && (
            // libellés longs (« Échéance dépassée, pas encore publié ») : au-dessus de la valeur, pas à côté
            <dl className={`ra-table${b.lignes.some((l) => (l.libelle?.length ?? 0) > 18) ? ' empile' : ''}`}>
              {b.lignes.map((l, j) => (
                <div key={j} className={`ra-ligne${l.libelle ? '' : ' seule'}`}>
                  {l.libelle && <dt>{l.libelle}</dt>}
                  <dd><Valeur {...l} /></dd>
                </div>))}
            </dl>
          )}
          {b.notes.map((n, j) => (
            <p key={j} className="ra-note">{n.libelle ? <><b>{n.libelle}</b> {n.valeur}</> : n.valeur}</p>))}
        </section>
      ))}
    </div>
  );
}
