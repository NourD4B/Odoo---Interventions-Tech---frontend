// Silhouette dessinée d'un véhicule (vue de profil), en attendant sa photo : forme selon la carrosserie,
// teinte selon la couleur notée dans Odoo. Dessin original, générique (aucun modèle réel reproduit).
import type { Carrosserie } from '../flotte';

const TEINTES: [RegExp, string][] = [
  [/blan/i, '#f3f4f6'], [/noi/i, '#2a2e35'], [/rouge/i, '#c0413a'], [/bleu/i, '#2f5fa8'], [/vert/i, '#3f7d5c'],
  [/gris|argent/i, '#9aa1ab'], [/beige|sable/i, '#cdbb98'], [/jaune/i, '#e2b33c'], [/orange/i, '#d9772f'],
];

export function teinte(couleur: string | null): string {
  return TEINTES.find(([motif]) => motif.test(couleur ?? ''))?.[1] ?? '#b3b9c2';
}

type Forme = { corps: string; vitres: string[]; roues: [number, number]; rayon: number; montant?: number };

// viewBox 0 0 320 150, sol à y = 128, avant à droite
const FORMES: Record<Exclude<Carrosserie, 'scooter'>, Forme> = {
  citadine: {
    corps: 'M40 116 C34 116 32 110 33 102 L36 86 C38 78 44 70 54 64 L82 50 C90 46 98 45 108 45 L178 45 C188 45 196 49 204 56 '
      + 'L232 80 L270 86 C282 88 288 94 290 102 L291 110 C291 115 288 117 283 117 Z',
    vitres: ['M86 56 L104 51 L140 51 L140 80 L74 80 C76 70 80 61 86 56 Z', 'M146 51 L178 51 C186 51 192 54 198 60 L218 80 L146 80 Z'],
    roues: [86, 240], rayon: 20, montant: 143,
  },
  compacte: {
    corps: 'M34 116 C28 116 26 110 27 102 L30 86 C32 77 38 70 48 65 L80 50 C88 46 96 45 106 45 L184 45 C194 45 202 49 210 56 '
      + 'L240 80 L280 86 C292 88 297 94 298 102 L299 110 C299 115 296 117 291 117 Z',
    vitres: ['M84 56 L102 51 L142 51 L142 80 L70 80 C72 70 77 61 84 56 Z', 'M148 51 L184 51 C192 51 198 54 204 60 L226 80 L148 80 Z'],
    roues: [84, 248], rayon: 20, montant: 145,
  },
  break: {
    corps: 'M30 116 C24 116 22 110 22 102 L23 66 C23 56 28 50 38 49 L190 45 C200 45 207 49 214 56 L244 80 L284 86 '
      + 'C296 88 301 94 302 102 L303 110 C303 115 300 117 295 117 Z',
    vitres: ['M32 56 L104 52 L104 80 L30 80 Z', 'M110 52 L150 51 L150 80 L110 80 Z',
      'M156 51 L190 51 C198 51 204 54 210 60 L230 80 L156 80 Z'],
    roues: [80, 252], rayon: 20, montant: 153,
  },
  suv: {
    corps: 'M30 114 C24 114 22 108 22 100 L23 60 C23 48 30 41 42 40 L190 37 C201 37 208 41 216 48 L244 72 L286 79 '
      + 'C297 81 302 88 302 96 L303 108 C303 113 300 115 295 115 Z',
    vitres: ['M32 48 L100 45 L100 74 L30 74 Z', 'M106 45 L150 43 L150 74 L106 74 Z',
      'M156 43 L190 43 C198 43 205 46 211 52 L232 74 L156 74 Z'],
    roues: [82, 250], rayon: 22, montant: 153,
  },
  fourgonnette: {
    corps: 'M26 116 C21 116 19 111 19 105 L19 42 C19 35 24 31 31 31 L206 30 C215 30 221 34 227 41 L252 70 L286 78 '
      + 'C296 80 300 87 300 95 L301 110 C301 114 298 116 293 116 Z',
    vitres: ['M180 37 L206 36 C212 36 217 39 221 44 L240 70 L180 70 Z'],
    roues: [78, 248], rayon: 20, montant: 176,
  },
  fourgon: {
    corps: 'M18 118 C13 118 11 113 11 107 L11 24 C11 18 15 14 21 14 L226 13 C236 13 243 18 248 26 L268 58 '
      + 'C290 62 300 70 302 84 L303 110 C303 115 300 118 294 118 Z',
    vitres: ['M204 20 L226 20 C232 20 237 23 240 29 L258 58 L204 58 Z'],
    roues: [70, 258], rayon: 21, montant: 200,
  },
};

