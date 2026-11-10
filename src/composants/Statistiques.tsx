// Briques des écrans de statistiques : état d'un service, barres, jauge, graphique par jour.
// Couleurs des séries (palette de référence validée : bleu, orange ; contrôles CVD réussis) dans styles.css.
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { euros, heures, jourCourt, LIBELLES_ETAT, nombre, type EtatService, type LigneService } from '../statistiques';

export function BadgeEtat({ etat }: { etat: EtatService }) {
  return <span className={`badge etat-${etat}`}>{LIBELLES_ETAT[etat]}</span>;
}

export function BadgeSimule({ simule }: { simule: boolean }) {
  return simule ? <span className="badge b-simulation" title="Service simulé : n'existe pas dans Odoo">simulé</span> : null;
}

/** Barre horizontale d'une seule série (proportion d'un maximum), valeur écrite à côté. */
export function Barre({ valeur, max, texte, titre, serie = 1 }: { valeur: number; max: number; texte: string; titre?: string;
  serie?: 1 | 2 }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (100 * valeur) / max)) : 0;
  return (
    <div className="barre" title={titre ?? texte}>
      <div className="barre-piste"><div className={`barre-remplie${serie === 2 ? ' serie-2' : ''}`} style={{ width: `${pct}%` }} /></div>
      <span className="barre-texte">{texte}</span>
    </div>
  );
}

/** Jauge 0–100 % (avancement, livré, charge). */
export function Jauge({ pct, texte }: { pct: number | null; texte?: string }) {
  if (pct === null) return <span className="muet">—</span>;
  return <Barre valeur={pct} max={100} texte={texte ?? `${nombre(pct)} %`} />;
}

export function Tuile({ libelle, valeur, detail, ton }: { libelle: string; valeur: ReactNode; detail?: ReactNode;
  ton?: 'alerte' | 'estime' }) {
  return (
    <div className={`kpi${ton ? ` kpi-${ton}` : ''}`}>
      <span>{libelle}</span>
      <strong>{valeur}</strong>
      {detail && <div className="muet">{detail}</div>}
    </div>
  );
}

