// Matières réalistes : textures photographiées (Poly Haven, domaine public, voir textures/CREDITS.md)
// posées à l'échelle réelle. Leur couleur sert de « détail » : elle est ramenée à sa moyenne puis
// multipliée par la couleur du matériau ou par un motif dessiné (art.js), si bien qu'une même photo
// de plâtre abîmé vieillit tous les papiers peints, chacun dans sa teinte.
import * as THREE from '/vendor/three.module.min.js';

// Jeu de textures → côté du carré photographié, en mètres.
export const SETS = {
  bark: 2.15, carpet: 0.6, ceiling: 1, checker: 3, flagstone: 3.17, floorboards: 2, ground: 2, iron: 1, knit: 0.27, leather: 0.4,
  linen: 0.27, marble: 1.5, parquet: 3.4, planks: 2, plaster: 1.8, roughwood: 2, stone: 2.71, stonewall: 2, tiles: 2, velvet: 0.28,
  wood: 2, wool: 0.27,
};

const loader = new THREE.ImageLoader();
const bases = new Map();
const pending = [];
let arrived = 0;
const track = p => pending.push(p.finally(() => arrived++));
let aniso = 1;
let env = null, envIntensity = 1;
let packed = false;
const photos = new Set(); // toutes les textures photo, copies comprises (filtrage changé en jeu : Renderer.setAniso)

export function setAnisotropy(a) {
  aniso = a;
}

// Photos compressées pour la carte graphique (si elle lit les formats BC1 et BC5, voir bc.js) :
// décodées et compressées par des workers pendant l'écran de chargement, 4 à 8 fois moins de mémoire.
export function setCompression(on) {
  packed = on;
}

const workers = [], jobs = new Map();
let nextJob = 0;

function encode(url, kind) {
  if (!workers.length) {
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./texworker.js', import.meta.url), { type: 'module' });
      w.onmessage = ({ data }) => {
        const job = jobs.get(data.id);
        jobs.delete(data.id);
        if (data.error) job.no(new Error(data.error));
        else job.ok(data.levels);
      };
      workers.push(w);
    }
  }
  const id = nextJob++;
  return new Promise((ok, no) => {
    jobs.set(id, { ok, no });
    workers[id % workers.length].postMessage({ id, url: new URL(url, location.href).href, kind });
  });
}

// Les textures photo créées jusqu'ici, copies comprises.
export function photoTextures() {
  return photos;
}

// Reflets posés sur les matières brillantes (voir surface, option env).
export function setEnvironment(texture, intensity) {
  env = texture;
  envIntensity = intensity;
}

// Les copies (tex) partagent l'image de l'original : elles la reçoivent quand elle arrive (compressée,
// avec ses niveaux de mipmap, que chaque copie garde à part : voir copies).
const copies = new Map();

function base(set, file) {
  const key = `${set}/${file}`;
  let t = bases.get(key);
  if (!t) {
    const url = `/textures/${key}.jpg`;
    // l'occlusion, la rugosité et le métal du fer restent en photo : BC5 ne garde que deux canaux
    if (packed && (file !== 'arm' || set !== 'iron')) {
      t = new THREE.CompressedTexture([], 1, 1, file === 'diff' ? THREE.RGB_S3TC_DXT1_Format : THREE.RED_GREEN_RGTC2_Format);
      copies.set(t, []);
      // une fois envoyés à la carte graphique (une seule fois pour toutes les copies), les niveaux sont oubliés
      const sent = () => {
        t.userData.sent = true;
        for (const c of [t, ...copies.get(t)]) c.mipmaps = [];
      };
      track(encode(url, file === 'diff' ? 'color' : file === 'nor' ? 'normal' : 'data').then(levels => {
        t.image.width = levels[0].width;
        t.image.height = levels[0].height;
        for (const c of [t, ...copies.get(t)]) {
          c.mipmaps = levels;
          c.onUpdate = sent;
          c.needsUpdate = true;
        }
      }, err => console.warn(key, err)));
    } else {
      t = new THREE.Texture();
      track(new Promise(ok => loader.load(url, img => {
        t.image = img;
        t.needsUpdate = true;
        ok();
      }, undefined, ok)));
    }
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    if (file === 'diff') t.colorSpace = THREE.SRGBColorSpace;
    bases.set(key, t);
    photos.add(t);
  }
  return t;
}

