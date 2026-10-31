// Réglages partagés par le serveur et les navigateurs.
// Distances en cases (tuiles), durées en secondes, vitesses en cases par seconde.

export const TILE = { VOID: 0, FLOOR: 1, WALL: 2, LOW: 3, TALL: 4, EXIT: 5 };
// Par type de case : bloque le passage / bloque la lumière et la vue.
export const SOLID = [true, false, true, true, true, true];
export const OPAQUE = [true, false, true, false, true, true];

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
  noise: { run: 8, walk: 2, skull: 18, battery: 5, revive: 3 },
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
