// Qualité graphique (options, onglet Graphismes) : préréglages et réglages détaillés. Tous changent en
// jeu sans recompiler un seul shader (voir Renderer.setQuality) : aucun ne touche au nombre de lumières
// ni aux defines des matériaux, ce qui figerait le jeu plusieurs secondes.
//
//  scale   : résolution du rendu 3D, part des pixels de l'écran (au plus 1,5 pixel par pixel CSS)
//  msaa    : lissage des bords (échantillons par pixel, 0 : aucun)
//  shadows : taille de la carte des ombres de sa lampe (0 : pas d'ombres)
//  lights  : bougies et lueurs qui éclairent réellement la scène (les plus proches)
//  beam    : pas de calcul du faisceau visible dans la poussière (0 : pas de faisceau)
//  bloom   : halo autour des lumières vives
//  aniso   : filtrage anisotrope des textures (netteté des sols et des murs vus de biais)
export const PRESETS = {
  low: { scale: 0.7, msaa: 0, shadows: 1024, lights: 6, beam: 0, bloom: 0, aniso: 1 },
  medium: { scale: 0.85, msaa: 0, shadows: 1024, lights: 9, beam: 8, bloom: 1, aniso: 4 },
  high: { scale: 1, msaa: 4, shadows: 2048, lights: 12, beam: 16, bloom: 1, aniso: 16 },
  ultra: { scale: 1, msaa: 8, shadows: 4096, lights: 12, beam: 24, bloom: 1, aniso: 16 },
};
// 'auto' part des valeurs de 'high' et les baisse si les images ralentissent (Renderer.adapt) ;
// 'custom' : ses propres valeurs.
export const PRESET_NAMES = ['auto', ...Object.keys(PRESETS), 'custom'];
export const KEYS = Object.keys(PRESETS.high);

// Valeurs proposées pour chaque réglage (scale : un curseur).
export const CHOICES = {
  msaa: [0, 2, 4, 8],
  shadows: [0, 1024, 2048, 4096],
  lights: [6, 9, 12],
  beam: [0, 8, 16, 24],
  bloom: [0, 1],
  aniso: [1, 4, 8, 16],
  fps: [30, 60, 0], // 0 : autant que l'écran en affiche
};
export const SCALE = { min: 0.5, max: 1, step: 0.05 };
export const DEFAULT = { preset: 'auto', fps: 60 };

// Ce que la carte graphique sait faire : { msaa, aniso } maximums.
const fits = (key, v, limits) => !limits || !(key in limits) || v <= limits[key];

// La plus grande valeur proposée qui ne dépasse ni `v` ni ce que sait faire la carte.
function clampTo(key, v, limits) {
  if (typeof v !== 'number' && typeof v !== 'string') v = NaN;
  if (!Number.isFinite(+v)) v = PRESETS.high[key];
  if (key === 'scale') {
    const s = Math.round(+v / SCALE.step) * SCALE.step;
    return Math.min(SCALE.max, Math.max(SCALE.min, Math.round(s * 100) / 100));
  }
  const ok = CHOICES[key].filter(c => c <= +v && fits(key, c, limits));
  return ok.length ? Math.max(...ok) : Math.min(...CHOICES[key]);
}

// Réglages lus dans la sauvegarde (texte JSON) ; corrigés s'ils sont abîmés ou d'une autre version.
export function parse(text) {
  let o = null;
  try { o = JSON.parse(text); } catch {}
  if (!o || typeof o !== 'object') return { ...DEFAULT };
  const s = {
    preset: PRESET_NAMES.includes(o.preset) ? o.preset : DEFAULT.preset,
    fps: CHOICES.fps.includes(o.fps) ? o.fps : DEFAULT.fps,
  };
  if (s.preset === 'custom') for (const k of KEYS) s[k] = clampTo(k, o[k] ?? PRESETS.high[k]);
  return s;
}

// Ce qu'on sauvegarde : le préréglage seul (ses valeurs peuvent changer d'une version à l'autre), ou
// toutes les valeurs d'un réglage personnalisé.
export function serialize(s) {
  const o = { preset: s.preset, fps: s.fps };
  if (s.preset === 'custom') for (const k of KEYS) o[k] = s[k];
  return JSON.stringify(o);
}

// Valeurs effectives, bornées à ce que sait faire la carte graphique.
export function resolve(s, limits) {
  const src = s.preset === 'custom' ? s : PRESETS[s.preset === 'auto' ? 'high' : s.preset];
  const v = {};
  for (const k of KEYS) v[k] = clampTo(k, src[k] ?? PRESETS.high[k], limits);
  return v;
}

// Le préréglage dont ces valeurs sont celles (sur cette carte graphique), sinon 'custom'.
export function matching(values, limits) {
  for (const name of Object.keys(PRESETS)) {
    const p = resolve({ preset: name }, limits);
    if (KEYS.every(k => p[k] === values[k])) return name;
  }
  return 'custom';
}

// Un réglage détaillé change : le préréglage qui correspond aux nouvelles valeurs, ou 'custom'.
export function change(s, key, value, limits) {
  if (key === 'fps') return CHOICES.fps.includes(+value) ? { ...s, fps: +value } : s;
  const v = { ...resolve(s, limits), [key]: clampTo(key, value, limits) };
  const preset = matching(v, limits);
  return preset === 'custom' ? { preset, fps: s.fps, ...v } : { preset, fps: s.fps };
}

// Choix d'un préréglage.
export function choose(s, preset) {
  if (!PRESET_NAMES.includes(preset) || preset === 'custom') return s;
  return { preset, fps: s.fps };
}

// Une image sur combien d'appels de l'écran (rafraîchi toutes les `refresh` ms) pour en montrer au plus
// `fps` par seconde (0 : toutes).
export function frameSkip(fps, refresh) {
  if (!fps) return 1;
  return Math.max(1, Math.floor(1000 / fps / refresh + 0.1));
}
