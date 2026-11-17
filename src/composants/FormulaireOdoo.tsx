// Détails d'un service tels que le formulaire Odoo « Services sur site » les montre, dans le même ordre et avec les
// mêmes actions (lecture seule ; tout se modifie dans Odoo) : adresse du client et « Voir l'itinéraire », numéro de
// contact (Appeler, SMS, WhatsApp), article de la commande client (sinon « Non facturable »), sous garantie, date
// planifiée, temps alloué (sous-tâches, avancement), feuille de travail, assignés. Le nom du client est déjà en tête
// de la fiche : il n'est pas répété.
import type { ReactNode } from 'react';
import type { ServicePlanif } from '../planification';
import { lienItineraire, liensTelephone } from '../servicesSurSite';

const dateHeure = (iso: string) => new Date(iso).toLocaleString('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Heures en hh:mm, comme le widget « float_time » d'Odoo (10 → 10:00, 1,5 → 01:30). */
export function hhmm(h: number): string {
  const m = Math.round(h * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const TRAIT = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const };
const ICONES = {
  itineraire: <path {...TRAIT} d="M4 10h11M11 5.5 15.5 10 11 14.5" />,
  appeler: <path {...TRAIT} d="M5.2 3.5h2.4l1.2 3.2-1.6 1.1a8.6 8.6 0 0 0 5 5l1.1-1.6 3.2 1.2v2.4a1.7 1.7 0 0 1-1.8 1.7A13.4 13.4 0 0 1 3.5 5.3a1.7 1.7 0 0 1 1.7-1.8z" />,
  sms: <><rect {...TRAIT} x="6" y="2.5" width="8" height="15" rx="1.8" /><path {...TRAIT} d="M9 15h2" /></>,
  whatsapp: <><path {...TRAIT} d="M10 3a7 7 0 0 0-6 10.6L3 17l3.5-1A7 7 0 1 0 10 3z" />
    <path {...TRAIT} d="M7.6 7.4c0 2.6 2.4 5 5 5l.8-1.4-1.6-.8-.7.7a3.7 3.7 0 0 1-2-2l.7-.7-.8-1.6z" /></>,
};
function Icone({ nom }: { nom: keyof typeof ICONES }) {
  return <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">{ICONES[nom]}</svg>;
}

export function LigneFormulaire({ libelle, children }: { libelle: string; children: ReactNode }) {
  return <div className="fo-ligne"><dt>{libelle}</dt><dd>{children}</dd></div>;
}

export default function FormulaireOdoo({ s, suite }: { s: ServicePlanif; suite?: ReactNode }) {
  const tel = s.partner_phone ? liensTelephone(s.partner_phone) : null;
  const adresse = (s.site_adresse ?? '').split(/,\s*/).filter(Boolean);
  const nbSous = s.nb_sous_taches ?? 0;
  return (
    <dl className="fo" aria-label="Dans Odoo">
      <LigneFormulaire libelle="Adresse du client">
        {adresse.length ? <>
          <span className="fo-adresse">{adresse.map((l, i) => <span key={i}>{l}</span>)}</span>
          <a className="fo-action" href={lienItineraire(s.site_adresse!)} target="_blank" rel="noreferrer">
            <Icone nom="itineraire" />Voir l'itinéraire</a></>
          : <span className="fo-vide">Non renseignée dans Odoo</span>}
      </LigneFormulaire>
      <LigneFormulaire libelle="Numéro de contact">
        {s.partner_phone ? <span className="fo-telephone">
          <span className="fo-numero">{s.partner_phone}</span>
          {tel && <span className="fo-actions">
            <a className="fo-action" href={tel.appeler}><Icone nom="appeler" />Appeler</a>
            <a className="fo-action" href={tel.sms}><Icone nom="sms" />SMS</a>
            <a className="fo-action" href={tel.whatsapp} target="_blank" rel="noreferrer"><Icone nom="whatsapp" />WhatsApp</a>
          </span>}</span>
          : <span className="fo-vide">Non renseigné</span>}
      </LigneFormulaire>
      <LigneFormulaire libelle="Article de la commande client">
        {s.article_commande ? <>{s.article_commande}{s.commande_nom && <small>Commande {s.commande_nom}</small>}</>
          : s.commande_nom ? <>Commande {s.commande_nom}</> : <span className="fo-vide">Non facturable</span>}
      </LigneFormulaire>
      <LigneFormulaire libelle="Sous garantie">
        <span className={`fo-case${s.under_warranty ? ' cochee' : ''}`} role="img" aria-label={s.under_warranty ? 'Oui' : 'Non'}>
          {s.under_warranty && <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path {...TRAIT}
            strokeWidth={2} d="M2.5 6.2 5 8.6l4.5-5" /></svg>}</span>
      </LigneFormulaire>
      <LigneFormulaire libelle="Date planifiée">
        {s.planned_date_begin || s.date_deadline
          ? <span className="fo-dates"><span>{s.planned_date_begin ? dateHeure(s.planned_date_begin) : '—'}</span>
            <span className="fo-fleche" aria-label="au">→</span>
            <span>{s.date_deadline ? dateHeure(s.date_deadline) : '—'}</span></span>
          : <span className="fo-vide">Non renseignée dans Odoo</span>}
      </LigneFormulaire>
      <LigneFormulaire libelle="Temps alloué">
        <span className="fo-temps"><strong>{hhmm(s.allocated_hours)}</strong>
          {nbSous > 0 && <span>(incl. {hhmm(s.heures_sous_taches ?? 0)} sur des sous-tâches)</span>}
          {s.progression != null && <span>({s.progression} %)</span>}
          {!s.allocated_hours && <span className="fo-alerte">compté 1 jour, à corriger dans Odoo</span>}</span>
      </LigneFormulaire>
      {s.feuille_modele && <LigneFormulaire libelle="Feuille de travail">{s.feuille_modele}</LigneFormulaire>}
      {!!s.assignes_odoo?.length && <LigneFormulaire libelle="Assignés">{s.assignes_odoo.join(', ')}</LigneFormulaire>}
      {suite}
    </dl>
  );
}
