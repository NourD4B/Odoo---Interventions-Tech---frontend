import { useEffect, useState } from 'react';
import { planif, type ChoixVehicule } from '../planification';

/** Véhicules pour une équipe et des dates : conformes d'abord (avec la raison), non conformes grisés mais
 *  sélectionnables — l'enregistrement passera alors par la dérogation. */
export default function MenuVehicule({ serviceId, matricules, debut, fin, actuel, onChoisir }: {
  serviceId: number; matricules: string[]; debut: string; fin: string; actuel: number | null;
  onChoisir: (v: ChoixVehicule | null) => void;
}) {
  const [choix, setChoix] = useState<ChoixVehicule[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
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

  if (erreur) return <div className="erreur">{erreur}</div>;
  if (!choix) return <div className="vide">Recherche des véhicules…</div>;
  if (!cle) return <div className="vide">Choisissez d'abord l'équipe.</div>;
  return (
    <div className="menu-vehicule" role="radiogroup" aria-label="Véhicule">
      <label className={`choix-vehicule${actuel === null ? ' choisi' : ''}`}>
        <input type="radio" name="vehicule" checked={actuel === null} onChange={() => onChoisir(null)} />
        <span><strong>Sans véhicule</strong></span>
      </label>
      {choix.map((v) => (
        <label key={v.vehicle_id} className={`choix-vehicule${v.conforme ? '' : ' non-conforme'}${actuel === v.vehicle_id ? ' choisi' : ''}`}>
          <input type="radio" name="vehicule" checked={actuel === v.vehicle_id} onChange={() => onChoisir(v)} />
          <span>
            <strong>{v.plaque}</strong> <span className="muet">{v.libelle.split('/').slice(0, 2).join(' ')}</span>
            <span className="muet raison">{v.conforme ? v.raison : v.violations.map((x) => x.message).join(' · ')}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
