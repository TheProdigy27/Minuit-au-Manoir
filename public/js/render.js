// Rendu en première personne (three.js) : le manoir en volume, la lampe torche et les bougies,
// les autres joueurs, la créature et les objets. L'interface est dessinée par-dessus (hud.js).
import * as THREE from '/vendor/three.module.min.js';
import { TILE, CFG, batteryFactor } from '/shared/config.js';
import { tileAt, lineOfSight } from '/shared/physics.js';
import { mulberry32 } from '/shared/map.js';
import * as art from './art.js';
import { Hud } from './hud.js';

export const WALL_H = 2.6; // hauteur sous plafond (une case = un mètre)
const DOOR_H = 2.15;
const TAU = Math.PI * 2;
const SLOTS = 12; // bougies et lueurs éclairant réellement la scène (les plus proches)
const BEAMS = 3; // lampes des autres joueurs qui éclairent la scène
const EYE = { alive: 1.55, down: 0.4, dead: 1.65 };
const DIRS4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const LAMP = 26; // intensité de la lampe torche
const GLOW = 2.2; // intensité des bougies, lustres, feux et lueurs
const GREEN = new THREE.Color().setRGB(80 / 255, 1, 120 / 255, THREE.SRGBColorSpace);
const PING = new THREE.Color().setRGB(140 / 255, 180 / 255, 1, THREE.SRGBColorSpace);
const OUTSIDE = new THREE.Color().setRGB(150 / 255, 1, 190 / 255, THREE.SRGBColorSpace);

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

// Matrice de placement : position, rotations (lacet, puis tangage, puis roulis), échelle.
function mat(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(v3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), v3(sx, sy, sz));
}

function flicker(l, t) {
  if (l.k === 'moon') return 0.9 + 0.05 * Math.sin(t * 0.7 + l.ph);
  if (l.k === 'fire') return 0.8 + 0.12 * Math.sin(t * 11 + l.ph) + 0.08 * Math.sin(t * 23 + l.ph * 2);
  return 0.85 + 0.08 * Math.sin(t * 9 + l.ph) + 0.06 * Math.sin(t * 17.3 + l.ph * 3);
}

// ---------------------------------------------------------------------------
// Géométrie fixe, regroupée par matériau : quelques dizaines d'appels de dessin pour tout le manoir.
// ---------------------------------------------------------------------------

class Builder {
  constructor(mw, mh, planMat) {
    this.mw = mw;
    this.mh = mh;
    this.planMat = planMat;
    this.parts = new Map();
  }

  part(m) {
    let p = this.parts.get(m);
    if (!p) this.parts.set(m, (p = { pos: [], nor: [], uv: [] }));
    return p;
  }

  planUV(x, z) {
    return [x / this.mw, 1 - z / this.mh];
  }

  // Quadrilatère a b c d, dans le sens trigonométrique vu de face.
  quad(m, a, b, c, d, uv = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    if (m === this.planMat) uv = [a, b, c, d].map(v => this.planUV(v.x, v.z));
    const p = this.part(m);
    const n = tmp.subVectors(b, a).cross(tmp2.subVectors(d, a)).normalize();
    const pts = [a, b, c, d];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      p.pos.push(pts[i].x, pts[i].y, pts[i].z);
      p.nor.push(n.x, n.y, n.z);
      p.uv.push(uv[i][0], uv[i][1]);
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

  // Géométrie three.js quelconque, placée par une matrice. Avec `plan`, les faces tournées vers le
  // haut reçoivent le plan dessiné (dessus des tonneaux, cercueils…).
  geo(m, g, matrix, plan = false) {
    const src = g.index ? g.toNonIndexed() : g;
    if (matrix) src.applyMatrix4(matrix);
    const pos = src.attributes.position.array, nor = src.attributes.normal.array, uv = src.attributes.uv?.array;
    for (let i = 0; i < pos.length / 3; i += 3) {
      const up = plan && nor[i * 3 + 1] + nor[i * 3 + 4] + nor[i * 3 + 7] > 2.85;
      const p = this.part(up ? this.planMat : m);
      for (let j = i; j < i + 3; j++) {
        p.pos.push(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]);
        p.nor.push(nor[j * 3], nor[j * 3 + 1], nor[j * 3 + 2]);
        if (up) p.uv.push(...this.planUV(pos[j * 3], pos[j * 3 + 2]));
        else p.uv.push(uv ? uv[j * 2] : 0, uv ? uv[j * 2 + 1] : 0);
      }
    }
    src.dispose();
    g.dispose();
  }

