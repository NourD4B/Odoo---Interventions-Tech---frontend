import { useMemo, useState } from 'react';
import { AdvancedMarker, APIProvider, InfoWindow, Map } from '@vis.gl/react-google-maps';
import { api, aujourdhui, LIBELLES_STATUT, type Intervention } from '../api';
import { Avertissements, Badge, COULEURS_STATUT, EtatChargement, heure, initiales, useDonnees } from '../composants';

const CLE_MAPS = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const MAP_ID = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) || 'DEMO_MAP_ID';
const FRANCE = { lat: 46.6, lng: 2.4 };

export default function CarteLive() {
  const [jour, setJour] = useState(aujourdhui());
  const [technicien, setTechnicien] = useState('');
  const [client, setClient] = useState('');
  const [societe, setSociete] = useState('');
  const [selection, setSelection] = useState<string | null>(null);

  const { donnees, erreur, chargement, recharger } = useDonnees(() => api.interventions(jour), [jour]);
  const toutes = donnees?.interventions ?? [];

  const options = useMemo(() => ({
    techniciens: [...new Set(toutes.flatMap((i) => i.techniciens))].sort(),
    clients: [...new Set(toutes.map((i) => i.client).filter(Boolean) as string[])].sort(),
    societes: [...new Set(toutes.map((i) => i.societe).filter(Boolean) as string[])].sort(),
  }), [toutes]);

  const visibles = toutes.filter((i) =>
    (!technicien || i.techniciens.includes(technicien)) &&
    (!client || i.client === client) &&
    (!societe || i.societe === societe));

  const compter = (...statuts: string[]) => visibles.filter((i) => statuts.includes(i.statut)).length;
  const selectionnee = visibles.find((i) => i.id === selection) ?? null;

  return (
    <>
      <div className="entete">
        <div>
          <h1>Carte live</h1>
          <div className="sous-titre">
            Odoo : {donnees?.odoo ?? '—'} intervention(s) · GestCo : {donnees?.hfsql ?? '—'} · position = site de la mission
          </div>
        </div>
        <button type="button" className="btn" onClick={() => { api.viderCache().then(recharger); }}>Actualiser</button>
      </div>

      <form className="filtres" aria-label="Filtres" onSubmit={(e) => e.preventDefault()}>
        <label className="champ">Jour<input type="date" value={jour} onChange={(e) => setJour(e.target.value)} /></label>
        <Choix libelle="Technicien" valeur={technicien} onChange={setTechnicien} options={options.techniciens} tous="Tous" />
        <Choix libelle="Client" valeur={client} onChange={setClient} options={options.clients} tous="Tous les clients" />
        <Choix libelle="Société" valeur={societe} onChange={setSociete} options={options.societes} tous="Toutes" />
      </form>

      <EtatChargement chargement={chargement} erreur={erreur} />
      <Avertissements liste={donnees?.avertissements} />

      <div className="kpis">
        <div className="kpi"><span>Sur site</span><strong style={{ color: '#1d4ed8' }}>{compter('sur_site')}</strong></div>
        <div className="kpi"><span>En cours</span><strong style={{ color: '#1d4ed8' }}>{compter('en_cours')}</strong></div>
        <div className="kpi"><span>Planifiées</span><strong style={{ color: '#b45309' }}>{compter('planifiee', 'a_planifier')}</strong></div>
        <div className="kpi"><span>Terminées</span><strong>{compter('terminee')}</strong></div>
      </div>

      <div className="rangee">
        <section className="carte large" aria-label="Carte des interventions">
          <h2>Position des interventions</h2>
          {CLE_MAPS ? (
            <APIProvider apiKey={CLE_MAPS} language="fr" region="FR">
              <div className="carte-google">
                <Map defaultCenter={FRANCE} defaultZoom={6} mapId={MAP_ID} gestureHandling="greedy">
                  {visibles.filter((i) => i.position).map((i) => (
                    <AdvancedMarker key={i.id} position={i.position!} title={`${i.client ?? i.titre} — ${LIBELLES_STATUT[i.statut]}`}
                      onClick={() => setSelection(i.id)}>
                      <div className="marqueur" style={{ background: COULEURS_STATUT[i.statut] }}>
                        {i.techniciens[0] ? initiales(i.techniciens[0]) : '?'}
                      </div>
                    </AdvancedMarker>
                  ))}
                  {selectionnee?.position && (
                    <InfoWindow position={selectionnee.position} onCloseClick={() => setSelection(null)}
                      headerContent={<strong>{selectionnee.client ?? selectionnee.titre}</strong>}>
                      <div>{selectionnee.titre}</div>
                      <div className="muet">{LIBELLES_STATUT[selectionnee.statut]} · {selectionnee.techniciens.join(', ') || 'aucun technicien'}</div>
                    </InfoWindow>
                  )}
                </Map>
              </div>
            </APIProvider>
          ) : (
            <div className="erreur">Clé Google Maps absente : renseigner VITE_GOOGLE_MAPS_API_KEY dans frontend/.env.</div>
          )}
          <p className="muet">Position = adresse du client de la mission (coordonnées Odoo, sinon géocodage Google).</p>
        </section>

        <section className="carte etroit" aria-label="Activité">
          <h2>Activité du jour</h2>
          {!chargement && !visibles.length && <div className="vide">Aucune intervention pour ces filtres.</div>}
          <div className="liste-activite">
            {visibles.map((i) => <LigneActivite key={i.id} i={i} active={i.id === selection} onClick={() => setSelection(i.id)} />)}
          </div>
        </section>
      </div>
    </>
  );
}

function LigneActivite({ i, active, onClick }: { i: Intervention; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`ligne-activite${active ? ' selectionnee' : ''}`} onClick={onClick}>
      <span className="pastille" style={{ background: COULEURS_STATUT[i.statut] }}>
        {i.techniciens[0] ? initiales(i.techniciens[0]) : '?'}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <strong>{i.techniciens.join(', ') || 'Non assignée'}</strong>
          <Badge type={i.statut}>{LIBELLES_STATUT[i.statut]}</Badge>
        </span>
        <span>{i.client ?? i.titre}{i.ville ? ` · ${i.ville}` : ''}</span>
        <span className="muet">
          {heure(i.debut) && `${heure(i.debut)}–${heure(i.fin)} · `}{i.source === 'odoo' ? 'Odoo' : 'GestCo'}
          {!i.position && ' · sans position'}
        </span>
      </span>
    </button>
  );
}

export function Choix({ libelle, valeur, onChange, options, tous }:
  { libelle: string; valeur: string; onChange: (v: string) => void; options: string[]; tous: string }) {
  return (
    <label className="champ">{libelle}
      <select value={valeur} onChange={(e) => onChange(e.target.value)}>
        <option value="">{tous}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
