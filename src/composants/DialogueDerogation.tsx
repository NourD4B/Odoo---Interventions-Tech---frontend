import { useState } from 'react';
import type { Violation } from '../planification';

const LIBELLES_REGLE: Record<string, string> = {
  disponibilite: 'Disponibilité', competences: 'Compétences', taille_equipe: "Taille d'équipe",
  vehicule_conforme: 'Véhicule', autonomie_electrique: 'Autonomie électrique',
};

/** Le choix enfreint des règles obligatoires : on les montre, et un motif est exigé pour déroger (journalisé). */
export default function DialogueDerogation({ violations, onConfirmer, onAnnuler }: {
  violations: Violation[]; onConfirmer: (motif: string) => void; onAnnuler: () => void;
}) {
  const [motif, setMotif] = useState('');
  const [tente, setTente] = useState(false);
  const valide = motif.trim().length >= 3;
  return (
    <div className="voile" role="dialog" aria-modal="true" aria-labelledby="titre-derogation">
      <form className="dialogue" onSubmit={(e) => {
        e.preventDefault(); setTente(true);
        if (valide) onConfirmer(motif.trim());
      }}>
        <h2 id="titre-derogation">Règles enfreintes</h2>
        <ul className="violations">
          {violations.map((v, i) => (
            <li key={i}><strong>{LIBELLES_REGLE[v.code] ?? v.code}</strong> — {v.message}</li>
          ))}
        </ul>
        <label className="champ">Motif de la dérogation (obligatoire, enregistré dans le journal)
          <textarea autoFocus rows={3} maxLength={500} value={motif} onChange={(e) => setMotif(e.target.value)}
            placeholder="Ex. : congé annulé par téléphone, client prévenu" aria-invalid={tente && !valide} />
          {tente && !valide && <span className="erreur-champ" role="alert">Indiquez un motif (3 caractères au moins).</span>}
        </label>
        <div className="actions">
          <button type="button" className="btn" onClick={onAnnuler}>Annuler</button>
          <button type="submit" className="btn btn-primaire">Déroger et enregistrer</button>
        </div>
      </form>
    </div>
  );
}
