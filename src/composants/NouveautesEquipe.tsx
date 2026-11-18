// « Depuis votre dernière visite » : ce que les collègues ont fait (journal : affectations, publications, prises en
// charge…, les siennes exclues) et ce qui a bougé dans Odoo (services nouveaux ou modifiés, retirés), d'après la copie
// locale. La dernière visite est retenue par ce navigateur (commodité, pas une donnée partagée) ; première visite :
// les dernières 24 heures.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { lireNouveautes, type Nouveautes } from '../accueil';
import { initiales } from '../composants';

const CLE_VISITE = 'd4b.accueil.derniere_visite';

function lireVisite(): string {
  try { const v = localStorage.getItem(CLE_VISITE); if (v) return v; } catch { /* stockage indisponible */ }
  return new Date(Date.now() - 24 * 3600_000).toISOString();
}
function noterVisite(): void {
  try { localStorage.setItem(CLE_VISITE, new Date().toISOString()); } catch { /* stockage indisponible */ }
}
function ilYA(iso: string | null): string {
  if (!iso) return '';
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return min < 1 ? "à l'instant" : min < 60 ? `il y a ${min} min` : min < 24 * 60 ? `il y a ${Math.round(min / 60)} h`
    : `le ${new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`;
}
const depuisLe = (iso: string) => new Date(iso).toLocaleString('fr-FR', { weekday: 'long', hour: '2-digit', minute: '2-digit' });

export default function NouveautesEquipe({ auteur, version }: { auteur: string | null; version: unknown }) {
  const visite = useRef(lireVisite());           // lue une fois : la page montre ce qui a changé depuis l'arrivée
  const [n, setN] = useState<Nouveautes | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {                              // relu après chaque synchronisation qui change les faits
    lireNouveautes(visite.current, auteur).then((x) => { setN(x); setErreur(null); }).catch((e: Error) => setErreur(e.message));
  }, [auteur, version]);
  useEffect(() => {                              // départ de la page : la visite est notée
    const cache = () => { if (document.visibilityState === 'hidden') noterVisite(); };
    document.addEventListener('visibilitychange', cache);
    return () => { document.removeEventListener('visibilitychange', cache); noterVisite(); };
  }, []);

  const vide = n && !n.equipe.length && !n.odoo.modifies.length && !n.odoo.retires.length;
  return (
    <section className="ac-carte nv" aria-labelledby="nv-titre">
      <header><h2 id="nv-titre">Depuis votre dernière visite</h2><span>{depuisLe(visite.current)}</span></header>
      {erreur && <p className="ac-vide">Nouveautés illisibles : {erreur}</p>}
      {vide && <p className="ac-vide ok">Rien de nouveau depuis votre dernière visite.</p>}
      {n && n.equipe.length > 0 && (
        <ul className="nv-equipe">{n.equipe.map((a, i) => (
          <li key={i}>
            <span className="nv-avatar" aria-hidden="true">{initiales(a.auteur.replace(/\s*\(simulé\)$/, ''))}</span>
            <p><strong>{a.auteur}</strong> {a.texte}<small>{ilYA(a.quand)}</small></p>
          </li>))}
        </ul>)}
      {n && (n.odoo.modifies.length > 0 || n.odoo.retires.length > 0) && (
        <div className="nv-odoo">
          <h3>Dans Odoo</h3>
          {n.odoo.modifies.length > 0 && <p><span className="nv-compte">{n.odoo.modifies.length}</span> nouveau
            {n.odoo.modifies.length > 1 ? 'x' : ''} ou modifié{n.odoo.modifies.length > 1 ? 's' : ''} :{' '}
            {n.odoo.modifies.map((s, i) => <span key={s.id}>{i > 0 && ', '}
              <Link to={`/dossiers?q=${encodeURIComponent(s.nom)}`}>{s.nom}</Link></span>)}</p>}
          {n.odoo.retires.length > 0 && <p><span className="nv-compte retire">{n.odoo.retires.length}</span> retiré
            {n.odoo.retires.length > 1 ? 's' : ''} d'Odoo : {n.odoo.retires.map((s) => s.nom).join(', ')}</p>}
        </div>)}
    </section>
  );
}