/** Services planifiés et faits par jour : barres groupées (2 séries), légende, valeurs, infobulle au survol. */
export function GraphiqueJours({ jours }: { jours: { date: string; planifies: number; faits: number; techniciens: number }[] }) {
  const [survol, setSurvol] = useState<number | null>(null);
  const max = Math.max(1, ...jours.map((j) => Math.max(j.planifies, j.faits)));
  const H = 160, BAS = 24, HAUT = 16, LARGE = 64, BARRE = 18, ECART = 2;
  const largeur = jours.length * LARGE;
  const y = (v: number) => HAUT + (H - HAUT - BAS) * (1 - v / max);
  const graduations = Array.from(new Set([0, Math.ceil(max / 2), max]));
  const barre = (x: number, v: number, classe: string) => {
    if (v <= 0) return null;
    const haut = y(v), bas = H - BAS, r = Math.min(4, (bas - haut) / 2);
    return <path className={classe} d={`M${x},${bas} V${haut + r} Q${x},${haut} ${x + r},${haut} H${x + BARRE - r}
      Q${x + BARRE},${haut} ${x + BARRE},${haut + r} V${bas} Z`} />;
  };
  return (
    <figure className="graphique">
      <div className="legende-graphique" aria-hidden="true">
        <span><i className="serie-1" />Planifiés</span><span><i className="serie-2" />Faits</span>
      </div>
      <div className="defilement">
        <svg viewBox={`-28 0 ${largeur + 28} ${H}`} width={largeur + 28} height={H} role="img"
             aria-label="Services planifiés et faits par jour">
          {graduations.map((g) => (
            <g key={g}><line className="grille" x1={0} x2={largeur} y1={y(g)} y2={y(g)} />
              <text className="axe" x={-8} y={y(g) + 4} textAnchor="end">{g}</text></g>
          ))}
          {jours.map((j, i) => {
            const x0 = i * LARGE + (LARGE - 2 * BARRE - ECART) / 2;
            return (
              <g key={j.date} onMouseEnter={() => setSurvol(i)} onMouseLeave={() => setSurvol(null)}
                 onFocus={() => setSurvol(i)} onBlur={() => setSurvol(null)} tabIndex={0}>
                <rect x={i * LARGE} y={0} width={LARGE} height={H} fill="transparent" />
                {barre(x0, j.planifies, 'serie-1')}
                {barre(x0 + BARRE + ECART, j.faits, 'serie-2')}
                {j.planifies > 0 && <text className="valeur" x={x0 + BARRE / 2} y={y(j.planifies) - 4} textAnchor="middle">{j.planifies}</text>}
                {j.faits > 0 && <text className="valeur" x={x0 + BARRE * 1.5 + ECART} y={y(j.faits) - 4} textAnchor="middle">{j.faits}</text>}
                <text className="axe" x={i * LARGE + LARGE / 2} y={H - 6} textAnchor="middle">{jourCourt(j.date)}</text>
              </g>
            );
          })}
          <line className="ligne-base" x1={0} x2={largeur} y1={H - BAS} y2={H - BAS} />
        </svg>
      </div>
      {survol !== null && (
        <div className="infobulle" role="status">
          <strong>{jourCourt(jours[survol].date)}</strong> · {jours[survol].planifies} planifié(s) ·
          {' '}{jours[survol].faits} fait(s) · {jours[survol].techniciens} technicien(s) sur le terrain
        </div>
      )}
      <table className="visuellement-cache">
        <caption>Services par jour</caption>
        <thead><tr><th>Jour</th><th>Planifiés</th><th>Faits</th><th>Techniciens</th></tr></thead>
        <tbody>{jours.map((j) => <tr key={j.date}><td>{j.date}</td><td>{j.planifies}</td><td>{j.faits}</td><td>{j.techniciens}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

/** Tableau des services (période, projet, à surveiller). */
export function TableServices({ lignes, vide }: { lignes: LigneService[]; vide?: string }) {
  if (!lignes.length) return <div className="vide">{vide ?? 'Aucun service.'}</div>;
  return (
    <div className="defilement">
      <table>
        <thead><tr><th>Service</th><th>État</th><th>Dates</th><th>Équipe · véhicule</th><th>Heures prév. / passées</th>
          <th>Matériel livré</th><th className="nombre">CA HT</th><th className="nombre">Reste à facturer</th></tr></thead>
        <tbody>
          {lignes.map((s) => (
            <tr key={s.id}>
              <td><Link to={`/statistiques/services/${s.id}`}><strong>{s.nom}</strong></Link>
                <div className="muet">{s.projet?.nom ?? 'sans projet'} · {s.societe ?? s.client ?? '—'}</div>
                <div className="badges"><BadgeSimule simule={s.simule} />
                  {s.priorite === 'urgente' && <span className="badge b-urgent">urgent</span>}
                  {s.sans_position && <span className="badge b-a_confirmer">site sans position</span>}</div></td>
              <td><BadgeEtat etat={s.etat} /></td>
              <td className="nowrap">{!s.debut && s.fin ? `limite ${jourCourt(s.fin)}`
                : <>{jourCourt(s.debut)}{s.fin && s.fin !== s.debut ? ` → ${jourCourt(s.fin)}` : ''}</>}</td>
              <td>{s.techniciens.join(', ') || <span className="muet">personne</span>}
                {s.vehicule !== null && <div className="muet">{s.vehicule}</div>}</td>
              <td className="nowrap">{heures(s.heures_prevues)} / {heures(s.heures_passees)}</td>
              <td style={{ minWidth: 120 }}><Jauge pct={s.pct_livre} /></td>
              <td className="nowrap nombre">{euros(s.ca_ht)}</td>
              <td className="nowrap nombre">{euros(s.reste_a_facturer_ht)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