  build(parent) {
    for (const [m, p] of this.parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(p.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = !m.userData.noShadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
    }
  }
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export class Renderer {
  constructor(canvas, hudCanvas) {
    this.cv = canvas;
    const gl = (this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.25;
    gl.autoClear = false;
    this.aniso = gl.capabilities.getMaxAnisotropy();
    this.sides = new Map();
    this.walls = new Map();
    this.S = this.makeShared();

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x000000);
    scene.fog = this.fog = new THREE.FogExp2(0x000000, 0.075);
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.04, 90);
    this.camera.rotation.order = 'YXZ';
    this.ambient = new THREE.AmbientLight(0x8a96c8, 0.12);
    scene.add(this.ambient);

    // La lampe torche : la seule lumière qui projette des ombres.
    this.lamp = new THREE.SpotLight(0xfff0d0, 0, 12, CFG.light.cone, 0.45, 1.5);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(1024, 1024);
    this.lamp.shadow.camera.near = 0.1;
    this.lamp.shadow.bias = -0.0004;
    this.lamp.shadow.normalBias = 0.03;
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
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.hud.resize();
  }

  texture(cv, repeat = false) {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = this.aniso;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  // Ressources propres à une partie, libérées à la suivante.
  own(x) {
    this.owned.push(x);
    return x;
  }

  makeShared() {
    const T = (cv, repeat) => this.texture(cv, repeat);
    const L = (o, noShadow = false) => {
      const m = new THREE.MeshLambertMaterial(o);
      m.userData.noShadow = noShadow;
      return m;
    };
    const wood = T(art.matterTexture('wood'), true), stone = T(art.matterTexture('stone'), true), velvet = T(art.matterTexture('velvet'), true);
    const ceiling = T(art.ceilingTexture(), true);
    const [pk, pkGlow] = art.pumpkinTextures();
    const sprite = (map, o = {}) => new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending, ...o });
    const glow = T(art.glowTexture());
    return {
      glow,
      smoke: T(art.smokeTexture()),
      beam: T(art.beamTexture()),
      skull: T(art.skullTexture()),
      mask: T(art.maskTexture()),
      seal: T(art.sealTexture()),
      night: T(art.nightTexture()),
      blood: T(art.bloodTexture()),
      flame: sprite(T(art.flameTexture())),
      windows: [false, true].map(moon => new THREE.MeshBasicMaterial({ map: T(art.windowTexture(moon)), color: 0x707070 })),
      paintings: [0, 1, 2, 3].map(v => L({ map: T(art.paintingTexture(v)) })),
      mirror: L({ map: T(art.mirrorTexture()), transparent: true, alphaTest: 0.3 }),
      torn: L({ map: T(art.tornTexture()), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }, true),
      web: L({ map: T(art.webTexture()), transparent: true, depthWrite: false, side: THREE.DoubleSide }, true),
      sprite,
      m: {
        wood: L({ map: wood }),
        stone: L({ map: stone }),
        velvet: L({ map: velvet }),
        curtain: L({ map: velvet, side: THREE.DoubleSide }),
        ceiling: L({ map: ceiling }),
        marble: L({ color: '#8a8a92' }),
        iron: L({ color: '#1e1e22' }),
        brass: L({ color: '#9a7a32' }),
        wax: L({ color: '#e8dfc8', emissive: '#2a2010' }),
        enamel: L({ color: '#cfcac0' }),
        lacquer: L({ color: '#100e10' }),
        linen: L({ color: '#bdb4a2' }),
        bark: L({ color: '#2e2219' }),
        leaf: L({ color: '#3a3a1c' }),
        terracotta: L({ color: '#7a3e22' }),
        painted: L({ color: '#7a3a1a' }),
        grass: L({ color: '#141c14' }),
        skin: L({ color: '#d9b894' }),
        orb: L({ color: '#2a3a5a', emissive: '#0a1a3a' }),
        brew: L({ color: '#2f8a3a', emissive: '#1f7a2a' }, true),
        pumpkin: L({ map: T(pk), emissiveMap: T(pkGlow), emissive: '#ffffff' }),
      },
    };
  }

  wallMat(theme) {
    let m = this.walls.get(theme);
    if (!m) this.walls.set(theme, (m = new THREE.MeshLambertMaterial({ map: this.texture(art.wallAtlas(theme, WALL_H)) })));
    return m;
  }

