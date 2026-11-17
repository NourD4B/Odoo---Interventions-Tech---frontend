// Réglages de planification d'un service, absents d'Odoo : taille de l'équipe sur place, type de service, compétences
// requises et, si le géocodage a échoué ou est approximatif, position du site. Onglet « Réglages » de la fiche du service
// (Planification), seul endroit où ils se modifient ; tout le reste se modifie dans Odoo (Services sur site).
import { useEffect, useState } from 'react';
import { CircleMarker, MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import {
  ErreurPlanif, erreursParChamp, LIBELLES_PRECISION, planif, type ReglagesPlanif, type Referentiels, type ServicePlanif,
} from '../planification';

const CENTRE_FRANCE: [number, number] = [46.6, 2.4];
/** Identifiant du formulaire : le bouton « Enregistrer les réglages » du pied de la fiche le soumet (attribut form). */
export const FORMULAIRE_REGLAGES = 'pf-formulaire-reglages';

function ClicCarte({ actif, onClic }: { actif: boolean; onClic: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => { if (actif) onClic(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))); } });
  return null;
}

function reglagesDe(s: ServicePlanif): ReglagesPlanif {
  return { type_service_id: s.type_service_id, nb_techniciens: s.nb_techniciens, competences_requises: s.competences_requises,
    vehicule_requis: s.vehicule_requis, fenetre_debut: s.fenetre_debut, fenetre_fin: s.fenetre_fin,
    site_lat: s.site_lat, site_lng: s.site_lng };
}

/** Mêmes réglages (compétences comparées sans tenir compte de l'ordre des cases cochées). */
function memes(a: ReglagesPlanif, b: ReglagesPlanif): boolean {
  const norme = (x: ReglagesPlanif) => JSON.stringify({ ...x, competences_requises: [...x.competences_requises].sort() });
  return norme(a) === norme(b);
}

/** Site qui demande une action ici : sans position, ou placé au centre de la commune seulement. */
export const siteARegler = (s: ServicePlanif) => s.site_lat === null || s.site_precision === 'commune';

