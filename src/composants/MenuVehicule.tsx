import { useEffect, useState } from 'react';
import { planif, type ChoixVehicule } from '../planification';

const VISIBLES = 4;

/** Véhicules pour une équipe et des dates : conformes d'abord (avec la raison), les premiers seulement ;
 *  non conformes repliés, sélectionnables quand même (dérogation : enregistrée avec un avertissement, motif facultatif). */
export default function MenuVehicule({ serviceId, matricules, debut, fin, actuel, onChoisir }: {
  serviceId: number; matricules: string[]; debut: string; fin: string; actuel: number | null;
  onChoisir: (v: ChoixVehicule | null) => void;
}) {
  const [choix, setChoix] = useState<ChoixVehicule[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [tout, setTout] = useState(false);
  const [nonConformes, setNonConformes] = useState(false);
  const cle = matricules.join(',');

  useEffect(() => {
    if (!cle || !debut) { setChoix([]); return; }
    let actif = true;
    setChoix(null);
    planif.vehicules(serviceId, { matricules: cle, debut, fin })
      .then((r) => { if (actif) { setChoix(r); setErreur(null); } })
      .catch((e: Error) => { if (actif) setErreur(e.message); });
    return () => { actif = false; };
  }, [serviceId, cle, debut, fin]);

  if (!cle) return <div className="vide">Choisissez d'abord l'équipe.</div>;
  if (erreur) return <div className="erreur">{erreur}</div>;
  if (!choix) return <div className="vide">Recherche des véhicules…</div>;

  const conformes = choix.filter((v) => v.conforme);
  const autres = choix.filter((v) => !v.conforme);
  const visibles = tout ? conformes : conformes.filter((v, i) => i < VISIBLES || v.vehicle_id === actuel);
  const autresVisibles = nonConformes ? autres : autres.filter((v) => v.vehicle_id === actuel);
  const ligne = (v: ChoixVehicule) => (
    <label key={v.vehicle_id} className={`choix-vehicule${v.conforme ? '' : ' non-conforme'}${actuel === v.vehicle_id ? ' choisi' : ''}`}>
      <input type="radio" name="vehicule" checked={actuel === v.vehicle_id} onChange={() => onChoisir(v)} />
      <span>
        <strong>{v.plaque}</strong> <span className="muet">{v.libelle.split('/').slice(0, 2).join(' ')}</span>
        <span className="muet raison">{v.conforme ? v.raison : v.violations.map((x) => x.message).join(' · ')}</span>
      </span>
    </label>
  );
  return (
    <div className="menu-vehicule" role="radiogroup" aria-label="Véhicule">
      {!conformes.length && <div className="avertissement">Aucun véhicule conforme pour cette équipe et ces dates.</div>}
      {visibles.map(ligne)}
      {conformes.length > visibles.length && (
        <button type="button" className="lien-bouton" onClick={() => setTout(true)}>
          Voir les {conformes.length - visibles.length} autres véhicules conformes</button>
      )}
      <label className={`choix-vehicule${actuel === null ? ' choisi' : ''}`}>
        <input type="radio" name="vehicule" checked={actuel === null} onChange={() => onChoisir(null)} />
        <span><strong>Sans véhicule</strong></span>
      </label>
      {autresVisibles.map(ligne)}
      {autres.length > autresVisibles.length && (
        <button type="button" className="lien-bouton" onClick={() => setNonConformes(true)}>
          Afficher les {autres.length - autresVisibles.length} véhicules non conformes (dérogation)</button>
      )}
    </div>
  );
}
