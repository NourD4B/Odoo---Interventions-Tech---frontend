import { useState } from 'react';
import { EtatChargement, useDonnees } from '../composants';
import { planif, type EntreeJournal } from '../planification';

const ACTIONS: Record<string, string> = {
  creer: 'Création', modifier: 'Modification', supprimer: 'Suppression', proposer: 'Proposition du solveur',
  affecter: 'Affectation', publier: 'Publication', regle: 'Règle modifiée',
};
const OBJETS: Record<string, string> = { service: 'Service', periode: 'Période', regle: 'Règle' };

function quand(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`;
}

function valeur(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.map(valeur).join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Avant -> après, champ par champ (seulement ce qui a changé) ; à défaut, le contenu de « après ». */
function Details({ e }: { e: EntreeJournal }) {
  const avant = e.avant ?? {};
  const apres = e.apres ?? {};
  const cles = [...new Set([...Object.keys(avant), ...Object.keys(apres)])]
    .filter((k) => !['version', 'categorie', 'unite'].includes(k) && JSON.stringify(avant[k]) !== JSON.stringify(apres[k]));
  if (!cles.length) return <span className="muet">—</span>;
  return (
    <ul className="details-journal">
      {cles.map((k) => (
        <li key={k}><span className="muet">{k} :</span>{' '}
          {k in avant && e.avant ? <><del>{valeur(avant[k])}</del> → </> : null}{valeur(apres[k])}</li>
      ))}
    </ul>
  );
}

export default function Journal() {
  const [objetType, setObjetType] = useState('');
  const [objetId, setObjetId] = useState('');
  const [limite, setLimite] = useState(200);
  const journal = useDonnees(() => planif.journal({ objet_type: objetType || undefined, objet_id: objetId.trim() || undefined, limite }),
    [objetType, objetId, limite]);
  const lignes = journal.donnees ?? [];

  return (
    <>
      <div className="entete">
        <div>
          <h1>Journal de la planification</h1>
          <div className="sous-titre">Qui a fait quoi, quand, et pourquoi (motif des dérogations) · le plus récent d'abord</div>
        </div>
        <button type="button" className="btn" onClick={journal.recharger}>Actualiser</button>
      </div>

      <div className="filtres">
        <label className="champ">Objet
          <select value={objetType} onChange={(e) => setObjetType(e.target.value)}>
            <option value="">Tous</option>
            {Object.entries(OBJETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="champ">N° de service / code de règle
          <input value={objetId} onChange={(e) => setObjetId(e.target.value)} placeholder="ex. 12 ou competences" />
        </label>
        <label className="champ">Nombre de lignes
          <select value={limite} onChange={(e) => setLimite(Number(e.target.value))}>
            {[50, 200, 1000].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      <EtatChargement chargement={journal.chargement} erreur={journal.erreur} />
      <section className="carte defilement" style={{ padding: 0 }} aria-label="Journal">
        <table className="table-journal">
          <thead><tr><th>Quand</th><th>Qui</th><th>Action</th><th>Objet</th><th>Changement</th><th>Motif</th></tr></thead>
          <tbody>
            {lignes.map((e) => (
              <tr key={e.id}>
                <td className="nowrap">{quand(e.horodatage)}</td>
                <td>{e.auteur}</td>
                <td>{ACTIONS[e.action] ?? e.action}</td>
                <td className="nowrap">{OBJETS[e.objet_type] ?? e.objet_type} {e.objet_id ?? ''}</td>
                <td><Details e={e} /></td>
                <td>{e.motif ? <span className="motif">{e.motif}</span> : <span className="muet">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!journal.chargement && !lignes.length && <div className="vide" style={{ padding: 16 }}>Aucune entrée.</div>}
      </section>
    </>
  );
}
