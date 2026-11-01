// Rendu en première personne (three.js) : le manoir en volume, la lampe torche et les bougies,
// les autres joueurs, la créature et les objets. L'interface est dessinée par-dessus (hud.js).
import * as THREE from '/vendor/three.module.min.js';
import { TILE, CFG, batteryFactor } from '/shared/config.js';
import { tileAt, lineOfSight } from '/shared/physics.js';
import { mulberry32 } from '/shared/map.js';
import * as art from './art.js';
import { surface, shine, meters, setAnisotropy, setCompression, setEnvironment, texturesReady, nightEnvironment } from './materials.js';
import { Post } from './post.js';
import { playerBody, monsterLimbs, AIM } from './figures.js';
import { Hud } from './hud.js';

export const WALL_H = 2.6; // hauteur sous plafond (une case = un mètre)
const DOOR_H = 2.15;
const TAU = Math.PI * 2;
const SLOTS = 12; // bougies et lueurs éclairant réellement la scène (les plus proches)
const BEAMS = 3; // lampes des autres joueurs qui éclairent la scène
const EYE = { alive: 1.55, down: 0.4, dead: 1.65 };
const DIRS4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const LAMP = 38; // intensité de la lampe torche (au centre du faisceau)
const GLOW = 2.2; // intensité des bougies, lustres, feux et lueurs
const DUST = 0.0025; // poussière en suspension : rend visible le faisceau de sa lampe
const GREEN = new THREE.Color().setRGB(80 / 255, 1, 120 / 255, THREE.SRGBColorSpace);
const PING = new THREE.Color().setRGB(140 / 255, 180 / 255, 1, THREE.SRGBColorSpace);
const OUTSIDE = new THREE.Color().setRGB(150 / 255, 1, 190 / 255, THREE.SRGBColorSpace);
const PINGS = 8; // signes de fantômes affichés en même temps, préparés d'avance

// Une lumière qui n'atteint pas le pixel (au-delà de sa portée, hors de son cône) n'est pas calculée :
// même image, mais chaque bougie n'éclaire qu'une petite partie de l'écran.
THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replaceAll(
  'RE_Direct( directLight,', 'if ( any( greaterThan( directLight.color, vec3( 0.0 ) ) ) ) RE_Direct( directLight,');

// Lampe tenue en main et ses chromes : matières aussi utilisées par les lampes des autres joueurs.
const ALU = { set: 'iron', channel: 0, scale: 0.03, color: 0x4a4a50, metalness: 1, roughness: 0.32, rough: false, ao: 0, detail: 0.15, normal: 0.5, noShadow: true };
const CHROME = { color: '#c8c8cc', metalness: 1, roughness: 0.18 };

// Matière photographiée sous chaque sol dessiné.
const FLOOR_SET = { checker: 'checker', wood: 'floorboards', parquet: 'parquet', carpet: 'carpet', stone: 'flagstone', marble: 'marble', planks: 'planks', tiles: 'tiles' };
// Dessus des meubles (motif du plan) : matière photographiée selon le meuble, du bois sinon.
const TOP_SET = {
  bed: 'linen', altar: 'stone', sarcophagus: 'stone', fountain: 'stone', pedestal: 'stone', statue: 'stone', counter: 'marble', island: 'marble',
  bathtub: 'tiles', sink: 'tiles', stove: 'iron', cauldron: 'iron', barrel: 'roughwood', fireplace: 'stone', sofa: 'velvet', armchair: 'velvet',
};
// Côtés des meubles : [matière photographiée, part de sa couleur, force du relief du motif, échelle].
const SIDE_SET = {
  potions: ['wood', 0.25, 2, 1], wardrobe: ['wood', 0.8, 4, 1], cabinet: ['wood', 0.7, 4, 1], drawers: ['wood', 0.8, 4, 1],
  kitchen: ['wood', 0.5, 4, 1], stove: ['iron', 0.6, 3, 1], crate: ['roughwood', 0.8, 3, 0.7], barrel: ['roughwood', 0.8, 3, 0.7], altar: ['stone', 0.8, 2, 1], tomb: ['stone', 0.9, 5, 0.5],
  clock: ['wood', 0.7, 3, 1], fireplace: ['stonewall', 0.9, 2, 0.6], crib: ['wood', 0.6, 2, 1], toy: ['wood', 0.6, 3, 1], door: ['roughwood', 0.7, 3, 1],
};

// Faisceau des autres joueurs : un cône additif, plus dense là où le regard le traverse en son milieu
// et qui s'efface sur les bords (on n'y voit plus une plaque).
const BEAM_VERT = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPos;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vNormal = normalMatrix * normal;
  vPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const BEAM_FRAG = `
uniform sampler2D map;
uniform float opacity;
uniform vec3 color;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPos;
void main() {
  float facing = abs( dot( normalize( vNormal ), normalize( -vPos ) ) );
  gl_FragColor = vec4( color, texture2D( map, vUv ).a * opacity * facing * facing );
}`;

// teint, cheveux et yeux des joueurs (selon leur numéro)
const TONES = ['#e3b896', '#c18f69', '#8a5a3c', '#f0cdb2', '#6b4430', '#d9a982', '#a87650', '#ecc3a2'];
const HAIRS = ['#2a1c12', '#5a3a22', '#15110e', '#7a5530', '#9a7a4a', '#1e1814', '#3a2418', '#b09070'];
const IRISES = ['#5a3a1c', '#3a5a7a', '#4a5a30', '#2a1a10', '#6a7a8a', '#4a3020', '#3a4a5a'];

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const lerp = (a, b, k) => a + (b - a) * k;

// Matrice de placement : position, rotations (lacet, puis tangage, puis roulis), échelle.
function mat(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(v3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), v3(sx, sy, sz));
}

// Une fois le motif envoyé à la carte graphique, sa toile ne sert plus : sa mémoire est rendue (plus
// de 100 Mo en tout pour le plan, les murs, les meubles et les livres).
function release(t) {
  t.image.width = t.image.height = 1;
}

function flicker(l, t) {
  if (l.k === 'moon') return 0.9 + 0.05 * Math.sin(t * 0.7 + l.ph);
  if (l.k === 'fire') return 0.8 + 0.12 * Math.sin(t * 11 + l.ph) + 0.08 * Math.sin(t * 23 + l.ph * 2);
  return 0.85 + 0.08 * Math.sin(t * 9 + l.ph) + 0.06 * Math.sin(t * 17.3 + l.ph * 3);
}

// Coordonnées en mètres (canal d'UV 1) où se posent les matières photographiées : alignées sur le
// manoir pour qu'elles se raccordent d'un pan à l'autre, et orientées comme les motifs dessinés
// (u vers la droite de la face vue de devant, v vers le haut ; vers le nord sur les faces horizontales).
function worldUV(p, n) {
  if (Math.abs(n.y) > 0.7) return [p.x, -p.z];
  const l = Math.hypot(n.x, n.z) || 1;
  return [(p.x * n.z - p.z * n.x) / l, p.y];
}

// ---------------------------------------------------------------------------
// Géométrie fixe, regroupée par matériau : quelques dizaines d'appels de dessin pour tout le manoir.
// Les matériaux marqués `userData.plan` reçoivent le plan dessiné (sol, dessus des meubles).
// ---------------------------------------------------------------------------