export default function ReglagesService({ service: s, refs, ecrire, corrigerPosition = false, onEtat, onEnregistre,
  onConflit }: {
  service: ServicePlanif; refs: Referentiels;
  ecrire: <T>(action: () => Promise<T>) => Promise<T | undefined>;
  corrigerPosition?: boolean;                                   // ouvert par « Placer le site »
  onEtat: (etat: { modifie: boolean; envoi: boolean }) => void;  // pour le bouton du pied de la fiche
  onEnregistre: (r: ServicePlanif) => void;
  onConflit: () => void;
}) {
  const publie = s.statut_planification === 'publie';
  const [r, setR] = useState<ReglagesPlanif>(() => reglagesDe(s));
  const [corriger, setCorriger] = useState(!publie && (corrigerPosition || s.site_lat === null));
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<{ texte: string; conflit: boolean } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const maj = (champs: Partial<ReglagesPlanif>) => {
    setR((x) => ({ ...x, ...champs }));
    setErreurs((e) => Object.fromEntries(Object.entries(e).filter(([k]) =>
      !(k in champs) && !(k === 'position' && 'site_lat' in champs))));
  };
  const type = refs.types_service.find((t) => t.id === r.type_service_id);
  const position: [number, number] | null = r.site_lat !== null && r.site_lng !== null ? [r.site_lat, r.site_lng] : null;
  const positionModifiee = position !== null && (r.site_lat !== s.site_lat || r.site_lng !== s.site_lng);
  const nb = Number.isFinite(r.nb_techniciens) ? r.nb_techniciens : 1;
  const modifie = !memes(r, reglagesDe(s));

  useEffect(() => { onEtat({ modifie, envoi }); }, [modifie, envoi, onEtat]);

  const choisirType = (id: number | null) => {
    const t = refs.types_service.find((x) => x.id === id);
    maj(t ? { type_service_id: id, nb_techniciens: t.nb_techniciens_defaut, competences_requises: t.competences,
      vehicule_requis: t.vehicule_requis } : { type_service_id: null });
  };
  const basculer = (code: string) => maj({ competences_requises: r.competences_requises.includes(code)
    ? r.competences_requises.filter((c) => c !== code) : [...r.competences_requises, code] });

  const enregistrer = async () => {
    setErreurs({}); setErreur(null);
    const locales: Record<string, string> = {};
    if (!Number.isInteger(r.nb_techniciens) || r.nb_techniciens < 1 || r.nb_techniciens > 10)
      locales.nb_techniciens = 'Entre 1 et 10 techniciens';
    if (corriger && position === null) locales.position = 'Cliquer sur la carte pour placer le site, ou annuler la correction';
    if (Object.keys(locales).length) { setErreurs(locales); return; }
    const corps = { ...r, version: s.version, fenetre_debut: r.fenetre_debut || null, fenetre_fin: r.fenetre_fin || null,
      ...(positionModifiee ? {} : { site_lat: null, site_lng: null }) };       // null = position inchangée
    setEnvoi(true);
    try {
      const fini = await ecrire(() => planif.modifierPlanification(s.id, corps));
      if (fini) onEnregistre(fini);
    } catch (e) {
      const parChamp = erreursParChamp(e);
      setErreurs(parChamp);
      setErreur({ conflit: e instanceof ErreurPlanif && e.statut === 409, texte: Object.keys(parChamp).length
        ? 'Corriger les champs signalés.' : e instanceof Error ? e.message : String(e) });
    } finally { setEnvoi(false); }
  };

  const etatPosition = positionModifiee ? `Nouvelle position ${r.site_lat}, ${r.site_lng} : enregistrée comme saisie à la main`
    : s.site_lat === null ? "Adresse introuvable par le géocodage : placer le site sur la carte, ou corriger l'adresse dans Odoo"
    : `Géocodée depuis l'adresse Odoo, ${LIBELLES_PRECISION[s.site_precision ?? ''] ?? s.site_precision ?? 'précision inconnue'}`;

  return (
    <form id={FORMULAIRE_REGLAGES} className="pf-reglages" noValidate onSubmit={(e) => { e.preventDefault(); void enregistrer(); }}>
      {publie && <p className="pf-reglages-fige">Service publié : réglages figés. Pour les modifier, retirer d'abord la
        publication (onglet « Affectation »).</p>}
      {erreur && (
        <div className="erreur" role="alert">{erreur.texte}
          {erreur.conflit && <> <button type="button" className="btn btn-petit" onClick={onConflit}>Recharger</button></>}
        </div>
      )}

      <fieldset disabled={publie || envoi} className="pf-reglages-champs">
        <legend className="visuellement-cache">Réglages de planification</legend>
        <section className="pf-section pf-reglage-ligne" aria-labelledby="pf-libelle-nb">
          <div>
            <h3 id="pf-libelle-nb">Techniciens sur place</h3>
            <p className="pf-aide">Taille de l'équipe, absente d'Odoo. Le temps alloué se répartit entre eux.</p>
          </div>
          <div className="sv-pas" role="group" aria-labelledby="pf-libelle-nb">
            <button type="button" aria-label="Un technicien de moins" disabled={nb <= 1}
                    onClick={() => maj({ nb_techniciens: Math.max(1, nb - 1) })}>−</button>
            <input type="number" min={1} max={10} step={1} value={r.nb_techniciens} aria-labelledby="pf-libelle-nb"
                   aria-invalid={!!erreurs.nb_techniciens} onChange={(e) => maj({ nb_techniciens: Number(e.target.value) })} />
            <button type="button" aria-label="Un technicien de plus" disabled={nb >= 10}
                    onClick={() => maj({ nb_techniciens: Math.min(10, nb + 1) })}>+</button>
          </div>
          {erreurs.nb_techniciens && <span className="erreur-champ" role="alert">{erreurs.nb_techniciens}</span>}
        </section>

        {refs.types_service.length > 0 && (
          <section className="pf-section" aria-labelledby="pf-libelle-type">
            <h3 id="pf-libelle-type">Type de service</h3>
            <select className="pf-select" aria-labelledby="pf-libelle-type" value={r.type_service_id ?? ''}
                    onChange={(e) => choisirType(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Aucun</option>
              {refs.types_service.map((t) => <option key={t.id} value={t.id}>{t.nom}</option>)}
            </select>
            {type && <p className="pf-aide">Valeurs du type appliquées. Durée habituelle {type.duree_defaut_h} h ; la durée
              retenue reste le temps alloué dans Odoo.</p>}
          </section>
        )}

        {refs.competences_actives && (
          <section className="pf-section" aria-labelledby="pf-libelle-competences">
            <div className="pf-section-tete"><h3 id="pf-libelle-competences">Compétences requises</h3>
              <span className="pf-aide">aucune : tout technicien terrain</span></div>
            <div className="pf-puces" role="group" aria-labelledby="pf-libelle-competences">
              {refs.competences.map((c) => (
                <label key={c.code} className="pf-puce"><input type="checkbox" checked={r.competences_requises.includes(c.code)}
                  onChange={() => basculer(c.code)} /><span>{c.libelle}</span></label>
              ))}
            </div>
          </section>
        )}
      </fieldset>

      <section className="pf-section pf-position" aria-labelledby="pf-libelle-position">
        <div className="pf-position-tete">
          <div>
            <h3 id="pf-libelle-position">Position du site</h3>
            <p className="pf-adresse">{s.site_adresse ?? 'Adresse non renseignée dans Odoo'}</p>
            <p className={`pf-aide${!positionModifiee && siteARegler(s) ? ' precision-faible' : ''}`}>{etatPosition}</p>
          </div>
          {!publie && (corriger
            ? s.site_lat !== null && <button type="button" className="btn btn-petit" disabled={envoi} onClick={() => {
                setCorriger(false); maj({ site_lat: s.site_lat, site_lng: s.site_lng }); }}>Annuler la correction</button>
            : <button type="button" className="btn btn-petit" disabled={envoi} onClick={() => setCorriger(true)}>Corriger la position</button>)}
        </div>
        {corriger && !publie && <p className="pf-consigne">Cliquer sur la carte à l'endroit de l'intervention.</p>}
        {erreurs.position && <span className="erreur-champ" role="alert">{erreurs.position}</span>}
        <div className={`carte-site pf-carte${corriger && !publie ? ' carte-site-active' : ''}`}>
          <MapContainer center={position ?? CENTRE_FRANCE} zoom={position ? 15 : 5} scrollWheelZoom={corriger}
                        style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19}
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
            <ClicCarte actif={corriger && !publie && !envoi} onClic={(lat, lng) => maj({ site_lat: lat, site_lng: lng })} />
            {position && <CircleMarker center={position} radius={9}
              pathOptions={{ color: '#fff', weight: 2, fillColor: positionModifiee ? '#eb6834' : '#1d4ed8', fillOpacity: 1 }} />}
          </MapContainer>
        </div>
      </section>
    </form>
  );
}
