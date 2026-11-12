// Vue « Mois » de la planification : 4 semaines, une case par jour ouvré et par technicien (libre, planifié,
// proposé, congé, férié, conflit). Survol d'une case : détail du service ou du congé. Clic sur une semaine : l'ouvrir.
// Données : /api/planification/charge (mêmes congés, fériés et interventions que la vue Semaine).
import { useMemo, type ReactNode } from 'react';
import { aujourdhui } from '../api';
import { Avertissements, EtatChargement, useDonnees } from '../composants';
import { InfoBulle, placeInfoBulle } from '../composants/InfoBulle';
import { planif, type JourCharge, type TechnicienCharge } from '../planification';

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const date = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00`);
const court = (s: string) => { const d = date(s); return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}`; };
const maj = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const periodeTexte = (a: string, b: string) => maj(a === b ? court(a) : `du ${court(a)} au ${court(b)}`);
/** « 9 – 13 nov. », « 30 nov. – 4 déc. ». */
const etiquetteSemaine = (a: string, b: string) => {
  const [x, y] = [date(a), date(b)];
  return x.getMonth() === y.getMonth() ? `${x.getDate()} – ${y.getDate()} ${MOIS[y.getMonth()]}`
    : `${x.getDate()} ${MOIS[x.getMonth()]} – ${y.getDate()} ${MOIS[y.getMonth()]}`;
};
const heures = (h: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(h)} h`;
function semaineIso(s: string) {
  const d = date(s); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const premier = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - premier.getTime()) / 86400000 - 3 + ((premier.getDay() + 6) % 7)) / 7);
}

type Colonne = { i: number; j: JourCharge };

export default function PlanMois({ debut, fin, onOuvrirSemaine }: {
  debut: string; fin: string; onOuvrirSemaine: (lundi: string) => void;
}) {
  const plan = useDonnees(() => planif.charge(debut, fin), [debut, fin]);
  const d = plan.donnees;
  const auj = aujourdhui();

  const colonnes = useMemo<Colonne[]>(() => (d?.jours ?? []).map((j, i) => ({ i, j })).filter((c) => !c.j.weekend), [d]);
  const semaines = useMemo(() => {
    const s: { lundi: string; cols: Colonne[] }[] = [];
    for (const c of colonnes) {
      const l = date(c.j.date); l.setDate(l.getDate() - ((l.getDay() + 6) % 7));
      const lundi = `${l.getFullYear()}-${String(l.getMonth() + 1).padStart(2, '0')}-${String(l.getDate()).padStart(2, '0')}`;
      if (!s.length || s[s.length - 1].lundi !== lundi) s.push({ lundi, cols: [c] }); else s[s.length - 1].cols.push(c);
    }
    return s;
  }, [colonnes]);
  const groupes = useMemo(() => {
    const noms = new Map((d?.agences ?? []).map((a) => [a.code, a.nom]));
    const par = new Map<string, TechnicienCharge[]>();
    for (const t of [...(d?.techniciens ?? [])].sort((x, y) => x.nom.localeCompare(y.nom, 'fr'))) {
      par.set(t.agence, [...(par.get(t.agence) ?? []), t]);
    }
    return [...par.entries()].map(([code, techs]) => ({ nom: noms.get(code) ?? code, techs }))
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  }, [d]);
  const nomDe = useMemo(() => new Map((d?.techniciens ?? []).map((t) => [t.matricule, t.nom])), [d]);
  const ordre = groupes.flatMap((g) => g.techs.map((t) => t.matricule));

  /** Jours de congé consécutifs (jours ouvrés) autour de la colonne `k`, pour la carte « Congé ». */
  const congeAutour = (t: TechnicienCharge, k: number) => {
    const conge = (x: number) => x >= 0 && x < colonnes.length && t.jours[colonnes[x].i]?.etat === 'conge';
    let a = k, b = k;
    while (conge(a - 1)) a -= 1;
    while (conge(b + 1)) b += 1;
    return periodeTexte(colonnes[a].j.date, colonnes[b].j.date);
  };

  const cases = (t: TechnicienCharge) => {
    const ligne = ordre.indexOf(t.matricule);
    return semaines.map((s) => s.cols.map((c) => {
      const k = colonnes.indexOf(c);
      const cellule = t.jours[c.i];
      const place = placeInfoBulle(ligne, ordre.length, k, colonnes.length);
      const services = cellule.services.map((id) => d!.services[String(id)]).filter(Boolean);
      let cls = 'pm-case';
      let bulle: ReactNode = null;
      let aria = `${t.nom}, ${court(c.j.date)} : libre`;
      if (services.length) {
        const s = services[0];
        cls += services.every((x) => x.etat === 'propose') ? ' propose' : ' pris';
        const alertes: string[] = [];
        if (cellule.etat === 'conflit') {
          cls += ' conflit';
          alertes.push(c.j.ferie ? `Affecté un jour férié (${c.j.ferie})` : 'Affecté pendant un congé');
        }
        if (services.length > 1) alertes.push(`Et ${services.length - 1} autre${services.length > 2 ? 's' : ''} service${services.length > 2 ? 's' : ''} ce jour-là`);
        aria = `${t.nom}, ${court(c.j.date)} : ${s.client ?? ''} ${s.nom}`;
        bulle = <InfoBulle titre={s.client ?? 'Client non renseigné'} sousTitre={s.nom} etat={s.etat}
          urgent={s.priorite === 'urgente'} alertes={alertes} place={place}
          lignes={[['Dates', periodeTexte(s.debut, s.fin)],
            ['Équipe', s.matricules.map((m) => nomDe.get(m) ?? m).join(', ')],
            ['Temps prévu', heures(s.allocated_hours)]]} />;
      } else if (c.j.ferie) {
        cls += ' ferie';
        aria = `${court(c.j.date)} : férié (${c.j.ferie})`;
      } else if (cellule.etat === 'conge') {
        cls += ' conge';
        aria = `${t.nom}, ${court(c.j.date)} : congé`;
        bulle = <InfoBulle titre="Congé" sousTitre={t.nom} place={place} lignes={[['Dates', congeAutour(t, k)]]} />;
      }
      if (c.j.date === auj) cls += ' aujourdhui';
      return bulle
        ? <span key={c.j.date} className={`${cls} a-ib`} tabIndex={0} aria-label={aria}>{bulle}</span>
        : <span key={c.j.date} className={cls} title={c.j.ferie ? `Férié : ${c.j.ferie}` : undefined} />;
    }));
  };

  const colonnesGrille = `var(--pm-col-nom) repeat(${semaines.length || 4}, minmax(0, 1fr)) 64px`;
  return (
    <>
      <EtatChargement chargement={plan.chargement && !d} erreur={plan.erreur} />
      <Avertissements liste={d?.avertissements} />
      {d && (
        <div className="pm">
          <section className="pm-tableau" aria-label="Charge sur 4 semaines">
            <div className="pm-grille">
              <div className="pm-ligne" style={{ gridTemplateColumns: colonnesGrille }}>
                <span />
                {semaines.map((s) => (
                  <button key={s.lundi} type="button" className="pm-semaine" onClick={() => onOuvrirSemaine(s.lundi)}
                    title={`Ouvrir la semaine ${semaineIso(s.lundi)}`}>
                    S{semaineIso(s.lundi)}<span>{etiquetteSemaine(s.cols[0].j.date, s.cols[s.cols.length - 1].j.date)}</span>
                  </button>
                ))}
                <span className="pm-tete-charge">Charge</span>
              </div>
              <div className="pm-ligne pm-jours" style={{ gridTemplateColumns: colonnesGrille }}>
                <span />
                {semaines.map((s) => (
                  <span key={s.lundi} className="pm-semaine-cases" style={{ gridTemplateColumns: `repeat(${s.cols.length}, minmax(0, 1fr))` }}>
                    {s.cols.map((c) => (
                      <span key={c.j.date} className={c.j.date === auj ? 'auj' : c.j.ferie ? 'ferie' : ''}>{date(c.j.date).getDate()}</span>
                    ))}
                  </span>
                ))}
                <span />
              </div>
              {groupes.map((g) => (
                <div key={g.nom} role="group" aria-label={g.nom}>
                  <div className="pm-agence">{g.nom}</div>
                  {g.techs.map((t) => (
                    <div key={t.matricule} className="pm-ligne pm-tech" style={{ gridTemplateColumns: colonnesGrille }}>
                      <strong className="pm-nom">{t.nom}</strong>
                      {cases(t).map((semaine, w) => (
                        <span key={semaines[w].lundi} className="pm-semaine-cases"
                          style={{ gridTemplateColumns: `repeat(${semaine.length}, minmax(0, 1fr))` }}>{semaine}</span>
                      ))}
                      <span className="pm-charge" title={`${t.occupes} jour(s) occupé(s) sur ${t.ouvres - t.conges} disponible(s)`}>
                        {t.charge_pct === null ? '—' : `${Math.round(t.charge_pct)} %`}</span>
                    </div>
                  ))}
                </div>
              ))}
              {!groupes.length && <p className="vide pl-vide">Aucun technicien terrain sur la période.</p>}
            </div>
          </section>
          <div className="pl-legende">
            <span><i className="pm-l libre" />Libre</span>
            <span><i className="pm-l pris" />Planifié</span>
            <span><i className="pm-l propose" />Proposé</span>
            <span><i className="pm-l conge" />Congé</span>
            <span><i className="pm-l ferie" />Férié</span>
            <span><i className="pm-l conflit" />Conflit</span>
            <span className="pl-legende-aide">Cliquez une semaine pour l'ouvrir.</span>
          </div>
        </div>
      )}
    </>
  );
}
