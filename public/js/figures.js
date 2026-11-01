// Personnages et créature, modelés d'un seul tenant et déformés par un squelette : chaque sommet suit
// un ou plusieurs os selon des poids, si bien que les genoux, les coudes et les doigts plient sans
// cassure. Les formes sont des tubes à section variable (tronc, membres, doigts, vrilles) et une
// sphère sculptée (tête), en mètres, tournées vers +x, la droite du personnage vers +z. render.js
// leur donne leurs matériaux et les anime.
import * as THREE from '/vendor/three.module.min.js';

const TAU = Math.PI * 2;
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// teinte CSS → couleur de sommet (linéaire)
const rgb = hex => new THREE.Color(hex).toArray();

// ---------------------------------------------------------------------------
// Géométrie
// ---------------------------------------------------------------------------

// Poids des os d'un sommet : liste de [os, poids], ou fonction de l'angle autour du tube.
const weightsAt = (w, a) => (typeof w === 'function' ? w(a) : w);
function mixW(a, b, k) {
  const m = new Map();
  for (const [i, w] of a) m.set(i, (m.get(i) || 0) + w * (1 - k));
  for (const [i, w] of b) m.set(i, (m.get(i) || 0) + w * k);
  return [...m];
}

// Anneau d'un tube : centre, rayons vers l'avant (f), l'arrière (b), la droite (r) et la gauche (l)
// de son repère, poids des os.
const ring = (c, f, b = f, r = f, l = r, w = null) => ({ c: Array.isArray(c) ? v3(...c) : c.clone(), f, b, r, l, w });

// Les normales des sommets confondus (couture d'un tube, pointe d'un dôme, pôles d'une sphère) sont mises en commun.
function weld(g) {
  const p = g.attributes.position, n = g.attributes.normal, acc = new Map(), keys = [];
  for (let i = 0; i < p.count; i++) {
    const k = `${Math.round(p.getX(i) * 1e5)},${Math.round(p.getY(i) * 1e5)},${Math.round(p.getZ(i) * 1e5)}`;
    keys.push(k);
    const s = acc.get(k) || [0, 0, 0];
    s[0] += n.getX(i);
    s[1] += n.getY(i);
    s[2] += n.getZ(i);
    acc.set(k, s);
  }
  for (let i = 0; i < p.count; i++) {
    const s = acc.get(keys[i]), l = Math.hypot(s[0], s[1], s[2]) || 1;
    n.setXYZ(i, s[0] / l, s[1] / l, s[2] / l);
  }
}

