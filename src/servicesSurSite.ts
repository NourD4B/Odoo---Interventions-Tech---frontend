// Services sur site : ce qui empêche ou fausse leur planification, et le lien vers leur fiche dans la Planification
// (seul endroit où ils se planifient et se règlent). Utilisé par la liste des dossiers et par le dossier.
import { aujourdhui } from './api';
import type { ServicePlanif } from './planification';
import type { FicheService } from './statistiques';

// ici : à régler dans la fiche ; odoo : à corriger dans Odoo. court : libellé d'une ligne de service (la date est déjà
// dans la pastille du jour), texte : l'explication complète (infobulle, détail du dossier).
export type Alerte = { texte: string; court: string; ou: 'ici' | 'odoo' };

const jj = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Lien vers la fiche du service dans la Planification, sur la semaine où elle le montre : celle de son affectation,
 *  sinon celle où il peut être planifié (sa « Date prévue » Odoo, jamais avant aujourd'hui). */
export function lienPlanification(id: number, affecteLe: string | null, prevuLe: string | null,
  onglet: 'reglages' | null = null): string {
  const auj = aujourdhui();
  const prevu = prevuLe?.slice(0, 10) ?? null;
  const p = new URLSearchParams({ semaine: affecteLe?.slice(0, 10) ?? (prevu && prevu > auj ? prevu : auj), service: String(id) });
  if (onglet) p.set('onglet', onglet);
  return `/planification?${p}`;
}

function alertesDe(o: { archive: boolean; publie: boolean; lat: number | null; precision: string | null; heures: number;
  echeance: string | null }): Alerte[] {
  if (o.archive) return [];                                          // historique : rien à régler
  const a: Alerte[] = [];
  if (o.lat === null) a.push({ texte: 'Site sans position : trajets et coûts non calculés', court: 'Site sans position', ou: 'ici' });
  else if (o.precision === 'commune') {
    a.push({ texte: 'Position approximative (centre de la commune)', court: 'Position approximative', ou: 'ici' });
  }
  if (!o.heures) {
    a.push({ texte: 'Temps alloué à 0 h dans Odoo : durée inconnue pour le solveur', court: 'Temps alloué à 0 h', ou: 'odoo' });
  }
  if (!o.publie && o.echeance && new Date(o.echeance) < new Date()) {
    a.push({ texte: `Date limite dépassée (${jj(o.echeance)}) et pas encore publié`, court: 'Date limite dépassée', ou: 'odoo' });
  }
  return a;
}

/** Alertes d'un service de la planification (liste des dossiers). */
export const alertesPlanif = (s: ServicePlanif) => alertesDe({ archive: !!s.archive_odoo,
  publie: s.statut_planification === 'publie', lat: s.site_lat, precision: s.site_precision, heures: s.allocated_hours,
  echeance: s.date_deadline });

/** Alertes d'une mission (dossier) : mêmes règles, depuis la fiche du service. */
export const alertesFiche = (f: FicheService) => alertesDe({ archive: f.archive_odoo,
  publie: f.planification.statut === 'publie', lat: f.site.lat, precision: f.site.precision,
  heures: f.odoo?.temps.alloue ?? f.prevu.heures ?? 0, echeance: f.etat === 'fait' || f.etat === 'facture' ? null : f.prevu.fin });

/** À régler dans la fiche (position du site), et encore modifiable. */
export const aReglerPlanif = (s: ServicePlanif) => s.statut_planification !== 'publie'
  && alertesPlanif(s).some((x) => x.ou === 'ici');

/** Visible dans la Planification : ni archivé, ni terminé dans Odoo sans y avoir été planifié. */
export const planifiable = (s: ServicePlanif) => !s.archive_odoo && !(s.cloture_odoo && !s.affectation);
