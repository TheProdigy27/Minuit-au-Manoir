// Réglages partagés par le serveur et les navigateurs.
// Distances en cases (tuiles), durées en secondes, vitesses en cases par seconde.

export const TILE = { VOID: 0, FLOOR: 1, WALL: 2, LOW: 3, TALL: 4, EXIT: 5, STAIR: 6 };
// Par type de case : bloque le passage / bloque la lumière et la vue.
export const SOLID = [true, false, true, true, true, true, false];
export const OPAQUE = [true, false, true, false, true, true, false];

export const CFG = {
  tickRate: 30,
  player: { half: 0.28, walk: 2.7, run: 4.4, crawl: 0.75, ghost: 5.5, stamina: 4, staminaRegen: 0.55 },
  light: { range: 7.5, cone: 0.6, ambient: 1.5, drain: 0.6, pickup: 40 },
  monster: {
    half: 0.36,
    dormant: 15, // la créature dort au début de la partie
    speed: { wander: 1.6, investigate: 2.7, search: 0, chase: 3.7, flee: 3.8, retreat: 2.6 },
    perSkull: 0.07, // +7 % de vitesse par crâne trouvé
    exitBonus: 0.3, // +30 % quand la porte est ouverte
    sightLit: 9, // voit une lampe allumée de loin…
    sightDark: 3, // …mais un joueur dans le noir seulement de près
    catchDist: 0.75,
    stunNeed: 1.3, // secondes de lampe braquée pour la faire fuir
    fleeTime: 3.5,
    stunCooldown: 9, // ensuite elle s'habitue à la lumière un moment
    litSlow: 0.55,
    memory: 1.2, // continue de vous suivre un instant après vous avoir perdu de vue
    boredom: 40, // sans piste, finit par « flairer » un joueur
  },
  noise: {
    run: 8, walk: 2, skull: 18, battery: 5, revive: 3,
    hide: 2.5, // la porte d'une cachette qui grince, en y entrant ou en sortant
    // La créature entend aussi le chat vocal. Le niveau de chaque trame (voice.js) compare la voix à la
    // façon habituelle de parler du joueur : une voix normale (pics vers `db` dB) porte à `r` cases, deux
    // fois plus loin tous les 6 dB de plus, au plus à `max`. Dès `shout` cases, un cri traverse les murs
    // sans s'affaiblir et s'entend à l'étage voisin. Moins de `min` : un murmure, elle ne l'entend pas.
    // Le bruit retombe de `fade` cases par seconde entre deux syllabes.
    voice: { db: -18, r: 5, min: 1.2, max: 16, shout: 12, fade: 20 },
  },
  // Chat vocal de proximité : au-delà de `range` cases (un étage d'écart en compte 8 de plus), on
  // n'entend plus quelqu'un ; jusqu'à `near`, on l'entend à plein volume.
  voice: { range: 20, near: 1.5 },
  // Cachettes (armoires, buffets, dessous des lits, cercueils) : on s'y glisse à moins de `reach` cases
  // du meuble. Caché·e, la créature ne vous voit pas et ne peut pas vous attraper… sauf si elle vous a vu
  // y entrer (`seen`), ou si elle vous entend (votre voix, la porte qui grince) à moins de `hear` cases :
  // elle vient alors vous en tirer (`seen: false, hear: 0` : on y est toujours à l'abri). Au moins une
  // cellule sur `spread` de chaque étage en a une.
  hide: { reach: 1.1, hear: 2.5, seen: true, spread: 2 },
  rules: { bleedOut: 50, reviveTime: 3, reviveDist: 1.3, pickupDist: 0.75, pingCooldown: 3, disconnectGrace: 45, reviveImmunity: 2 },
};

export const DIFFICULTY = {
  facile: { label: 'Facile', speed: 0.88, sight: 0.85, drain: 0.7, bleed: 1.4, skulls: 0, monsters: 0 },
  normal: { label: 'Normal', speed: 1, sight: 1, drain: 1, bleed: 1, skulls: 0, monsters: 0 },
  cauchemar: { label: 'Cauchemar', speed: 1.1, sight: 1.2, drain: 1.3, bleed: 0.7, skulls: 1, monsters: 1 },
};

export const COLORS = ['#f0a030', '#4fc3f7', '#ef5350', '#9ccc65', '#ba68c8', '#ffd54f', '#f06292', '#4db6ac'];

export const PLAYER_STATES = ['alive', 'down', 'dead', 'escaped', 'spectator'];
export const MONSTER_STATES = ['dormant', 'wander', 'investigate', 'search', 'chase', 'flee', 'retreat'];

// Portée de la lampe selon la batterie : elle faiblit sous 25 %.
export const batteryFactor = b => (b >= 25 ? 1 : 0.45 + 0.55 * (b / 25));

// Distance (en cases) à laquelle la créature entend une trame de voix de niveau `db` (0 : pas du tout).
export function voiceNoise(db) {
  const V = CFG.noise.voice, r = V.r * 2 ** ((db - V.db) / 6);
  return r < V.min ? 0 : Math.min(V.max, r);
}