// Part des photos arrivées, de 0 à 1 (barre de l'écran de chargement).
export function texturesLoaded() {
  return pending.length ? arrived / pending.length : 0;
}

// Toutes les photos chargées (elles se chargent pendant l'écran de chargement).
export function texturesReady() {
  for (const set of Object.keys(SETS)) for (const f of ['diff', 'nor', 'arm']) base(set, f);
  return Promise.all(pending).then(() => {
    for (const w of workers) w.terminate();
    workers.length = 0;
  });
}

// Une copie de la photo, répétée tous les `size` mètres sur le canal d'UV `channel` (l'image n'est envoyée
// qu'une fois). Copier ne change pas l'image : la version de la source reste la même, si bien qu'une copie
// faite après l'envoi (en début de partie, quand les niveaux ont été oubliés) reprend la texture déjà sur
// la carte graphique, sans rien renvoyer. Avant cela, une telle copie restait sans texture (lue noire).
function tex(set, file, size, channel) {
  const b = base(set, file), v = b.source.version, t = b.clone();
  t.source.version = v;
  if (copies.has(b)) {
    copies.get(b).push(t);
    // rien à envoyer à la carte graphique avant l'arrivée de ses niveaux
    if (!b.mipmaps.length && !b.userData.sent) t.version = 0;
  }
  t.repeat.set(1 / size, 1 / size);
  t.channel = channel;
  photos.add(t);
  return t;
}

const PARS = `
#ifdef USE_DETAIL
uniform sampler2D detailMap;
uniform float detailStrength;
#endif
#ifdef USE_BUMPN
uniform sampler2D bumpNormal;
uniform float bumpStrength;
#endif`;

// Couleur de la photo divisée par sa moyenne (dernier niveau de mipmap) : seules ses variations restent.
const DETAIL = `
#ifdef USE_DETAIL
{
  vec3 dc = texture2D( detailMap, vNormalMapUv ).rgb;
  vec3 dm = textureLod( detailMap, vNormalMapUv, 12.0 ).rgb;
  diffuseColor.rgb *= mix( vec3( 1.0 ), dc / max( dm, vec3( 0.004 ) ), detailStrength );
}
#endif`;

// Relief de la photo et relief tiré du motif dessiné, additionnés. Compressée (BC5), la photo ne garde
// que x et y de ses normales : z s'en déduit.
const NORMAL = THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', `#ifdef NORMAL_XY
  mapN.z = sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) );
#endif
mapN.xy *= normalScale;
#ifdef USE_BUMPN
  vec3 bumpN = texture2D( bumpNormal, vMapUv ).xyz * 2.0 - 1.0;
  bumpN.xy *= bumpStrength;
  mapN = normalize( vec3( mapN.xy + bumpN.xy, mapN.z * bumpN.z ) );
#endif`);

function onBeforeCompile(shader) {
  Object.assign(shader.uniforms, this.userData.u);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + PARS)
    .replace('#include <map_fragment>', '#include <map_fragment>\n' + DETAIL)
    .replace('#include <normal_fragment_maps>', NORMAL);
}