  sideMat(kind, h) {
    const key = kind + h;
    let m = this.sides.get(key);
    if (!m) {
      const t = this.texture(art.sideTexture(kind, h));
      t.wrapS = THREE.RepeatWrapping;
      m = new THREE.MeshLambertMaterial({ map: t });
      if (kind === 'crib') {
        Object.assign(m, { alphaTest: 0.5, side: THREE.DoubleSide });
        m.userData.noShadow = true;
      }
      if (kind === 'potions') Object.assign(m, { emissiveMap: t, emissive: new THREE.Color(0x555555) });
      this.sides.set(key, m);
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
    const k = Math.min(1.5, maxTex / (map.w * art.TS), maxTex / (map.h * art.TS), Math.sqrt(12e6 / (map.w * map.h * art.TS * art.TS)));
    this.plan = art.buildPlan(map, k);
    this.planMat = this.own(new THREE.MeshLambertMaterial({ map: this.own(this.texture(this.plan)) }));
    this.topAt = new Float32Array(map.w * map.h);
    this.kindAt = new Array(map.w * map.h);
    const B = new Builder(map.w, map.h, this.planMat);
    this.buildShell(B, map);
    for (const f of map.furniture) this.buildFurniture(B, f, map);
    this.buildDecor(B, map);
    this.buildLights(B, map);
    this.buildExit(B, map);
    B.build(this.world);
    this.items = new Map();
    this.rigs = new Map();
    this.mrigs = [];
    this.pingObjs = [];
    this.weights = new Map();
    this.exitAngle = 0;
    this.hud.setMap(map, this.plan);
  }

  clearWorld() {
    if (!this.world) return;
    this.scene.remove(this.world);
    this.world.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    for (const x of this.owned) x.dispose();
    this.owned = [];
    this.world = null;
  }

  buildShell(B, map) {
    const { w, h } = map, M = this.S.m;
    const theme = (x, y) => this.wallMat(art.themeNear(map, x, y));
    B.quad(this.planMat, v3(0, 0, h), v3(w, 0, h), v3(w, 0, 0), v3(0, 0, 0));
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
      for (let dz = 2; dz < ch; dz += 2) B.box(cell.x, WALL_H - 0.2, cell.y + dz - 0.09, cell.x + cw, WALL_H, cell.y + dz + 0.09, null, M.wood, { bottom: M.wood });
    }
  }

