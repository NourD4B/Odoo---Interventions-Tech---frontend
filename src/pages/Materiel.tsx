// Matériel et traçabilité : une seule page. En haut les agences (unités en stock, réservées, sorties) ; à gauche
// les produits de l'agence choisie, avec la barre de leurs unités et les interventions concernées ; à droite le
// parcours du produit choisi (où il est rangé, d'où il vient, où il est parti). Lecture seule de la copie Odoo.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EtatChargement, useDonnees } from '../composants';
import { qte, stock, type CarteAgence, type Evenement, type ProduitAgence } from '../stock';

type Filtre = 'tous' | 'reserves' | 'sortis' | 'negatifs';
const FILTRES: { cle: Filtre; libelle: string }[] = [
  { cle: 'tous', libelle: 'Tous' }, { cle: 'reserves', libelle: 'Réservés' }, { cle: 'sortis', libelle: 'Sortis' },
  { cle: 'negatifs', libelle: 'Négatifs' },
];
const PAS = 100;

type Unites = { stock: number; reserve: number; sorti: number; retour: number };

const compte = (n: number, mot: string) => (n ? `${qte(n)} ${mot}${Math.abs(n) > 1 ? 's' : ''}` : '');

function Barre({ x, mini }: { x: Unites; mini?: boolean }) {
  const libre = Math.max(0, x.stock - x.reserve);
  const reserve = Math.max(0, x.reserve);
  const total = libre + reserve + x.sorti + x.retour || 1;
  const pct = (v: number) => `${(100 * v) / total}%`;
  const texte = `${qte(libre)} libres, ${qte(reserve)} réservées, ${qte(x.sorti)} sorties, ${qte(x.retour)} retournées`;
  return (
    <span className={mini ? 'mt-mini' : 'mt-barre'} role="img" aria-label={texte} title={texte}>
      <span className="mt-s-libre" style={{ width: pct(libre) }} /><span className="mt-s-reserve" style={{ width: pct(reserve) }} />
      <span className="mt-s-sorti" style={{ width: pct(x.sorti) }} /><span className="mt-s-retour" style={{ width: pct(x.retour) }} />
    </span>
  );
}

function Agence({ c, choisie, onChoisir }: { c: CarteAgence; choisie: boolean; onChoisir: () => void }) {
  const vide = c.articles === 0 && c.negatifs === 0 && c.sorti === 0;
  return (
    <button type="button" className={`mt-agence${choisie ? ' choisie' : ''}${vide ? ' vide' : ''}`} aria-pressed={choisie}
      onClick={onChoisir} title={c.nom}>
      <span className="mt-agence-nom">{c.nom}</span>
      {vide ? <span className="mt-petit">Pas de stock dans Odoo</span> : <>
        <span className="mt-agence-chiffre"><b>{qte(c.unites)}</b><span className="mt-petit">unités, {c.articles} produit{c.articles > 1 ? 's' : ''}</span></span>
        <Barre x={{ stock: c.unites, reserve: c.reserve, sorti: c.sorti, retour: c.retour }} mini />
        <span className="mt-petit">{qte(c.reserve)} réservées{c.negatifs ? `, ${c.negatifs} en négatif` : ''}</span>
      </>}
    </button>
  );
}

function LigneProduit({ p, choisi, onChoisir }: { p: ProduitAgence; choisi: boolean; onChoisir: () => void }) {
  return (
    <div className={`mt-produit${choisi ? ' choisi' : ''}`}>
      <button type="button" className="mt-produit-bouton" aria-pressed={choisi} onClick={onChoisir}>
        <span className="mt-produit-nom"><b>{p.produit.nom}</b><span className="mt-ref">{p.produit.reference ?? '—'}</span></span>
        <span className={`mt-qte${p.negatif ? ' neg' : ''}`}>{qte(p.stock)}<small>en stock</small></span>
        <Barre x={p} />
      </button>
      {(p.negatif || p.interventions.length > 0) && <span className="mt-puces">
        {p.negatif && <span className="mt-puce alerte">Stock négatif dans Odoo</span>}
        {p.interventions.map((i) => {
          const detail = [compte(i.sorti, 'sorti'), compte(i.retour, 'revenu'), compte(i.reserve, 'réservé')]
            .filter(Boolean).join(', ');
          return (
            <Link key={i.id} to={`/statistiques/services/${i.id}`} className={`mt-puce ${i.etat}`}
              title={`Intervention ${i.nom} : ${detail}`}>{i.nom} · {detail}</Link>);
        })}
      </span>}
    </div>
  );
}

