import { useState } from 'react';
import { Badge, EtatChargement, useDonnees } from '../composants';
import { useEcriture } from '../composants/Ecriture';
import { ErreurPlanif, planif, type Regle } from '../planification';

type Niveau = Regle['niveau'];
/** Niveaux proposés selon la catégorie : une règle obligatoire s'impose ou s'ignore ; une préférence pèse ou s'ignore. */
const NIVEAUX: Record<Regle['categorie'], { valeur: Niveau; libelle: string }[]> = {
  obligatoire: [{ valeur: 'obligatoire', libelle: 'Obligatoire' }, { valeur: 'inactive', libelle: 'Inactive' }],
  preference: [{ valeur: 'preference', libelle: 'Active' }, { valeur: 'inactive', libelle: 'Inactive' }],
  parametre: [],
};
const SECTIONS: { categorie: Regle['categorie']; titre: string; aide: string }[] = [
  { categorie: 'obligatoire', titre: 'Règles obligatoires',
    aide: "Le solveur ne les enfreint jamais ; le dispatcher peut déroger avec un motif (journalisé). Inactive : ignorée partout." },
  { categorie: 'preference', titre: 'Préférences (score du solveur)',
    aide: "Plus le poids est fort, plus le solveur en tient compte face aux autres. Planifier reste prioritaire : son poids doit rester bien au-dessus des autres." },
  { categorie: 'parametre', titre: 'Paramètres de calcul',
    aide: "Valeurs utilisées pour le temps de trajet et le coût estimé (hors nuits d'hôtel et repas)." },
];

function nombre(v: string): number | null {
  const n = Number(v.replace(',', '.'));
  return v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
}

