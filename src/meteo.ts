// Météo de la semaine affichée (planification) : Open-Meteo, service libre et gratuit (code open source, données
// CC BY 4.0), sans clé ni compte. Seule la position de l'agence (adresse de l'entreprise) est envoyée.
// Indisponible (hors ligne, période hors prévisions) : rien n'est affiché, la page fonctionne sans.

export interface MeteoJour { code: number; max: number; min: number }
export interface Meteo { actuelle: { code: number; temperature: number } | null; jours: Record<string, MeteoJour> }

const URL = 'https://api.open-meteo.com/v1/forecast';
const cache = new Map<string, Promise<Meteo>>();

async function lire(params: Record<string, string>): Promise<Record<string, unknown>> {
  const r = await fetch(`${URL}?${new URLSearchParams(params)}`);
  if (!r.ok) throw new Error(`météo indisponible (${r.status})`);
  return r.json() as Promise<Record<string, unknown>>;
}

/** Temps actuel et prévisions par jour (« AAAA-MM-JJ ») entre `debut` et `fin`, heure de Paris. */
export function meteo(lat: number, lng: number, debut: string, fin: string): Promise<Meteo> {
  const cle = `${lat.toFixed(2)}|${lng.toFixed(2)}|${debut}|${fin}`;
  if (!cache.has(cle)) {
    const base = { latitude: lat.toFixed(4), longitude: lng.toFixed(4), timezone: 'Europe/Paris' };
    const p = (async () => {
      const actuel = await lire({ ...base, current: 'temperature_2m,weather_code' }).catch(() => null);
      const jours = await lire({ ...base, daily: 'weather_code,temperature_2m_max,temperature_2m_min', start_date: debut,
        end_date: fin }).catch(() => null);           // semaine hors des prévisions : pas d'icônes, sans erreur
      const c = actuel?.current as { temperature_2m?: number; weather_code?: number } | undefined;
      const d = jours?.daily as { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[];
        temperature_2m_min?: number[] } | undefined;
      const parJour: Record<string, MeteoJour> = {};
      (d?.time ?? []).forEach((t, i) => {
        const code = d?.weather_code?.[i], max = d?.temperature_2m_max?.[i], min = d?.temperature_2m_min?.[i];
        if (code != null && max != null && min != null) parJour[t] = { code, max, min };
      });
      return { actuelle: c?.weather_code != null && c.temperature_2m != null
        ? { code: c.weather_code, temperature: c.temperature_2m } : null, jours: parJour };
    })();
    p.catch(() => cache.delete(cle));
    cache.set(cle, p);
  }
  return cache.get(cle)!;
}

/** Code météo OMM (WMO) -> pictogramme et libellé. */
export function temps(code: number): { icone: string; libelle: string } {
  if (code === 0) return { icone: '☀️', libelle: 'Ensoleillé' };
  if (code <= 2) return { icone: '⛅', libelle: 'Éclaircies' };
  if (code === 3) return { icone: '☁️', libelle: 'Couvert' };
  if (code <= 48) return { icone: '🌫️', libelle: 'Brouillard' };
  if (code <= 57) return { icone: '🌦️', libelle: 'Bruine' };
  if (code <= 67) return { icone: '🌧️', libelle: 'Pluie' };
  if (code <= 77) return { icone: '🌨️', libelle: 'Neige' };
  if (code <= 82) return { icone: '🌦️', libelle: 'Averses' };
  if (code <= 86) return { icone: '🌨️', libelle: 'Averses de neige' };
  return { icone: '⛈️', libelle: 'Orage' };
}