function TexteEvenement({ e }: { e: Evenement }) {
  const nom = e.intervention?.nom;
  if (!e.intervention || !nom || !e.texte.startsWith(nom)) return <span>{e.texte}</span>;
  return <span><Link to={`/statistiques/services/${e.intervention.id}`}>{nom}</Link>{e.texte.slice(nom.length)}</span>;
}

function Panneau({ produitId, agence }: { produitId: number; agence: string }) {
  const d = useDonnees(() => stock.parcours(produitId, agence), [produitId, agence]);
  const p = d.donnees;
  if (!p) return <aside className="mt-panneau"><EtatChargement chargement={d.chargement} erreur={d.erreur} /></aside>;
  const max = Math.max(1, ...p.repartition.map((r) => Math.max(0, r.stock)));
  return (
    <aside className="mt-panneau" aria-labelledby="mt-t-detail">
      <div><h2 id="mt-t-detail">{p.nom}</h2><span className="mt-ref">{p.reference ?? '—'}</span></div>
      {!p.suivi_stock && <p className="mt-note">Odoo ne suit pas le stock de ce produit : on voit ses mouvements, pas ce qu'il en reste.</p>}
      <div className="mt-totaux">
        <div><span>Toutes agences</span><b className={p.total < 0 ? 'neg' : ''}>{qte(p.total)}</b></div>
        <div className="bleu"><span>Réservé</span><b>{qte(p.reserve)}</b></div>
        <div><span>Sorti ({p.fenetre_jours} j)</span><b>{qte(p.sorti)}</b></div>
      </div>
      <section aria-labelledby="mt-t-rep">
        <h3 id="mt-t-rep">Dans les agences</h3>
        {p.repartition.length ? p.repartition.map((r) => (
          <div key={r.cle} className={`mt-rep${r.cle === agence ? ' ici' : ''}`}>
            <span className="mt-rep-nom" title={r.nom}>{r.nom}</span>
            <span className="mt-piste"><span style={{ width: `${(100 * Math.max(0, r.stock)) / max}%` }} /></span>
            <b className={r.stock < 0 ? 'neg' : ''}>{qte(r.stock)}</b>
            <span className="mt-rep-lieux">{r.emplacements.join(', ')}</span>
          </div>)) : <p className="mt-petit">Aucun stock dans Odoo.</p>}
      </section>
      <section aria-labelledby="mt-t-parcours">
        <h3 id="mt-t-parcours">Parcours</h3>
        {p.parcours.length ? <ol className="mt-parcours">
          {p.parcours.map((e, i) => (
            <li key={i} className={`t-${e.type}`}>
              <span className="mt-rail" aria-hidden="true"><span className="mt-point" /><span className="mt-trait" /></span>
              <span className="mt-ev">
                <b>{e.titre}</b>
                <TexteEvenement e={e} />
                <span className="mt-petit">{e.jour}{e.document ? `, ${e.document}` : ''}</span>
              </span>
            </li>))}
        </ol> : <p className="mt-petit">Aucun mouvement dans Odoo.</p>}
      </section>
    </aside>
  );
}

export default function Materiel() {
  const [params, setParams] = useSearchParams();
  const agence = params.get('agence') ?? 'toutes';
  const produitParam = Number(params.get('produit')) || null;
  const t = useDonnees(() => stock.tracabilite(agence), [agence]);
  const [filtre, setFiltre] = useState<Filtre>('tous');
  const [recherche, setRecherche] = useState('');
  const [nombre, setNombre] = useState(PAS);
  useEffect(() => setNombre(PAS), [agence, filtre, recherche]);

  const liste = useMemo(() => {
    const r = recherche.trim().toLowerCase();
    return (t.donnees?.produits ?? []).filter((p) => (
      (filtre === 'tous' || (filtre === 'reserves' && (p.reserve > 0 || p.interventions.some((i) => i.reserve > 0)))
        || (filtre === 'sortis' && p.sorti > 0) || (filtre === 'negatifs' && p.negatif))
      && (!r || `${p.produit.nom} ${p.produit.reference ?? ''}`.toLowerCase().includes(r))));
  }, [t.donnees, filtre, recherche]);
  const produitId = produitParam ?? liste[0]?.produit.id ?? null;
  const carte = t.donnees?.cartes.find((c) => c.cle === agence);
  const choisir = (cle: string, valeur: string | null) => {
    const p = new URLSearchParams(params);
    if (valeur === null) p.delete(cle); else p.set(cle, valeur);
    if (cle === 'agence') p.delete('produit');
    setParams(p, { replace: true });
  };

  return (
    <div className="mt">
      <div className="entete">
        <div>
          <h1>Matériel et traçabilité</h1>
          <div className="sous-titre">Ce que chaque agence a en stock, pour quelle intervention, et ce qui en est sorti
            {t.donnees?.a_jour_le ? `. Copie d'Odoo du ${new Date(t.donnees.a_jour_le).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}.</div>
        </div>
        <label className="mt-recherche"><span className="lu">Rechercher un produit</span>
          <input type="search" placeholder="Produit ou référence" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        </label>
      </div>

      {!t.donnees ? <EtatChargement chargement={t.chargement} erreur={t.erreur} /> : <>
        <section className="mt-agences" aria-label="Agences">
          {t.donnees.cartes.map((c) => (
            <Agence key={c.cle} c={c} choisie={c.cle === agence} onChoisir={() => choisir('agence', c.cle === 'toutes' ? null : c.cle)} />))}
        </section>

        <div className="mt-corps">
          <section className="mt-liste" aria-labelledby="mt-t-produits">
            <div className="mt-liste-tete">
              <h2 id="mt-t-produits">{carte?.nom ?? 'Produits'} : {liste.length} produit{liste.length > 1 ? 's' : ''}</h2>
              <div className="segmente mt-seg" role="group" aria-label="Filtrer les produits">
                {FILTRES.map((f) => <button key={f.cle} type="button" className={filtre === f.cle ? 'actif' : ''}
                  aria-pressed={filtre === f.cle} onClick={() => setFiltre(f.cle)}>{f.libelle}</button>)}
              </div>
            </div>
            <div className="mt-legende" aria-hidden="true">
              <span><i className="mt-s-libre" />En stock, libre</span><span><i className="mt-s-reserve" />Réservé</span>
              <span><i className="mt-s-sorti" />Sorti chez le client ({t.donnees.fenetre_jours} j)</span>
              <span><i className="mt-s-retour" />Retourné</span>
            </div>
            {liste.length ? <>
              {liste.slice(0, nombre).map((p) => (
                <LigneProduit key={p.produit.id} p={p} choisi={p.produit.id === produitId}
                  onChoisir={() => choisir('produit', String(p.produit.id))} />))}
              {liste.length > nombre && <button type="button" className="mt-plus" onClick={() => setNombre(nombre + PAS)}>
                Afficher {Math.min(PAS, liste.length - nombre)} produits de plus</button>}
            </> : <p className="vide">{carte && carte.articles === 0 && carte.negatifs === 0
              ? "Pas de stock dans Odoo pour cette agence : les produits ne sont pas encore rangés par agence."
              : 'Aucun produit pour ce filtre.'}</p>}
          </section>
          {produitId !== null && <Panneau produitId={produitId} agence={agence} />}
        </div>
        <p className="muet">Odoo n'est pas encore organisé par agence : chaque carte reprend un entrepôt Odoo tel qu'il est
          aujourd'hui. « Toutes les agences » est le stock total, comme « Disponible » dans Odoo.</p>
      </>}
    </div>
  );
}