// Tube passant par des anneaux. Le repère des anneaux part de `front` (leur « avant ») et suit le tube.
//  sub          : anneaux intermédiaires ajoutés entre deux anneaux (plis, articulations plus souples)
//  dome0, dome1 : bout arrondi au début ou à la fin (longueur en mètres)
//  from, to     : tube ouvert, d'un angle à l'autre (sinon fermé)
//  relief(a, k, R)  : ajouté au rayon (a : angle autour, k : de 0 à 1 le long du tube, R : l'anneau)
//  shift(a, k, R)   : décalage le long du tube (ourlet déchiqueté)
//  color(a, k, R)   : couleur des sommets
// UV en mètres (tour, longueur).
function tube(src, o = {}) {
  let rings = src;
  if (o.sub) {
    rings = [];
    src.forEach((A, i) => {
      rings.push(A);
      const B = src[i + 1];
      if (!B) return;
      for (let s = 1; s <= o.sub; s++) {
        const k = s / (o.sub + 1), wa = A.w, wb = B.w;
        const w = typeof wa === 'function' || typeof wb === 'function' ? a => mixW(weightsAt(wa, a), weightsAt(wb, a), k) : mixW(wa, wb, k);
        rings.push({ c: A.c.clone().lerp(B.c, k), f: lerp(A.f, B.f, k), b: lerp(A.b, B.b, k), r: lerp(A.r, B.r, k), l: lerp(A.l, B.l, k), w });
      }
    });
  }
  const dome = (end, h) => {
    const E = end ? rings[rings.length - 1] : rings[0], P = end ? rings[rings.length - 2] : rings[1];
    const t = E.c.clone().sub(P.c).normalize();
    const add = [0.4, 0.7, 0.9, 1].map(k => {
      const s = Math.sin((k * Math.PI) / 2), c = Math.cos((k * Math.PI) / 2);
      return { ...E, c: E.c.clone().addScaledVector(t, h * s), f: E.f * c, b: E.b * c, r: E.r * c, l: E.l * c, s: c };
    });
    rings = end ? [...rings, ...add] : [...add.reverse(), ...rings];
  };
  if (o.dome0) dome(false, o.dome0);
  if (o.dome1) dome(true, o.dome1);

  const n = rings.length, seg = o.seg || 16, open = o.from !== undefined;
  const a0 = open ? o.from : -Math.PI, a1 = open ? o.to : Math.PI;
  // repères : tangente (gardée dans le même sens quand le tube revient sur lui-même), avant, côté
  const T = [], N = [], S = [];
  const nrm = (o.front || v3(1, 0, 0)).clone();
  for (let i = 0; i < n; i++) {
    const t = new THREE.Vector3().subVectors(rings[Math.min(i + 1, n - 1)].c, rings[Math.max(i - 1, 0)].c);
    if (t.lengthSq() < 1e-14) t.copy(T[i - 1]);
    t.normalize();
    if (i && t.dot(T[i - 1]) < 0) t.negate();
    T.push(t);
    nrm.addScaledVector(t, -nrm.dot(t)).normalize();
    N.push(nrm.clone());
    S.push(new THREE.Vector3().crossVectors(t, nrm));
  }
  const pos = [], uv = [], col = [], W = [];
  let len = 0;
  for (let i = 0; i < n; i++) {
    const R = rings[i], k = i / (n - 1);
    if (i) len += R.c.distanceTo(rings[i - 1].c);
    const per = (Math.PI * (R.f + R.b + R.r + R.l)) / 2;
    for (let j = 0; j <= seg; j++) {
      const a = a0 + ((a1 - a0) * j) / seg, cs = Math.cos(a), sn = Math.sin(a);
      let x = cs * (cs >= 0 ? R.f : R.b), z = sn * (sn >= 0 ? R.r : R.l);
      if (o.relief) {
        // le relief s'efface vers la pointe des dômes
        const d = o.relief(a, k, R) * (R.s ?? 1), l = Math.hypot(x, z);
        x += (l > 1e-7 ? x / l : cs) * d;
        z += (l > 1e-7 ? z / l : sn) * d;
      }
      const sh = o.shift ? o.shift(a, k, R) : 0;
      pos.push(
        R.c.x + N[i].x * x + S[i].x * z + T[i].x * sh,
        R.c.y + N[i].y * x + S[i].y * z + T[i].y * sh,
        R.c.z + N[i].z * x + S[i].z * z + T[i].z * sh,
      );
      uv.push(((a - a0) / TAU) * per, len + sh);
      col.push(...(o.color ? o.color(a, k, R) : [1, 1, 1]));
      W.push(weightsAt(R.w, a));
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j, b = a + 1, c = a + seg + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  weld(g);
  g.userData.w = W;
  return g;
}

// Sphère dont chaque sommet est déplacé : fn(d, out) reçoit la direction unitaire d et écrit la
// position ; color(d) donne la couleur du sommet. keep(d) : faces gardées (au moins un sommet).
function sculpt(ws, hs, fn, color = null, keep = null) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const p = g.attributes.position, d = new THREE.Vector3(), out = new THREE.Vector3(), col = [];
  const kept = [];
  for (let i = 0; i < p.count; i++) {
    d.fromBufferAttribute(p, i).normalize();
    fn(d, out);
    col.push(...(color ? color(d) : [1, 1, 1]));
    kept.push(keep ? keep(d) : true);
    p.setXYZ(i, out.x, out.y, out.z);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  if (keep) {
    const src = g.index.array, idx = [];
    for (let i = 0; i < src.length; i += 3) if (kept[src[i]] || kept[src[i + 1]] || kept[src[i + 2]]) idx.push(src[i], src[i + 1], src[i + 2]);
    g.setIndex(idx);
  }
  g.computeVertexNormals();
  weld(g);
  return g;
}

// Symétrique gauche d'une pièce faite pour le côté droit (z → -z), os de droite remplacés par ceux de gauche.
function mirror(g, toLeft) {
  const m = g.clone(), p = m.attributes.position, n = m.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    p.setZ(i, -p.getZ(i));
    n.setZ(i, -n.getZ(i));
  }
  const idx = m.index.array;
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  // clone() partage userData : la copie reçoit le sien
  m.userData = { w: g.userData.w && g.userData.w.map(w => w && w.map(([b, x]) => [toLeft[b] ?? b, x])) };
  return m;
}

const leftOf = (w, toLeft) => w.map(([b, x]) => [toLeft[b] ?? b, x]);

// Pièces d'un même matériau réunies : un appel de dessin par matériau.
class Skin {
  constructor() {
    this.parts = new Map();
  }

  // rigid : poids communs à tous les sommets (sinon ceux posés par tube) ; tint : couleur multipliée.
  add(m, g, rigid = null, tint = null) {
    let p = this.parts.get(m);
    if (!p) this.parts.set(m, (p = { pos: [], nor: [], uv: [], col: [], si: [], sw: [], idx: [] }));
    const base = p.pos.length / 3, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, C = g.attributes.color;
    for (let i = 0; i < P.count; i++) {
      p.pos.push(P.getX(i), P.getY(i), P.getZ(i));
      p.nor.push(N.getX(i), N.getY(i), N.getZ(i));
      p.uv.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0);
      const c = C ? [C.getX(i), C.getY(i), C.getZ(i)] : [1, 1, 1];
      p.col.push(c[0] * (tint ? tint[0] : 1), c[1] * (tint ? tint[1] : 1), c[2] * (tint ? tint[2] : 1));
      const w = (rigid || g.userData.w[i]).filter(x => x[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = w.reduce((s, x) => s + x[1], 0) || 1;
      for (let k = 0; k < 4; k++) {
        p.si.push(w[k] ? w[k][0] : 0);
        p.sw.push(w[k] ? w[k][1] / sum : 0);
      }
    }
    for (const k of g.index.array) p.idx.push(base + k);
    g.dispose();
  }

  build(parent, skeleton) {
    return [...this.parts].map(([m, p]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(p.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
      g.setAttribute('uv1', new THREE.Float32BufferAttribute(p.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(p.col, 3));
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(p.si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(p.sw, 4));
      g.setIndex(p.idx);
      const mesh = new THREE.SkinnedMesh(g, m);
      mesh.castShadow = !m.userData.noShadow;
      mesh.receiveShadow = true;
      parent.add(mesh);
      mesh.bind(skeleton, new THREE.Matrix4());
      return mesh;
    });
  }
}

// Os placés à leurs articulations (positions absolues, sans rotation au repos).
function makeBones(names, parents, joints, holder) {
  const list = names.map(n => Object.assign(new THREE.Bone(), { name: n }));
  names.forEach((n, i) => {
    const p = parents[n], at = joints[n];
    if (!p) {
      holder.add(list[i]);
      list[i].position.set(...at);
      return;
    }
    const pa = joints[p];
    list[names.indexOf(p)].add(list[i]);
    list[i].position.set(at[0] - pa[0], at[1] - pa[1], at[2] - pa[2]);
  });
  holder.updateMatrixWorld(true);
  return list;
}

// Doigt passant par des points : rayon r à la base, effilé, renflé aux articulations, bout arrondi.
function finger(pts, r, w, joints = [0.42, 0.72], o = {}) {
  const curve = new THREE.CatmullRomCurve3(pts.map(p => (Array.isArray(p) ? v3(...p) : p)));
  const n = o.n || 12, rings = [];
  for (let i = 0; i <= n; i++) {
    const k = i / n, c = curve.getPointAt(k);
    let s = r * (1 - (o.taper ?? 0.25) * k);
    for (const j of joints) s *= 1 + (o.knob ?? 0.07) * Math.exp(-(((k - j) / 0.055) ** 2));
    rings.push(ring(c, s, s, s * (o.flat ?? 0.88), s * (o.flat ?? 0.88), typeof w === 'function' ? w(k) : w));
  }
  return tube(rings, { seg: o.seg || 10, dome1: r * (o.tip ?? 0.75), front: o.front });
}

// ---------------------------------------------------------------------------
// Joueurs
// ---------------------------------------------------------------------------

const PB = ['hips', 'spine', 'chest', 'neck', 'head', 'shL', 'elL', 'wrL', 'shR', 'elR', 'wrR', 'thL', 'knL', 'anL', 'thR', 'knR', 'anR'];
const B = Object.fromEntries(PB.map((n, i) => [n, i]));
const PARENT = {
  spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', shL: 'chest', elL: 'shL', wrL: 'elL', shR: 'chest', elR: 'shR', wrR: 'elR',
  thL: 'hips', knL: 'thL', anL: 'knL', thR: 'hips', knR: 'thR', anR: 'knR',
};
const SIDED = ['sh', 'el', 'wr', 'th', 'kn', 'an'];
const JOINT = {
  hips: [0, 0.96, 0], spine: [0, 1.1, 0], chest: [0, 1.28, 0], neck: [0, 1.47, 0], head: [0.005, 1.585, 0],
  shR: [0, 1.435, 0.185], elR: [-0.012, 1.135, 0.211], wrR: [0.005, 0.875, 0.221],
  thR: [0, 0.925, 0.095], knR: [0.015, 0.5, 0.1], anR: [0, 0.085, 0.105],
};
for (const k of SIDED) {
  const [x, y, z] = JOINT[k + 'R'];
  JOINT[k + 'L'] = [x, y, -z];
}
const TO_LEFT = Object.fromEntries(SIDED.map(k => [B[k + 'R'], B[k + 'L']]));
const one = n => [[B[n], 1]];
const two = (a, b, k) => [[B[a], 1 - k], [B[b], k]];

// Centre de la tête, et lampe tenue en main droite (repère du poignet) : axe du fût en travers de la
// paume, de la tranche de la main vers l'index, d'où sort la tête de la lampe.
const HEAD = v3(0.012, 1.672, 0);
const GRIP = { c: v3(0, -0.098, -0.033), d: v3(0.94, -0.34, 0).normalize(), r: 0.019 };
// Pose de la main droite qui tient la lampe à hauteur de hanche, pointée devant soi : épaule, coude, poignet.
export const AIM = [0.42, 0.62, -0.75];

// Visage sculpté dans une sphère (d : direction depuis le centre de la tête).
function face(d) {
  const u = Math.atan2(d.z, d.x), au = Math.abs(u), w = Math.asin(Math.max(-1, Math.min(1, d.y)));
  const G = (u0, w0, su, sw) => Math.exp(-(((au - u0) / su) ** 2) - (((w - w0) / sw) ** 2));
  return { u, au, w, G, front: smooth(0.15, 0.6, d.x) };
}

function headPoint(d, out, socket = 1) {
  const { au, w, G, front } = face(d);
  let x = d.x * (d.x > 0 ? 0.097 : 0.106), y = d.y * (d.y > 0 ? 0.118 : 0.115), z = d.z * 0.075;
  // le bas du visage se resserre en mâchoire ; la nuque rentre vers le cou
  const jaw = smooth(-0.12, -0.85, w);
  z *= 1 - 0.36 * jaw;
  x *= 1 - jaw * (d.x < 0 ? 0.3 : 0.05);
  let r = front * (
    0.008 * G(0.36, 0.3, 0.3, 0.07) // arcades sourcilières
    - socket * 0.008 * G(0.37, 0.1, 0.22, 0.14) // orbites
    + 0.009 * G(0, 0.12, 0.07, 0.08) // racine du nez
    + 0.023 * G(0, -0.06, 0.07, 0.1) // arête
    + 0.009 * G(0, -0.15, 0.09, 0.05) // bout du nez
    + 0.007 * G(0.13, -0.17, 0.05, 0.045) // ailes du nez
    + 0.008 * G(0.68, -0.05, 0.25, 0.14) // pommettes
    - 0.002 * G(0.55, -0.33, 0.18, 0.14) // joues
    + 0.005 * G(0, -0.32, 0.4, 0.25) // le bas du visage avance
    + 0.005 * G(0, -0.355, 0.2, 0.035) // lèvre supérieure
    + 0.006 * G(0, -0.445, 0.18, 0.04) // lèvre inférieure
    - 0.005 * G(0, -0.4, 0.22, 0.025) // bouche
    - 0.004 * G(0, -0.56, 0.2, 0.05) // creux sous la lèvre
    + 0.012 * G(0, -0.68, 0.2, 0.12) // menton
  );
  r -= 0.004 * G(1.25, 0.3, 0.25, 0.2); // tempes
  r += 0.006 * Math.exp(-(((Math.PI - au) / 0.7) ** 2) - (((w - 0.15) / 0.35) ** 2)); // occiput
  return out.set(x, y, z).addScaledVector(d, r);
}

function faceColor(d, brow) {
  const { G, front } = face(d);
  const c = [1, 1, 1];
  const mul = (k, t) => { for (let i = 0; i < 3; i++) c[i] *= lerp(1, t[i], Math.min(1, k)); };
  mul(front * G(0.6, -0.12, 0.28, 0.16), [1, 0.88, 0.84]); // joues
  mul(front * G(0, -0.15, 0.1, 0.07), [1, 0.9, 0.86]); // nez
  mul(front * G(0, -0.4, 0.17, 0.05), [0.72, 0.46, 0.44]); // lèvres
  mul(front * G(0.37, 0.09, 0.15, 0.08), [0.72, 0.66, 0.66]); // orbites
  mul(front * G(0.07, -0.19, 0.03, 0.02) * 0.35, [0.4, 0.32, 0.3]); // narines
  mul(front * G(0, -0.4, 0.2, 0.014) * 0.7, [0.45, 0.3, 0.3]); // fente de la bouche
  mul(front * G(0.36, 0.25, 0.2, 0.035) * 0.9, brow); // sourcils
  return c;
}

// Ligne d'implantation des cheveux (hauteur selon l'angle autour de la tête) pour trois coiffures.
const HAIRLINES = [
  [[0, 0.46], [0.5, 0.4], [0.95, 0.3], [1.25, 0], [1.4, -0.12], [1.55, 0.1], [1.85, 0.05], [2.3, -0.38], [Math.PI, -0.48]],
  [[0, 0.34], [0.45, 0.31], [0.95, 0.2], [1.25, -0.12], [1.55, -0.28], [1.9, -0.32], [2.4, -0.55], [Math.PI, -0.62]],
  [[0, 0.4], [0.3, 0.36], [0.95, 0.22], [1.25, -0.1], [1.55, -0.32], [1.9, -0.4], [2.4, -0.62], [Math.PI, -0.7]],
];
function hairline(style, au) {
  const L = HAIRLINES[style];
  for (let i = 1; i < L.length; i++) if (au <= L[i][0]) return lerp(L[i - 1][1], L[i][1], (au - L[i - 1][0]) / (L[i][0] - L[i - 1][0]));
  return L[L.length - 1][1];
}

// Corps d'un joueur. M : matériaux (coat, trousers, leather, skin, hair, eyes, scarf, alu, lens), communs à
// tous les joueurs ; look : leurs couleurs propres, posées sur les sommets (coat, scarf, skin, hair, brow,
// iris : couleurs linéaires) et la coiffure (style, de 0 à 2).
export function playerBody(M, look) {
  const S = new Skin();
  const own = new Map([[M.coat, look.coat], [M.scarf, look.scarf], [M.skin, look.skin], [M.hair, look.hair]]);
  const add = (m, g, rigid, tint) => {
    const c = own.get(m);
    S.add(m, g, rigid, c ? c.map((v, i) => v * (tint ? tint[i] : 1)) : tint);
  };
  const both = (m, g, rigid = null, tint = null) => {
    add(m, mirror(g, TO_LEFT), rigid && leftOf(rigid, TO_LEFT), tint);
    add(m, g, rigid, tint);
  };

  // --- Manteau : haut fermé jusqu'à la ceinture, puis deux pans croisés qui suivent chacun sa jambe ---
  const EDGE = -0.3; // bord du pan droit, croisé par-dessus le gauche
  const lapel = a => 0.004 * smooth(EDGE - 0.07, EDGE + 0.07, a) * smooth(EDGE + 1.7, EDGE + 1.1, a);
  const seamShade = a => {
    const e = Math.exp(-(((a - EDGE) / 0.09) ** 2));
    return [1 - 0.45 * e, 1 - 0.45 * e, 1 - 0.45 * e];
  };
  add(M.coat, tube([
    ring([0, 1.54, 0], 0.062, 0.068, 0.066, 0.066, two('chest', 'neck', 0.5)),
    ring([0, 1.5, 0], 0.07, 0.075, 0.082, 0.082, two('chest', 'neck', 0.25)),
    ring([0, 1.478, 0], 0.085, 0.09, 0.122, 0.122, one('chest')),
    ring([-0.004, 1.458, 0], 0.102, 0.102, 0.158, 0.158, one('chest')),
    ring([-0.005, 1.432, 0], 0.118, 0.112, 0.182, 0.182, one('chest')),
    ring([-0.002, 1.4, 0], 0.128, 0.116, 0.186, 0.186, one('chest')),
    ring([0, 1.36, 0], 0.134, 0.118, 0.176, 0.176, one('chest')),
    ring([0.005, 1.3, 0], 0.138, 0.118, 0.168, 0.168, two('chest', 'spine', 0.2)),
    ring([0.005, 1.2, 0], 0.128, 0.113, 0.156, 0.156, two('chest', 'spine', 0.65)),
    ring([0, 1.1, 0], 0.118, 0.108, 0.148, 0.148, one('spine')),
    ring([0, 1.03, 0], 0.117, 0.107, 0.148, 0.148, two('spine', 'hips', 0.6)),
  ], { seg: 40, sub: 1, relief: lapel, color: seamShade }));

  const SKIRT = [EDGE - 0.45, EDGE + TAU];
  const skirt = k => a => {
    // 0 : jambe gauche, 1 : jambe droite. Le pan dessous suit la gauche, le pan dessus la droite.
    let r = smooth(-0.7, 0.7, Math.sin(a));
    r *= smooth(SKIRT[0], EDGE + 0.7, a);
    r = Math.max(r, smooth(SKIRT[1] - 1.3, SKIRT[1] - 0.35, a));
    return [[B.hips, 1 - k], [B.thR, k * r], [B.thL, k * (1 - r)]];
  };
  add(M.coat, tube([
    ring([0, 1.08, 0], 0.118, 0.108, 0.15, 0.15, one('hips')),
    ring([0, 0.97, 0], 0.124, 0.119, 0.16, 0.16, skirt(0.03)),
    ring([0, 0.9, 0], 0.129, 0.129, 0.168, 0.168, skirt(0.15)),
    ring([0, 0.8, 0], 0.137, 0.139, 0.176, 0.176, skirt(0.4)),
    ring([0.005, 0.7, 0], 0.144, 0.149, 0.184, 0.184, skirt(0.55)),
    ring([0.01, 0.6, 0], 0.151, 0.159, 0.192, 0.192, skirt(0.68)),
    ring([0.01, 0.604, 0], 0.144, 0.152, 0.185, 0.185, skirt(0.68)),
    ring([0.008, 0.64, 0], 0.14, 0.148, 0.181, 0.181, skirt(0.62)),
  ], {
    seg: 44, sub: 1, from: SKIRT[0], to: SKIRT[1],
    relief: (a, k, R) => 0.009 * smooth(1.0, 0.62, R.c.y) * Math.sin(a * 7 + 1.3 * Math.sin(a * 3)) + 0.006 * smooth(SKIRT[1] - 0.5, SKIRT[1] - 0.05, a) + 0.004,
    color: a => seamShade(a - TAU),
  }));
  // col relevé derrière la nuque
  add(M.coat, tube([
    ring([-0.004, 1.59, 0], 0.07, 0.082, 0.08, 0.08, two('neck', 'head', 0.3)),
    ring([-0.002, 1.54, 0], 0.066, 0.076, 0.074, 0.074, one('neck')),
    ring([0, 1.48, 0], 0.07, 0.08, 0.086, 0.086, two('chest', 'neck', 0.3)),
  ], { seg: 20, from: 1.0, to: TAU - 1.0 }));
  // poches à rabat
  for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(0.012, 0.05, 0.15);
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(-s * 0.8).setPosition(Math.cos(0.95) * 0.142, 0.86, s * Math.sin(0.95) * 0.18));
    add(M.coat, g, [[B.hips, 0.75], [s > 0 ? B.thR : B.thL, 0.25]], [0.8, 0.8, 0.8]);
  }
  // boutons de corne sur le pan croisé (avec le cuir : un matériau de moins à dessiner)
  for (const [a, y] of [[-0.15, 1.33], [0.55, 1.33], [-0.15, 1.2], [0.55, 1.2], [-0.15, 1.1], [0.55, 1.1]]) {
    const f = y > 1.25 ? 0.14 : y > 1.15 ? 0.13 : 0.121, s = y > 1.25 ? 0.17 : y > 1.15 ? 0.157 : 0.149;
    const g = new THREE.SphereGeometry(0.011, 8, 6);
    g.scale(0.45, 1, 1);
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(-a).setPosition(Math.cos(a) * f + 0.009, y, Math.sin(a) * s));
    add(M.leather, g, y > 1.25 ? one('chest') : one('spine'), rgb('#2a1d14'));
  }
  // ceinture de cuir et sa boucle
  add(M.leather, tube([
    ring([0, 1.078, 0], 0.124, 0.114, 0.155, 0.155, one('spine')),
    ring([0, 1.074, 0], 0.127, 0.117, 0.158, 0.158, two('spine', 'hips', 0.3)),
    ring([0, 1.036, 0], 0.127, 0.117, 0.158, 0.158, two('spine', 'hips', 0.7)),
    ring([0, 1.032, 0], 0.124, 0.114, 0.155, 0.155, one('hips')),
  ], { seg: 40 }), null, rgb('#2a1c14'));
  {
    const g = new THREE.BoxGeometry(0.008, 0.048, 0.052);
    g.translate(0.132, 1.055, 0.02);
    add(M.leather, g, two('spine', 'hips', 0.5), rgb('#7a7060'));
  }

  // --- Manches ---
  const sleeve = tube([
    ring([0, 1.442, 0.16], 0.04, 0.042, 0.034, 0.03, two('chest', 'shR', 0.3)),
    ring([0, 1.43, 0.176], 0.055, 0.057, 0.052, 0.046, two('chest', 'shR', 0.55)),
    ring([-0.002, 1.39, 0.188], 0.058, 0.057, 0.056, 0.05, two('chest', 'shR', 0.85)),
    ring([-0.005, 1.3, 0.198], 0.055, 0.055, 0.054, 0.049, one('shR')),
    ring([-0.009, 1.2, 0.205], 0.051, 0.051, 0.049, 0.046, two('shR', 'elR', 0.1)),
    ring([-0.011, 1.155, 0.209], 0.049, 0.049, 0.047, 0.045, two('shR', 'elR', 0.35)),
    ring([-0.012, 1.125, 0.211], 0.048, 0.049, 0.046, 0.044, two('shR', 'elR', 0.65)),
    ring([-0.008, 1.075, 0.213], 0.046, 0.047, 0.044, 0.042, two('shR', 'elR', 0.92)),
    ring([-0.002, 0.98, 0.217], 0.043, 0.044, 0.041, 0.039, one('elR')),
    ring([0.004, 0.91, 0.22], 0.044, 0.045, 0.043, 0.041, two('elR', 'wrR', 0.1)),
    ring([0.005, 0.893, 0.221], 0.044, 0.045, 0.043, 0.041, two('elR', 'wrR', 0.15)),
    ring([0.005, 0.897, 0.221], 0.036, 0.037, 0.035, 0.033, two('elR', 'wrR', 0.15)),
    ring([0.004, 0.94, 0.22], 0.033, 0.034, 0.032, 0.031, one('elR')),
  ], {
    seg: 20, sub: 1, dome0: 0.015,
    // plis au creux du coude
    relief: (a, k, R) => 0.0025 * Math.sin(a * 2 + R.c.y * 150) * Math.exp(-(((R.c.y - 1.12) / 0.05) ** 2)),
  });
  both(M.coat, sleeve);

  // --- Pantalon ---
  const leg = tube([
    ring([0, 1.0, 0.085], 0.08, 0.085, 0.066, 0.066, one('hips')),
    ring([0, 0.94, 0.09], 0.08, 0.085, 0.068, 0.066, two('hips', 'thR', 0.4)),
    ring([0, 0.88, 0.095], 0.077, 0.082, 0.07, 0.066, two('hips', 'thR', 0.8)),
    ring([0.003, 0.78, 0.097], 0.074, 0.078, 0.074, 0.066, one('thR')),
    ring([0.008, 0.66, 0.098], 0.066, 0.07, 0.067, 0.06, one('thR')),
    ring([0.012, 0.57, 0.099], 0.058, 0.062, 0.06, 0.055, two('thR', 'knR', 0.15)),
    ring([0.015, 0.52, 0.1], 0.055, 0.058, 0.057, 0.052, two('thR', 'knR', 0.45)),
    ring([0.015, 0.48, 0.1], 0.054, 0.058, 0.056, 0.051, two('thR', 'knR', 0.72)),
    ring([0.012, 0.42, 0.1], 0.052, 0.062, 0.055, 0.05, one('knR')),
    ring([0.008, 0.32, 0.101], 0.049, 0.064, 0.052, 0.048, one('knR')),
    ring([0.004, 0.22, 0.102], 0.046, 0.054, 0.048, 0.045, one('knR')),
    ring([0.002, 0.14, 0.103], 0.048, 0.051, 0.049, 0.047, two('knR', 'anR', 0.1)),
    ring([0.004, 0.095, 0.104], 0.054, 0.054, 0.052, 0.05, two('knR', 'anR', 0.3)),
    ring([0.004, 0.1, 0.104], 0.046, 0.046, 0.044, 0.043, two('knR', 'anR', 0.3)),
    ring([0.003, 0.13, 0.103], 0.043, 0.044, 0.042, 0.041, one('knR')),
  ], {
    seg: 18, sub: 1,
    // tissu tassé sur la chaussure
    relief: (a, k, R) => 0.003 * Math.sin(a * 3 + R.c.y * 90) * smooth(0.26, 0.12, R.c.y),
  });
  both(M.trousers, leg);

  // --- Bottines : tige, empeigne et semelle ---
  const boot = rgb('#17120e'), sole = rgb('#0a0908');
  both(M.leather, tube([
    ring([-0.004, 0.17, 0.105], 0.042, 0.045, 0.041, 0.039, two('knR', 'anR', 0.4)),
    ring([-0.006, 0.12, 0.105], 0.044, 0.048, 0.043, 0.041, one('anR')),
    ring([-0.008, 0.075, 0.105], 0.048, 0.052, 0.045, 0.043, one('anR')),
  ], { seg: 16 }), null, boot);
  both(M.leather, tube([
    ring([-0.082, 0.06, 0.105], 0.035, 0.05, 0.034, 0.032),
    ring([-0.07, 0.065, 0.105], 0.05, 0.058, 0.039, 0.037),
    ring([-0.035, 0.07, 0.105], 0.058, 0.062, 0.043, 0.041),
    ring([0.02, 0.064, 0.107], 0.048, 0.056, 0.046, 0.044),
    ring([0.075, 0.05, 0.108], 0.036, 0.042, 0.049, 0.046),
    ring([0.125, 0.04, 0.109], 0.03, 0.033, 0.05, 0.046),
    ring([0.17, 0.035, 0.109], 0.026, 0.028, 0.045, 0.041),
    ring([0.2, 0.032, 0.108], 0.021, 0.023, 0.034, 0.031),
  ], { seg: 16, front: v3(0, 1, 0), dome0: 0.012, dome1: 0.022, color: (a, k) => (Math.abs(k - 0.62) < 0.03 ? [0.6, 0.6, 0.6] : [1, 1, 1]) }), one('anR'), boot);
  both(M.leather, tube([
    ring([-0.085, 0.013, 0.105], 0.013, 0.013, 0.034, 0.032),
    ring([-0.05, 0.013, 0.105], 0.013, 0.013, 0.045, 0.043),
    ring([-0.02, 0.013, 0.106], 0.013, 0.013, 0.047, 0.045),
    ring([-0.005, 0.008, 0.107], 0.008, 0.008, 0.048, 0.045),
    ring([0.075, 0.008, 0.108], 0.008, 0.008, 0.053, 0.05),
    ring([0.125, 0.008, 0.109], 0.008, 0.008, 0.054, 0.05),
    ring([0.17, 0.008, 0.109], 0.008, 0.008, 0.049, 0.045),
  ], { seg: 16, front: v3(0, 1, 0), dome0: 0.006, dome1: 0.04 }), one('anR'), sole);

  // --- Mains gantées : la gauche détendue, la droite serrée autour de la lampe ---
  const glove = rgb('#1e1611'), W = v3(...JOINT.wrR);
  const atWrist = g => g.translate(W.x, W.y, W.z);
  const hand = [];
  hand.push(tube([
    ring([0, 0.055, 0], 0.036, 0.036, 0.034, 0.034, two('elR', 'wrR', 0.1)),
    ring([0, 0.012, 0], 0.033, 0.033, 0.03, 0.03, two('elR', 'wrR', 0.45)),
    ring([0, -0.004, 0], 0.029, 0.027, 0.021, 0.021, two('elR', 'wrR', 0.8)),
    ring([0.003, -0.022, 0], 0.036, 0.031, 0.017, 0.019, one('wrR')),
    ring([0.004, -0.046, 0], 0.042, 0.038, 0.015, 0.019, one('wrR')),
    ring([0.003, -0.072, 0], 0.043, 0.039, 0.014, 0.016, one('wrR')),
    ring([0.002, -0.088, 0], 0.041, 0.037, 0.013, 0.013, one('wrR')),
  ], { seg: 16, dome1: 0.008 }));
  const FINGERS = [ // jointure (x, y), longueur, rayon, écart, flexion
    [0.027, -0.092, 0.074, 0.0095, 0.03, 0.3],
    [0.009, -0.094, 0.082, 0.0098, 0.0, 0.36],
    [-0.009, -0.09, 0.077, 0.0093, -0.03, 0.42],
    [-0.026, -0.082, 0.06, 0.0083, -0.07, 0.48],
  ];
  const left = hand.map(g => g.clone()), right = hand;
  for (const [x, y, len, r, spread, curl] of FINGERS) {
    // main détendue : doigts légèrement repliés vers la paume (-z)
    const pts = [[x, y + 0.014, 0.001], [x, y, 0.001]];
    let p = v3(x, y, 0.001), a = 0;
    for (const [f, k] of [[0.45, 1], [0.3, 1.4], [0.25, 1.1]]) {
      a += curl * k;
      p = p.clone().add(v3(Math.sin(spread) * Math.cos(a), -Math.cos(spread) * Math.cos(a), -Math.sin(a)).multiplyScalar(len * f));
      pts.push(p.toArray());
    }
    left.push(finger(pts, r, one('wrR')));
    // main serrée : le doigt s'enroule autour du fût
    const { c, d, r: rb } = GRIP, K = v3(x, y - 0.002, 0.001);
    const Q = c.clone().addScaledVector(d, K.clone().sub(c).dot(d)), u = K.clone().sub(Q), d0 = u.length();
    u.normalize();
    const side = v3(0, -1, 0).addScaledVector(d, d.y).addScaledVector(u, -v3(0, -1, 0).addScaledVector(d, d.y).dot(u)).normalize();
    const R = rb + r * 0.95, wrap = [[x, y + 0.014, 0.001], K.toArray()];
    let s = 0, ang = 0, last = K;
    while (s < len * 0.95) {
      ang += 0.22;
      const rr = lerp(d0, R, smooth(0, 1.0, ang));
      const q = Q.clone().addScaledVector(u, Math.cos(ang) * rr).addScaledVector(side, Math.sin(ang) * rr);
      s += q.distanceTo(last);
      last = q;
      wrap.push(q.toArray());
    }
    right.push(finger(wrap, r, one('wrR'), [0.4, 0.7], { n: 16 }));
  }
  // pouces : le long de l'index, ou replié par-dessus le fût
  left.push(finger([[0.016, -0.008, -0.004], [0.032, -0.026, -0.012], [0.044, -0.048, -0.019], [0.05, -0.068, -0.024], [0.052, -0.084, -0.027]], 0.0118, one('wrR'), [0.35, 0.68]));
  right.push(finger([[0.02, -0.02, -0.006], [0.038, -0.045, -0.016], [0.046, -0.07, -0.036], [0.042, -0.092, -0.057], [0.032, -0.104, -0.063]], 0.0118, one('wrR'), [0.35, 0.68]));
  for (const g of left) add(M.leather, mirror(atWrist(g), TO_LEFT), null, glove);
  for (const g of right) add(M.leather, atWrist(g), null, glove);

  // lampe : fût tourné et bague en aluminium, verre
  const PROFILE = [[0, 0], [0.016, 0], [0.018, 0.003], [0.018, 0.02], [0.0165, 0.024], [0.0165, 0.112], [0.018, 0.116], [0.018, 0.124], [0.025, 0.158], [0.029, 0.168], [0.029, 0.19], [0.026, 0.19]];
  const orient = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), GRIP.d));
  const base = GRIP.c.clone().addScaledVector(GRIP.d, -0.064).add(W);
  const lampAt = (g, along) => g.applyMatrix4(orient).translate(base.x + GRIP.d.x * along, base.y + GRIP.d.y * along, base.z + GRIP.d.z * along);
  add(M.alu, lampAt(new THREE.LatheGeometry(PROFILE.map(([r, y]) => new THREE.Vector2(r * 1.1, y)), 24), 0), one('wrR'));
  add(M.alu, lampAt(new THREE.TorusGeometry(0.031, 0.003, 6, 24).rotateX(Math.PI / 2), 0.19), one('wrR'));
  add(M.lens, lampAt(new THREE.CircleGeometry(0.03, 24).rotateX(-Math.PI / 2), 0.188), one('wrR'));

  // --- Tête : cou, visage, oreilles, yeux et paupières, cheveux ---
  add(M.skin, tube([
    ring([0.012, 1.64, 0], 0.048, 0.05, 0.047, 0.047, one('head')),
    ring([0.01, 1.6, 0], 0.05, 0.053, 0.049, 0.049, two('neck', 'head', 0.7)),
    ring([0.005, 1.55, 0], 0.052, 0.055, 0.051, 0.051, one('neck')),
    ring([0, 1.49, 0], 0.055, 0.058, 0.054, 0.054, two('chest', 'neck', 0.6)),
    ring([0, 1.45, 0], 0.06, 0.062, 0.058, 0.058, one('chest')),
  ], { seg: 16 }));
  const toHead = g => g.translate(HEAD.x, HEAD.y, HEAD.z);
  add(M.skin, toHead(sculpt(72, 64, headPoint, d => faceColor(d, look.brow))), one('head'));
  {
    // oreille droite : coquille aplatie, plus sombre au creux
    const ear = tube([
      ring([0, 0.03, 0], 0.011, 0.012, 0.005, 0.002),
      ring([-0.004, 0.012, 0.002], 0.013, 0.015, 0.007, 0.003),
      ring([-0.004, -0.008, 0.003], 0.012, 0.014, 0.007, 0.003),
      ring([-0.001, -0.024, 0.002], 0.008, 0.009, 0.006, 0.003),
    ], { seg: 12, dome0: 0.005, dome1: 0.009, color: a => (Math.cos(a) > -0.2 && Math.sin(a) > 0.3 ? [0.8, 0.68, 0.66] : [0.97, 0.88, 0.86]) });
    ear.rotateZ(0.12).rotateY(-0.25).translate(HEAD.x - 0.012, HEAD.y - 0.004, HEAD.z + 0.071);
    both(M.skin, ear, one('head'));
  }
  {
    const d = v3(Math.cos(0.1) * Math.cos(0.37), Math.sin(0.1), Math.cos(0.1) * Math.sin(0.37));
    const at = headPoint(d, new THREE.Vector3(), 0).addScaledVector(d, -0.0135).add(HEAD);
    const iris = look.iris;
    // pôle tourné vers l'avant : pupille, iris cerclé de sombre et blanc de l'œil en anneaux réguliers
    const eye = new THREE.SphereGeometry(0.012, 16, 14).rotateZ(-Math.PI / 2);
    const p = eye.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) {
      const a = Math.acos(Math.max(-1, Math.min(1, p.getX(i) / 0.012)));
      col.push(...(a < 0.19 ? [0.01, 0.01, 0.01] : a < 0.46 ? iris.map(c => c * (a > 0.4 ? 0.45 : 0.8 + 0.5 * (a - 0.19) / 0.21)) : [0.8, 0.74, 0.7]));
    }
    eye.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    eye.translate(at.x, at.y, at.z);
    both(M.eyes, eye, one('head'));
    // paupières : calottes de peau sur le haut et le bas de l'œil, bordées de cils
    const lid = (len, tilt, up) => {
      const g = new THREE.SphereGeometry(0.0129, 16, 6, 0, TAU, 0, len), q = g.attributes.position, lash = [];
      for (let i = 0; i < q.count; i++) lash.push(...(Math.acos(Math.max(-1, Math.min(1, q.getY(i) / 0.0129))) > len - 0.14 ? [0.22, 0.18, 0.16] : [1, 1, 1]));
      g.setAttribute('color', new THREE.Float32BufferAttribute(lash, 3));
      if (!up) g.rotateX(Math.PI);
      g.rotateZ(tilt).translate(at.x, at.y, at.z);
      return g;
    };
    both(M.skin, lid(0.95, -0.45, true), one('head'));
    both(M.skin, lid(0.62, 0.55, false), one('head'));
  }
  {
    const style = look.style, n = new THREE.Vector3(), e = new THREE.Vector3();
    const line = u => hairline(style, Math.abs(u)) + (style ? 0.018 : 0.008) * Math.sin(u * 13 + 1) * smooth(1.3, 0.3, Math.abs(u));
    const hair = sculpt(64, 52, (d, out) => {
      const f = face(d), u = f.u;
      let w = f.w;
      // les sommets sous la ligne d'implantation y sont ramenés : le bord suit la ligne, sans marches
      const hl = line(u);
      if (w < hl) {
        w = hl;
        d = e.set(Math.cos(w) * Math.cos(u), Math.sin(w), Math.cos(w) * Math.sin(u));
      }
      const m = smooth(hl, hl + 0.1, w);
      const th = 0.0016 + m * ((style ? 0.011 : 0.007) + (style ? 0.01 : 0.009) * smooth(-0.2, 0.9, w) + 0.005 * Math.sin(u * 9 + Math.sin(w * 6) * 2) * Math.sin(w * 11 + u * 3));
      headPoint(d, out);
      n.copy(out).normalize();
      return out.addScaledVector(n, th);
    }, null, d => face(d).w > line(face(d).u) - 0.05);
    add(M.hair, toHead(hair), one('head'));
    if (style === 2) {
      // cheveux longs tombant sur le col
      add(M.hair, tube([
        ring([-0.005, 1.69, 0], 0.1, 0.112, 0.084, 0.084, one('head')),
        ring([-0.01, 1.62, 0], 0.1, 0.105, 0.088, 0.088, two('neck', 'head', 0.6)),
        ring([-0.015, 1.55, 0], 0.1, 0.1, 0.1, 0.1, one('neck')),
        ring([-0.02, 1.47, 0], 0.11, 0.115, 0.13, 0.13, two('chest', 'neck', 0.5)),
        ring([-0.025, 1.41, 0], 0.12, 0.13, 0.15, 0.15, one('chest')),
      ], { seg: 24, from: 1.25, to: TAU - 1.25, relief: (a, k) => 0.004 * Math.sin(a * 9 + k * 4) + 0.006 * k }));
    }
  }

  // --- Écharpe : deux tours autour du cou, un pan devant, l'autre jeté dans le dos ---
  const knit = (a, k) => (k > 0.82 && Math.sin(k * 90) > 0.2 ? [0.55, 0.55, 0.55] : [1, 1, 1]);
  for (const [y, a0, tilt] of [[1.508, 0.4, 0.07], [1.552, 2.2, -0.05]]) {
    const pts = [];
    for (let i = 0; i <= 22; i++) {
      const a = a0 + (i / 22) * (TAU + 0.5), r = 0.087 + 0.006 * Math.sin(a * 2);
      pts.push(ring([0.006 + Math.cos(a) * r, y - Math.cos(a) * 0.012 + Math.sin(a) * tilt * 0.1, Math.sin(a) * r * 0.98], 0.027, 0.027, 0.02, 0.02, two('chest', 'neck', 0.55)));
    }
    add(M.scarf, tube(pts, { seg: 12, front: v3(0, 1, 0), dome0: 0.01, dome1: 0.01, relief: a => 0.002 * Math.sin(a * 4) }));
  }
  add(M.scarf, tube([
    ring([0.075, 1.52, 0.04], 0.008, 0.008, 0.045, 0.045, two('chest', 'neck', 0.4)),
    ring([0.128, 1.44, 0.058], 0.008, 0.008, 0.048, 0.048, one('chest')),
    ring([0.16, 1.32, 0.066], 0.007, 0.007, 0.047, 0.047, one('chest')),
    ring([0.164, 1.2, 0.066], 0.007, 0.007, 0.046, 0.046, two('chest', 'spine', 0.5)),
    ring([0.158, 1.1, 0.068], 0.007, 0.007, 0.046, 0.046, one('spine')),
  ], { seg: 12, sub: 2, front: v3(1, 0, 0), color: knit, dome1: 0.004 }));
  add(M.scarf, tube([
    ring([-0.01, 1.54, 0.075], 0.008, 0.008, 0.044, 0.044, two('chest', 'neck', 0.4)),
    ring([-0.09, 1.5, 0.1], 0.008, 0.008, 0.046, 0.046, one('chest')),
    ring([-0.138, 1.4, 0.095], 0.007, 0.007, 0.046, 0.046, one('chest')),
    ring([-0.148, 1.26, 0.088], 0.007, 0.007, 0.045, 0.045, two('chest', 'spine', 0.4)),
    ring([-0.143, 1.13, 0.084], 0.007, 0.007, 0.045, 0.045, one('spine')),
  ], { seg: 12, sub: 2, front: v3(-1, 0, 0), color: knit, dome1: 0.004 }));

  const group = new THREE.Group();
  const list = makeBones(PB, PARENT, JOINT, group);
  const skeleton = new THREE.Skeleton(list);
  const meshes = S.build(group, skeleton);
  const bone = Object.fromEntries(PB.map((n, i) => [n, list[i]]));
  // bout de la lampe : la lueur et le faisceau y sont accrochés, tournés vers +x le long du fût
  const tip = new THREE.Object3D();
  tip.position.copy(GRIP.c).addScaledVector(GRIP.d, 0.127);
  tip.quaternion.setFromUnitVectors(v3(1, 0, 0), GRIP.d);
  bone.wrR.add(tip);
  return { group, skeleton, meshes, bone, tip };
}