  buildFurniture(B, f, map) {
    const M = this.S.m, P = this.planMat, U = { unit: true }, FIT = { unit: true, fit: true };
    const S = (kind, h) => this.sideMat(kind, h);
    const x0 = f.x + 0.05, z0 = f.y + 0.05, x1 = f.x + f.w - 0.05, z1 = f.y + f.h - 0.05;
    const cx = f.x + f.w / 2, cz = f.y + f.h / 2;
    const top = h => {
      for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) { this.topAt[y * map.w + x] = h; this.kindAt[y * map.w + x] = f.k; }
    };
    const block = (h, kind) => { B.box(x0, 0, z0, x1, h, z1, P, S(kind, h), U); top(h); };
    const cyl = (m, rt, rb, h, x, y, z, seg = 12, plan = false) => B.geo(m, new THREE.CylinderGeometry(rt, rb, h, seg), mat(x, y + h / 2, z), plan);
    const table = (h, leg = 0.06) => {
      B.box(x0, h - 0.06, z0, x1, h, z1, P, M.wood, { bottom: M.wood });
      const i = 0.07;
      for (const [lx, lz] of [[x0 + i, z0 + i], [x1 - i - leg, z0 + i], [x0 + i, z1 - i - leg], [x1 - i - leg, z1 - i - leg]]) B.box(lx, 0, lz, lx + leg, h - 0.06, lz + leg, null, M.wood);
      top(h);
    };
    const rnd = mulberry32(f.x * 977 + f.y * 131);
    this.kindAt[f.y * map.w + f.x] = f.k;
    switch (f.k) {
      case 'shelf': block(2.2, 'books'); break;
      case 'potions': block(2.0, 'potions'); break;
      case 'wardrobe': block(2.1, 'wardrobe'); break;
      case 'cabinet': block(1.9, 'cabinet'); break;
      case 'dresser': block(0.95, 'drawers'); break;
      case 'nightstand': block(0.62, 'drawers'); break;
      case 'counter':
      case 'island': block(0.92, 'kitchen'); break;
      case 'altar': B.box(x0, 0, z0, x1, 1.0, z1, P, S('altar', 1.0), FIT); top(1.0); break;
      case 'toychest': block(0.55, 'toy'); break;
      case 'sarcophagus': B.box(x0, 0, z0, x1, 0.85, z1, P, M.stone); top(0.85); break;
      case 'bathtub': B.box(x0, 0.08, z0, x1, 0.62, z1, P, M.enamel, { bottom: M.enamel }); top(0.62); break;
      case 'crate': B.box(x0, 0, z0, x1, 0.75, z1, S('crate', 0.75), S('crate', 0.75), { unit: true, topUnit: true }); top(0.75); break;
      case 'crates':
        B.box(x0, 0, z0, x1, 0.85, z1, S('crate', 0.85), S('crate', 0.85), { unit: true, topUnit: true });
        B.box(x0 + 0.1, 0.85, z0 + 0.12, x1 - 0.12, 1.7, z1 - 0.06, S('crate', 0.85), S('crate', 0.85), { unit: true, topUnit: true });
        break;
      case 'table': table(0.78); break;
      case 'sidetable': table(0.75, 0.05); break;
      case 'worktable': table(0.86, 0.07); break;
      case 'longtable': table(0.78, 0.08); break;
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
      case 'statue':
        B.box(x0 + 0.08, 0, z0 + 0.08, x1 - 0.08, 0.4, z1 - 0.08, M.stone, M.stone);
        cyl(M.marble, 0.15, 0.3, 1.2, cx, 0.4, cz);
        B.geo(M.marble, new THREE.SphereGeometry(0.13, 12, 10), mat(cx, 1.72, cz + 0.05));
        B.geo(M.marble, new THREE.SphereGeometry(0.16, 10, 8), mat(cx, 1.62, cz - 0.02, 0, 0, 0, 1, 0.6, 1));
        for (const s of [-1, 1]) B.geo(M.marble, new THREE.SphereGeometry(0.5, 10, 8), mat(cx + s * 0.14, 1.42, cz - 0.18, 0, s * 0.6, 0, 0.08, 1, 0.45));
        break;
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
        B.geo(M.wood, g, null, true);
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
        B.geo(M.lacquer, g, null, true);
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

  buildDecor(B, map) {
    const M = this.S.m, S = this.S;
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
          B.box(x + 0.18, 1.18, z, x + 0.82, 1.98, z + 0.03, null, M.wood);
          q(S.paintings[d.v], x + 0.18, x + 0.82, 1.18, 1.98, 0.035);
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
      const m = new THREE.Mesh(new THREE.BoxGeometry(half - 0.02, top, 0.08), leafMat);
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
    const cloth = this.own(new THREE.MeshLambertMaterial({ color: p.color }));
    const dark = this.own(new THREE.MeshLambertMaterial({ color: art.shade(p.color, -0.65) }));
    const hair = this.own(new THREE.MeshLambertMaterial({ color: art.shade(p.color, -0.45) }));
    const limb = (r, len, m) => {
      const g = new THREE.CylinderGeometry(r, r * 0.85, len, 8);
      g.translate(0, -len / 2, 0);
      const o = new THREE.Mesh(g, m);
      o.castShadow = true;
      return o;
    };
    const legs = [-1, 1].map(s => {
      const l = limb(0.075, 0.84, dark);
      l.position.set(0, 0.86, s * 0.1);
      body.add(l);
      return l;
    });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.36, 4, 10), cloth);
    torso.position.y = 1.2;
    torso.scale.set(0.75, 1, 1.05);
    torso.castShadow = true;
    body.add(torso);
    const arms = [-1, 1].map(s => {
      const a = limb(0.05, 0.62, cloth);
      a.position.set(0, 1.44, s * 0.24);
      body.add(a);
      return a;
    });
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.034, 0.17, 8), M.iron);
    lamp.position.set(0, -0.68, 0);
    arms[1].add(lamp);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), M.skin);
    head.position.set(0.01, 1.68, 0);
    head.castShadow = true;
    body.add(head);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.128, 14, 8, 0, TAU, 0, Math.PI * 0.55), hair);
    cap.position.set(-0.012, 1.69, 0);
    body.add(cap);
    const lampGlow = new THREE.Sprite(this.own(this.S.sprite(this.S.glow, { color: 0xfff0d0, opacity: 0.9 })));
    lampGlow.scale.setScalar(0.35);
    lampGlow.position.set(0, -0.78, 0);
    arms[1].add(lampGlow);
    // faisceau visible de loin
    const len = CFG.light.range;
    const cone = new THREE.ConeGeometry(Math.tan(CFG.light.cone) * len, len, 20, 1, true);
    cone.rotateZ(Math.PI / 2);
    cone.translate(len / 2, 0, 0);
    const beam = new THREE.Mesh(cone, this.own(new THREE.MeshBasicMaterial({
      map: this.S.beam, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    })));
    beam.position.set(0.55, 1.2, 0.24);
    beam.rotation.z = -0.12;
    root.add(beam);
    const blood = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), this.own(new THREE.MeshLambertMaterial({
      map: this.S.blood, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
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
    return { root, body, legs, arms, beam, lampGlow, blood, ghost };
  }

  makeMonsterRig() {
    const S = this.S;
    const root = new THREE.Group(), body = new THREE.Group();
    root.add(body);
    const mats = [];
    const own = m => { mats.push(m); return this.own(m); };
    const dark = own(new THREE.MeshLambertMaterial({ color: 0x0b080d, transparent: true }));
    const add = (parent, o) => { o.castShadow = true; parent.add(o); return o; };
    const prof = [[0, 0], [0.4, 0.02], [0.42, 0.3], [0.34, 0.9], [0.27, 1.35], [0.23, 1.62], [0.3, 1.78], [0.16, 1.92], [0, 1.96]].map(([r, y]) => new THREE.Vector2(r, y));
    const robe = add(body, new THREE.Mesh(new THREE.LatheGeometry(prof, 16), dark));
    robe.rotation.z = -0.16;
    const head = new THREE.Group();
    head.position.set(0.32, 1.98, 0);
    body.add(head);
    add(head, new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), dark));
    const maskMat = own(new THREE.MeshLambertMaterial({ map: S.mask, emissiveMap: S.mask, emissive: new THREE.Color(0x2a2622), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }));
    head.add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 14, Math.PI - 0.95, 1.9, Math.PI / 2 - 1.0, 2.0), maskMat));
    const eyeMat = own(S.sprite(S.glow, { color: 0xffd9a0 }));
    const eyes = [-1, 1].map(s => {
      const e = new THREE.Sprite(eyeMat);
      e.position.set(0.15, 0.03, s * 0.05); // entre le crâne et le masque : la lueur passe par les trous des yeux
      e.scale.setScalar(0.15);
      head.add(e);
      return e;
    });
    const limb = (r, len) => {
      const g = new THREE.CylinderGeometry(r, r * 0.7, len, 6);
      g.translate(0, -len / 2, 0);
      return new THREE.Mesh(g, dark);
    };
    const arms = [-1, 1].map(s => {
      const shoulder = new THREE.Group();
      shoulder.position.set(0.14, 1.74, s * 0.27);
      body.add(shoulder);
      add(shoulder, limb(0.04, 0.66));
      const elbow = new THREE.Group();
      elbow.position.y = -0.66;
      shoulder.add(elbow);
      add(elbow, limb(0.032, 0.7));
      const hand = new THREE.Group();
      hand.position.y = -0.7;
      elbow.add(hand);
      for (const a of [-0.35, 0, 0.35]) {
        const g = new THREE.ConeGeometry(0.014, 0.24, 5);
        g.rotateX(Math.PI);
        g.translate(0, -0.12, 0);
        const claw = add(hand, new THREE.Mesh(g, dark));
        claw.rotation.x = a;
      }
      return { shoulder, elbow, s };
    });
    const tendrils = [];
    for (let i = 0; i < 7; i++) {
      let parent = new THREE.Group();
      parent.position.set(-0.12, 1.35 + (i % 4) * 0.16, (i - 3) * 0.08);
      parent.rotation.set((i - 3) * 0.35, 0, 0.9 + (i % 3) * 0.3);
      body.add(parent);
      const segs = [];
      for (let j = 0; j < 3; j++) {
        const g = new THREE.CylinderGeometry(0.022 - j * 0.006, 0.03 - j * 0.008, 0.36, 6);
        g.translate(0, 0.18, 0);
        const seg = add(parent, new THREE.Mesh(g, dark));
        const joint = new THREE.Group();
        joint.position.y = 0.36;
        seg.add(joint);
        segs.push(seg);
        parent = joint;
      }
      tendrils.push(segs);
    }
    const smoke = [];
    for (let i = 0; i < 5; i++) {
      const m = own(new THREE.SpriteMaterial({ map: S.smoke, transparent: true, depthWrite: false, opacity: 0.6 }));
      const sp = new THREE.Sprite(m);
      sp.position.set((Math.random() - 0.5) * 0.4, 0.4 + i * 0.35, (Math.random() - 0.5) * 0.4);
      sp.userData.ph = Math.random() * 10;
      root.add(sp);
      smoke.push(sp);
    }
    return { root, body, head, eyes, eyeMat, arms, tendrils, smoke, dark, mats, xray: false };
  }

  makeSkull() {
    const g = new THREE.Group();
    const s = new THREE.Sprite(this.own(new THREE.SpriteMaterial({ map: this.S.skull, color: 0xd8d8d8 })));
    s.scale.setScalar(0.34);
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
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.18, 12), this.own(new THREE.MeshLambertMaterial({ color: '#d8b030', emissive: '#2a2008' })));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.041, 0.06, 12), this.S.m.iron);
    cap.position.y = 0.07;
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 8), this.S.m.marble);
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
    const key = new THREE.DirectionalLight(0xffe0b0, 0.6);
    key.position.set(0.4, 1, 0.6);
    scene.add(amb, key);
    const holder = new THREE.Group();
    holder.position.set(0.19, -0.2, -0.45);
    holder.scale.setScalar(0.8);
    holder.rotation.y = 0.07;
    root.add(holder);
    const metal = new THREE.MeshLambertMaterial({ color: 0x2c2c30 });
    const headMat = new THREE.MeshLambertMaterial({ color: 0x3a3a40, emissive: 0x000000 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.025, 0.2, 16), metal);
    body.rotation.x = -Math.PI / 2;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.025, 0.07, 16), headMat);
    head.rotation.x = -Math.PI / 2;
    head.position.z = -0.13;
    const sleeveMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.3, 12), sleeveMat);
    sleeve.rotation.set(-Math.PI / 2 + 0.5, 0, -0.5);
    sleeve.position.set(0.06, -0.07, 0.15);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.038, 12, 8), new THREE.MeshLambertMaterial({ color: 0xd9b894 }));
    hand.scale.set(1, 0.9, 1.4);
    hand.position.set(0.004, -0.012, 0.03);
    const anchor = new THREE.Object3D();
    anchor.position.z = -0.18;
    holder.add(body, head, sleeve, hand, anchor);
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

  // Moins de pixels à calculer quand les images tombent sous ~40 par seconde pendant quelques secondes.
  adapt() {
    const now = performance.now(), ms = now - this.lastFrame;
    this.lastFrame = now;
    if (ms > 200) return; // onglet en arrière-plan, chargement…
    this.slow = Math.max(0, this.slow + (ms > 25 ? ms / 1000 : -ms / 2000));
    if (this.slow > 3 && this.quality > 0.55) {
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
    this.ambient.intensity = (ghost ? 2.6 : 0.3) + flash * 2.6;
    this.vm.amb.intensity = 0.35 + flash * 2;
    for (const m of this.S.windows) m.color.setScalar(0.42 + flash * 1.6);

    const gl = this.gl;
    gl.clear();
    gl.render(this.scene, this.camera);
    if (this.vm.root.visible) {
      gl.clearDepth();
      gl.render(this.vm.scene, this.camera);
    }
    this.hud.draw(G, this);
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
    this.cv.classList.toggle('ghost', on);
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
    vm.headMat.emissive.setRGB(power * 0.12, power * 0.1, power * 0.06);
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
      let r = this.rigs.get(p.id);
      if (!r) {
        r = this.makePlayerRig(p);
        this.rigs.set(p.id, r);
        this.world.add(r.root);
      }
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
      r.body.rotation.z = down ? Math.PI / 2 : 0;
      r.body.position.set(down ? 0.9 : 0, down ? 0.17 : 0, 0);
      const ph = p.moving ? t * (p.running ? 11 : 7) : 0, amp = p.moving ? (p.running ? 0.7 : 0.45) : 0;
      r.legs[0].rotation.z = Math.sin(ph) * amp;
      r.legs[1].rotation.z = -Math.sin(ph) * amp;
      r.arms[0].rotation.z = down ? 0.3 : -Math.sin(ph) * amp * 0.8;
      r.arms[1].rotation.z = down ? 2.6 : 1.25 + Math.sin(ph * 2) * 0.03;
      const on = body && p.state === 'alive' && p.light;
      r.beam.visible = r.lampGlow.visible = on;
      if (on) {
        const k = this.beamPower(G, p);
        r.beam.scale.x = batteryFactor(p.battery);
        r.beam.material.opacity = 0.05 * k;
        r.lampGlow.material.opacity = 0.9 * k;
        lit.push({ p, k, d: Math.hypot(p.x - eye.x, p.y - eye.y) });
      }
    }
    lit.sort((a, b) => a.d - b.d);
    this.beams.forEach((s, i) => {
      const b = lit[i];
      if (!b) { s.intensity = 0; return; }
      const { p, k } = b, ca = Math.cos(p.a), sa = Math.sin(p.a);
      s.position.set(p.x + ca * 0.55 - sa * 0.24, 1.2, p.y + sa * 0.55 + ca * 0.24);
      s.target.position.set(p.x + ca * 6, 0.5, p.y + sa * 6);
      s.target.updateMatrixWorld();
      s.distance = CFG.light.range * batteryFactor(p.battery) * 1.4;
      s.intensity = LAMP * 0.8 * k;
    });
  }

  updateMonsters(G, ghost, eye) {
    const t = G.time;
    while (this.mrigs.length < G.monsters.length) {
      const r = this.makeMonsterRig();
      this.mrigs.push(r);
      this.world.add(r.root);
    }
    this.mrigs.forEach((r, i) => {
      const m = G.monsters[i];
      r.root.visible = !!m;
      if (!m) return;
      if (r.xray !== ghost) {
        // les fantômes voient la créature à travers les murs
        r.xray = ghost;
        for (const mt of r.mats) Object.assign(mt, { depthTest: !ghost, fog: !ghost, needsUpdate: true });
        r.dark.emissive.set(ghost ? 0x6a0c1c : 0x000000);
        r.root.traverse(o => { o.renderOrder = ghost ? 5 : 0; });
      }
      const asleep = m.state === 0, chase = m.state === 4, flee = m.state === 5;
      const shake = flee || m.lit ? 0.04 : 0;
      r.root.position.set(m.x + (Math.random() - 0.5) * shake, 0, m.y + (Math.random() - 0.5) * shake);
      r.root.rotation.y = -m.a;
      r.body.scale.set(1, asleep ? 0.62 : 1 + Math.sin(t * 2.3) * 0.015, 1);
      r.body.rotation.z = asleep ? -0.35 : chase ? -0.22 : -0.05;
      r.dark.opacity = flee ? 0.7 : 1;
      const speed = asleep ? 0.6 : chase ? 7 : 2.5;
      for (const a of r.arms) {
        const reach = chase ? 1.4 + Math.sin(t * 8 + a.s) * 0.12 : 0.25 + Math.sin(t * 1.3 + a.s) * 0.12;
        a.shoulder.rotation.z = asleep ? 0.6 : reach;
        a.shoulder.rotation.x = a.s * (chase ? -0.15 : 0.08);
        a.elbow.rotation.z = chase ? 0.15 + Math.sin(t * 9 + a.s) * 0.1 : 0.35;
      }
      r.tendrils.forEach((segs, k) => {
        segs.forEach((seg, j) => {
          seg.rotation.x = Math.sin(t * speed * 0.5 + k * 1.7 + j) * 0.45;
          seg.rotation.z = Math.sin(t * speed * 0.4 + k + j * 1.3) * 0.5;
        });
      });
      for (const sp of r.smoke) {
        const ph = sp.userData.ph;
        sp.material.rotation = t * 0.3 + ph;
        sp.scale.setScalar(1.5 + Math.sin(t * 0.9 + ph) * 0.3);
        sp.material.opacity = asleep ? 0.3 : 0.55;
      }
      const d = Math.hypot(m.x - eye.x, m.y - eye.y);
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
      let o = this.items.get(it.id);
      if (!o) {
        o = it.type === 'skull' ? this.makeSkull() : this.makeBattery();
        o.position.set(it.x, 0, it.y);
        this.world.add(o);
        this.items.set(it.id, o);
      }
      o.visible = !it.taken;
      if (!o.visible) continue;
      if (it.type === 'skull') {
        const y = 0.42 + Math.sin(t * 2 + it.id) * 0.05;
        for (const p of o.userData.parts) p.position.y = y;
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