function LigneRegle({ r, enregistrer }: { r: Regle; enregistrer: (r: Regle, maj: Partial<Regle>) => Promise<boolean> }) {
  const [niveau, setNiveau] = useState<Niveau>(r.niveau === 'obligatoire' && r.categorie === 'preference' ? 'preference' : r.niveau);
  const [valeur, setValeur] = useState(r.valeur === null ? '' : String(r.valeur));
  const [poids, setPoids] = useState(String(r.poids));
  const [envoi, setEnvoi] = useState(false);
  const aValeur = r.valeur !== null;
  const aPoids = r.categorie === 'preference';
  const v = nombre(valeur), w = nombre(poids);
  const valide = (!aValeur || v !== null) && (!aPoids || w !== null);
  const modifie = niveau !== r.niveau || (aValeur && v !== r.valeur) || (aPoids && w !== r.poids);
  const unite = r.unite ? ` (${r.unite})` : '';

  return (
    <article className="ligne-regle">
      <div className="ligne-regle-titre">
        <strong>{r.libelle}</strong>
        <span className="muet">{r.code}</span>
        {r.statut === 'a_confirmer' ? <Badge type="a_confirmer">à confirmer par D4B</Badge> : <Badge type="concordant">validée</Badge>}
      </div>
      <div className="ligne-regle-champs">
        {NIVEAUX[r.categorie].length > 0 && (
          <div className="segmente" role="radiogroup" aria-label={`Niveau : ${r.libelle}`}>
            {NIVEAUX[r.categorie].map((n) => (
              <button key={n.valeur} type="button" role="radio" aria-checked={niveau === n.valeur}
                className={niveau === n.valeur ? 'actif' : ''} onClick={() => setNiveau(n.valeur)}>{n.libelle}</button>
            ))}
          </div>
        )}
        {aPoids && (
          <label className="champ">Poids
            <input inputMode="decimal" value={poids} onChange={(e) => setPoids(e.target.value)} aria-invalid={w === null}
              disabled={niveau === 'inactive'} />
          </label>
        )}
        {aValeur && (
          <label className="champ">Valeur{unite}
            <input inputMode="decimal" value={valeur} onChange={(e) => setValeur(e.target.value)} aria-invalid={v === null} />
          </label>
        )}
        <button type="button" className="btn btn-primaire" disabled={!modifie || !valide || envoi}
          onClick={async () => {
            setEnvoi(true);
            await enregistrer(r, { niveau, ...(aValeur && v !== null ? { valeur: v } : {}), ...(aPoids && w !== null ? { poids: w } : {}) });
            setEnvoi(false);
          }}>{envoi ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
    </article>
  );
}

export default function Reglages() {
  const regles = useDonnees(() => planif.regles(), []);
  const agences = useDonnees(() => planif.agences(), []);
  const [message, setMessage] = useState<{ type: 'erreur' | 'ok'; texte: string } | null>(null);
  const { ecrire, dialogue } = useEcriture();

  const enregistrer = async (r: Regle, maj: Partial<Regle>): Promise<boolean> => {
    setMessage(null);
    try {
      const n = await ecrire(() => planif.modifierRegle(r.code, maj));
      if (!n) return false;
      const details = [
        n.categorie !== 'parametre' ? (n.niveau === 'inactive' ? 'inactive' : n.niveau === 'obligatoire' ? 'obligatoire' : 'active') : null,
        n.categorie === 'preference' ? `poids ${n.poids}` : null,
        n.valeur !== null ? `${n.valeur}${n.unite ? ` ${n.unite}` : ''}` : null,
      ].filter(Boolean).join(', ');
      setMessage({ type: 'ok', texte: `« ${r.libelle} » : ${details} — journalisé.` });
      regles.recharger();
      return true;
    } catch (e) {
      setMessage({ type: 'erreur', texte: e instanceof ErreurPlanif ? e.message : String(e) });
      return false;
    }
  };

  return (
    <>
      <div className="entete">
        <div>
          <h1>Réglages de la planification</h1>
          <div className="sous-titre">Règles, préférences et paramètres du solveur, agences de départ · tout est à confirmer par D4B</div>
        </div>
      </div>
      {message && <div className={message.type === 'erreur' ? 'erreur' : 'succes'} role={message.type === 'erreur' ? 'alert' : 'status'}>{message.texte}</div>}
      <EtatChargement chargement={regles.chargement} erreur={regles.erreur} />

      {SECTIONS.map((section) => {
        const lignes = (regles.donnees ?? []).filter((r) => r.categorie === section.categorie);
        if (!lignes.length) return null;
        return (
          <section key={section.categorie} className="carte" aria-labelledby={`titre-${section.categorie}`}>
            <h2 id={`titre-${section.categorie}`}>{section.titre}</h2>
            <p className="muet">{section.aide}</p>
            <div className="liste-regles">
              {lignes.map((r) => <LigneRegle key={`${r.code}-${r.niveau}-${r.valeur}-${r.poids}`} r={r} enregistrer={enregistrer} />)}
            </div>
          </section>
        );
      })}

      <section className="carte" aria-labelledby="titre-agences">
        <h2 id="titre-agences">Agences (points de départ)</h2>
        <p className="muet">Source : backend/config/agences.json. Une agence « à confirmer » n'est pas utilisée par le solveur.</p>
        <EtatChargement chargement={agences.chargement} erreur={agences.erreur} />
        <div className="defilement">
          <table>
            <thead><tr><th>Agence</th><th>Adresse</th><th>Statut</th><th>Position</th><th>Société / entrepôt Odoo</th></tr></thead>
            <tbody>
              {agences.donnees?.map((a) => (
                <tr key={a.code}>
                  <td><strong>{a.nom}</strong><div className="muet">{a.code}</div></td>
                  <td>{a.adresse}</td>
                  <td>{a.statut === 'active' ? <Badge type="concordant">active</Badge> : <Badge type="a_confirmer">à confirmer</Badge>}</td>
                  <td>{a.lat !== null && a.lng !== null ? `${a.lat.toFixed(4)}, ${a.lng.toFixed(4)}`
                    : <span className="precision-faible">non géocodée</span>}</td>
                  <td className="muet">company {a.company_id ?? '—'} · entrepôt {a.warehouse_id ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {dialogue}
    </>
  );
}