// Livre debout, posé sur y = 0 : dos arrondi tourné vers -z (vers la pièce), plats de part et
// d'autre (x = ±t/2), tranche des pages au fond (z = d). UV dans l'atlas des livres (art.bookAtlas).
function bookGeo(t, h, d, col, rnd) {
  const pos = [], nor = [], uv = [], N = art.BOOK_COLS;
  const bulge = Math.min(0.007, t * 0.2), su = col / N, cu = 0.5 + col / (2 * N), pu = rnd() * (0.5 - t * 2);
  // quadrilatère p (normales n, UV q), ses deux triangles tournés vers out
  const face = (p, n, q, out) => {
    const e1 = tmp.subVectors(p[1], p[0]), e2 = tmp2.subVectors(p[2], p[0]);
    const order = e1.cross(e2).dot(out) >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const i of order) {
      pos.push(p[i].x, p[i].y, p[i].z);
      nor.push(n[i].x, n[i].y, n[i].z);
      uv.push(q[i][0], q[i][1]);
    }
  };
  // dos : demi-ellipse de 4 facettes, normales arrondies
  const arc = [];
  for (let i = 0; i <= 4; i++) {
    const a = (Math.PI * i) / 4, x = (-Math.cos(a) * t) / 2, z = -Math.sin(a) * bulge;
    arc.push({ x, z, n: v3(x / ((t * t) / 4), 0, z / (bulge * bulge)).normalize() });
  }
  for (let i = 0; i < 4; i++) {
    const A = arc[i], C = arc[i + 1], u0 = su + (i / 4 / N) * 0.98 + 0.0002, u1 = su + ((i + 1) / 4 / N) * 0.98;
    face([v3(A.x, 0, A.z), v3(C.x, 0, C.z), v3(C.x, h, C.z), v3(A.x, h, A.z)], [A.n, C.n, C.n, A.n],
      [[u0, 0.25], [u1, 0.25], [u1, 0.999], [u0, 0.999]], v3((A.x + C.x) / 2, 0, -1));
  }
  // plats, tranche des pages
  const cov = [[cu + 0.001, 0], [cu + 1 / (2 * N) - 0.001, 0], [cu + 1 / (2 * N) - 0.001, 0.249], [cu + 0.001, 0.249]];
  for (const s of [-1, 1]) {
    const n = v3(s, 0, 0), x = (s * t) / 2;
    face([v3(x, 0, 0), v3(x, 0, d), v3(x, h, d), v3(x, h, 0)], [n, n, n, n], cov, n);
  }
  const back = v3(0, 0, 1), pg = (x, v) => [pu + (x + t / 2) * 2, v];
  face([v3(-t / 2, 0, d), v3(t / 2, 0, d), v3(t / 2, h, d), v3(-t / 2, h, d)], [back, back, back, back], [pg(-t / 2, 0.01), pg(t / 2, 0.01), pg(t / 2, 0.24), pg(-t / 2, 0.24)], back);
  // dessus : éventail depuis le milieu de la tranche
  const up = v3(0, 1, 0), mid = v3(0, h, d), rim = [...arc.map(p => v3(p.x, h, p.z)), v3(t / 2, h, d), v3(-t / 2, h, d)];
  const tuv = p => pg(p.x, 0.01 + Math.max(0, p.z / d) * 0.23);
  for (let i = 0; i < rim.length - 1; i++) {
    const a = rim[i], b = rim[i + 1];
    if (a.distanceTo(mid) < 1e-6 || b.distanceTo(mid) < 1e-6) continue;
    const e1 = tmp.subVectors(b, a), e2 = tmp2.subVectors(mid, a), tri = e1.cross(e2).y < 0 ? [a, mid, b] : [a, b, mid];
    for (const p of tri) {
      const q = tuv(p);
      pos.push(p.x, p.y, p.z);
      nor.push(up.x, up.y, up.z);
      uv.push(q[0], q[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

class Builder {
  constructor(mw, mh) {
    this.mw = mw;
    this.mh = mh;
    this.parts = new Map();
  }

  part(m) {
    let p = this.parts.get(m);
    if (!p) this.parts.set(m, (p = { pos: [], nor: [], uv: [], uv1: [] }));
    return p;
  }

  planUV(x, z) {
    return [x / this.mw, 1 - z / this.mh];
  }

  // Quadrilatère a b c d, dans le sens trigonométrique vu de face.
  quad(m, a, b, c, d, uv = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    if (m.userData.plan) uv = [a, b, c, d].map(v => this.planUV(v.x, v.z));
    const p = this.part(m);
    const n = tmp.subVectors(b, a).cross(tmp2.subVectors(d, a)).normalize();
    const pts = [a, b, c, d];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      p.pos.push(pts[i].x, pts[i].y, pts[i].z);
      p.nor.push(n.x, n.y, n.z);
      p.uv.push(uv[i][0], uv[i][1]);
      p.uv1.push(...worldUV(pts[i], n));
    }
  }

  // Pan de mur d'une case, centré en (cx, cz), tourné vers (nx, nz) ; `variant` choisit la colonne de l'atlas.
  wall(m, cx, cz, nx, nz, y0, y1, variant) {
    const rx = nz * 0.5, rz = -nx * 0.5;
    const u0 = variant / 3 + 0.002, u1 = (variant + 1) / 3 - 0.002, v0 = y0 / WALL_H, v1 = y1 / WALL_H;
    this.quad(m, v3(cx - rx, y0, cz - rz), v3(cx + rx, y0, cz + rz), v3(cx + rx, y1, cz + rz), v3(cx - rx, y1, cz - rz), [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  }

  // Pavé. Côtés : u en mètres le long de chaque face (ou de 0 à 1 si `o.fit`) ; v en mètres
  // (motif qui se répète), ou de 0 à 1 sur la hauteur si `o.unit` (texture dessinée pour cette hauteur).
  box(x0, y0, z0, x1, y1, z1, top, side, o = {}) {
    if (side) {
      const v0 = o.unit ? 0 : y0, v1 = o.unit ? 1 : y1;
      for (const [ax, az, bx, bz] of [[x0, z1, x1, z1], [x1, z0, x0, z0], [x1, z1, x1, z0], [x0, z0, x0, z1]]) {
        const len = o.fit ? 1 : Math.hypot(bx - ax, bz - az);
        this.quad(side, v3(ax, y0, az), v3(bx, y0, bz), v3(bx, y1, bz), v3(ax, y1, az), [[0, v0], [len, v0], [len, v1], [0, v1]]);
      }
    }
    const flat = [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
    if (top) this.quad(top, v3(x0, y1, z1), v3(x1, y1, z1), v3(x1, y1, z0), v3(x0, y1, z0), o.topUnit ? [[0, 0], [1, 0], [1, 1], [0, 1]] : flat);
    if (o.bottom) this.quad(o.bottom, v3(x0, y0, z0), v3(x1, y0, z0), v3(x1, y0, z1), v3(x0, y0, z1), flat);
  }

  // Géométrie three.js quelconque, placée par une matrice. Avec `plan` (un matériau de plan), les faces
  // tournées vers le haut reçoivent le plan dessiné (dessus des tonneaux, cercueils…). `size` : taille
  // en mètres des UV du modèle (tour et hauteur d'un cylindre…) ; sans elle, projection sur le manoir.
  geo(m, g, matrix, plan = null, size = null) {
    const src = g.index ? g.toNonIndexed() : g;
    if (matrix) src.applyMatrix4(matrix);
    const pos = src.attributes.position.array, nor = src.attributes.normal.array, uv = src.attributes.uv?.array;
    for (let i = 0; i < pos.length / 3; i += 3) {
      const nx = nor[i * 3] + nor[i * 3 + 3] + nor[i * 3 + 6], ny = nor[i * 3 + 1] + nor[i * 3 + 4] + nor[i * 3 + 7], nz = nor[i * 3 + 2] + nor[i * 3 + 5] + nor[i * 3 + 8];
      const up = plan && ny > 2.85;
      const p = this.part(up ? plan : m);
      const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
      for (let j = i; j < i + 3; j++) {
        const x = pos[j * 3], y = pos[j * 3 + 1], z = pos[j * 3 + 2];
        p.pos.push(x, y, z);
        p.nor.push(nor[j * 3], nor[j * 3 + 1], nor[j * 3 + 2]);
        if (up) p.uv.push(...this.planUV(x, z));
        else p.uv.push(uv ? uv[j * 2] : 0, uv ? uv[j * 2 + 1] : 0);
        if (size && uv && !up) p.uv1.push(uv[j * 2] * size[0], uv[j * 2 + 1] * size[1]);
        else if (ay >= ax && ay >= az) p.uv1.push(x, -z);
        else if (ax >= az) p.uv1.push(-z * Math.sign(nx), y);
        else p.uv1.push(x * Math.sign(nz), y);
      }
    }
    src.dispose();
    g.dispose();
  }

  // `depth` : la scène de la pré-passe de profondeur (voir Renderer.frame), qui reçoit les pans opaques.
  build(parent, depth) {
    for (const [m, p] of this.parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(p.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
      g.setAttribute('uv1', new THREE.Float32BufferAttribute(p.uv1, 2));
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = !m.userData.noShadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      if (!m.transparent && !m.alphaTest) {
        const z = new THREE.Mesh(g, DEPTH[m.side === THREE.DoubleSide ? 1 : 0]);
        z.matrixAutoUpdate = false;
        depth.add(z);
      }
    }
  }
}

// Pré-passe : la profondeur seule, un peu en retrait pour que le même pan la retrouve ensuite à coup sûr.
const DEPTH = [THREE.FrontSide, THREE.DoubleSide].map(side => new THREE.MeshBasicMaterial({
  side, colorWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
}));

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export class Renderer {
  constructor(canvas, hudCanvas) {
    this.cv = canvas;
    // pas d'anticrénelage sur le canvas : l'image est rendue (et lissée) hors écran, voir post.js
    const gl = (this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }));
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.25;
    gl.autoClear = false;
    this.aniso = gl.capabilities.getMaxAnisotropy();
    setAnisotropy(this.aniso);
    // reflets très atténués d'une pièce éclairée à la bougie, sur les matières brillantes seulement
    // (métaux, vernis, porcelaine) : sur le bois brut ou le plâtre, ils ne se voyaient pas et coûtaient cher
    this.env = nightEnvironment(gl);
    setEnvironment(this.env, 0.35);
    setCompression(gl.extensions.has('WEBGL_compressed_texture_s3tc_srgb') && gl.extensions.has('EXT_texture_compression_rgtc'));
    this.ready = texturesReady();
    this.post = new Post(gl);
    this.sides = new Map();
    this.walls = new Map();
    this.S = this.makeShared();

    // Le fond noir vient de gl.clear() (frame) : la scène ne doit pas effacer la pré-passe de profondeur.
    const scene = (this.scene = new THREE.Scene());
    scene.fog = this.fog = new THREE.FogExp2(0x000000, 0.075);
    this.depth = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.04, 90);
    this.camera.rotation.order = 'YXZ';
    this.vmCam = this.camera.clone();
    this.ambient = new THREE.AmbientLight(0x8a96c8, 0.12);
    scene.add(this.ambient);

    // La lampe torche : la seule lumière qui projette des ombres. Son verre et son réflecteur
    // dessinent un point chaud cerclé d'un anneau, puis un halo plus faible.
    this.lamp = new THREE.SpotLight(0xfff0d0, 0, 12, CFG.light.cone, 0.05, 1.5);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(2048, 2048);
    this.lamp.shadow.camera.near = 0.1;
    this.lamp.shadow.bias = -0.0002;
    this.lamp.shadow.normalBias = 0.02;
    this.lamp.map = new THREE.CanvasTexture(art.flashlightCookie()); // valeurs linéaires : pas de conversion sRGB
    scene.add(this.lamp, this.lamp.target);
    // Un peu de lumière autour de soi, pour voir où l'on met les pieds lampe éteinte.
    this.aura = new THREE.PointLight(0xd8c8b0, 0, 2.4, 2);
    scene.add(this.aura);
    this.slots = Array.from({ length: SLOTS }, () => {
      const l = new THREE.PointLight(0xffffff, 0, 4, 1); // atténuation douce : une bougie éclaire sa pièce
      scene.add(l);
      return l;
    });
    this.beams = Array.from({ length: BEAMS }, () => {
      const s = new THREE.SpotLight(0xfff0d0, 0, 9, CFG.light.cone, 0.5, 1.5);
      scene.add(s, s.target);
      return s;
    });

    this.vm = this.makeViewmodel();
    this.dust = this.makeDust();
    scene.add(this.dust.points);
    this.hud = new Hud(hudCanvas);
    this.world = null;
    this.owned = [];
    this.cand = [];
    this.lastT = 0;
    this.ghostView = false;
    this.quality = 1; // baisse toute seule si l'ordinateur peine (voir adapt)
    this.slow = 0;
    this.lastFrame = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.gl.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5) * this.quality);
    this.gl.setSize(innerWidth, innerHeight, false);
    const size = this.gl.getDrawingBufferSize(tmp2);
    this.post.setSize(size.x, size.y);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.hud.resize();
  }

  texture(cv, repeat = false) {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = this.aniso;
    t.onUpdate = release;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  // Relief d'un motif dessiné (toile de normales, sans correction de couleur).
  normalTexture(normals) {
    const t = new THREE.CanvasTexture(normals);
    t.anisotropy = this.aniso;
    t.onUpdate = release;
    return t;
  }

  bumpTexture(cv, strength, blur) {
    return this.normalTexture(art.normalFromCanvas(cv, strength, blur));
  }

  // Ressources propres à une partie, libérées à la suivante.
  own(x) {
    this.owned.push(x);
    return x;
  }

  makeShared() {
    const T = (cv, repeat) => this.texture(cv, repeat);
    const [pk, pkGlow] = art.pumpkinTextures();
    const sprite = (map, o = {}) => new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending, ...o });
    const glow = T(art.glowTexture());
    const painting = v => {
      const cv = art.paintingTexture(v);
      return surface({ map: T(cv), bump: this.bumpTexture(cv, 4, 1), bumpStrength: 1, set: 'linen', detail: 0.12, normal: 0.6, roughness: 0.55, scale: 0.6 });
    };
    // flamme plus vive que le blanc : elle déborde en halo au développement de l'image (post.js)
    const flame = sprite(T(art.flameTexture()), { color: new THREE.Color(3.2, 3, 2.8) });
    // mèches des cheveux : nuances et relief
    const strands = art.hairTexture(), hairMap = T(strands, true), hairNormal = this.bumpTexture(strands, 3, 1);
    for (const t of [hairMap, hairNormal]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(10, 3);
    }
    // livres reliés : atlas des dos dessinés sur le grain du cuir ; la dorure est métallique
    const atlas = art.bookAtlas();
    const books = surface({ map: T(atlas.color), bump: this.bumpTexture(atlas.height, 4, 1), set: 'leather', scale: 0.25, detail: 0.35, normal: 0.6, rough: false });
    books.roughnessMap = books.metalnessMap = this.normalTexture(atlas.arm);
    books.metalness = 1;
    shine(books);
    return {
      glow,
      smoke: T(art.smokeTexture()),
      beam: T(art.beamTexture()),
      mask: T(art.maskTexture()),
      seal: T(art.sealTexture()),
      night: T(art.nightTexture()),
      blood: T(art.bloodTexture()),
      flame,
      hairMap,
      hairNormal,
      books,
      windows: [false, true].map(moon => new THREE.MeshBasicMaterial({ map: T(art.windowTexture(moon)), color: 0x707070 })),
      paintings: [0, 1, 2, 3].map(painting),
      mirror: surface({ map: T(art.mirrorTexture()), transparent: true, alphaTest: 0.3, metalness: 0.9, roughness: 0.12 }),
      torn: surface({ map: T(art.tornTexture()), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, noShadow: true }),
      web: surface({ map: T(art.webTexture()), transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.45, noShadow: true }),
      sprite,
      m: {
        wood: surface({ set: 'wood', color: '#5a3622', roughness: 0.85, ao: 0.8 }),
        beam: surface({ set: 'wood', color: '#3a2618', roughness: 1, scale: 1.5 }),
        stone: surface({ set: 'stone', color: '#3e3d40', scale: 0.4, normal: 1.8 }),
        velvet: surface({ set: 'velvet', color: '#4a1020', scale: 1.5, physical: { sheen: 0.7, sheenColor: new THREE.Color('#a04858'), sheenRoughness: 0.5 } }),
        curtain: surface({ set: 'velvet', color: '#3e0c18', scale: 2, side: THREE.DoubleSide, physical: { sheen: 0.6, sheenColor: new THREE.Color('#8a3a48'), sheenRoughness: 0.6 } }),
        ceiling: surface({ set: 'ceiling', color: '#3a3032', scale: 1.5 }),
        marble: surface({ set: 'ceiling', color: '#a9a49c', roughness: 0.55, detail: 0.7, normal: 0.6, scale: 0.7 }),
        iron: surface({ set: 'iron', color: '#2a2726', metalness: 1, metalMap: true, roughness: 0.9, scale: 0.6 }),
        brass: surface({ set: 'iron', color: '#b08a3e', metalness: 1, roughness: 0.32, rough: false, detail: 0.25, normal: 0.35, scale: 0.4 }),
        gilt: surface({ set: 'iron', color: '#a8823a', metalness: 1, roughness: 0.38, rough: false, detail: 0.4, normal: 0.5, scale: 0.3 }),
        wax: surface({ color: '#e8dfc8', emissive: '#3a2a12', roughness: 0.5 }),
        enamel: surface({ set: 'plaster', color: '#d4cfc4', roughness: 0.18, rough: false, detail: 0.25, normal: 0.15 }),
        lacquer: surface({ color: '#0c0a0c', roughness: 0.35, physical: { clearcoat: 1, clearcoatRoughness: 0.06 } }),
        linen: surface({ set: 'linen', color: '#bdb4a2', normal: 0.8 }),
        bark: surface({ set: 'bark', color: '#3a2c22', scale: 0.4 }),
        leaf: surface({ color: '#3a3a1c', roughness: 0.55 }),
        terracotta: surface({ set: 'stone', color: '#8a4428', scale: 0.3 }),
        painted: surface({ set: 'wood', color: '#7a3a1a', roughness: 0.5, detail: 0.35, scale: 0.5 }),
        grass: surface({ set: 'ground', color: '#2a2a1c' }),
        skin: surface({ color: '#d9b894', roughness: 0.55 }),
        orb: surface({ color: '#2a3a5a', emissive: '#0a1a3a', roughness: 0.05, physical: { clearcoat: 1, clearcoatRoughness: 0.02 } }),
        brew: surface({ color: '#2f8a3a', emissive: '#1f7a2a', roughness: 0.1, noShadow: true }),
        pumpkin: surface({ map: T(pk), emissiveMap: T(pkGlow), emissive: '#ffffff', roughness: 0.6 }),
        chrome: surface(CHROME),
        // aluminium anodisé des lampes
        alu: surface(ALU),
        // personnages : cuir (bottines, gants, ceinture) teint par sommet, pantalon de laine, yeux
        leather: surface({ set: 'leather', channel: 0, scale: 0.35, vertexColors: true, roughness: 0.6, detail: 0.5, normal: 0.7 }),
        trousers: surface({ set: 'wool', channel: 0, scale: 0.8, color: '#2a2724', detail: 0.5 }),
        eyes: surface({ vertexColors: true, roughness: 0.35, noShadow: true, physical: { clearcoat: 0.6, clearcoatRoughness: 0.05 } }),
        // matières communes à tous les joueurs, teintes par sommet à leurs couleurs (un même matériau
        // pour tous : moins de changements d'état, et dessinés avant le décor qu'ils cachent)
        coat: surface({ set: 'wool', channel: 0, vertexColors: true, detail: 0.6 }),
        scarf: surface({ set: 'knit', channel: 0, scale: 0.7, vertexColors: true, detail: 0.7, normal: 1.2 }),
        skin: surface({ vertexColors: true, roughness: 0.55 }),
        hair: Object.assign(surface({ map: hairMap, vertexColors: true, roughness: 0.45 }), { normalMap: hairNormal }),
        socket: new THREE.MeshBasicMaterial({ color: 0x050302 }),
        bone: surface({ set: 'stone', channel: 0, scale: 0.08, color: '#ad9f80', detail: 0.55, roughness: 0.7, emissive: '#061a0a', vertexColors: true }),
      },
    };
  }

  wallMat(theme) {
    let m = this.walls.get(theme);
    if (!m) {
      const { color, bump } = art.wallAtlas(theme, WALL_H);
      m = bump
        ? surface({ map: this.texture(color), bump: this.normalTexture(bump), set: 'plaster', detail: 0.55, normal: 0.8 })
        : surface({ map: this.texture(color), set: 'stonewall', normal: 1.3 });
      this.walls.set(theme, m);
    }
    return m;
  }

  sideMat(kind, h) {
    const key = kind + h;
    let m = this.sides.get(key);
    if (!m) {
      const cv = art.sideTexture(kind, h);
      const t = this.texture(cv);
      t.wrapS = THREE.RepeatWrapping;
      const [set, detail, relief, scale] = SIDE_SET[kind] || ['wood', 0.6, 3, 1];
      const b = this.bumpTexture(cv, relief, 1);
      b.wrapS = THREE.RepeatWrapping;
      m = surface({ map: t, bump: b, set, detail, scale, metalness: kind === 'stove' ? 0.6 : 0 });
      if (kind === 'crib') {
        Object.assign(m, { alphaTest: 0.5, side: THREE.DoubleSide });
        m.userData.noShadow = true;
      }
      if (kind === 'potions') shine(Object.assign(m, { emissiveMap: t, emissive: new THREE.Color(0x555555), roughness: 0.4 }));
      this.sides.set(key, m);
    }
    return m;
  }

  // Sol d'une pièce : le plan dessiné (teinte, taches, ombres des meubles) sur la matière photographiée.
  floorMat(theme) {
    let m = this.floorMats.get(theme);
    if (!m) {
      const set = FLOOR_SET[(art.STYLE[theme] || art.STYLE.foyer).floor];
      m = this.own(surface({ map: this.planTex, set, roughness: set === 'carpet' ? 1 : 0.9 }));
      m.userData.plan = true;
      this.floorMats.set(theme, m);
    }
    return m;
  }

  // Dessus des meubles : le plan dessiné sur une matière photographiée.
  planMat(set) {
    let m = this.planMats.get(set);
    if (!m) {
      m = this.own(surface({ map: this.planTex, set, detail: 0.85, scale: set === 'linen' || set === 'velvet' ? 1.5 : 0.7, roughness: set === 'marble' ? 0.6 : 1 }));
      m.userData.plan = true;
      this.planMats.set(set, m);
    }
    return m;
  }

  // -------------------------------------------------------------------------
  // Construction du manoir
  // -------------------------------------------------------------------------

  setMap(map) {
    this.clearWorld();
    this.map = map;
    this.world = new THREE.Group();
    this.scene.add(this.world);
    const maxTex = this.gl.capabilities.maxTextureSize;
    const k = Math.min(2, maxTex / (map.w * art.TS), maxTex / (map.h * art.TS), Math.sqrt(12e6 / (map.w * map.h * art.TS * art.TS)));
    this.planTex = this.own(this.texture(art.buildPlan(map, k, true)));
    this.floorMats = new Map();
    this.planMats = new Map();
    this.topAt = new Float32Array(map.w * map.h);
    this.kindAt = new Array(map.w * map.h);
    const B = new Builder(map.w, map.h);
    this.buildShell(B, map);
    for (const f of map.furniture) this.buildFurniture(B, f, map);
    this.buildDecor(B, map);
    this.buildLights(B, map);
    this.buildExit(B, map);
    B.build(this.world, this.depth);
    this.items = new Map();
    this.rigs = new Map();
    this.mrigs = [];
    this.pingObjs = [];
    this.weights = new Map();
    this.exitAngle = 0;
    this.hud.setMap(map, art.buildPlan(map, 1));
  }

  clearWorld() {
    if (!this.world) return;
    this.scene.remove(this.world);
    this.depth.clear();
    this.world.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    for (const x of this.owned) x.dispose();
    this.owned = [];
    this.world = null;
  }

  buildShell(B, map) {
    const { w, h } = map, M = this.S.m;
    const theme = (x, y) => this.wallMat(art.themeNear(map, x, y));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (tileAt(map, x, y) !== TILE.WALL) B.quad(this.floorMat(art.themeNear(map, x, y)), v3(x, 0, y + 1), v3(x + 1, 0, y + 1), v3(x + 1, 0, y), v3(x, 0, y));
      }
    }
    B.quad(M.ceiling, v3(0, WALL_H, 0), v3(w, WALL_H, 0), v3(w, WALL_H, h), v3(0, WALL_H, h), [[0, 0], [w, 0], [w, h], [0, h]]);
    const open = t => t !== TILE.WALL && t !== TILE.VOID;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (tileAt(map, x, y) !== TILE.WALL) continue;
        for (const [dx, dy] of DIRS4) {
          if (!open(tileAt(map, x + dx, y + dy))) continue;
          B.wall(theme(x + dx, y + dy), x + 0.5 + dx * 0.5, y + 0.5 + dy * 0.5, dx, dy, 0, WALL_H, (x * 7 + y * 13 + dx + 2 * dy + 3) % 3);
        }
      }
    }

    // Portes entre les pièces : linteau et chambranle
    const { cols, rows, cw, ch } = map.grid;
    const frame = (x0, z0, x1, z1) => B.box(x0, 0, z0, x1, DOOR_H + 0.12, z1, M.wood, M.wood);
    const lintel = (x0, z0, x1, z1, vertical) => {
      B.quad(M.wood, v3(x0, DOOR_H, z0), v3(x1, DOOR_H, z0), v3(x1, DOOR_H, z1), v3(x0, DOOR_H, z1), [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
      if (vertical) {
        for (let z = z0; z < z1; z++) {
          B.wall(theme(x0 - 1, z), x0, z + 0.5, -1, 0, DOOR_H, WALL_H, 0);
          B.wall(theme(x1, z), x1, z + 0.5, 1, 0, DOOR_H, WALL_H, 0);
        }
        for (const [a, b] of [[x0 - 0.05, x0], [x1, x1 + 0.05]]) {
          frame(a, z0 - 0.12, b, z0);
          frame(a, z1, b, z1 + 0.12);
          B.box(a, DOOR_H, z0 - 0.12, b, DOOR_H + 0.12, z1 + 0.12, M.wood, M.wood, { bottom: M.wood });
        }
      } else {
        for (let x = x0; x < x1; x++) {
          B.wall(theme(x, z0 - 1), x + 0.5, z0, 0, -1, DOOR_H, WALL_H, 0);
          B.wall(theme(x, z1), x + 0.5, z1, 0, 1, DOOR_H, WALL_H, 0);
        }
        for (const [a, b] of [[z0 - 0.05, z0], [z1, z1 + 0.05]]) {
          frame(x0 - 0.12, a, x0, b);
          frame(x1, a, x1 + 0.12, b);
          B.box(x0 - 0.12, DOOR_H, a, x1 + 0.12, DOOR_H + 0.12, b, M.wood, M.wood, { bottom: M.wood });
        }
      }
    };
    for (let c = 1; c < cols; c++) {
      const x = c * (cw + 1);
      for (let y = 1; y < h - 1;) {
        if (tileAt(map, x, y) === TILE.WALL) { y++; continue; }
        let y1 = y;
        while (y1 < h - 1 && tileAt(map, x, y1) !== TILE.WALL) y1++;
        if (y1 - y <= 3) lintel(x, y, x + 1, y1, true);
        y = y1;
      }
    }
    for (let r = 1; r < rows; r++) {
      const y = r * (ch + 1);
      for (let x = 1; x < w - 1;) {
        if (tileAt(map, x, y) === TILE.WALL) { x++; continue; }
        let x1 = x;
        while (x1 < w - 1 && tileAt(map, x1, y) !== TILE.WALL) x1++;
        if (x1 - x <= 3) lintel(x, y, x1, y + 1, false);
        x = x1;
      }
    }

    // Poutres au plafond
    for (const cell of map.cells) {
      for (let dz = 2; dz < ch; dz += 2) B.box(cell.x, WALL_H - 0.2, cell.y + dz - 0.09, cell.x + cw, WALL_H, cell.y + dz + 0.09, null, M.beam, { bottom: M.beam });
    }
  }

  buildFurniture(B, f, map) {
    const M = this.S.m, P = this.planMat(TOP_SET[f.k] || 'wood'), U = { unit: true }, FIT = { unit: true, fit: true };
    const S = (kind, h) => this.sideMat(kind, h);
    const x0 = f.x + 0.05, z0 = f.y + 0.05, x1 = f.x + f.w - 0.05, z1 = f.y + f.h - 0.05;
    const cx = f.x + f.w / 2, cz = f.y + f.h / 2;
    const top = h => {
      for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) { this.topAt[y * map.w + x] = h; this.kindAt[y * map.w + x] = f.k; }
    };
    const block = (h, kind) => { B.box(x0, 0, z0, x1, h, z1, P, S(kind, h), U); top(h); };
    const cyl = (m, rt, rb, h, x, y, z, seg = 12, plan = false) => B.geo(m, new THREE.CylinderGeometry(rt, rb, h, seg), mat(x, y + h / 2, z), plan ? P : null, [TAU * Math.max(rt, rb), h]);
    const table = (h, leg = 0.06) => {
      B.box(x0, h - 0.06, z0, x1, h, z1, P, M.wood, { bottom: M.wood });
      const i = 0.07;
      for (const [lx, lz] of [[x0 + i, z0 + i], [x1 - i - leg, z0 + i], [x0 + i, z1 - i - leg], [x1 - i - leg, z1 - i - leg]]) B.box(lx, 0, lz, lx + leg, h - 0.06, lz + leg, null, M.wood);
      top(h);
    };
    const rnd = mulberry32(f.x * 977 + f.y * 131);
    this.kindAt[f.y * map.w + f.x] = f.k;
    switch (f.k) {
      case 'shelf': this.buildBookcase(B, f, map, x0, z0, x1, z1, 2.2); top(2.2); break;
      case 'potions': block(2.0, 'potions'); break;
      case 'wardrobe': block(2.1, 'wardrobe'); break;
      case 'cabinet': block(1.9, 'cabinet'); break;
      case 'dresser': block(0.95, 'drawers'); break;
      case 'nightstand': block(0.62, 'drawers'); break;
      case 'counter':
      case 'island': block(0.92, 'kitchen'); break;
      case 'altar': B.box(x0, 0, z0, x1, 1.0, z1, P, S('altar', 1.0), FIT); top(1.0); break;
      case 'toychest': block(0.55, 'toy'); break;
      case 'sarcophagus': B.box(x0, 0, z0, x1, 0.85, z1, P, S('tomb', 0.85), FIT); top(0.85); break;
      case 'bathtub': B.box(x0, 0.08, z0, x1, 0.62, z1, P, M.enamel, { bottom: M.enamel }); top(0.62); break;
      case 'crate': B.box(x0, 0, z0, x1, 0.75, z1, S('crate', 0.75), S('crate', 0.75), { unit: true, topUnit: true }); top(0.75); break;
      case 'crates':
        B.box(x0, 0, z0, x1, 0.85, z1, S('crate', 0.85), S('crate', 0.85), { unit: true, topUnit: true });
        B.box(x0 + 0.1, 0.85, z0 + 0.12, x1 - 0.12, 1.7, z1 - 0.06, S('crate', 0.85), S('crate', 0.85), { unit: true, topUnit: true });
        break;
      case 'table': table(0.78); break;
      case 'sidetable': table(0.75, 0.05); break;
      case 'worktable': table(0.86, 0.07); break;
      case 'longtable':
        table(0.78, 0.08);
        // couverts dressés : assiettes et gobelets
        if (f.plates) {
          for (let i = 0; i < f.w; i++) {
            for (const pz of [f.y + 0.29, f.y + f.h - 0.29]) {
              const px = f.x + i + 0.5, gz = pz + (pz < cz ? 0.13 : -0.13);
              cyl(M.enamel, 0.13, 0.1, 0.016, px, 0.78, pz, 24);
              cyl(M.brass, 0.03, 0.03, 0.006, px + 0.2, 0.78, gz, 12);
              cyl(M.brass, 0.006, 0.006, 0.07, px + 0.2, 0.786, gz, 6);
              cyl(M.brass, 0.036, 0.02, 0.07, px + 0.2, 0.856, gz, 14);
            }
          }
        }
        break;
      case 'lowtable': table(0.42, 0.05); break;
      case 'bench':
        B.box(x0, 0.4, z0 + 0.2, x1, 0.46, z1 - 0.2, P, M.wood, { bottom: M.wood });
        B.box(x0 + 0.1, 0, z0 + 0.25, x0 + 0.16, 0.4, z1 - 0.25, null, M.wood);
        B.box(x1 - 0.16, 0, z0 + 0.25, x1 - 0.1, 0.4, z1 - 0.25, null, M.wood);
        top(0.46);
        break;
      case 'bed':
        B.box(x0, 0.1, z0 + 0.1, x1, 0.32, z1, M.wood, M.wood);
        B.box(x0 + 0.02, 0.32, z0 + 0.1, x1 - 0.02, 0.56, z1 - 0.02, P, M.linen);
        for (let i = 0, n = f.w >= 2 ? 2 : 1; i < n; i++) {
          B.geo(M.linen, new THREE.SphereGeometry(0.5, 18, 10), mat(x0 + ((i + 0.5) * (x1 - x0)) / n, 0.61, z0 + 0.36, 0.3, 0, 0, ((x1 - x0) / n) * 0.82, 0.14, 0.34));
        }
        B.box(x0, 0, z0, x1, 1.25, z0 + 0.1, M.wood, M.wood);
        B.box(x0, 0, z1 - 0.06, x1, 0.75, z1, M.wood, M.wood);
        for (const [px, pz, ph] of [[x0, z0, 1.9], [x1 - 0.08, z0, 1.9], [x0, z1 - 0.08, 1.5], [x1 - 0.08, z1 - 0.08, 1.5]]) B.box(px, 0, pz, px + 0.08, ph, pz + 0.08, M.wood, M.wood);
        top(0.56);
        break;
      case 'sofa':
      case 'armchair':
        B.box(x0, 0.05, z0, x1, 0.45, z1, M.velvet, M.velvet);
        B.box(x0, 0.45, z0, x1, 0.98, z0 + 0.22, M.velvet, M.velvet);
        B.box(x0, 0.45, z0 + 0.22, x0 + 0.14, 0.66, z1, M.velvet, M.velvet);
        B.box(x1 - 0.14, 0.45, z0 + 0.22, x1, 0.66, z1, M.velvet, M.velvet);
        top(0.45);
        break;
      case 'pew':
        B.box(x0, 0.4, z0 + 0.1, x1, 0.46, z1 - 0.2, M.wood, M.wood, { bottom: M.wood });
        B.box(x0, 0.46, z1 - 0.22, x1, 0.98, z1 - 0.14, M.wood, M.wood);
        B.box(x0, 0, z0 + 0.1, x0 + 0.06, 1.02, z1 - 0.1, M.wood, M.wood);
        B.box(x1 - 0.06, 0, z0 + 0.1, x1, 1.02, z1 - 0.1, M.wood, M.wood);
        top(0.46);
        break;
      case 'barrel': cyl(S('barrel', 0.95), 0.36, 0.36, 0.95, cx, 0, cz, 16, true); top(0.95); break;
      case 'stove':
        block(0.92, 'stove');
        B.box(x0, 0.92, z0, x1, 1.9, z0 + 0.24, M.iron, M.iron);
        cyl(M.iron, 0.1, 0.1, WALL_H - 1.9, cx, 1.9, z0 + 0.12, 10);
        break;
      case 'clock':
        B.box(x0 + 0.18, 0, z0 + 0.2, x1 - 0.18, 2.1, z1 - 0.12, M.wood, S('clock', 2.1), FIT);
        B.box(x0 + 0.12, 2.1, z0 + 0.15, x1 - 0.12, 2.24, z1 - 0.08, M.wood, M.wood);
        break;
      case 'fireplace':
        B.box(x0, 0, z0, x1, 1.2, z1, M.stone, S('fireplace', 1.2), FIT);
        B.box(x0 - 0.05, 1.2, z0, x1 + 0.05, 1.28, z1 + 0.07, M.wood, M.wood, { bottom: M.wood });
        B.box(x0 + 0.22, 1.28, z0, x1 - 0.22, WALL_H, z1 - 0.3, null, M.stone);
        break;
      case 'statue': {
        // ange de pierre : robe drapée, tête penchée, mains jointes, ailes de plumes repliées
        B.box(x0 + 0.08, 0, z0 + 0.08, x1 - 0.08, 0.4, z1 - 0.08, M.stone, M.stone);
        const robe = new THREE.CylinderGeometry(0.15, 0.3, 1.2, 48, 16);
        const rp = robe.attributes.position;
        for (let i = 0; i < rp.count; i++) {
          const a = Math.atan2(rp.getZ(i), rp.getX(i)), k = 0.5 - rp.getY(i) / 1.2;
          const fold = 1 + (0.025 + 0.075 * k) * Math.sin(a * 9 + Math.sin(a * 3) * 1.6);
          rp.setX(i, rp.getX(i) * fold);
          rp.setZ(i, rp.getZ(i) * fold);
        }
        robe.computeVertexNormals();
        B.geo(M.marble, robe, mat(cx, 1.0, cz), null, [TAU * 0.3, 1.2]);
        B.geo(M.marble, new THREE.SphereGeometry(0.16, 28, 16), mat(cx, 1.6, cz - 0.01, 0, 0, 0, 1, 0.55, 0.95));
        B.geo(M.marble, new THREE.CylinderGeometry(0.045, 0.055, 0.12, 16), mat(cx, 1.66, cz + 0.02, 0.3));
        B.geo(M.marble, new THREE.SphereGeometry(0.11, 28, 20), mat(cx, 1.76, cz + 0.06, 0.45, 0, 0, 0.92, 1.12, 1));
        B.geo(M.marble, new THREE.SphereGeometry(0.05, 16, 12), mat(cx, 1.42, cz + 0.2, 0, 0, 0, 1, 1.5, 0.8));
        const wing = new THREE.Shape();
        wing.moveTo(0, 0);
        wing.quadraticCurveTo(0.02, 0.3, 0.14, 0.42);
        wing.quadraticCurveTo(0.3, 0.38, 0.4, 0.12);
        const tips = 7;
        for (let i = 1; i <= tips; i++) {
          const t = i / tips, px = 0.4 - 0.2 * t - 0.05 * Math.sin(t * Math.PI), py = 0.12 - 0.92 * t;
          wing.quadraticCurveTo(px + 0.06, py + 0.07, px, py);
        }
        wing.quadraticCurveTo(0.08, -0.5, 0.02, -0.25);
        wing.closePath();
        for (const s of [-1, 1]) {
          const g = new THREE.ExtrudeGeometry(wing, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 6 });
          B.geo(M.marble, g, mat(cx + s * 0.1, 1.55, cz - 0.1, 0, s > 0 ? 1.12 : Math.PI - 1.12, 0));
        }
        break;
      }
      case 'pedestal':
        cyl(M.stone, 0.14, 0.2, 1.0, cx, 0, cz);
        B.box(cx - 0.22, 1.0, cz - 0.22, cx + 0.22, 1.06, cz + 0.22, M.stone, M.stone);
        B.geo(M.orb, new THREE.SphereGeometry(0.12, 16, 12), mat(cx, 1.18, cz));
        top(1.06);
        break;
      case 'coffin': {
        const L = Math.max(f.w, f.h) / 2 - 4 / art.TS, W = Math.min(f.w, f.h) / 2 - 6 / art.TS, rot = f.w > f.h;
        const pts = [[-0.6 * W, -L], [0.6 * W, -L], [W, -0.45 * L], [0.7 * W, L], [-0.7 * W, L], [-W, -0.45 * L]];
        const shape = new THREE.Shape(pts.map(([px, py]) => {
          const [qx, qy] = rot ? [-py, px] : [px, py];
          return new THREE.Vector2(cx + qx, -(cz + qy));
        }));
        const g = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false });
        g.rotateX(-Math.PI / 2);
        B.geo(M.wood, g, null, P);
        top(0.5);
        break;
      }
      case 'piano': {
        const T = art.TS, X = f.x * T, Y = f.y * T, Wp = f.w * T, Hp = f.h * T;
        const p = (px, py) => [px / T, -py / T];
        const s = new THREE.Shape();
        s.moveTo(...p(X + 4, Y + 4));
        s.lineTo(...p(X + Wp - 4, Y + 4));
        s.quadraticCurveTo(...p(X + Wp - 4, Y + Hp - 4), ...p(X + Wp * 0.45, Y + Hp - 4));
        s.quadraticCurveTo(...p(X + 4, Y + Hp - 4), ...p(X + 4, Y + Hp * 0.6));
        s.closePath();
        const g = new THREE.ExtrudeGeometry(s, { depth: 0.36, bevelEnabled: false, curveSegments: 10 });
        g.rotateX(-Math.PI / 2);
        g.translate(0, 0.62, 0);
        B.geo(M.lacquer, g, null, P);
        for (const [lx, lz] of [[x0 + 0.2, z0 + 0.2], [x1 - 0.25, z0 + 0.25], [cx - 0.2, z1 - 0.35]]) cyl(M.lacquer, 0.04, 0.03, 0.62, lx, 0, lz, 8);
        top(0.98);
        break;
      }
      case 'fountain':
        cyl(M.stone, 0.92, 0.95, 0.45, cx, 0, cz, 28, true);
        cyl(M.stone, 0.1, 0.14, 0.75, cx, 0.45, cz, 10);
        cyl(M.stone, 0.32, 0.12, 0.14, cx, 1.2, cz, 16, true);
        top(0.45);
        break;
      case 'deadtree':
        cyl(M.bark, 0.1, 0.2, 2.0, cx, 0, cz, 8);
        for (let i = 0; i < 7; i++) {
          const a = rnd() * TAU, y = 1.0 + rnd() * 1.0, len = 0.5 + rnd() * 0.6;
          const g = new THREE.CylinderGeometry(0.012, 0.05, len, 5);
          g.translate(0, len / 2, 0);
          B.geo(M.bark, g, mat(cx, y, cz, 0, a, 0.6 + rnd() * 0.6));
        }
        break;
      case 'plant':
        cyl(M.terracotta, 0.17, 0.12, 0.32, cx, 0, cz);
        for (let i = 0; i < 7; i++) {
          const g = new THREE.SphereGeometry(0.5, 6, 4);
          g.scale(0.05, 0.36, 0.11);
          g.translate(0, 0.18, 0);
          B.geo(M.leaf, g, mat(cx, 0.3, cz, 0, rnd() * TAU, 0.3 + rnd() * 0.7));
        }
        break;
      case 'crib':
        B.box(x0 + 0.05, 0.3, z0 + 0.05, x1 - 0.05, 0.42, z1 - 0.05, P, M.wood);
        B.box(x0, 0, z0, x1, 0.95, z1, null, S('crib', 0.95), U);
        top(0.95);
        break;
      case 'rockinghorse':
        B.geo(M.painted, new THREE.SphereGeometry(0.5, 12, 8), mat(cx, 0.56, cz, 0, 0, 0, 0.34, 0.16, 0.13));
        B.geo(M.painted, new THREE.BoxGeometry(0.09, 0.26, 0.08), mat(cx + 0.25, 0.72, cz, 0, 0, -0.5));
        B.geo(M.painted, new THREE.SphereGeometry(0.5, 10, 6), mat(cx + 0.33, 0.83, cz, 0, 0, -0.3, 0.2, 0.1, 0.09));
        for (const [lx, lz] of [[-0.16, -0.06], [-0.16, 0.06], [0.16, -0.06], [0.16, 0.06]]) cyl(M.painted, 0.018, 0.018, 0.34, cx + lx, 0.16, cz + lz, 6);
        for (const s of [-1, 1]) {
          const g = new THREE.TorusGeometry(0.75, 0.02, 4, 18, 0.8);
          g.rotateZ(-Math.PI / 2 - 0.4);
          B.geo(M.painted, g, mat(cx, 0.78, cz + s * 0.07));
        }
        break;
      case 'cauldron': {
        const r = Math.min(f.w, f.h) * 0.36;
        B.geo(M.iron, new THREE.SphereGeometry(r, 18, 12, 0, TAU, Math.PI * 0.32, Math.PI * 0.68), mat(cx, r + 0.12, cz));
        const rimY = r + 0.12 + r * Math.cos(Math.PI * 0.32), rimR = r * Math.sin(Math.PI * 0.32);
        const rim = new THREE.TorusGeometry(rimR, 0.04, 6, 24);
        rim.rotateX(Math.PI / 2);
        B.geo(M.iron, rim, mat(cx, rimY, cz));
        const brew = new THREE.CircleGeometry(rimR, 24);
        brew.rotateX(-Math.PI / 2);
        B.geo(M.brew, brew, mat(cx, rimY - 0.03, cz));
        for (let i = 0; i < 3; i++) cyl(M.iron, 0.03, 0.03, 0.2, cx + Math.cos(i * 2.1) * r * 0.6, 0, cz + Math.sin(i * 2.1) * r * 0.6, 6);
        top(rimY);
        break;
      }
      case 'pumpkin': {
        const cell = map.cells.find(c => f.x >= c.x && f.x < c.x + map.grid.cw && f.y >= c.y && f.y < c.y + map.grid.ch);
        const face = cell ? Math.atan2(cell.y + map.grid.ch / 2 - cz, cell.x + map.grid.cw / 2 - cx) : 0;
        B.geo(M.pumpkin, new THREE.SphereGeometry(0.24, 18, 12), mat(cx, 0.19, cz, 0, -face, 0, 1, 0.78, 1));
        cyl(M.leaf, 0.02, 0.03, 0.08, cx, 0.36, cz, 6);
        break;
      }
      case 'candelabra':
        cyl(M.brass, 0.16, 0.2, 0.05, cx, 0, cz, 12);
        cyl(M.brass, 0.025, 0.03, 1.12, cx, 0.05, cz, 8);
        top(1.17);
        break;
      case 'sink':
        cyl(M.enamel, 0.1, 0.14, 0.78, cx, 0, cz, 10);
        B.box(x0 + 0.12, 0.78, z0 + 0.12, x1 - 0.12, 0.92, z1 - 0.1, P, M.enamel, { bottom: M.enamel });
        top(0.92);
        break;
      default:
        B.box(x0, 0, z0, x1, 0.8, z1, P, M.wood);
        top(0.8);
    }
  }

  // Bibliothèque : bâti de bois à casiers sur chaque grande face ouverte sur la pièce (les deux pour
  // un meuble isolé), garnis de livres debout, en séries, penchés ou couchés en piles. Les livres de
  // chaque meuble forment un maillage à part, écarté de l'image quand il n'est pas en vue.
  buildBookcase(B, f, map, x0, z0, x1, z1, H) {
    const M = this.S.m, P = this.planMat(TOP_SET[f.k] || 'wood'), BB = new Builder(map.w, map.h);
    const rnd = mulberry32(f.x * 733 + f.y * 197 + 11);
    const long = f.w >= f.h;
    // faces candidates : normale sortante, origine, axe le long du meuble (U) et vers l'intérieur (W)
    const faces = long
      ? [[0, -1, x0, z0, 1, 0, 0, 1], [0, 1, x1, z1, -1, 0, 0, -1]]
      : [[-1, 0, x0, z1, 0, -1, 1, 0], [1, 0, x1, z0, 0, 1, -1, 0]];
    // ouverte si la plupart des cases qui la bordent sont du sol
    const isOpen = ([nx, nz]) => {
      let free = 0, n = 0;
      const cells = nx ? Array.from({ length: f.h }, (_, j) => [nx < 0 ? f.x - 1 : f.x + f.w, f.y + j]) : Array.from({ length: f.w }, (_, i) => [f.x + i, nz < 0 ? f.y - 1 : f.y + f.h]);
      for (const [i, j] of cells) {
        const t = tileAt(map, i, j);
        n++;
        if (t === TILE.FLOOR || t === TILE.LOW) free++;
      }
      return free * 2 >= n;
    };
    let open = faces.filter(isOpen);
    if (!open.length) open = [faces[1]];
    const L = long ? x1 - x0 : z1 - z0, D = long ? z1 - z0 : x1 - x0;
    const cd = Math.min(0.34, (open.length > 1 ? D / 2 : D) - 0.02);
    // cœur plein entre les casiers (leurs fonds)
    const sh = (nx, nz) => (open.some(o => o[0] === nx && o[1] === nz) ? cd : 0);
    B.box(x0 + sh(-1, 0), 0, z0 + sh(0, -1), x1 - sh(1, 0), H, z1 - sh(0, 1), P, M.wood);
    const ROWS = 5, base = 0.1, step = (H - 0.1 - base) / ROWS;
    const FORMATS = [0.2, 0.225, 0.25, 0.28, 0.31, 0.34];
    for (const [, , ox, oz, ux, uz, wx, wz] of open) {
      const at = (u, w) => [ox + ux * u + wx * w, oz + uz * u + wz * w];
      const box = (u0, y0, w0, u1, y1, w1, top = M.wood, o = {}) => {
        const [ax, az] = at(u0, w0), [bx, bz] = at(u1, w1);
        B.box(Math.min(ax, bx), y0, Math.min(az, bz), Math.max(ax, bx), y1, Math.max(az, bz), top, M.wood, o);
      };
      box(0, H - 0.1, 0, L, H, cd, P);
      box(-0.02, H - 0.13, -0.025, L + 0.02, H - 0.07, 0.03, M.wood, { bottom: M.wood });
      box(0, 0, 0.015, L, base, cd);
      box(0, 0, 0, 0.035, H - 0.1, cd);
      box(L - 0.035, 0, 0, L, H - 0.1, cd);
      const bays = Math.max(1, Math.round(L / 0.95)), bw = L / bays;
      for (let k = 1; k < bays; k++) box(k * bw - 0.015, base, 0.005, k * bw + 0.015, H - 0.1, cd);
      for (let k = 1; k < ROWS; k++) box(0.035, base + k * step - 0.022, 0.008, L - 0.035, base + k * step, cd, M.wood, { bottom: M.wood });
      // repère d'un livre : U le long du rayon, Y vers le haut, W vers le fond (le dos regarde la pièce)
      const U = v3(ux, 0, uz), Y = v3(0, 1, 0), Wv = v3(wx, 0, wz), O = v3(ox, 0, oz);
      const upright = new THREE.Matrix4().makeBasis(U, Y, Wv), lying = new THREE.Matrix4().makeBasis(Y.clone().negate(), U, Wv);
      const put = (g, basis, u, y, w, extra = null) => {
        const m = new THREE.Matrix4().copy(basis);
        if (extra) m.multiply(extra);
        m.setPosition(O.clone().addScaledVector(U, u).addScaledVector(Wv, w).setY(y));
        BB.geo(this.S.books, g, m);
      };
      for (let row = 0; row < ROWS; row++) {
        const y0 = base + row * step, clear = step - (row < ROWS - 1 ? 0.022 : 0) - 0.012;
        for (let k = 0; k < bays; k++) {
          const u1 = (k + 1) * bw - (k < bays - 1 ? 0.017 : 0.037);
          let u = k * bw + (k ? 0.017 : 0.037) + rnd() * 0.01, series = null;
          while (u < u1 - 0.02) {
            const r = rnd();
            if (r < 0.035) {
              u += 0.03 + rnd() * 0.09;
              continue;
            }
            if (r < 0.075 && u1 - u > 0.3) {
              // pile de livres couchés, dos vers la pièce
              const len = 0.19 + rnd() * 0.09;
              let y = y0;
              for (let n = 2 + Math.floor(rnd() * 4); n > 0; n--) {
                const t = 0.022 + rnd() * 0.035, d = Math.min(cd - 0.04, 0.14 + rnd() * 0.08);
                if (y + t > y0 + clear) break;
                put(bookGeo(t, len - rnd() * 0.03, d, Math.floor(rnd() * art.BOOK_COLS), rnd), lying, u + rnd() * 0.01, y + t / 2, 0.018 + rnd() * 0.01);
                y += t;
              }
              u += len + 0.012;
              continue;
            }
            if (!series && rnd() < 0.09) series = { n: 3 + Math.floor(rnd() * 6), col: Math.floor(rnd() * art.BOOK_COLS), t: 0.025 + rnd() * 0.025, h: FORMATS[Math.floor(rnd() * FORMATS.length)] };
            const t = series ? series.t : 0.017 + rnd() ** 1.6 * 0.05;
            const h = Math.min(clear - 0.01, (series ? series.h : FORMATS[Math.floor(rnd() * FORMATS.length)]) + (rnd() - 0.5) * 0.012);
            const d = Math.min(cd - 0.04, h * 0.62 + rnd() * 0.04);
            const col = series ? series.col : Math.floor(rnd() * art.BOOK_COLS);
            const pull = 0.015 + rnd() * 0.01 + (rnd() < 0.06 ? 0.03 : 0);
            if (series && --series.n <= 0) series = null;
            if (r > 0.965 && u1 - u > h * 0.4 + t) {
              // livre penché sur le précédent, en appui sur son coin
              const a = 0.12 + rnd() * 0.2, lean = new THREE.Matrix4().makeRotationZ(a).multiply(new THREE.Matrix4().makeTranslation(t / 2, 0, 0));
              u += h * Math.sin(a);
              put(bookGeo(t, h, d, col, rnd), upright, u, y0, pull, lean);
              u += t * Math.cos(a) + 0.004;
              continue;
            }
            if (u + t > u1) break;
            put(bookGeo(t, h, d, col, rnd), upright, u + t / 2, y0, pull, new THREE.Matrix4().makeRotationZ((rnd() - 0.5) * 0.02));
            u += t + 0.0015;
          }
        }
      }
    }
    BB.build(this.world, this.depth);
  }

  buildDecor(B, map) {
    const M = this.S.m, S = this.S;
    // tapis : un vrai volume de laine posé sur le sol
    for (const d of map.decals) {
      if (d.k !== 'rug' && d.k !== 'runner') continue;
      const m = this.own(surface({ map: this.own(this.texture(art.rugTexture(d))), set: 'carpet', detail: 0.55, normal: 1.2, scale: 0.6 }));
      B.box(d.x + 0.08, 0, d.y + 0.08, d.x + d.w - 0.08, 0.014, d.y + d.h - 0.08, m, m, { unit: true, fit: true, topUnit: true });
    }
    for (const d of map.decals) {
      if (d.k === 'chair') {
        // chaise autour de la table de la salle à manger, dossier vers l'extérieur
        const x = d.x, z = d.y, back = d.r ? 1 : -1;
        B.box(x - 0.2, 0.42, z - 0.2, x + 0.2, 0.47, z + 0.2, M.wood, M.wood, { bottom: M.wood });
        for (const [lx, lz] of [[-0.18, -0.18], [0.14, -0.18], [-0.18, 0.14], [0.14, 0.14]]) B.box(x + lx, 0, z + lz, x + lx + 0.04, 0.42, z + lz + 0.04, null, M.wood);
        const bz = z + back * 0.18;
        B.box(x - 0.2, 0.47, Math.min(bz, bz - back * 0.04), x + 0.2, 1.05, Math.max(bz, bz - back * 0.04), M.wood, M.wood);
      } else if (d.k === 'web') {
        // toile tendue dans le coin, sous le plafond
        const ox = d.x + (d.corner % 2 ? 1 : 0), oz = d.y + (d.corner > 1 ? 1 : 0);
        const sx = d.corner % 2 ? -1 : 1, sz = d.corner > 1 ? -1 : 1, r = 0.9;
        const a = v3(ox + sx * 0.01, WALL_H - r, oz + sz * 0.01), b = v3(ox + sx * r, WALL_H - 0.01, oz + sz * 0.01), c = v3(ox + sx * 0.01, WALL_H - 0.01, oz + sz * r);
        B.quad(S.web, a, b, c, c, [[0, 0], [1, 0], [0, 1], [0, 1]]);
      }
    }
    for (const d of map.wallDeco) {
      const x = d.x, z = d.y + 1; // face sud du mur
      const q = (m, x0, x1, y0, y1, dz = 0.01) => B.quad(m, v3(x0, y0, z + dz), v3(x1, y0, z + dz), v3(x1, y1, z + dz), v3(x0, y1, z + dz));
      switch (d.k) {
        case 'window':
          q(S.windows[(x * 7) % 3 === 0 ? 1 : 0], x + 0.14, x + 0.86, 0.85, 2.25);
          B.box(x + 0.08, 0.78, z, x + 0.92, 0.85, z + 0.1, M.wood, M.wood, { bottom: M.wood });
          for (const [a, b] of [[x - 0.02, x + 0.2], [x + 0.8, x + 1.02]]) {
            B.quad(M.curtain, v3(a, 0.15, z + 0.06), v3(b, 0.15, z + 0.06), v3(b, 2.45, z + 0.06), v3(a, 2.45, z + 0.06), [[0, 0.15], [b - a, 0.15], [b - a, 2.45], [0, 2.45]]);
          }
          B.box(x - 0.05, 2.44, z + 0.04, x + 1.05, 2.48, z + 0.08, M.brass, M.brass);
          break;
        case 'painting':
          B.box(x + 0.14, 1.14, z, x + 0.86, 2.02, z + 0.05, M.gilt, M.gilt, { bottom: M.gilt });
          q(S.paintings[d.v], x + 0.18, x + 0.82, 1.18, 1.98, 0.052);
          break;
        case 'mirror':
          q(S.mirror, x + 0.22, x + 0.78, 1.15, 1.9, 0.02);
          break;
        case 'torn':
          q(S.torn, x + 0.1, x + 0.9, 1.1, 2.2, 0.004);
          break;
      }
    }
  }

  // Bougies, lustres, feux de cheminée… : leur flamme, leur halo, et leur place pour l'éclairage.
  buildLights(B, map) {
    const M = this.S.m, w = map.w;
    const kindAt = (x, y) => this.kindAt[Math.floor(y) * w + Math.floor(x)];
    this.statics = map.lights.map((l, i) => {
      const color = new THREE.Color().setRGB(l.c[0] / 255, l.c[1] / 255, l.c[2] / 255, THREE.SRGBColorSpace);
      const L = { ...l, i, color, ph: Math.random() * 100, h: 0, power: 2.2, range: l.r * 1.6, flames: [], halo: null };
      const flame = (x, y, z, s = 1) => {
        const sp = new THREE.Sprite(this.S.flame);
        sp.position.set(x, y, z);
        sp.userData.s = s;
        this.world.add(sp);
        L.flames.push(sp);
      };
      const candle = (x, y, z, hh = 0.13) => {
        B.geo(M.wax, new THREE.CylinderGeometry(0.022, 0.025, hh, 8), mat(x, y + hh / 2, z));
        flame(x, y + hh + 0.04, z);
      };
      const ty = Math.floor(l.y), tx = Math.floor(l.x);
      switch (l.k) {
        case 'moon':
          L.h = 1.7;
          L.power = 1.6;
          break;
        case 'chandelier': {
          const y = WALL_H - 0.55;
          L.h = y + 0.15;
          L.power = 9;
          B.geo(M.iron, new THREE.CylinderGeometry(0.012, 0.012, WALL_H - y, 4), mat(l.x, (WALL_H + y) / 2, l.y));
          const ring = new THREE.TorusGeometry(0.45, 0.02, 6, 28);
          ring.rotateX(Math.PI / 2);
          B.geo(M.brass, ring, mat(l.x, y, l.y));
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * TAU;
            B.box(l.x - 0.012, y - 0.01, l.y - 0.012, l.x + 0.012, y + 0.01, l.y + 0.012, null, M.brass);
            candle(l.x + Math.cos(a) * 0.45, y, l.y + Math.sin(a) * 0.45);
          }
          break;
        }
        case 'fire':
          L.h = 0.45;
          L.power = 7;
          if (kindAt(l.x, l.y - 1) === 'fireplace') {
            for (const dx of [-0.25, 0, 0.22]) flame(l.x + dx, 0.24, ty + 0.03, 3.2 - Math.abs(dx) * 4);
          }
          break;
        case 'pumpkin':
          L.h = 0.25;
          L.power = 1.4;
          break;
        case 'cauldron':
          L.h = 1.2;
          L.power = 3;
          break;
        default: {
          const top = this.topAt[ty * w + tx];
          if (top > 0) {
            L.h = top + 0.2;
            if (kindAt(l.x, l.y) === 'longtable' || kindAt(l.x, l.y) === 'candelabra') {
              B.box(l.x - 0.16, top, l.y - 0.02, l.x + 0.16, top + 0.03, l.y + 0.02, M.brass, M.brass);
              for (const dx of [-0.14, 0, 0.14]) candle(l.x + dx, top + 0.03, l.y, dx ? 0.12 : 0.16);
            } else candle(l.x, top, l.y);
          } else if (tileAt(map, tx, Math.floor(l.y - 0.5)) === TILE.WALL) {
            // applique murale
            const wz = Math.floor(l.y - 0.5) + 1;
            B.box(l.x - 0.02, 1.48, wz, l.x + 0.02, 1.52, wz + 0.17, M.brass, M.brass);
            B.geo(M.brass, new THREE.CylinderGeometry(0.06, 0.035, 0.03, 10), mat(l.x, 1.53, wz + 0.17));
            candle(l.x, 1.545, wz + 0.17);
            L.h = 1.75;
          } else {
            // bougies posées au sol
            L.h = 0.3;
            for (const [dx, dz, hh] of [[-0.1, 0.04, 0.16], [0.1, 0.06, 0.11], [0, -0.1, 0.21]]) candle(l.x + dx, 0, l.y + dz, hh);
          }
        }
      }
      if (L.flames.length || l.k === 'cauldron' || l.k === 'pumpkin') {
        const sp = new THREE.Sprite(this.own(this.S.sprite(this.S.glow, { color: color, opacity: 0.3 })));
        const f = L.flames;
        if (f.length) sp.position.set(f.reduce((s, o) => s + o.position.x, 0) / f.length, f.reduce((s, o) => s + o.position.y, 0) / f.length, f.reduce((s, o) => s + o.position.z, 0) / f.length);
        else sp.position.set(l.x, L.h - (l.k === 'cauldron' ? 0.2 : 0), l.y);
        const size = l.k === 'chandelier' ? 1.6 : l.k === 'fire' ? 1.4 : L.h > 1.6 && l.k === 'candle' ? 0.45 : 0.6;
        sp.scale.setScalar(size);
        sp.userData.size = size;
        this.world.add(sp);
        L.halo = sp;
      }
      return L;
    });
  }

  buildExit(B, map) {
    const S = this.S, M = S.m, ex = map.exit, h = map.h;
    const x0 = ex.x, x1 = ex.x + ex.w, z0 = ex.y, z1 = ex.y + 1, top = 2.35;
    B.quad(M.wood, v3(x0, top, z0), v3(x1, top, z0), v3(x1, top, z1), v3(x0, top, z1), [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
    for (let x = x0; x < x1; x++) B.wall(this.wallMat('foyer'), x + 0.5, z0, 0, -1, top, WALL_H, 0);
    B.box(x0 - 0.18, 0, z0 - 0.07, x0, top + 0.18, z0, M.wood, M.wood);
    B.box(x1, 0, z0 - 0.07, x1 + 0.18, top + 0.18, z0, M.wood, M.wood);
    B.box(x0 - 0.18, top, z0 - 0.07, x1 + 0.18, top + 0.18, z0, M.wood, M.wood, { bottom: M.wood });
    B.quad(M.grass, v3(x0 - 4, 0, h + 4), v3(x1 + 4, 0, h + 4), v3(x1 + 4, 0, z1), v3(x0 - 4, 0, z1));

    const sky = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), this.own(new THREE.MeshBasicMaterial({ map: S.night, fog: false })));
    sky.position.set((x0 + x1) / 2, 2.4, h + 4);
    sky.rotation.y = Math.PI;
    this.world.add(sky);
    this.outside = sky;

    const leafMat = this.sideMat('door', top), half = ex.w / 2;
    const leaf = (hx, dir) => {
      const pivot = new THREE.Group();
      pivot.position.set(hx, 0, z0 + 0.1);
      const m = new THREE.Mesh(meters(new THREE.BoxGeometry(half - 0.02, top, 0.08), half - 0.02, top), leafMat);
      m.position.set(dir * (half / 2), top / 2, 0);
      m.castShadow = m.receiveShadow = true;
      pivot.add(m);
      this.world.add(pivot);
      return pivot;
    };
    this.leafL = leaf(x0, 1);
    this.leafR = leaf(x1, -1);
    this.seal = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), this.own(new THREE.MeshBasicMaterial({
      map: S.seal, transparent: true, depthWrite: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending,
    })));
    this.seal.position.set((x0 + x1) / 2, 1.3, z0 - 0.03);
    this.seal.rotation.y = Math.PI;
    this.world.add(this.seal);
  }

  // -------------------------------------------------------------------------
  // Personnages, créature, objets
  // -------------------------------------------------------------------------

  makePlayerRig(p) {
    const M = this.S.m;
    const root = new THREE.Group(), body = new THREE.Group();
    root.add(body);
    // manteau de laine à chevrons teinté de sa couleur, écharpe tricotée de sa couleur vive ;
    // teint, cheveux, yeux et coiffure selon son numéro
    const col = hex => new THREE.Color(hex).toArray();
    const tone = col(TONES[p.id % TONES.length]), hair = col(HAIRS[(p.id * 3) % HAIRS.length]);
    const lens = this.own(shine(new THREE.MeshStandardMaterial({ color: 0x8a8a84, emissive: 0x000000, roughness: 0.05, metalness: 0.8 })));
    lens.userData.noShadow = true;
    const fig = playerBody({ ...M, lens }, {
      coat: col(art.blend(p.color, '#3a3430')), scarf: col(p.color), skin: tone, hair,
      brow: hair.map((c, i) => Math.min(1, c / tone[i])),
      iris: col(IRISES[(p.id * 5) % IRISES.length]),
      style: p.id % 3,
    });
    body.add(fig.group);
    this.own(fig.skeleton);
    const lampGlow = new THREE.Sprite(this.own(this.S.sprite(this.S.glow, { color: 0xfff0d0, opacity: 0.9 })));
    lampGlow.scale.setScalar(0.22);
    lampGlow.position.x = 0.02;
    fig.tip.add(lampGlow);
    // faisceau visible de loin
    const len = CFG.light.range;
    const cone = new THREE.ConeGeometry(Math.tan(CFG.light.cone) * len, len, 48, 1, true);
    cone.rotateZ(Math.PI / 2);
    cone.translate(len / 2, 0, 0);
    const beam = new THREE.Mesh(cone, this.own(new THREE.ShaderMaterial({
      uniforms: { map: { value: this.S.beam }, opacity: { value: 0.08 }, color: { value: new THREE.Color(0xfff0d0) } },
      vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    })));
    fig.tip.add(beam);
    const blood = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), this.own(surface({
      map: this.S.blood, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.12,
    })));
    blood.rotation.x = -Math.PI / 2;
    blood.position.y = 0.01;
    root.add(blood);
    // fantôme (visible des autres fantômes)
    const ghost = new THREE.Group();
    const sheetPts = [[0, 1.75], [0.12, 1.72], [0.2, 1.6], [0.24, 1.35], [0.27, 0.9], [0.32, 0.45]].map(([x, y]) => new THREE.Vector2(x, y));
    const sheetMat = this.own(new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
    ghost.add(new THREE.Mesh(new THREE.LatheGeometry(sheetPts, 16), sheetMat));
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), this.own(new THREE.MeshBasicMaterial({ color: 0x111122 })));
      e.position.set(0.21, 1.5, s * 0.07);
      ghost.add(e);
    }
    root.add(ghost);
    return { root, body, bone: fig.bone, tip: fig.tip, lens, beam, lampGlow, blood, ghost, mv: 0, run: 0, aim: 1, ph: 0, t: 0 };
  }

  makeMonsterRig() {
    const S = this.S;
    const root = new THREE.Group(), body = new THREE.Group();
    root.add(body);
    const mats = [];
    const own = m => { mats.push(m); return this.own(m); };
    // étoffe noire très mate : presque aucun reflet, même sous la lampe
    const cloth = (side = THREE.FrontSide) => own(surface({ color: 0x0a080c, transparent: true, side, set: 'linen', channel: 0, scale: 0.5, detail: 0.6, normal: 1.4, rough: false, roughness: 1, physical: { specularIntensity: 0.15, sheen: 0.5, sheenColor: new THREE.Color(0x1a1420), sheenRoughness: 0.8 } }));
    const dark = cloth();
    const add = (parent, o) => { o.castShadow = true; parent.add(o); return o; };
    const prof = [[0, 0], [0.4, 0.02], [0.42, 0.3], [0.34, 0.9], [0.27, 1.35], [0.23, 1.62], [0.3, 1.78], [0.16, 1.92], [0, 1.96]].map(([r, y]) => new THREE.Vector2(r, y));
    // robe : plis qui s'évasent vers le bas et ourlet en lambeaux
    const robeGeo = this.own(new THREE.LatheGeometry(prof, 48));
    const rp = robeGeo.attributes.position;
    for (let i = 0; i < rp.count; i++) {
      const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i), a = Math.atan2(z, x), k = Math.max(0, 1 - y / 1.6);
      const fold = 1 + 0.09 * k * Math.sin(a * 7 + Math.sin(a * 2) * 2);
      rp.setXYZ(i, x * fold, y < 0.05 && Math.hypot(x, z) > 0.1 ? 0.02 + 0.22 * Math.abs(Math.sin(a * 5.3) * Math.sin(a * 2.1 + 1)) : y, z * fold);
    }
    robeGeo.computeVertexNormals();
    const robe = add(body, new THREE.Mesh(robeGeo, dark));
    robe.rotation.z = -0.16;
    const head = new THREE.Group();
    head.position.set(0.32, 1.98, 0);
    body.add(head);
    add(head, new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), dark));
    // masque de porcelaine vernie
    const maskMat = own(surface({
      map: S.mask, emissiveMap: S.mask, emissive: new THREE.Color(0x2a2622), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.3,
      physical: { clearcoat: 0.9, clearcoatRoughness: 0.12 },
    }));
    head.add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 14, Math.PI - 0.95, 1.9, Math.PI / 2 - 1.0, 2.0), maskMat));
    const eyeMat = own(S.sprite(S.glow, { color: 0xffd9a0 }));
    const eyes = [-1, 1].map(s => {
      const e = new THREE.Sprite(eyeMat);
      e.position.set(0.15, 0.03, s * 0.05); // entre le crâne et le masque : la lueur passe par les trous des yeux
      e.scale.setScalar(0.15);
      head.add(e);
      return e;
    });
    // bras décharnés à la peau grise et cireuse, longues mains aux griffes noires, vrilles d'ombre
    const skin = own(surface({ set: 'leather', channel: 0, scale: 0.18, color: '#77766c', vertexColors: true, roughness: 0.45, detail: 0.35, normal: 1.1, transparent: true }));
    const nail = own(surface({ color: '#120e0b', roughness: 0.2, transparent: true }));
    const sleeve = cloth(THREE.DoubleSide); // l'intérieur des manches se voit
    const limbs = monsterLimbs({ dark, sleeve, skin, nail });
    body.add(limbs.group);
    this.own(limbs.skeleton);
    // les mains s'éloignent loin de leur position de repos : jamais écartées de l'image
    for (const m of limbs.meshes) m.frustumCulled = false;
    const { arms, tendrils } = limbs;
    const smoke = [];
    for (let i = 0; i < 5; i++) {
      const m = own(new THREE.SpriteMaterial({ map: S.smoke, transparent: true, depthWrite: false, opacity: 0.6 }));
      const sp = new THREE.Sprite(m);
      sp.position.set((Math.random() - 0.5) * 0.4, 0.4 + i * 0.35, (Math.random() - 0.5) * 0.4);
      sp.userData.ph = Math.random() * 10;
      root.add(sp);
      smoke.push(sp);
    }
    return { root, body, head, eyes, eyeMat, arms, tendrils, smoke, dark, tint: [dark, sleeve, skin, nail], mats, xray: false };
  }

  // Crâne maudit sculpté dans une sphère : orbites et nez creusés (et assombris), pommettes, tempes,
  // mâchoire resserrée et rangée de dents ; une lueur verte brille au fond des orbites.
  makeSkull() {
    const g = new THREE.Group(), s = new THREE.Group();
    const geo = this.own(new THREE.SphereGeometry(0.1, 56, 40));
    const p = geo.attributes.position, col = new Float32Array(p.count * 3), d = new THREE.Vector3();
    const near = (cx, cy, cz, w) => {
      const l = Math.hypot(cx, cy, cz);
      return Math.exp(((d.x * cx + d.y * cy + d.z * cz) / l - 1) / w);
    };
    for (let i = 0; i < p.count; i++) {
      d.fromBufferAttribute(p, i).normalize();
      const eyes = near(-0.38, 0.04, 0.92, 0.03) + near(0.38, 0.04, 0.92, 0.03);
      const brow = near(-0.34, 0.3, 0.89, 0.012) + near(0.34, 0.3, 0.89, 0.012);
      const nose = near(0, -0.24, 0.97, 0.01);
      const cheeks = near(-0.66, -0.2, 0.72, 0.03) + near(0.66, -0.2, 0.72, 0.03);
      const temples = near(-0.96, 0.12, 0.22, 0.05) + near(0.96, 0.12, 0.22, 0.05);
      const r = 1 - 0.36 * eyes + 0.05 * brow - 0.22 * nose + 0.07 * cheeks - 0.08 * temples;
      let x = d.x * r * 0.76, y = d.y * r * 0.86, z = d.z * r * 1.04;
      // bas du visage : la mâchoire se resserre et la face s'aplatit
      if (d.y < -0.3) {
        const k = Math.min(1, (-0.3 - d.y) / 0.6);
        x *= 1 - 0.38 * k;
        z = z * (1 - 0.18 * k) + 0.06 * k * Math.max(0, d.z);
      }
      if (d.z > 0.2 && d.y > -0.3) z -= 0.06 * (d.z - 0.2);
      p.setXYZ(i, x * 0.1, y * 0.1, z * 0.1);
      // dents : rangée claire striée, bouche sombre
      let shade = 1 - Math.min(0.96, 2.4 * eyes + 2.2 * nose) - 0.15 * temples;
      if (d.z > 0.55 && d.y < -0.42 && d.y > -0.68) {
        const gap = Math.abs(Math.sin(Math.atan2(d.x, d.z) * 22));
        shade *= Math.abs(d.y + 0.55) < 0.025 ? 0.15 : 0.55 + 0.45 * gap;
      }
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = shade;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.S.m.bone);
    mesh.castShadow = true;
    s.add(mesh);
    const eye = this.own(this.S.sprite(this.S.glow, { color: GREEN.clone().multiplyScalar(4) }));
    for (const k of [-1, 1]) {
      const e = new THREE.Sprite(eye);
      e.position.set(k * 0.028, 0.004, 0.072);
      e.scale.setScalar(0.04);
      s.add(e);
    }
    s.scale.setScalar(1.5);
    s.position.y = 0.42;
    g.add(s);
    const halo = new THREE.Sprite(this.own(this.S.sprite(this.S.glow, { color: GREEN, opacity: 0.4 })));
    halo.scale.setScalar(1.1);
    halo.position.y = 0.42;
    g.add(halo);
    g.userData.parts = [s, halo];
    return g;
  }

  makeBattery() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.18, 16), this.own(surface({ color: '#d8a020', emissive: '#2a2008', roughness: 0.35, physical: { clearcoat: 0.6, clearcoatRoughness: 0.2 } })));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.041, 0.06, 16), this.S.m.chrome);
    cap.position.y = 0.07;
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 10), this.S.m.chrome);
    tip.position.y = -0.1;
    const inner = new THREE.Group();
    inner.add(body, cap, tip);
    inner.position.y = 0.12;
    inner.rotation.z = 0.25;
    g.add(inner);
    const glint = new THREE.Sprite(this.own(this.S.sprite(this.S.glow, { color: 0xffffff, opacity: 0 })));
    glint.scale.setScalar(0.25);
    glint.position.y = 0.16;
    g.add(glint);
    g.userData.inner = inner;
    g.userData.glint = glint;
    return g;
  }

  makePing() {
    const g = new THREE.Group();
    const add = m => this.own(new THREE.MeshBasicMaterial({ color: PING, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, map: m }));
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 3, 20, 1, true), add(this.S.beam));
    col.geometry.rotateX(Math.PI);
    col.position.y = 1.5;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40), add(null));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    g.add(col, ring);
    g.userData.col = col;
    g.userData.ring = ring;
    this.world.add(g);
    return g;
  }

  makeViewmodel() {
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    scene.add(root);
    const amb = new THREE.AmbientLight(0x8a96c8, 0.4);
    const key = new THREE.DirectionalLight(0xffe0b0, 1.1);
    key.position.set(0.4, 1, 0.6);
    scene.add(amb, key);
    const holder = new THREE.Group();
    holder.position.set(0.19, -0.2, -0.45);
    holder.scale.setScalar(0.8);
    holder.rotation.y = 0.14;
    root.add(holder);
    scene.environment = this.env;
    scene.environmentIntensity = 0.8;
    // lampe en aluminium anodisé (profil tourné : culot, corps, tête évasée), bague chromée, verre et bouton
    const alu = surface({ ...ALU, env: 0.8 }), chrome = surface({ ...CHROME, env: 0.8 });
    const prof = [[0, 0], [0.016, 0], [0.018, 0.003], [0.018, 0.02], [0.0165, 0.024], [0.0165, 0.112], [0.018, 0.116], [0.018, 0.124], [0.025, 0.158], [0.029, 0.168], [0.029, 0.19], [0.026, 0.19]];
    const lamp = new THREE.Group();
    lamp.add(new THREE.Mesh(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 40), alu));
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.0275, 0.0028, 8, 40), chrome);
    bezel.rotation.x = Math.PI / 2;
    bezel.position.y = 0.19;
    const headMat = new THREE.MeshStandardMaterial({ color: 0x8a8a84, emissive: 0x000000, roughness: 0.05, metalness: 0.8 });
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.026, 40), headMat);
    lens.rotation.x = -Math.PI / 2;
    lens.position.y = 0.188;
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0055, 0.006, 14), surface({ color: 0x111111, roughness: 0.8 }));
    button.rotation.x = Math.PI / 2;
    button.position.set(0, 0.092, 0.0175);
    lamp.add(bezel, lens, button);
    lamp.rotation.x = -Math.PI / 2;
    lamp.position.z = 0.07;
    const sleeveMat = surface({ color: 0x555555, set: 'linen', channel: 0, scale: 0.3, detail: 0.5 });
    // avant-bras : du poignet vers le bas de l'écran, à droite
    const wrist = v3(0.03, -0.012, 0.075), arm = v3(0.35, -0.45, 1).normalize(), along = new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), arm.clone().negate());
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.3, 16), sleeveMat);
    sleeve.quaternion.copy(along);
    sleeve.position.copy(wrist).addScaledVector(arm, 0.19);
    // main gantée de cuir serrée autour du corps de la lampe : dos de la main à droite, doigts
    // enroulés par-dessous, pouce posé sur le dessus
    const glove = surface({ color: 0x5a3c28, set: 'stone', channel: 0, scale: 0.04, detail: 0.25, normal: 0.5, roughness: 0.55, env: 0.8, physical: { clearcoat: 0.25, clearcoatRoughness: 0.4 } });
    const back = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), glove);
    back.scale.set(0.024, 0.03, 0.045);
    back.rotation.z = -0.35;
    back.position.set(0.02, -0.002, 0.03);
    const fingers = [0, 1, 2, 3].map(i => {
      const f = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.0098 - i * 0.0005, 12, 18, Math.PI * 1.1), glove);
      f.rotation.z = -Math.PI * 1.05;
      f.position.z = 0.004 + i * 0.0165;
      return f;
    });
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.0085, 0.034, 6, 12), glove);
    thumb.rotation.set(Math.PI / 2 + 0.15, 0, 0.25);
    thumb.position.set(-0.006, 0.019, 0.01);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.027, 0.05, 18), glove);
    cuff.quaternion.copy(along);
    cuff.position.copy(wrist).addScaledVector(arm, 0.02);
    const anchor = new THREE.Object3D();
    anchor.position.z = -0.13;
    holder.add(lamp, sleeve, back, ...fingers, thumb, cuff, anchor);
    return { scene, root, holder, amb, key, headMat, sleeveMat, anchor };
  }

  makeDust() {
    const N = 240, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const seed = Array.from({ length: N }, () => [Math.random() * 8, Math.random() * WALL_H, Math.random() * 8, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.12]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    const points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.022, map: this.S.glow, vertexColors: true, transparent: true, depthWrite: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending,
    }));
    points.frustumCulled = false;
    return { points, seed, pos, col, g };
  }

  rig(p) {
    let r = this.rigs.get(p.id);
    if (!r) {
      r = this.makePlayerRig(p);
      this.rigs.set(p.id, r);
      this.world.add(r.root);
    }
    return r;
  }

  monsterRigs(n) {
    while (this.mrigs.length < n) {
      const r = this.makeMonsterRig();
      this.mrigs.push(r);
      this.world.add(r.root);
    }
  }

  item(it) {
    let o = this.items.get(it.id);
    if (!o) {
      o = it.type === 'skull' ? this.makeSkull() : this.makeBattery();
      o.position.set(it.x, 0, it.y);
      this.world.add(o);
      this.items.set(it.id, o);
    }
    return o;
  }

  // Avant la première image d'une partie (après setMap) : tout ce qui peut apparaître en jeu est créé,
  // ses shaders compilés en arrière-plan sans figer la page, puis une image d'essai où tout est visible
  // envoie les textures à la carte graphique et prépare les ombres. Sans cela, chaque nouveauté (ami à
  // terre, fantôme, signe…) figeait le jeu le temps de compiler : plusieurs secondes au premier lancement.
  async prepare(G) {
    await this.ready; // photos chargées (et compressées) pendant l'écran titre
    for (const p of G.players.values()) this.rig(p);
    this.monsterRigs(G.monsters.length);
    for (const it of G.items.values()) this.item(it);
    while (this.pingObjs.length < PINGS) this.pingObjs.push(this.makePing());
    const gl = this.gl, post = this.post, vmCam = this.vmCamera();
    // les shaders dépendent de la cible du rendu (image en haute dynamique, sans correction de tons)
    gl.setRenderTarget(post.target);
    await Promise.all([
      gl.compileAsync(this.scene, this.camera),
      gl.compileAsync(this.depth, this.camera),
      gl.compileAsync(this.vm.scene, vmCam),
    ]);
    const saved = [];
    for (const scene of [this.scene, this.vm.scene]) {
      scene.traverse(o => {
        if (o.isLight) return;
        saved.push([o, o.visible, o.frustumCulled]);
        o.visible = true;
        o.frustumCulled = false;
      });
    }
    gl.setRenderTarget(post.target);
    gl.clear();
    gl.render(this.depth, this.camera);
    gl.render(this.scene, this.camera);
    gl.render(this.vm.scene, vmCam);
    post.finish(0); // derrière l'écran du salon, encore affiché
    for (const [o, visible, culled] of saved) {
      o.visible = visible;
      o.frustumCulled = culled;
    }
  }

  // -------------------------------------------------------------------------
  // Image
  // -------------------------------------------------------------------------

  // Les lampes clignotent quand les piles faiblissent ou que la créature est proche.
  beamPower(G, p) {
    let k = 1;
    if (p.battery < 15 && Math.random() < 0.12) k = 0.15;
    let near = Infinity;
    for (const m of G.monsters) if (m.state !== 0) near = Math.min(near, Math.hypot(m.x - p.x, m.y - p.y));
    if (near < 5 && Math.random() < ((5 - near) / 5) * 0.22) k *= 0.1 + Math.random() * 0.4;
    return k;
  }

  // Position à l'écran (pixels de l'interface) d'un point du manoir à la hauteur `h`.
  project(x, y, h, w, H) {
    const cs = tmp.set(x, h, y).applyMatrix4(this.camera.matrixWorldInverse);
    const cx = cs.x, cy = cs.y, behind = cs.z > -0.05;
    tmp.set(x, h, y).project(this.camera);
    return { x: ((tmp.x + 1) / 2) * w, y: ((1 - tmp.y) / 2) * H, behind, cx, cy };
  }

  // Quand les images tombent sous ~40 par seconde pendant quelques secondes : d'abord plus de
  // lissage des bords, puis moins de pixels à calculer.
  adapt() {
    const now = performance.now(), ms = now - this.lastFrame;
    this.lastFrame = now;
    if (ms > 200) return; // onglet en arrière-plan, chargement…
    this.slow = Math.max(0, this.slow + (ms > 25 ? ms / 1000 : -ms / 2000));
    if (this.slow > 3 && this.post.samples > 0) {
      this.post.samples = 0;
      this.slow = 0;
    } else if (this.slow > 3 && this.quality > 0.55) {
      this.quality = Math.max(0.55, this.quality - 0.15);
      this.slow = 0;
      this.resize();
    }
  }

  frame(G) {
    const t = G.time, dt = Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    this.adapt();
    const eye = G.view, owner = eye.who, ghost = G.me?.state === 'dead';
    this.updateCamera(G, eye, dt);
    this.setGhostView(ghost);
    const lampOn = this.updateViewmodel(G, eye, owner);
    this.updateLights(G, dt, eye);
    this.updatePlayers(G, owner, ghost);
    this.updateMonsters(G, ghost, eye);
    this.updateItems(G);
    this.updatePings(G);
    this.updateExit(G, dt);
    this.updateDust(t, lampOn);

    const flash = Math.min(1, G.flash);
    // 0.33 : un peu plus qu'avant, pour la lueur que les reflets de la pièce donnaient aux matières mates
    this.ambient.intensity = (ghost ? 2.6 : 0.33) + flash * 2.6;
    this.vm.amb.intensity = 0.35 + flash * 2;
    for (const m of this.S.windows) m.color.setScalar(0.42 + flash * 1.6);

    // la scène en haute dynamique, puis le développement (halo, contraste, grain) vers l'écran ;
    // d'abord la profondeur seule du décor opaque : chaque pixel n'est ensuite éclairé qu'une fois,
    // au lieu de l'être aussi pour chaque pan caché derrière
    const gl = this.gl, post = this.post;
    gl.setRenderTarget(post.target);
    gl.clear();
    gl.render(this.depth, this.camera);
    gl.render(this.scene, this.camera);
    if (this.vm.root.visible) gl.render(this.vm.scene, this.vmCamera());
    post.beam(this.camera, this.lamp, DUST);
    post.params.grain.value = 0.035 + G.fear * 0.05;
    post.params.aberration.value = 0.012 + G.fear * 0.03 + G.shake * 0.03;
    post.params.ghost.value = ghost ? 1 : 0;
    post.params.shade.value = Math.min(1, 0.7 + G.fear * 0.4);
    post.params.red.value = G.me?.state === 'down' ? 0.55 + 0.25 * Math.sin(t * 4)
      : G.fear > 0.35 ? (G.fear - 0.35) * 0.9 * (0.6 + 0.4 * Math.sin(t * 9)) : 0;
    post.params.flash.value = Math.min(0.3, G.flash * 0.3);
    post.finish(t);
    this.hud.draw(G, this);
  }

  // Caméra de la main : la même vue, mais toute sa profondeur tient dans le premier centième. Rien du
  // décor ne passe devant elle, sans effacer la profondeur du décor qui sert au faisceau (post.js).
  vmCamera() {
    const c = this.vmCam, e = c.projectionMatrix.copy(this.camera.projectionMatrix).elements;
    for (const i of [2, 6, 10, 14]) e[i] = e[i] * 0.01 - e[i + 1] * 0.99;
    c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
    c.position.copy(this.camera.position);
    c.quaternion.copy(this.camera.quaternion);
    return c;
  }

  updateCamera(G, eye, dt) {
    const cam = this.camera, t = G.time;
    let h = EYE[eye.state] ?? EYE.alive, roll = 0, sway = 0;
    if (eye.state === 'alive' && eye.moving) {
      h += Math.abs(Math.sin(eye.bob * 2.6)) * (eye.running ? 0.05 : 0.03);
      sway = Math.sin(eye.bob * 2.6) * (eye.running ? 0.012 : 0.007);
    } else if (eye.state === 'dead') h += Math.sin(t * 1.6) * 0.06;
    else if (eye.state === 'down') roll = 0.3 + Math.sin(t * 1.3) * 0.04;
    cam.position.set(eye.x, h, eye.y);
    cam.rotation.set(eye.p, -eye.a - Math.PI / 2, roll + sway);
    if (G.shake > 0) {
      const s = G.shake;
      cam.position.x += (Math.random() - 0.5) * s * 0.12;
      cam.position.y += (Math.random() - 0.5) * s * 0.08;
      cam.rotation.x += (Math.random() - 0.5) * s * 0.06;
      cam.rotation.y += (Math.random() - 0.5) * s * 0.06;
    }
    const fov = 72 + (eye.running ? 5 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 6);
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  setGhostView(on) {
    if (on === this.ghostView) return;
    this.ghostView = on;
    this.fog.color.set(on ? 0x0a1022 : 0x000000);
    this.fog.density = on ? 0.045 : 0.075;
  }

  // La lampe tenue en main (dessinée à part, toujours devant le décor) et la lumière qu'elle projette.
  updateViewmodel(G, eye, owner) {
    const vm = this.vm, cam = this.camera;
    const me = owner === G.me && G.me;
    const alive = owner?.state === 'alive';
    const lampOn = alive && (me ? G.local.light && G.me.battery > 0 : owner.light);
    vm.root.visible = alive;
    vm.root.position.copy(cam.position);
    vm.root.quaternion.copy(cam.quaternion);
    if (alive) {
      const k = eye.moving ? 1 : 0, run = eye.running ? 1.8 : 1;
      vm.holder.position.set(0.19 + Math.sin(eye.bob * 2.6) * 0.012 * k * run, -0.2 - Math.abs(Math.cos(eye.bob * 2.6)) * 0.01 * k * run + Math.sin(G.time * 1.7) * 0.002, -0.45);
      vm.sleeveMat.color.set(art.shade(owner.color, -0.5));
    }
    vm.root.updateMatrixWorld(true);
    const power = lampOn ? this.beamPower(G, owner) : 0;
    vm.headMat.emissive.setRGB(power * 2.5, power * 2.3, power * 2);
    const lamp = this.lamp;
    lamp.intensity = LAMP * power;
    if (lampOn) {
      lamp.distance = CFG.light.range * batteryFactor(owner.battery) * 1.5;
      vm.anchor.getWorldPosition(lamp.position);
      lamp.target.position.set(0, 0, -7).applyMatrix4(cam.matrixWorld);
      lamp.target.updateMatrixWorld();
    }
    this.aura.position.set(cam.position.x, cam.position.y - 0.3, cam.position.z);
    this.aura.intensity = owner?.state === 'alive' ? 1.2 : owner?.state === 'down' ? 0.8 : 0;
    return lampOn;
  }

  // Les lumières les plus proches occupent les places disponibles ; elles s'allument et s'éteignent
  // en douceur quand elles en changent.
  updateLights(G, dt, eye) {
    const t = G.time, map = this.map, cand = this.cand;
    cand.length = 0;
    for (const l of this.statics) {
      const out = (G.extinguished.get(l.i) || 0) > t;
      for (const f of l.flames) f.visible = !out;
      if (l.halo) l.halo.visible = !out;
      if (out) continue;
      const d = Math.hypot(l.x - eye.x, l.y - eye.y);
      if (d > 26) continue;
      const k = flicker(l, t);
      for (const f of l.flames) {
        const s = f.userData.s;
        f.scale.set(0.055 * s * (0.9 + 0.2 * k), 0.1 * s * (0.75 + 0.35 * k + 0.1 * Math.sin(t * 30 + l.ph)), 1);
      }
      if (l.halo) {
        l.halo.material.opacity = (l.k === 'pumpkin' ? 0.35 : 0.28) * k;
        l.halo.scale.setScalar(l.halo.userData.size * (0.9 + 0.15 * k));
      }
      cand.push({ key: l, x: l.x, y: l.y, h: l.h, color: l.color, power: l.power * k, range: l.range, d });
    }
    for (const it of G.items.values()) {
      if (it.taken || it.type !== 'skull') continue;
      const d = Math.hypot(it.x - eye.x, it.y - eye.y);
      if (d < 26) cand.push({ key: 'k' + it.id, x: it.x, y: it.y, h: 0.5, color: GREEN, power: 1.6 + 0.4 * Math.sin(t * 3 + it.id), range: 3, d });
    }
    for (const p of G.pings) {
      const d = Math.hypot(p.x - eye.x, p.y - eye.y);
      cand.push({ key: `p${p.x},${p.y}`, x: p.x, y: p.y, h: 1.2, color: PING, power: 3 * Math.min(1, p.t / 2), range: 4, d });
    }
    if (G.exitOpen) {
      const ex = map.exit, x = ex.x + ex.w / 2, y = ex.y + 0.2;
      cand.push({ key: 'exit', x, y, h: 1.6, color: OUTSIDE, power: 9 * Math.min(1, this.exitAngle), range: 8, d: Math.hypot(x - eye.x, y - eye.y) });
    }
    for (const c of cand) c.score = c.d - c.range * 0.4 + (lineOfSight(map, eye.x, eye.y, c.x, c.y) ? 0 : 5);
    cand.sort((a, b) => a.score - b.score);
    const want = SLOTS - 2; // deux places restent libres pour celles qui s'éteignent
    const active = [];
    cand.forEach((c, i) => {
      const w0 = this.weights.get(c.key) || 0;
      c.w = w0 + ((i < want ? 1 : 0) - w0) * Math.min(1, dt * 6);
      this.weights.set(c.key, c.w);
      if (c.w > 0.01) active.push(c);
    });
    active.sort((a, b) => b.w - a.w);
    this.slots.forEach((s, i) => {
      const c = active[i];
      if (!c) { s.intensity = 0; return; }
      s.position.set(c.x, c.h, c.y);
      s.color.copy(c.color);
      s.distance = c.range;
      s.intensity = c.power * GLOW * c.w * Math.min(1, (26 - c.d) / 6);
    });
  }

  updatePlayers(G, owner, ghost) {
    const t = G.time, eye = G.view, lit = [];
    for (const p of G.players.values()) {
      const r = this.rig(p);
      const body = p !== owner && (p.state === 'alive' || p.state === 'down');
      const spirit = p !== owner && p.state === 'dead' && ghost;
      r.root.visible = body || spirit;
      r.body.visible = r.blood.visible = body;
      r.ghost.visible = spirit;
      if (!r.root.visible) continue;
      r.root.position.set(p.x, 0, p.y);
      r.root.rotation.y = -p.a;
      if (spirit) r.ghost.position.y = 0.25 + Math.sin(t * 2 + p.id) * 0.08;
      const down = p.state === 'down';
      r.blood.visible = down;
      const on = body && p.state === 'alive' && p.light;
      if (body) this.posePlayer(r, p, t, down, on);
      r.beam.visible = r.lampGlow.visible = on;
      r.lens.emissive.setScalar(0);
      if (on) {
        const k = this.beamPower(G, p);
        r.beam.scale.x = batteryFactor(p.battery);
        r.beam.material.uniforms.opacity.value = 0.08 * k;
        r.lampGlow.material.opacity = 0.9 * k;
        r.lens.emissive.setRGB(k * 2.5, k * 2.3, k * 2);
        lit.push({ p, r, k, d: Math.hypot(p.x - eye.x, p.y - eye.y) });
      }
    }
    lit.sort((a, b) => a.d - b.d);
    this.beams.forEach((s, i) => {
      const b = lit[i];
      if (!b) { s.intensity = 0; return; }
      // depuis le verre de sa lampe, dans l'axe du fût
      const { p, r, k } = b;
      r.tip.getWorldPosition(s.position);
      s.target.position.set(1, 0, 0).applyQuaternion(r.tip.getWorldQuaternion(tmpQ)).multiplyScalar(6).add(s.position);
      s.target.updateMatrixWorld();
      s.distance = CFG.light.range * batteryFactor(p.battery) * 1.4;
      s.intensity = LAMP * 0.8 * k;
    });
  }

  // Marche (cuisses, genoux, chevilles, balancement des bras et du buste), lampe pointée devant soi
  // ou baissée quand elle est éteinte, à terre sur le dos ; passages en douceur d'une pose à l'autre.
  posePlayer(r, p, t, down, lampOn) {
    const B = r.bone, dt = Math.min(0.1, Math.max(0, t - r.t)), ease = k => Math.min(1, dt * k);
    r.t = t;
    const moving = p.moving && !down;
    r.mv += ((moving ? 1 : 0) - r.mv) * ease(8);
    r.run += ((p.running ? 1 : 0) - r.run) * ease(5);
    r.aim += ((lampOn ? 1 : 0) - r.aim) * ease(5);
    r.ph += dt * (moving ? lerp(9, 11, r.run) : down && p.moving ? 4 : 0);
    const ph = r.ph, w = r.mv, A = w * lerp(0.48, 0.66, r.run);
    const breath = Math.sin(t * 1.7 + p.id) * 0.012;
    r.body.rotation.z = down ? Math.PI / 2 : 0;
    r.body.position.set(down ? 0.9 : 0, down ? 0.135 : 0, 0);
    B.hips.position.y = 0.96 + (down ? 0 : w * (0.022 * Math.cos(2 * ph) - 0.02 - 0.03 * r.run));
    B.hips.rotation.y = down ? 0 : 0.12 * A * Math.sin(ph);
    B.spine.rotation.set(0, -0.08 * A * Math.sin(ph), -0.04 * w - 0.14 * r.run * w + breath);
    B.chest.rotation.set(0, -0.06 * A * Math.sin(ph), breath * 0.5);
    B.neck.rotation.set(0, 0, 0.05 * r.run * w);
    B.head.rotation.set(0, down ? 0.5 + Math.sin(t * 1.3) * 0.1 : Math.sin(t * 0.4 + p.id) * 0.15 * (1 - w), down ? 0 : 0.06 * w * r.run);
    [-1, 1].forEach((s, i) => {
      const side = i ? 'R' : 'L', th = B['th' + side], kn = B['kn' + side], an = B['an' + side];
      if (down) {
        // une jambe repliée, l'autre tendue, qui poussent faiblement quand on rampe
        const push = p.moving ? Math.sin(ph + i * Math.PI) * 0.3 : 0;
        th.rotation.set(0, 0, i ? 0.15 + push : 0.7 + push);
        kn.rotation.z = i ? -0.15 : -1.2 - push;
        an.rotation.z = 0.2;
        return;
      }
      const a = ph + (i ? Math.PI : 0), swing = Math.sin(a);
      th.rotation.set(0, 0, swing * A + 0.12 * r.run * w);
      kn.rotation.z = -(0.05 + w * (0.08 + 0.2 * r.run) + Math.max(0, Math.cos(a + 0.6)) * A * lerp(1.7, 2.3, r.run));
      an.rotation.z = -(th.rotation.z + kn.rotation.z) * 0.75 + 0.15 * w * Math.max(0, -swing);
    });
    // bras gauche : balancement opposé à la jambe gauche ; à terre, étendu sur le côté
    if (down) B.shL.rotation.set(0.9, 0, 0.3 + Math.sin(t * 1.1) * 0.05);
    else B.shL.rotation.set(0.06, 0, -Math.sin(ph) * A * 0.85 + 0.04);
    B.elL.rotation.z = down ? 0.4 : 0.25 + w * (0.25 + 0.6 * r.run) + Math.max(0, -Math.sin(ph)) * A * 0.5;
    B.wrL.rotation.z = 0.05;
    // bras droit : la lampe pointée droit devant (AIM) ou baissée ; à terre, la main tendue vers le haut
    if (down) {
      B.shR.rotation.set(-0.2, 0, 1.5 + Math.sin(t * 1.6) * 0.12);
      B.elR.rotation.z = 0.3;
      B.wrR.rotation.z = -0.2;
    } else {
      const k = r.aim, sway = Math.sin(ph * 2) * 0.03 * w + Math.sin(t * 1.1 + p.id) * 0.015;
      B.shR.rotation.set(-0.05 * k, 0, lerp(0.15 + Math.sin(ph) * A * 0.5, AIM[0], k) + sway);
      B.elR.rotation.z = lerp(0.45 + w * 0.3, AIM[1], k);
      B.wrR.rotation.z = lerp(-0.25, AIM[2], k);
    }
    r.root.updateMatrixWorld(true);
  }

  updateMonsters(G, ghost, eye) {
    const t = G.time;
    this.monsterRigs(G.monsters.length);
    this.mrigs.forEach((r, i) => {
      const m = G.monsters[i];
      r.root.visible = !!m;
      if (!m) return;
      if (r.xray !== ghost) {
        // les fantômes voient la créature à travers les murs (sans changer ses shaders : les recompiler
        // figeait le jeu au moment de la mort)
        r.xray = ghost;
        for (const mt of r.mats) mt.depthTest = !ghost;
        for (const mt of r.tint) {
          mt.emissive.set(ghost ? 0x6a0c1c : 0x000000);
          mt.emissiveIntensity = 1;
        }
        r.root.traverse(o => { o.renderOrder = ghost ? 5 : 0; });
      }
      const asleep = m.state === 0, chase = m.state === 4, flee = m.state === 5;
      const shake = flee || m.lit ? 0.04 : 0;
      r.root.position.set(m.x + (Math.random() - 0.5) * shake, 0, m.y + (Math.random() - 0.5) * shake);
      r.root.rotation.y = -m.a;
      r.body.scale.set(1, asleep ? 0.62 : 1 + Math.sin(t * 2.3) * 0.015, 1);
      r.body.rotation.z = asleep ? -0.35 : chase ? -0.22 : -0.05;
      for (const mt of r.tint) mt.opacity = flee ? 0.7 : 1;
      const speed = asleep ? 0.6 : chase ? 7 : 2.5;
      for (const a of r.arms) {
        const reach = chase ? 1.4 + Math.sin(t * 8 + a.s) * 0.12 : 0.25 + Math.sin(t * 1.3 + a.s) * 0.12;
        a.shoulder.rotation.z = asleep ? 0.6 : reach;
        a.shoulder.rotation.x = a.s * (chase ? -0.15 : 0.08);
        a.elbow.rotation.z = chase ? 0.15 + Math.sin(t * 9 + a.s) * 0.1 : 0.35;
        // poignet cassé vers le bas ; doigts crispés qui s'ouvrent et se referment pendant la chasse,
        // à demi repliés et agités de lents frémissements sinon
        a.wrist.rotation.z = asleep ? -0.2 : chase ? -0.35 + Math.sin(t * 7 + a.s) * 0.15 : -0.15 + Math.sin(t * 0.9 + a.s) * 0.1;
        a.fingers.forEach((f, i) => {
          const c = asleep ? 0.55 : chase ? 0.15 + 0.6 * (0.5 + 0.5 * Math.sin(t * 6 + i * 0.6 + a.s)) : 0.3 + 0.18 * Math.sin(t * 1.3 + i * 1.7 + a.s * 2);
          f[0].rotation.z = -c * 0.7;
          f[1].rotation.z = -c * 1.1;
          f[2].rotation.z = -c * 0.8;
          f[0].rotation.x = (i - 1.5) * a.s * (chase ? 0.1 : 0.05);
        });
        const c = asleep ? 0.5 : chase ? 0.2 + 0.4 * (0.5 + 0.5 * Math.sin(t * 6 + a.s)) : 0.35;
        a.thumb[1].rotation.z = -c * 0.6;
        a.thumb[2].rotation.z = -c * 0.8;
      }
      r.tendrils.forEach((segs, k) => {
        segs.forEach((seg, j) => {
          seg.rotation.x = Math.sin(t * speed * 0.5 + k * 1.7 + j * 0.5) * 0.24;
          seg.rotation.z = Math.sin(t * speed * 0.4 + k + j * 0.65) * 0.27;
        });
      });
      for (const sp of r.smoke) {
        const ph = sp.userData.ph;
        sp.material.rotation = t * 0.3 + ph;
        sp.scale.setScalar(1.5 + Math.sin(t * 0.9 + ph) * 0.3);
        sp.material.opacity = asleep ? 0.3 : 0.55;
      }
      const d = Math.hypot(m.x - eye.x, m.y - eye.y);
      // vue d'un fantôme, sa lueur rouge compense la brume : elle se voit de loin
      if (ghost) for (const mt of r.tint) mt.emissiveIntensity = 1 / Math.max(0.15, Math.exp(-((this.fog.density * d) ** 2)));
      let a = asleep || flee ? 0 : Math.max(0, 1 - d / 9) * (chase ? 1 : 0.6) * (0.75 + 0.25 * Math.sin(t * 7));
      if (ghost && !asleep) a = Math.max(a, 0.7);
      r.eyeMat.opacity = a;
      r.eyeMat.color.set(chase ? 0xff2a20 : 0xffd9a0);
      for (const e of r.eyes) e.visible = a > 0.01;
    });
  }

  updateItems(G) {
    const t = G.time;
    for (const it of G.items.values()) {
      const o = this.item(it);
      o.visible = !it.taken;
      if (!o.visible) continue;
      if (it.type === 'skull') {
        const y = 0.42 + Math.sin(t * 2 + it.id) * 0.05;
        for (const p of o.userData.parts) p.position.y = y;
        // le crâne se tourne vers celui qui regarde et lève un peu la face vers lui
        const sk = o.userData.parts[0], dx = this.camera.position.x - it.x, dz = this.camera.position.z - it.y;
        sk.rotation.set(-Math.min(0.7, Math.atan2(this.camera.position.y - y, Math.hypot(dx, dz))) * 0.8, Math.atan2(dx, dz) + Math.sin(t * 0.8 + it.id) * 0.4, 0, 'YXZ');
        o.userData.parts[1].material.opacity = 0.32 + 0.12 * Math.sin(t * 3 + it.id);
      } else {
        o.userData.inner.rotation.y = t * 0.8 + it.id;
        o.userData.glint.material.opacity = Math.sin(t * 3 + it.id) > 0.92 ? 0.8 : 0;
      }
    }
  }

  updatePings(G) {
    while (this.pingObjs.length < G.pings.length) this.pingObjs.push(this.makePing());
    this.pingObjs.forEach((o, i) => {
      const p = G.pings[i];
      o.visible = !!p;
      if (!p) return;
      const a = Math.min(1, p.t / 2), cyc = ((6 - p.t) % 1.5) / 1.5;
      o.position.set(p.x, 0, p.y);
      o.userData.col.material.opacity = 0.35 * a;
      o.userData.ring.material.opacity = a * (1 - cyc);
      o.userData.ring.scale.setScalar(0.6 + cyc * 1.6);
    });
  }

  updateExit(G, dt) {
    const target = G.exitOpen ? 1.75 : 0;
    this.exitAngle += (target - this.exitAngle) * Math.min(1, dt * 1.2);
    this.leafL.rotation.y = -this.exitAngle;
    this.leafR.rotation.y = this.exitAngle;
    this.outside.visible = this.exitAngle > 0.01;
    this.seal.visible = !G.exitOpen;
    this.seal.rotation.z = G.time * 0.3;
    this.seal.material.opacity = 0.55 + 0.2 * Math.sin(G.time * 2);
  }

  // Poussière en suspension, visible seulement dans le faisceau de sa propre lampe.
  updateDust(t, on) {
    const { seed, pos, col, g } = this.dust, cam = this.camera.position, L = this.lamp;
    const dir = tmp2.subVectors(L.target.position, L.position).normalize();
    const cosCone = Math.cos(CFG.light.cone), range = L.distance || 1;
    const wrap = (v, base, size) => base + ((((v - base) % size) + size) % size);
    for (let i = 0; i < seed.length; i++) {
      const s = seed[i];
      const x = wrap(s[0] + s[3] * t, cam.x - 4, 8), y = wrap(s[1] + s[4] * t, 0, WALL_H), z = wrap(s[2] + s[5] * t, cam.z - 4, 8);
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      let b = 0;
      if (on) {
        const dx = x - L.position.x, dy = y - L.position.y, dz = z - L.position.z, d = Math.hypot(dx, dy, dz);
        const c = (dx * dir.x + dy * dir.y + dz * dir.z) / (d || 1);
        if (c > cosCone && d < range) b = Math.sqrt((c - cosCone) / (1 - cosCone)) * (1 - d / range) * 0.9;
      }
      col[i * 3] = b;
      col[i * 3 + 1] = b * 0.93;
      col[i * 3 + 2] = b * 0.8;
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }
}
