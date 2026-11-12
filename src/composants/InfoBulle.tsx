// Petite carte de détail d'un service, affichée au survol (ou au focus clavier) d'une barre ou d'une case de la
// planification. Placée en dessous ou au-dessus, à gauche ou à droite, pour rester dans la grille.
// Le parent porte la classe « a-ib » (position relative) : la carte s'affiche à son survol.
export type PlaceInfoBulle = { verticale: 'haut' | 'bas'; cote: 'gauche' | 'droite' };

const LIBELLES_ETAT: Record<string, string> = {
  a_planifier: 'À planifier', propose: 'Proposé', verrouille: 'Verrouillé', publie: 'Publié', brouillon: 'En cours',
};

export function InfoBulle({ titre, sousTitre, etat, urgent = false, lignes, alertes = [], place }: {
  titre: string; sousTitre?: string | null; etat?: string | null; urgent?: boolean;
  lignes: [string, string][]; alertes?: string[]; place: PlaceInfoBulle;
}) {
  return (
    <div className={`ib ib-${place.verticale} ib-${place.cote}`} role="tooltip">
      <div className="ib-tete">
        <strong>{titre}</strong>
        {etat && <span className={`ib-etat etat-${etat}`}>{LIBELLES_ETAT[etat] ?? etat}{urgent ? ', urgent' : ''}</span>}
      </div>
      {sousTitre && <span className="ib-sous">{sousTitre}</span>}
      {lignes.length > 0 && (
        <dl>{lignes.map(([libelle, valeur]) => <div key={libelle}><dt>{libelle}</dt><dd>{valeur}</dd></div>)}</dl>
      )}
      {alertes.map((a) => <p key={a} className="ib-alerte">{a}</p>)}
    </div>
  );
}

/** Place la carte : au-dessus pour les dernières lignes, à droite pour les dernières colonnes. */
export function placeInfoBulle(ligne: number, lignes: number, colonne: number, colonnes: number): PlaceInfoBulle {
  return { verticale: lignes > 4 && ligne >= lignes - 3 ? 'haut' : 'bas', cote: colonne >= colonnes / 2 ? 'droite' : 'gauche' };
}