function Roue({ x, r }: { x: number; r: number }) {
  return (
    <g>
      <circle cx={x} cy={128 - r} r={r} fill="#24272d" />
      <circle cx={x} cy={128 - r} r={r * 0.55} fill="#c9ced6" />
      <circle cx={x} cy={128 - r} r={r * 0.18} fill="#8b929c" />
    </g>
  );
}

export default function Silhouette({ carrosserie, couleur, titre }: {
  carrosserie: Carrosserie; couleur: string | null; titre: string;
}) {
  const fond = teinte(couleur);
  const contour = /blan/i.test(couleur ?? '') ? '#c3c8cf' : 'rgba(0,0,0,.22)';
  return (
    <svg viewBox="0 0 320 150" role="img" aria-label={titre} className="silhouette">
      <ellipse cx="162" cy="130" rx="146" ry="6" fill="rgba(22,24,29,.10)" />
      {carrosserie === 'scooter' ? (
        <g>
          <path d="M96 106 L196 106 C206 106 212 100 214 92 L224 52 L236 50 L230 88 C228 102 236 108 250 108"
            fill="none" stroke={fond} strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M92 96 C94 80 108 72 132 72 L176 72 C186 72 190 78 188 86 L184 100 L96 104 Z" fill={fond} stroke={contour} />
          <path d="M120 70 C122 62 132 58 150 58 L176 58 C184 58 188 62 186 68 L184 72 L120 72 Z" fill="#2f333a" />
          <path d="M222 50 L246 42" stroke="#2f333a" strokeWidth="5" strokeLinecap="round" />
          <Roue x={90} r={18} /><Roue x={244} r={18} />
        </g>
      ) : (() => {
        const f = FORMES[carrosserie];
        return (
          <g>
            <path d={f.corps} fill={fond} stroke={contour} strokeWidth="1.5" strokeLinejoin="round" />
            {f.vitres.map((d) => <path key={d} d={d} fill="#bcd0e2" opacity=".9" />)}
            {f.montant && <line x1={f.montant} y1="84" x2={f.montant} y2="112" stroke={contour} strokeWidth="1.2" />}
            <path d={`M${f.roues[0] - f.rayon - 6} 116 a${f.rayon + 6} ${f.rayon + 6} 0 0 1 ${2 * f.rayon + 12} 0`}
              fill="#3a3e45" opacity=".35" />
            <path d={`M${f.roues[1] - f.rayon - 6} 116 a${f.rayon + 6} ${f.rayon + 6} 0 0 1 ${2 * f.rayon + 12} 0`}
              fill="#3a3e45" opacity=".35" />
            <Roue x={f.roues[0]} r={f.rayon} /><Roue x={f.roues[1]} r={f.rayon} />
            <rect x="286" y="92" width="10" height="6" rx="2" fill="#f5e7a8" opacity=".9" />
          </g>
        );
      })()}
    </svg>
  );
}

/** Carrosserie à dessiner : celle de la fiche constructeur, sinon déduite de la catégorie Odoo. */
export function carrosserieDe(fiche: { carrosserie?: Carrosserie } | null, categorie: string | null): Carrosserie {
  if (fiche?.carrosserie) return fiche.carrosserie;
  const c = (categorie ?? '').toLowerCase();
  if (c.includes('commerc')) return 'fourgonnette';
  if (c.includes('suv')) return 'suv';
  if (c.includes('moto')) return 'scooter';
  return 'citadine';
}