// ---------------------------------------------------------------------------
// Créature : bras décharnés sortant de manches en lambeaux, longues mains griffues, vrilles
// ---------------------------------------------------------------------------

const MSH = [0.14, 1.74, 0.27], MEL = [0.14, 1.08, 0.27], MWR = [0.14, 0.38, 0.27];
// doigts (main droite, paume vers l'arrière) : décalage sur la largeur de la paume, longueur, rayon
const CLAWS = [[-0.028, 1, 0.0088], [-0.009, 1.12, 0.0092], [0.01, 1.04, 0.0088], [0.028, 0.82, 0.0078]];
const PHAL = [0.08, 0.062, 0.048];

// M : { dark (étoffe), sleeve (la même, vue des deux côtés), skin, nail } ; renvoie le groupe (os et
// maillages), les bras et les vrilles.
export function monsterLimbs(M) {
  const names = [], parents = {}, joints = {};
  const bone = (n, parent, at) => {
    names.push(n);
    parents[n] = parent;
    joints[n] = at;
    return names.length - 1;
  };
  const S = new Skin();
  const arms = [];
  const geo = { sleeve: null, arm: null, fingers: [], nails: [] };
  for (const s of [1, -1]) {
    const k = s > 0 ? 'R' : 'L', z = v => [v[0], v[1], v[2] * s];
    const sh = bone('sh' + k, null, z(MSH)), el = bone('el' + k, 'sh' + k, z(MEL)), wr = bone('wr' + k, 'el' + k, z(MWR));
    const fingers = CLAWS.map(([dz, f], i) => {
      let y = MWR[1] - 0.125 + Math.abs(dz) * 0.5;
      return PHAL.map((len, j) => {
        const id = bone(`f${k}${i}${j}`, j ? `f${k}${i}${j - 1}` : 'wr' + k, z([MWR[0] - 0.004, y, MWR[2] + dz]));
        y -= len * f;
        return id;
      });
    });
    const T0 = [MWR[0] - 0.012, MWR[1] - 0.035, MWR[2] - 0.034];
    const thumb = [0, 1, 2].map(j => bone(`t${k}${j}`, j ? `t${k}${j - 1}` : 'wr' + k, z([T0[0] - j * 0.012, T0[1] - j * 0.042, T0[2] - j * 0.016])));
    arms.push({ s, sh, el, wr, fingers, thumb });
  }

  // Le bras droit, du haut de l'épaule à la paume, puis ses doigts : le gauche en est le reflet.
  const R = arms[0], W = (i, j, k) => [[i, 1 - k], [j, k]];
  const [x0, , zA] = MSH;
  const sleeve = tube([
    ring([x0, 1.82, zA - 0.03], 0.075, 0.08, 0.07, 0.06, [[R.sh, 1]]),
    ring([x0, 1.72, zA + 0.01], 0.092, 0.095, 0.09, 0.08, [[R.sh, 1]]),
    ring([x0 + 0.005, 1.5, zA + 0.02], 0.1, 0.104, 0.1, 0.09, [[R.sh, 1]]),
    ring([x0 + 0.01, 1.28, zA + 0.02], 0.115, 0.12, 0.112, 0.1, [[R.sh, 1]]),
    ring([x0 + 0.012, 1.1, zA + 0.02], 0.13, 0.135, 0.125, 0.112, [[R.sh, 1]]),
  ], {
    seg: 28, sub: 1,
    relief: (a, k) => 0.012 * k * Math.sin(a * 5 + Math.sin(a * 2) * 2),
    shift: (a, k) => (k > 0.99 ? -0.16 * Math.abs(Math.sin(a * 5.3) * Math.sin(a * 2.1 + 1)) : 0),
  });
  const mottle = (a, k, Rg) => {
    const n = 0.5 + 0.5 * Math.sin(a * 3 + Rg.c.y * 23) * Math.sin(a * 5 - Rg.c.y * 31);
    return [0.78 + 0.22 * n, 0.8 + 0.2 * n, 0.8 + 0.18 * n];
  };
  const arm = tube([
    ring([x0, 1.77, zA], 0.04, 0.04, 0.04, 0.04, [[R.sh, 1]]),
    ring([x0, 1.5, zA], 0.036, 0.037, 0.035, 0.034, [[R.sh, 1]]),
    ring([x0, 1.2, zA], 0.031, 0.033, 0.03, 0.03, [[R.sh, 1]]),
    ring([x0, 1.11, zA], 0.03, 0.036, 0.031, 0.03, W(R.sh, R.el, 0.25)),
    ring([x0, 1.08, zA], 0.03, 0.041, 0.032, 0.03, W(R.sh, R.el, 0.5)),
    ring([x0, 1.05, zA], 0.03, 0.036, 0.031, 0.03, W(R.sh, R.el, 0.78)),
    ring([x0, 0.95, zA], 0.03, 0.03, 0.03, 0.028, [[R.el, 1]]),
    ring([x0, 0.75, zA], 0.025, 0.025, 0.027, 0.025, [[R.el, 1]]),
    ring([x0, 0.55, zA], 0.019, 0.02, 0.022, 0.021, [[R.el, 1]]),
    ring([x0, 0.42, zA], 0.015, 0.016, 0.019, 0.018, W(R.el, R.wr, 0.2)),
    ring([x0, 0.38, zA], 0.014, 0.015, 0.02, 0.019, W(R.el, R.wr, 0.5)),
    ring([x0, 0.35, zA], 0.014, 0.015, 0.024, 0.023, W(R.el, R.wr, 0.85)),
    ring([x0, 0.31, zA], 0.015, 0.014, 0.034, 0.033, [[R.wr, 1]]),
    ring([x0, 0.27, zA], 0.015, 0.012, 0.04, 0.039, [[R.wr, 1]]),
    ring([x0, 0.25, zA], 0.014, 0.01, 0.04, 0.039, [[R.wr, 1]]),
  ], {
    seg: 18, sub: 2, dome1: 0.012,
    relief: (a, k, Rg) => {
      const y = Rg.c.y;
      // os du coude, tendons du poignet, jointures
      return 0.009 * Math.exp(-(((y - 1.08) / 0.03) ** 2) - (((Math.abs(a) - Math.PI) / 0.5) ** 2))
        + 0.0028 * Math.max(0, Math.cos(a * 5)) * smooth(0.7, 0.42, y) * smooth(0.33, 0.4, y)
        + 0.004 * Math.max(0, Math.cos(a)) ** 2 * (0.5 + 0.5 * Math.cos(a * 9)) * Math.exp(-(((y - 0.255) / 0.02) ** 2));
    },
    color: mottle,
  });
  const fingers = [], nails = [];
  CLAWS.forEach(([dz, f, r], i) => {
    const ids = R.fingers[i], ys = ids.map(id => joints[names[id]][1]);
    const yEnd = ys[2] - PHAL[2] * f;
    const pts = [[MWR[0] - 0.004, ys[0] + 0.03, MWR[2] + dz], ...ys.map(y => [MWR[0] - 0.004, y, MWR[2] + dz]), [MWR[0] - 0.004, yEnd, MWR[2] + dz]];
    // chaque phalange suit son os, en douceur autour des articulations
    const wf = k => {
      const y = lerp(pts[0][1], yEnd, k);
      const a = smooth(ys[1] + 0.008, ys[1] - 0.008, y), b = smooth(ys[2] + 0.008, ys[2] - 0.008, y);
      return [[ids[0], 1 - a], [ids[1], a - b], [ids[2], b]];
    };
    const kj = ys.slice(1).map(y => (pts[0][1] - y) / (pts[0][1] - yEnd));
    fingers.push(finger(pts, r, wf, kj, { n: 22, knob: 0.16, taper: 0.4, flat: 0.92, tip: 0.5 }));
    // griffe recourbée vers la paume
    const t0 = v3(MWR[0] - 0.002, yEnd + 0.004, MWR[2] + dz);
    const claw = [t0, t0.clone().add(v3(0.002, -0.016, 0)), t0.clone().add(v3(-0.004, -0.032, 0)), t0.clone().add(v3(-0.014, -0.045, 0))];
    nails.push(finger(claw, r * 0.62, [[ids[2], 1]], [], { n: 8, taper: 0.85, flat: 0.55, tip: 0.3, seg: 8 }));
  });
  {
    const ids = R.thumb, at = ids.map(id => v3(...joints[names[id]]));
    const end = at[2].clone().add(v3(-0.01, -0.036, -0.012));
    const wt = k => (k < 0.45 ? [[ids[0], 1]] : k < 0.75 ? [[ids[1], 1]] : [[ids[2], 1]]);
    fingers.push(finger([at[0].clone().add(v3(0.006, 0.02, 0.01)), ...at, end], 0.011, wt, [0.45, 0.75], { n: 16, knob: 0.15, taper: 0.4, tip: 0.5 }));
    const claw = [end, end.clone().add(v3(-0.004, -0.014, -0.004)), end.clone().add(v3(-0.012, -0.026, -0.006))];
    nails.push(finger(claw, 0.0065, [[ids[2], 1]], [], { n: 6, taper: 0.85, flat: 0.55, tip: 0.3, seg: 8 }));
  }
  const toLeft = {};
  arms[0].fingers.flat().forEach((id, i) => { toLeft[id] = arms[1].fingers.flat()[i]; });
  arms[0].thumb.forEach((id, i) => { toLeft[id] = arms[1].thumb[i]; });
  for (const key of ['sh', 'el', 'wr']) toLeft[arms[0][key]] = arms[1][key];
  const both = (m, g) => {
    S.add(m, mirror(g, toLeft));
    S.add(m, g);
  };
  both(M.sleeve, sleeve);
  both(M.skin, arm);
  for (const g of fingers) both(M.skin, g);
  for (const g of nails) both(M.nail, g);

  // Vrilles d'ombre qui sortent du dos : effilées, torsadées, six os chacune.
  const tendrils = [];
  const SEG = 0.18;
  for (let i = 0; i < 7; i++) {
    const base = new THREE.Object3D();
    base.position.set(-0.12, 1.35 + (i % 4) * 0.16, (i - 3) * 0.08);
    base.rotation.set((i - 3) * 0.35, 0, 0.9 + (i % 3) * 0.3);
    base.updateMatrix();
    const ids = [];
    for (let j = 0; j < 6; j++) {
      const at = v3(0, j * SEG, 0).applyMatrix4(base.matrix);
      ids.push(bone(`v${i}${j}`, j ? `v${i}${j - 1}` : null, at.toArray()));
    }
    const rings = [];
    for (let j = 0; j <= 24; j++) {
      const y = (j / 24) * SEG * 6, r = lerp(0.032, 0.004, (j / 24) ** 0.8), b = Math.min(5, y / SEG), b0 = Math.floor(b), k = b - b0;
      const w = b0 >= 5 ? [[ids[5], 1]] : [[ids[b0], 1 - k], [ids[b0 + 1], k]];
      rings.push(ring(v3(0, y, 0).applyMatrix4(base.matrix), r, r, r, r, w));
    }
    S.add(M.dark, tube(rings, { seg: 8, dome1: 0.01, relief: (a, k) => 0.003 * (1 - k) * Math.sin(a * 3 + k * 18), front: v3(0, 0, 1) }));
    tendrils.push({ ids, rot: base.quaternion.clone() });
  }

  const group = new THREE.Group();
  const list = makeBones(names, parents, joints, group);
  // les vrilles partent inclinées : leur premier os garde cette orientation (les suivants sont droits)
  for (const t of tendrils) {
    const b = list[t.ids[0]];
    b.quaternion.copy(t.rot);
    for (let j = 1; j < 6; j++) list[t.ids[j]].position.set(0, SEG, 0);
  }
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);
  const meshes = S.build(group, skeleton);
  const at = id => list[id];
  return {
    group, skeleton, meshes,
    arms: arms.map(a => ({ s: a.s, shoulder: at(a.sh), elbow: at(a.el), wrist: at(a.wr), fingers: a.fingers.map(f => f.map(at)), thumb: a.thumb.map(at) })),
    tendrils: tendrils.map(t => t.ids.slice(1).map(at)),
  };
}