// Matériau physique (PBR).
//  set      : photo de détail (couleur, relief, rugosité, occlusion), à l'échelle réelle × `scale`
//  detail   : part de la couleur de la photo (0 : relief seul ; 1 : toutes ses nuances)
//  map      : motif dessiné (canal d'UV 0) ; bump : son relief (canvas de normales, voir art.normalFromCanvas)
//  channel  : canal d'UV de la photo (1 : coordonnées en mètres posées par le Builder ; 0 : UV du modèle)
//  roughness, metalness : multiplient la photo ; metalMap : le canal bleu de la photo indique le métal
//  physical : sheen, clearcoat… (velours, laque, porcelaine)
//  env      : force des reflets de la pièce ; par défaut, ceux de setEnvironment sur les seules matières
//             brillantes (métal, vernis, peu rugueuses), aucun ailleurs (ils ne s'y voyaient pas)
export function surface(o = {}) {
  const {
    set, scale = 1, detail = 1, channel = 1, map = null, bump = null, bumpStrength = 1, normal = 1, ao = 1,
    metalMap = false, rough = true, physical = null, noShadow = false, env: envK, ...rest
  } = o;
  const M = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const m = new M({ roughness: 1, metalness: 0, ...rest, ...physical });
  m.userData.noShadow = noShadow;
  if (envK ?? (m.metalness > 0 || m.roughness <= 0.6 || physical?.clearcoat > 0)) shine(m, envK);
  if (map) m.map = map;
  if (set) {
    const size = SETS[set] * scale;
    m.normalMap = tex(set, 'nor', size, channel);
    m.normalScale.setScalar(normal);
    if (rough || ao || metalMap) {
      const arm = tex(set, 'arm', size, channel);
      if (rough) m.roughnessMap = arm;
      if (ao) { m.aoMap = arm; m.aoMapIntensity = ao; }
      if (metalMap) m.metalnessMap = arm;
    }
    m.userData.u = {
      detailMap: { value: base(set, 'diff') },
      detailStrength: { value: detail },
      bumpNormal: { value: bump },
      bumpStrength: { value: bumpStrength },
    };
    m.defines.USE_DETAIL = '';
    if (packed) m.defines.NORMAL_XY = '';
    if (bump && map) m.defines.USE_BUMPN = '';
    m.onBeforeCompile = onBeforeCompile;
  }
  return m;
}

// Donne au matériau `m` les reflets de la pièce (force `k`, celle de setEnvironment par défaut).
export function shine(m, k = envIntensity) {
  m.envMap = env;
  m.envMapIntensity = k;
  return m;
}

// Copie les UV du modèle dans le canal 1, à l'échelle (mètres) : pour les objets faits hors du Builder.
export function meters(geometry, su, sv = su) {
  const uv = geometry.attributes.uv.array, uv1 = new Float32Array(uv.length);
  for (let i = 0; i < uv.length; i += 2) {
    uv1[i] = uv[i] * su;
    uv1[i + 1] = uv[i + 1] * sv;
  }
  geometry.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  return geometry;
}

// Ce que reflètent les surfaces brillantes : une pièce sombre, quelques lueurs chaudes de bougies
// et la clarté froide d'une fenêtre. Très atténué, il donne aux métaux, aux vernis et aux carrelages leur éclat.
export function nightEnvironment(gl) {
  const scene = new THREE.Scene();
  const basic = (r, g, b, side = THREE.FrontSide) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), side });
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(12, 5, 12), basic(0.012, 0.009, 0.008, THREE.BackSide)));
  const panel = (mat, x, y, z, w, h) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    p.position.set(x, y, z);
    p.lookAt(0, y, 0);
    scene.add(p);
  };
  panel(basic(2.4, 1.3, 0.5), 5.5, 0.6, 2, 1.2, 0.8);
  panel(basic(1.6, 0.85, 0.35), -4, 1.2, -5.5, 0.6, 0.6);
  panel(basic(1.2, 0.6, 0.25), -5.5, -0.8, 3, 1.8, 0.4);
  panel(basic(0.25, 0.32, 0.5), 2, 0.8, -5.9, 1.4, 2.2);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), basic(0.03, 0.022, 0.016));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.4;
  scene.add(floor);
  const pmrem = new THREE.PMREMGenerator(gl);
  const rt = pmrem.fromScene(scene, 0.04);
  pmrem.dispose();
  scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return rt.texture;
}
