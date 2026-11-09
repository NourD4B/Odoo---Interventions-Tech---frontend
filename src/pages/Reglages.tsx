import { useState } from 'react';
import { Badge, EtatChargement, useDonnees } from '../composants';
import { useEcriture } from '../composants/Ecriture';
import { ErreurPlanif, planif, type Regle } from '../planification';

const NIVEAUX: { valeur: Regle['niveau']; libelle: string }[] = [
  { valeur: 'obligatoire', libelle: 'Obligatoire' }, { valeur: 'preference', libelle: 'Préférence' },
  { valeur: 'inactive', libelle: 'Inactive' },
];
/** Unité de la valeur, pour les règles qui en ont une. */
const UNITES: Record<string, string> = { autonomie_electrique: 'km', jour_heures: 'h / jour' };

function LigneRegle({ r, enregistrer }: { r: Regle; enregistrer: (r: Regle, maj: Partial<Regle>) => Promise<boolean> }) {
  const [niveau, setNiveau] = useState(r.niveau);
  const [valeur, setValeur] = useState(r.valeur === null ? '' : String(r.valeur));
  const [envoi, setEnvoi] = useState(false);
  const modifie = niveau !== r.niveau || (r.valeur !== null && Number(valeur) !== r.valeur);
  const valeurValide = r.valeur === null || (valeur !== '' && Number(valeur) > 0);
  return (
    <article className="ligne-regle">
      <div className="ligne-regle-titre">
        <strong>{r.libelle}</strong>
        <span className="muet">{r.code}</span>
        {r.statut === 'a_confirmer' ? <Badge type="a_confirmer">à confirmer par D4B</Badge> : <Badge type="concordant">validée</Badge>}
      </div>
      <div className="ligne-regle-champs">
        <div className="segmente" role="radiogroup" aria-label={`Niveau : ${r.libelle}`}>
          {NIVEAUX.map((n) => (
            <button key={n.valeur} type="button" role="radio" aria-checked={niveau === n.valeur}
              className={niveau === n.valeur ? 'actif' : ''} onClick={() => setNiveau(n.valeur)}>{n.libelle}</button>
          ))}
        </div>
        {r.valeur !== null && (
          <label className="champ">Valeur{UNITES[r.code] ? ` (${UNITES[r.code]})` : ''}
            <input type="number" min={1} value={valeur} onChange={(e) => setValeur(e.target.value)} aria-invalid={!valeurValide} />
          </label>
        )}
        <button type="button" className="btn btn-primaire" disabled={!modifie || !valeurValide || envoi}
          onClick={async () => {
            setEnvoi(true);
            await enregistrer(r, { niveau, ...(r.valeur !== null ? { valeur: Number(valeur) } : {}) });
            setEnvoi(false);
          }}>{envoi ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
      {niveau === 'preference' && (
        <p className="muet">Les préférences pondérées seront prises en compte avec l'optimisation (tâche 3) ;
          d'ici là, une préférence n'est pas imposée au solveur.</p>
      )}
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
      const nouvelle = await ecrire(() => planif.modifierRegle(r.code, maj));
      if (!nouvelle) return false;
      setMessage({ type: 'ok', texte: `« ${r.libelle} » : ${NIVEAUX.find((n) => n.valeur === nouvelle.niveau)?.libelle}` +
        (nouvelle.valeur !== null ? `, ${nouvelle.valeur}${UNITES[r.code] ? ` ${UNITES[r.code]}` : ''}` : '') + ' — journalisé.' });
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
          <div className="sous-titre">Règles du solveur et agences de départ · toutes les règles sont à confirmer par D4B</div>
        </div>
      </div>
      {message && <div className={message.type === 'erreur' ? 'erreur' : 'succes'} role={message.type === 'erreur' ? 'alert' : 'status'}>{message.texte}</div>}

      <section className="carte" aria-labelledby="titre-regles">
        <h2 id="titre-regles">Règles</h2>
        <p className="muet">Obligatoire : le solveur ne l'enfreint jamais ; le dispatcher peut déroger avec un motif.
          Inactive : ignorée partout.</p>
        <EtatChargement chargement={regles.chargement} erreur={regles.erreur} />
        <div className="liste-regles">
          {regles.donnees?.map((r) => <LigneRegle key={`${r.code}-${r.niveau}-${r.valeur}`} r={r} enregistrer={enregistrer} />)}
        </div>
      </section>

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
