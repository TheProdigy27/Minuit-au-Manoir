// Développement de l'image, comme une caméra : la scène est rendue en haute dynamique, les lumières
// vives bavent (halo), puis viennent la courbe de contraste, le vignetage et les franges colorées de
// l'objectif, le grain de la pellicule et un tramage qui évite les marches d'escalier dans le noir.
import * as THREE from '/vendor/three.module.min.js';

const LEVELS = 6; // niveaux du halo, chacun deux fois plus petit

const VERT = `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

// Réduction en 13 points (Jimenez, 2014). La première ne garde que ce qui dépasse le seuil, avec une
// moyenne pondérée qui empêche un pixel isolé très vif de scintiller.
const DOWN = `
uniform sampler2D src;
uniform vec2 texel;
uniform float first;
uniform float threshold;
uniform float knee;
varying vec2 vUv;
vec3 s( float x, float y ) { return texture2D( src, vUv + vec2( x, y ) * texel ).rgb; }
float luma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
vec3 group( vec3 a, vec3 b, vec3 c, vec3 d, out float w ) {
  vec3 m = ( a + b + c + d ) * 0.25;
  w = 1.0 / ( 1.0 + luma( m ) );
  return m * w;
}
void main() {
  vec3 a = s( -2.0, 2.0 ), b = s( 0.0, 2.0 ), c = s( 2.0, 2.0 );
  vec3 d = s( -2.0, 0.0 ), e = s( 0.0, 0.0 ), f = s( 2.0, 0.0 );
  vec3 g = s( -2.0, -2.0 ), h = s( 0.0, -2.0 ), i = s( 2.0, -2.0 );
  vec3 j = s( -1.0, 1.0 ), k = s( 1.0, 1.0 ), l = s( -1.0, -1.0 ), m = s( 1.0, -1.0 );
  vec3 col;
  if ( first > 0.5 ) {
    float w0, w1, w2, w3, w4;
    vec3 c0 = group( j, k, l, m, w0 ), c1 = group( a, b, d, e, w1 ), c2 = group( b, c, e, f, w2 );
    vec3 c3 = group( d, e, g, h, w3 ), c4 = group( e, f, h, i, w4 );
    col = ( c0 * 0.5 + ( c1 + c2 + c3 + c4 ) * 0.125 ) / ( w0 * 0.5 + ( w1 + w2 + w3 + w4 ) * 0.125 );
    float br = max( col.r, max( col.g, col.b ) );
    float soft = clamp( br - threshold + knee, 0.0, 2.0 * knee );
    soft = soft * soft / ( 4.0 * knee + 1e-4 );
    col *= max( soft, br - threshold ) / max( br, 1e-4 );
  } else {
    col = e * 0.125 + ( a + c + g + i ) * 0.03125 + ( b + d + f + h ) * 0.0625 + ( j + k + l + m ) * 0.125;
  }
  gl_FragColor = vec4( col, 1.0 );
}`;

// Agrandissement (filtre en tente 3×3), ajouté au niveau supérieur.
const UP = `
uniform sampler2D src;
uniform vec2 texel;
varying vec2 vUv;
void main() {
  vec2 r = texel;
  vec3 c = texture2D( src, vUv ).rgb * 4.0;
  c += ( texture2D( src, vUv + vec2( -r.x, 0.0 ) ).rgb + texture2D( src, vUv + vec2( r.x, 0.0 ) ).rgb
       + texture2D( src, vUv + vec2( 0.0, -r.y ) ).rgb + texture2D( src, vUv + vec2( 0.0, r.y ) ).rgb ) * 2.0;
  c += texture2D( src, vUv + vec2( -r.x, -r.y ) ).rgb + texture2D( src, vUv + vec2( r.x, -r.y ) ).rgb
     + texture2D( src, vUv + vec2( -r.x, r.y ) ).rgb + texture2D( src, vUv + vec2( r.x, r.y ) ).rgb;
  gl_FragColor = vec4( c / 16.0, 1.0 );
}`;

const OUT = `
uniform sampler2D src;
uniform sampler2D bloom;
uniform float bloomStrength;
uniform float aberration;
uniform float vignette;
uniform float grain;
uniform float time;
uniform float ghost;
uniform float shade;
uniform float red;
uniform float flash;
uniform vec2 aspect;
uniform sampler2D depthTex;
uniform mat4 projInv;
uniform float beamOn;
uniform vec3 lampPos;
uniform vec3 lampDir;
uniform float lampCos;
uniform float lampTan;
uniform float lampRange;
uniform vec3 lampColor;
uniform sampler2D cookie;
varying vec2 vUv;
float hash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
// Lumière de la lampe diffusée par la poussière en suspension, le long du rayon de vue jusqu'à la
// première surface (repère de la caméra) : le faisceau se voit dans l'air.
vec3 beam() {
  float z = texture2D( depthTex, vUv ).x;
  vec4 p = projInv * vec4( vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0 );
  vec3 P = p.xyz / p.w;
  float len = min( length( P ), lampRange + length( lampPos ) );
  vec3 dir = normalize( P );
  float dt = len / 16.0, jitter = hash( gl_FragCoord.xy + fract( time ) * 61.0 ), sum = 0.0;
  for ( int i = 0; i < 16; i ++ ) {
    float t = ( float( i ) + jitter ) * dt;
    vec3 L = dir * t - lampPos;
    float d = length( L ), c = dot( L, lampDir ) / max( d, 1e-4 );
    if ( c > lampCos && d < lampRange ) {
      float r = sqrt( max( 0.0, 1.0 - c * c ) ) / max( c, 1e-3 ) / lampTan;
      float fall = 1.0 - d / lampRange;
      sum += texture2D( cookie, vec2( 0.5 + 0.5 * r, 0.5 ) ).r * fall * fall / ( 0.35 + d * d ) * exp( -0.075 * t );
    }
  }
  return lampColor * sum * dt;
}
void main() {
  vec2 d = vUv - 0.5;
  float r2 = dot( d * aspect, d * aspect );
  // franges colorées vers les bords, comme un objectif bon marché
  vec2 off = d * r2 * aberration;
  vec3 col = vec3( texture2D( src, vUv - off ).r, texture2D( src, vUv ).g, texture2D( src, vUv + off ).b );
  col += texture2D( bloom, vUv ).rgb * bloomStrength;
  if ( beamOn > 0.5 ) col += beam();
  // perte de lumière dans les coins (loi en cos⁴)
  float c = 1.0 / ( 1.0 + r2 * 1.6 );
  col *= mix( 1.0, c * c, vignette );
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // grain argentique, plus visible dans les ombres, et tramage d'un demi-niveau
  float lum = dot( gl_FragColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
  float n = hash( gl_FragCoord.xy + fract( time * 7.31 ) * 917.0 ) + hash( gl_FragCoord.xy * 1.7 + fract( time * 3.17 ) * 431.0 ) - 1.0;
  gl_FragColor.rgb += n * grain * ( 1.0 - 0.75 * lum );
  // par-dessus : la vue délavée et bleutée des fantômes, les bords assombris (plus encore avec la peur),
  // le voile rouge (à terre, créature toute proche) et l'éclair, en dégradés depuis le centre de l'écran
  vec3 o = clamp( gl_FragColor.rgb, 0.0, 1.0 );
  o = mix( o, vec3( dot( o, vec3( 0.2126, 0.7152, 0.0722 ) ) ), 0.85 * ghost ) * ( 1.0 + 0.08 * ghost );
  o = mix( o, vec3( 0.157, 0.275, 0.51 ), 0.16 * ghost );
  float e = length( d * aspect ) / ( 0.5 * length( aspect ) );
  o *= 1.0 - shade * 0.9 * clamp( ( e - 0.3 ) / 0.7, 0.0, 1.0 );
  o = mix( o, vec3( 0.588, 0.0, 0.0 ), red * 0.9 * clamp( ( e - 0.35 ) / 0.65, 0.0, 1.0 ) );
  gl_FragColor.rgb = mix( o, vec3( 0.784, 0.824, 1.0 ), flash );
  gl_FragColor.rgb += ( hash( gl_FragCoord.xy + 71.3 ) - 0.5 ) / 255.0;
}`;

export class Post {
  constructor(gl) {
    this.gl = gl;
    this.hdr = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.hdr.depthTexture = new THREE.DepthTexture(1, 1); // pour le faisceau dans l'air
    this.mips = Array.from({ length: LEVELS }, () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(g);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const shader = (fragmentShader, uniforms, o = {}) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, ...o });
    const tx = () => ({ value: null }), v2 = () => ({ value: new THREE.Vector2() });
    this.down = shader(DOWN, { src: tx(), texel: v2(), first: { value: 0 }, threshold: { value: 1.1 }, knee: { value: 0.6 } }, { toneMapped: false });
    this.up = shader(UP, { src: tx(), texel: v2() }, { toneMapped: false, blending: THREE.AdditiveBlending });
    this.out = shader(OUT, {
      src: tx(), bloom: tx(), bloomStrength: { value: 0.06 }, aberration: { value: 0.012 }, vignette: { value: 0.35 },
      grain: { value: 0.04 }, time: { value: 0 }, aspect: v2(), ghost: { value: 0 }, shade: { value: 0 }, red: { value: 0 }, flash: { value: 0 },
      depthTex: { value: this.hdr.depthTexture }, projInv: { value: new THREE.Matrix4() }, beamOn: { value: 0 }, lampPos: { value: new THREE.Vector3() },
      lampDir: { value: new THREE.Vector3() }, lampCos: { value: 1 }, lampTan: { value: 1 }, lampRange: { value: 1 }, lampColor: { value: new THREE.Color() }, cookie: tx(),
    });
    this.params = this.out.uniforms;
  }

  setSize(w, h) {
    this.hdr.setSize(w, h);
    this.out.uniforms.aspect.value.set(1, h / w);
    let mw = w, mh = h;
    for (const m of this.mips) {
      mw = Math.max(1, mw >> 1);
      mh = Math.max(1, mh >> 1);
      m.setSize(mw, mh);
    }
  }

  // Où la scène doit être dessinée.
  get target() {
    return this.hdr;
  }

  // Lissage des bords (multiéchantillonnage) : 4, ou 0 sur les ordinateurs qui peinent.
  get samples() {
    return this.hdr.samples;
  }

  set samples(n) {
    this.hdr.dispose();
    this.hdr.samples = n;
  }

  // Faisceau visible de la lampe `lamp` (SpotLight), vu par `camera` ; `density` : poussière dans l'air.
  beam(camera, lamp, density) {
    const O = this.out.uniforms;
    O.beamOn.value = lamp.intensity > 0 && density > 0 ? 1 : 0;
    if (!O.beamOn.value) return;
    O.projInv.value.copy(camera.projectionMatrixInverse);
    O.lampPos.value.copy(lamp.position).applyMatrix4(camera.matrixWorldInverse);
    O.lampDir.value.subVectors(lamp.target.position, lamp.position).transformDirection(camera.matrixWorldInverse);
    O.lampCos.value = Math.cos(lamp.angle);
    O.lampTan.value = Math.tan(lamp.angle);
    O.lampRange.value = lamp.distance;
    O.lampColor.value.copy(lamp.color).multiplyScalar(lamp.intensity * density);
    O.cookie.value = lamp.map;
  }

  pass(material, target) {
    this.quad.material = material;
    this.gl.setRenderTarget(target);
    this.gl.render(this.scene, this.cam);
  }

  // Halo puis image finale à l'écran.
  finish(time) {
    const D = this.down.uniforms, U = this.up.uniforms;
    let src = this.hdr;
    this.mips.forEach((m, i) => {
      D.src.value = src.texture;
      D.texel.value.set(1 / src.width, 1 / src.height);
      D.first.value = i === 0 ? 1 : 0;
      this.pass(this.down, m);
      src = m;
    });
    for (let i = LEVELS - 1; i > 0; i--) {
      const s = this.mips[i];
      U.src.value = s.texture;
      U.texel.value.set(1 / s.width, 1 / s.height);
      this.pass(this.up, this.mips[i - 1]);
    }
    const O = this.out.uniforms;
    O.src.value = this.hdr.texture;
    O.bloom.value = this.mips[0].texture;
    O.time.value = time;
    this.pass(this.out, null);
  }
}
