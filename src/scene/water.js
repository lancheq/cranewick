/**
 * water.js — 水面 / 溅水 / 浮力
 * 对应 docs/ART_BIBLE.md 第七章「水面的物理契约」。
 *
 * 7.1 Gerstner 4 分量波（深水色散 c = sqrt(gλ/2π)）
 * 7.2 吃水 d = m / (ρ·A_wp)
 * 7.3 阻尼振荡 y'' + 2ζω y' + ω² y = 0
 * 7.4 溅水：中心水柱 + 3 圈环形波 + 水雾粒子
 */
import * as THREE from 'three';
import { C, X, TONE } from '../core/palette.js';

const G = 9.81;
const RHO = 1.025; // t/m³ 海水

// ---------------------------------------------------------------------------
// 7.1 Gerstner 波面
// ---------------------------------------------------------------------------
const WAVES = [
  // [波长 λ(m), 振幅(m), 方向角(度)]
  [14.0, 0.18, 0.0],
  [9.0, 0.10, 55.0],
  [5.0, 0.05, 105.0],
  [3.0, 0.02, 160.0],
];

const WATER_VERT = /* glsl */`
uniform float uTime;
uniform vec4 uWaves[4];      // xyzw = 波长, 振幅, 方向x, 方向z
uniform vec2 uCenter;        // 极坐标网格的世界中心（跟随相机）
varying vec3 vWorld;
varying vec3 vNrm;
varying float vHeight;

void main() {
  vec3 p = position;

  // 波相位始终用「世界坐标」，这样网格跟随相机移动时波场不会跟着飘
  vec2 wp = p.xz + uCenter;

  float h = 0.0;
  vec2 grad = vec2(0.0);

  vec3 preW = vec3(wp.x, 0.0, wp.y);
  float viewDist = length(cameraPosition - preW);

  for (int i = 0; i < 4; i++) {
    float lambda = uWaves[i].x;
    float amp    = uWaves[i].y;
    vec2  dir    = normalize(uWaves[i].zw);
    float k      = 6.28318530718 / lambda;
    float c      = sqrt(9.81 / k);          // 深水色散关系
    float f      = k * (dot(dir, wp) - c * uTime);
    // 视距衰减：远处采样不足的短波必须压平，否则出现摩尔纹/网格感
    float fade   = 1.0 - smoothstep(lambda * 8.0, lambda * 40.0, viewDist);
    h           += amp * fade * sin(f);
    grad        += dir * (amp * k * fade * cos(f));
  }

  p.y += h;
  vHeight = h;
  vWorld = vec3(wp.x, h, wp.y);
  vNrm = normalize(vec3(-grad.x, 1.0, -grad.y));
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
}
`;

const WATER_FRAG = /* glsl */`
uniform vec3 uDeep;
uniform vec3 uHi;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uSunDir;
uniform float uTime;
varying vec3 vWorld;
varying vec3 vNrm;
varying float vHeight;

void main() {
  vec3 N = normalize(vNrm);
  vec3 V = normalize(cameraPosition - vWorld);

  // 风格化：不用菲涅尔，改用受限色阶（与全场景 toon 语言一致）
  float lam = clamp(dot(N, normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
  float band = smoothstep(0.34, 0.68, lam);
  vec3 col = mix(uDeep, uHi, 0.18 + band * 0.66);

  // 高度着色：这是"水面读得出波"的主力 —— 不依赖光照角度，任何视角都有起伏感
  float relief = smoothstep(-0.26, 0.30, vHeight);
  col *= mix(0.72, 1.28, relief);

  // 波峰硬边高光：只取最高的一小段，避免大面积过曝
  float crest = smoothstep(0.80, 1.0, vHeight / 0.30);
  col = mix(col, uHi * 1.18, crest * 0.5);

  // 视角掠射增亮（水面反射的暗示）
  float graze = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.5);
  col = mix(col, uHi, graze * 0.22);

  // 整体降明度、提饱和，让水面读起来是"水"而不是"冰壳"
  col *= vec3(0.86, 0.97, 1.02);

  // 雾
  float d = length(cameraPosition - vWorld);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * 极坐标自适应网格：近处密、远处疏，且永远覆盖到地平线。
 * 比等距矩形网格省 4–5 倍三角面，同时保证相机附近有足够采样率。
 */
function polarGrid(rings = 110, sectors = 180, rMin = 0.6, rMax = 1600) {
  const pos = [], uvs = [], idx = [];
  const growth = Math.pow(rMax / rMin, 1 / (rings - 1));
  const rs = [];
  let r = rMin;
  for (let i = 0; i < rings; i++) { rs.push(r); r *= growth; }

  for (let i = 0; i < rings; i++) {
    for (let j = 0; j <= sectors; j++) {
      const a = (j / sectors) * Math.PI * 2;
      pos.push(Math.cos(a) * rs[i], 0, Math.sin(a) * rs[i]);
      uvs.push(j / sectors, i / (rings - 1));
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < sectors; j++) {
      const a = i * (sectors + 1) + j;
      const b = a + 1;
      const c = a + sectors + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * 创建水面
 * @returns {{mesh:THREE.Mesh, uniform:object, update:(t:number, camera?:THREE.Camera)=>void}}
 */
export function createWater(o = {}) {
  const geo = o.plane
    ? (() => {
        const g = new THREE.PlaneGeometry(o.size ?? 1400, o.size ?? 1400, o.segments ?? 240, o.segments ?? 240);
        g.rotateX(-Math.PI / 2);
        return g;
      })()
    : polarGrid(o.rings ?? 110, o.sectors ?? 180, o.rMin ?? 0.6, o.rMax ?? 1600);

  const waveArr = WAVES.map(([l, a, ang]) => {
    const r = THREE.MathUtils.degToRad(ang);
    return new THREE.Vector4(l, a, Math.sin(r), Math.cos(r));
  });

  const uni = {
    uTime: { value: 0 },
    uWaves: { value: waveArr },
    uCenter: { value: new THREE.Vector2(0, 0) },
    uDeep: { value: C.waterDeep.clone() },
    uHi: { value: C.waterHi.clone() },
    uFogColor: { value: C.fog.clone() },
    uFogDensity: { value: o.fogDensity ?? TONE.fogDensity },
    uSunDir: { value: new THREE.Vector3(0.5, 0.35, 0.6).normalize() },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms: uni,
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    side: THREE.DoubleSide,
    fog: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'Water';
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.userData.noMerge = true;
  mesh.userData.noOutline = true;   // v7.2 关键：水面绝不描边（否则同心环显影成黑色椭圆）
  mesh.position.y = o.y ?? 0;

  // 采样波面高度（用于浮力与溅水定位）
  function heightAt(x, z, t) {
    let h = 0;
    for (const [lambda, amp, ang] of WAVES) {
      const r = THREE.MathUtils.degToRad(ang);
      const dirx = Math.sin(r), dirz = Math.cos(r);
      const k = (Math.PI * 2) / lambda;
      const c = Math.sqrt(G / k);
      h += amp * Math.sin(k * (dirx * x + dirz * z - c * t));
    }
    return h;
  }

  const follow = o.followCamera !== false && !o.plane;
  return {
    mesh, uniform: uni, waves: WAVES, heightAt,
    update(t, camera) {
      uni.uTime.value = t;
      if (follow && camera) {
        // 吸附到 1 m 栅格，避免顶点抖动造成闪烁
        const cx = Math.round(camera.position.x);
        const cz = Math.round(camera.position.z);
        mesh.position.x = cx;
        mesh.position.z = cz;
        uni.uCenter.value.set(cx, cz);
      }
    },
    setFog(d) { uni.uFogDensity.value = d; },
  };
}

// ---------------------------------------------------------------------------
// 7.2 / 7.3 浮力与阻尼振荡
// ---------------------------------------------------------------------------
export function createBuoyancy(o = {}) {
  const mass = o.mass ?? 570;             // t（HMS PENDRAGON 实重，见 airship.js SPEC）
  const awp = o.waterplaneArea ?? 173;    // m²（两浮筒水线面积）
  const draft = o.draft ?? mass / (RHO * awp);
  const omega = Math.sqrt(G / draft);     // rad/s
  const zeta = o.zeta ?? 0.22;

  let y = draft;      // 当前吃水
  let v = 0;          // 吃水速度
  let settled = false;

  return {
    draft, omega, period: (Math.PI * 2) / omega, zeta,
    get y() { return y; },
    /** 当前吃水变化速率（m/s，正 = 继续下沉）—— 溅射的"持续激起"强度取它 */
    get v() { return v; },
    get settled() { return settled; },
    /** 触水瞬间给定竖直速度（m/s，向下为正） */
    impact(vImpact = 1.2) {
      y = 0;
      v = vImpact;
      settled = false;
    },
    reset() { y = draft; v = 0; settled = true; },
    /**
     * @param {number} dt
     * @param {number} [waterY] 该位置的波面高度，叠加到结果上
     */
    update(dt, waterY = 0) {
      const steps = Math.max(1, Math.ceil(dt / 0.008));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const a = -omega * omega * (y - draft) - 2 * zeta * omega * v;
        v += a * h;
        y += v * h;
      }
      if (Math.abs(y - draft) < 0.02 && Math.abs(v) < 0.05) settled = true;
      return y + waterY;
    },
  };
}

// ---------------------------------------------------------------------------
// 7.4 落水溅射（方向性）
// 物理依据：船体竖直入水时把水向「两侧」推开，同时船首下沉把水「向前」铲起。
// ⇒ 主体是【船首水墙 + 两侧翼浪 + 横向推移浪丘 + 前向船首波】，不是同心圆环。
// ---------------------------------------------------------------------------
const SPLASH_CONFIG = {
  // 船首水墙：正前方 ±75° 的弧形水幕（两层错开叠放，避免单层"整片塑料板"感）
  bowSheet: { arc: 2.62, delay: 0.00, dur: 1.05, hMax: 9.0, r0: 2.0, r1: 14.0, op: 0.82 },
  bowSheet2: { arc: 1.90, delay: 0.09, dur: 1.25, hMax: 6.8, r0: 1.6, r1: 10.8, op: 0.55 },
  // 两侧翼浪：±100° 与 ±140° 两对外抛翼
  wingInner: { arc: 1.45, delay: 0.07, dur: 1.20, hMax: 6.2, r0: 2.2, r1: 13.0, op: 0.76, ang: 1.75 },
  wingOuter: { arc: 1.20, delay: 0.15, dur: 1.35, hMax: 4.2, r0: 2.6, r1: 15.0, op: 0.62, ang: 2.44 },
  // 横向推移浪丘（沿 ±Z 走，脊线平行于船身 → 不是圆环）
  swell: { delay: 0.05, dur: 2.6, len: 30, width: 9, hMax: 2.0, travel: 26 },
  // 回涌：水被推开后必然回填（缺这一段就永远"很僵硬"）
  rushBack: { delay: 1.15, dur: 2.1, len: 26, width: 12, hMax: 1.0, travel: 22 },
  // 前向船首波（沿 +X 走）
  bowWave: { delay: 0.30, dur: 2.2, len: 22, width: 7, hMax: 1.7, travel: 24 },
  // 水雾粒子：朝前偏置的扇形（不是全向锥）
  particles: 1600,
  foamParticles: 620,
  particleLife: 1.7,
  vMin: 7,
  vMax: 16,
  /** 扇形偏置：合速度中「向前」的权重 */
  forwardBias: 1.55,
  spreadHalfAngle: 1.95,   // rad ≈ 112°，前方半扇
  /** 抖动：给每片水幕一点角度/高度的慢摆，破除"刚性缩放"的僵硬感 */
  wobbleAmpAng: 0.075,     // rad
  wobbleAmpY: 0.22,        // m
  /** 下沉期间持续补喷：每帧重新播种的粒子比例 */
  pulseFraction: 0.14,
};

/** 竖直弧形水幕（底边落在 y=0，朝 +X 中心，可按 arc 展开） */
function curtainGeo(arc, seg = 64) {
  const g = new THREE.CylinderGeometry(1, 1, 1, seg, 1, true, Math.PI / 2 - arc / 2, arc);
  g.translate(0, 0.5, 0);
  return g;
}

/**
 * 水幕贴图（程序化生成）：
 *   底实顶虚的纵向 alpha 衰减 + 竖向条纹 + 不规则破损上缘。
 * 直接用平涂 MeshBasicMaterial 会读成"半透明塑料板"，必须靠贴图打碎边缘。
 * （不用自定义着色器：避免 GLSL 编译/传入时机带来的整页失败风险）
 */
let _curtainTex = null;
function curtainTexture() {
  if (_curtainTex) return _curtainTex;
  const W = 512, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);

  for (let y = 0; y < H; y++) {
    // 画布 y=0 是纹理顶部；flipY 后对应几何 v=1（幕顶）
    const vv = 1 - y / (H - 1);
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      // 破损上缘：低于此高度完全透明，两条不同频率正弦相乘 → 不规则溅口
      const edge = 0.08 + 0.30 * (0.5 + 0.5 * Math.sin(u * 19.0))
        * (0.5 + 0.5 * Math.sin(u * 6.3 + 1.7));
      let a = 0;
      if (vv > edge) a = Math.pow((vv - edge) / (1 - edge), 0.75);
      // 竖向条纹
      a *= 0.60 + 0.40 * Math.sin(u * 97.0);
      // 底部实、顶部虚（水幕越往上越是飞沫）
      a *= Math.pow(1 - vv, 0.5) * 1.25;
      a = Math.max(0, Math.min(1, a));

      const i = (y * W + x) * 4;
      // 底部偏水色、顶部偏飞沫白
      const warm = Math.min(1, (1 - vv) * 1.15);
      img.data[i] = Math.round(190 + 65 * warm);
      img.data[i + 1] = Math.round(214 + 41 * warm);
      img.data[i + 2] = Math.round(216 + 39 * warm);
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  _curtainTex = t;
  return t;
}

function curtainMaterial(op) {
  return new THREE.MeshBasicMaterial({
    map: curtainTexture(),
    transparent: true,
    opacity: op,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
    fog: true,
  });
}

/** 浪丘柔边贴图：极点不透明 → 赤道透明，边缘带轻微起伏（避免"硬边圆盘"） */
let _moundTex = null;
function moundTexture() {
  if (_moundTex) return _moundTex;
  const W = 256, H = 128;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);                  // 球面 v：0 = 极点，1 = 赤道
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      let a = Math.pow(Math.max(0, 1 - v), 0.85);
      a *= 0.86 + 0.14 * Math.sin(u * 26.0 + 1.1);
      a = Math.max(0, Math.min(1, a));
      const i = (y * W + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  _moundTex = t;
  return t;
}

/** 低矮浪丘（上半球压扁），脊线方向由 scale 控制 */
const domeGeo = new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);

export function createBowSplash(o = {}) {
  const cfg = { ...SPLASH_CONFIG, ...(o.config || {}) };
  const group = new THREE.Group();
  group.name = 'BowSplash';
  group.visible = false;
  group.userData.noMerge = true;

  const foam = new THREE.Color('#DDE8E6');
  const waterHi = C.waterHi.clone();

  const fadeMat = (color, opacity, mound) => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, toneMapped: false, fog: true,
    map: mound ? moundTexture() : null,
    alphaTest: mound ? 0.01 : 0,
  });

  // ---- 水幕（船首两层 + 两对翼浪）----
  const sheets = [];
  const sheetDefs = [
    { key: 'bowSheet', ang: 0 },
    { key: 'bowSheet2', ang: 0 },
    { key: 'wingInner', ang: 1 },
    { key: 'wingInner', ang: -1 },
    { key: 'wingOuter', ang: 1 },
    { key: 'wingOuter', ang: -1 },
  ];
  sheetDefs.forEach((d, idx) => {
    const c = cfg[d.key];
    const geo = curtainGeo(c.arc);
    const m = new THREE.Mesh(geo, curtainMaterial(0));
    m.userData.c = c;
    m.userData.ang = d.ang === 0 ? 0 : d.ang * c.ang;
    // 各自独立的慢摆相位：破除"所有水幕同步刚性缩放"的僵硬感
    m.userData.ph = idx * 1.37;
    m.userData.fAng = 2.1 + (idx % 3) * 0.7;
    m.userData.fY = 2.6 + (idx % 2) * 1.1;
    group.add(m);
    sheets.push(m);
  });

  // ---- 横向推移浪丘 ×2（±Z）----
  const swells = [];
  for (const sgn of [1, -1]) {
    const mat = fadeMat(waterHi.clone().lerp(foam, 0.45), 0, true);
    const m = new THREE.Mesh(domeGeo, mat);
    m.userData.sgn = sgn;
    m.userData.c = cfg.swell;
    group.add(m);
    swells.push(m);
  }
  // 前向船首波
  const bowWaveMat = fadeMat(waterHi.clone().lerp(foam, 0.5), 0, true);
  const bowWave = new THREE.Mesh(domeGeo, bowWaveMat);
  bowWave.userData.c = cfg.bowWave;
  bowWave.userData.forward = true;
  group.add(bowWave);

  // 回涌 ×2：水被推开后会回填（这一段缺失是"僵硬"的主因之一）
  const rushBacks = [];
  for (const sgn of [1, -1]) {
    const mat = fadeMat(waterHi.clone().lerp(foam, 0.25), 0, true);
    const m = new THREE.Mesh(domeGeo, mat);
    m.userData.sgn = sgn;
    m.userData.c = cfg.rushBack;
    group.add(m);
    rushBacks.push(m);
  }

  // ---- 水雾粒子（前方偏置扇形）----
  const P = cfg.particles;
  const pos = new Float32Array(P * 3);
  const vel = new Float32Array(P * 3);
  const life = new Float32Array(P);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pMat = new THREE.PointsMaterial({
    color: foam, size: 2.3, sizeAttenuation: true, transparent: true,
    opacity: 0.95, depthWrite: false, toneMapped: false,
  });
  const points = new THREE.Points(geo, pMat);
  points.frustumCulled = false;
  group.add(points);

  // ---- 浪花（大颗白沫，寿命更短、更飘）----
  const F = cfg.foamParticles;
  const fpos = new Float32Array(F * 3);
  const fvel = new Float32Array(F * 3);
  const flife = new Float32Array(F);
  const fgeo = new THREE.BufferGeometry();
  fgeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
  const fMat = new THREE.PointsMaterial({
    color: new THREE.Color('#F2F7F5'), size: 3.8, sizeAttenuation: true,
    transparent: true, opacity: 0.92, depthWrite: false, toneMapped: false,
  });
  const foamPts = new THREE.Points(fgeo, fMat);
  foamPts.frustumCulled = false;
  group.add(foamPts);

  // 确定性随机
  let seed = 20260914;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

  // 【性能】热路径零分配：原先每次播种都 new THREE.Vector3()
  // （pulse 每帧 ~224 次 + trigger 一次性 2220 次）⇒ GC 周期性停顿 ⇒ 落水段"有几帧卡顿"
  const _dirH = new THREE.Vector3();

  let active = false;
  let t = 0;
  let scale = 1;
  let pulseUntil = 0;

  function seedParticles(arrPos, arrVel, arrLife, n, bias, vMin, vMax, lifeBase, upBias) {
    for (let i = 0; i < n; i++) {
      // 前方偏置扇形：θ ∈ [−half, +half] 绕 +X，再乘一个向前权重
      const half = cfg.spreadHalfAngle;
      const th = (rnd() * 2 - 1) * half;
      const lat = rnd() * 2 - 1;                       // 竖直方向的抬升
      const speed = vMin + rnd() * (vMax - vMin);
      _dirH.set(Math.cos(th), 0, Math.sin(th));
      const fx = _dirH.x * bias + 1.0 * (bias - 1.0);   // 再向 +X 偏
      const fz = _dirH.z * bias;
      const len = Math.hypot(fx, fz) || 1;
      arrPos[i * 3] = (rnd() - 0.5) * 3.0;
      arrPos[i * 3 + 1] = rnd() * 0.6;
      arrPos[i * 3 + 2] = (rnd() - 0.5) * 3.0;
      arrVel[i * 3] = (fx / len) * speed * (0.5 + rnd() * 0.5);
      arrVel[i * 3 + 1] = (0.55 + rnd() * 0.85) * speed * upBias + lat * 1.2;
      arrVel[i * 3 + 2] = (fz / len) * speed * (0.5 + rnd() * 0.5);
      arrLife[i] = lifeBase * (0.55 + rnd() * 0.55);
    }
  }

  function trigger(o = {}) {
    active = true;
    t = 0;
    scale = o.scale ?? 1;
    pulseUntil = 0;
    group.visible = true;
    const sv = Math.max(0.5, scale);
    seedParticles(pos, vel, life, P, cfg.forwardBias, cfg.vMin * sv, cfg.vMax * sv, cfg.particleLife, 1.0);
    seedParticles(fpos, fvel, flife, F, cfg.forwardBias * 0.8, cfg.vMin * sv * 0.7, cfg.vMax * sv * 0.9, cfg.particleLife * 0.75, 1.25);
    geo.attributes.position.needsUpdate = true;
    fgeo.attributes.position.needsUpdate = true;
    for (const s of sheets) s.material.opacity = 0;
    for (const s of swells) s.material.opacity = 0;
    for (const s of rushBacks) s.material.opacity = 0;
    bowWave.material.opacity = 0;
  }

  /**
   * 下沉期间持续补喷 —— 这是"水花不是播一段固定动画，而是落水过程激起的"的关键。
   * 每调用一次重新播种一部分粒子（近距离、低初速），强度随下沉速率衰减。
   * @param {number} strength 0..1，通常取 v_sink / v_impact_cap
   */
  function pulse(strength = 1) {
    if (!active || strength <= 0.01) return;
    pulseUntil = t + 0.45;
    const n = Math.max(1, Math.floor(P * cfg.pulseFraction * Math.min(1, strength)));
    const sv = Math.max(0.4, scale * strength);
    for (let k = 0; k < n; k++) {
      const i = Math.floor(rnd() * P);
      const half = cfg.spreadHalfAngle * 0.78;
      const th = (rnd() * 2 - 1) * half;
      const speed = (cfg.vMin * 0.3 + rnd() * (cfg.vMax - cfg.vMin) * 0.5) * sv;
      _dirH.set(Math.cos(th), 0, Math.sin(th));
      const fx = _dirH.x * cfg.forwardBias + (cfg.forwardBias - 1.0);
      const fz = _dirH.z * cfg.forwardBias;
      const len = Math.hypot(fx, fz) || 1;
      pos[i * 3] = (rnd() - 0.5) * 4.5;
      pos[i * 3 + 1] = rnd() * 0.5;
      pos[i * 3 + 2] = (rnd() - 0.5) * 4.5;
      vel[i * 3] = (fx / len) * speed * (0.4 + rnd() * 0.6);
      vel[i * 3 + 1] = (0.42 + rnd() * 0.75) * speed;
      vel[i * 3 + 2] = (fz / len) * speed * (0.4 + rnd() * 0.6);
      life[i] = cfg.particleLife * (0.35 + rnd() * 0.45);
    }
    geo.attributes.position.needsUpdate = true;
  }

  function stepParticles(arrPos, arrVel, arrLife, n, dt, drag, gravity) {
    let alive = 0;
    for (let i = 0; i < n; i++) {
      if (arrLife[i] <= 0) continue;
      alive++;
      arrLife[i] -= dt;
      arrVel[i * 3 + 1] -= gravity * dt;
      arrVel[i * 3] *= drag;
      arrVel[i * 3 + 2] *= drag;
      arrPos[i * 3] += arrVel[i * 3] * dt;
      arrPos[i * 3 + 1] += arrVel[i * 3 + 1] * dt;
      arrPos[i * 3 + 2] += arrVel[i * 3 + 2] * dt;
      if (arrPos[i * 3 + 1] < 0) {
        arrPos[i * 3 + 1] = 0;
        arrVel[i * 3 + 1] *= -0.2;
        arrVel[i * 3] *= 0.3;
        arrVel[i * 3 + 2] *= 0.3;
        arrLife[i] = Math.min(arrLife[i], 0.14);
      }
      if (arrLife[i] <= 0) arrPos[i * 3 + 1] = -999;
    }
    return alive;
  }

  function update(dt) {
    if (!active) return;
    t += dt;

    // --- 水幕：弧形水墙抬起、外扩、落下（带独立慢摆，破除僵硬）---
    for (const m of sheets) {
      const c = m.userData.c;
      const tt = t - c.delay;
      if (tt < 0 || tt > c.dur) { m.visible = false; continue; }
      m.visible = true;
      const u = tt / c.dur;
      const grow = 1 - Math.pow(1 - u, 2.2);            // 先急后缓地外扩
      const R = THREE.MathUtils.lerp(c.r0, c.r1, grow) * scale;
      const H = c.hMax * scale
        * (u < 0.28 ? Math.pow(u / 0.28, 0.65) : 1 - Math.pow((u - 0.28) / 0.72, 1.7));
      // 两组不同频率的慢摆：角度 + 高度 + 径向微呼吸 —— 破除"同步刚性缩放"
      const wob = Math.sin(tt * m.userData.fAng + m.userData.ph);
      const wob2 = Math.sin(tt * m.userData.fY * 1.7 + m.userData.ph * 1.9);
      const breathe = 1 + 0.06 * wob2;
      m.scale.set(R * breathe, Math.max(H * (1 + 0.10 * wob), 0.01), R * breathe);
      m.rotation.y = m.userData.ang + cfg.wobbleAmpAng * wob;
      m.material.opacity = Math.max(0, c.op * (1 - Math.pow(u, 1.35)));
      m.position.y = 0.04 + cfg.wobbleAmpY * wob2;
    }

    // --- 横向推移浪丘：沿 ±Z 外走，脊线平行船身（不是圆环）---
    for (const m of swells) {
      const c = m.userData.c;
      const tt = t - c.delay;
      if (tt < 0 || tt > c.dur) { m.visible = false; continue; }
      m.visible = true;
      const u = tt / c.dur;
      const z = m.userData.sgn * c.travel * (1 - Math.pow(1 - u, 2.0));
      const wob = Math.sin(tt * 1.9 + m.userData.sgn * 1.1);
      m.position.set(0, 0.02, z);
      const widen = (1 + u * 0.9) * (1 + 0.05 * wob);
      m.scale.set(c.len / 2 * widen * scale, c.hMax * scale * (1 - Math.pow(u, 1.6)) * (1 + 0.12 * wob), c.width / 2 * widen);
      m.material.opacity = Math.max(0, 0.75 * Math.sin(Math.PI * Math.min(1, u * 1.15)));
    }

    // --- 回涌：水被推开后由外向内回填（缺这一层就永远"僵硬"）---
    for (const m of rushBacks) {
      const c = m.userData.c;
      const tt = t - c.delay;
      if (tt < 0 || tt > c.dur) { m.visible = false; continue; }
      m.visible = true;
      const u = tt / c.dur;
      const z = m.userData.sgn * THREE.MathUtils.lerp(c.travel, 5.0, 1 - Math.pow(1 - u, 1.8));
      m.position.set(0, 0.02, z);
      const narrow = THREE.MathUtils.lerp(1.15, 0.55, u);
      m.scale.set(
        c.len / 2 * narrow * scale,
        c.hMax * scale * Math.sin(Math.PI * Math.min(1, u * 1.05)),
        c.width / 2 * scale
      );
      m.material.opacity = Math.max(0, 0.5 * Math.sin(Math.PI * Math.min(1, u * 1.1)));
    }

    // --- 前向船首波：沿 +X 外走 ---
    {
      const c = bowWave.userData.c;
      const tt = t - c.delay;
      if (tt < 0 || tt > c.dur) bowWave.visible = false;
      else {
        bowWave.visible = true;
        const u = tt / c.dur;
        const x = c.travel * (1 - Math.pow(1 - u, 2.0));
        bowWave.position.set(x, 0.02, 0);
        const widen = 1 + u * 1.1;
        bowWave.scale.set(c.width / 2 * widen, c.hMax * (1 - Math.pow(u, 1.6)), c.len / 2 * widen);
        bowWave.material.opacity = Math.max(0, 0.8 * Math.sin(Math.PI * Math.min(1, u * 1.15)));
      }
    }

    // --- 粒子 ---
    stepParticles(pos, vel, life, P, dt, 0.985, G * 1.02);
    stepParticles(fpos, fvel, flife, F, dt, 0.955, G * 0.62);   // 浪花更飘、更慢落
    geo.attributes.position.needsUpdate = true;
    fgeo.attributes.position.needsUpdate = true;
    pMat.opacity = Math.max(0, 0.95 * (1 - t / (cfg.particleLife + 0.6)));
    fMat.opacity = Math.max(0, 0.9 * (1 - t / (cfg.particleLife * 0.75 + 0.7)));

    const done = t > Math.max(
      cfg.swell.dur + cfg.swell.delay,
      cfg.rushBack.dur + cfg.rushBack.delay,
      cfg.bowWave.dur + cfg.bowWave.delay,
      cfg.particleLife + 0.8,
      cfg.particleLife * 0.75 + 1.0,
      pulseUntil
    );
    if (done) { active = false; group.visible = false; }
  }

  return {
    group, trigger, pulse, update, config: cfg,
    /** 复位到未触发的干净状态（供核验工具重跑时间轴，保证测量可复现） */
    reset() {
      active = false; t = 0; scale = 1; pulseUntil = 0;
      group.visible = false;
      for (const s of sheets) { s.material.opacity = 0; s.visible = false; }
      for (const s of swells) { s.material.opacity = 0; s.visible = false; }
      for (const s of rushBacks) { s.material.opacity = 0; s.visible = false; }
      bowWave.material.opacity = 0; bowWave.visible = false;
      for (let i = 0; i < P; i++) { life[i] = 0; pos[i * 3 + 1] = -999; }
      for (let i = 0; i < F; i++) { flife[i] = 0; fpos[i * 3 + 1] = -999; }
      geo.attributes.position.needsUpdate = true;
      fgeo.attributes.position.needsUpdate = true;
    },
    get active() { return active; },
    get age() { return t; },
  };
}

/** 兼容旧命名 */
export const createSplash = createBowSplash;

// ---------------------------------------------------------------------------
// 7.5 欠阻尼弹簧回正响应（俯仰 / 横滚共用）
//
//   θ'' + 2ζω·θ' + ω²·θ = 0 ，初始条件 θ(0) = θ0, θ'(0) = 0
//   解析解 θ(t) = θ0 · e^(−ζωt) · [ cos(ωd·t) + (ζω/ωd)·sin(ωd·t) ]，ωd = ω√(1−ζ²)
//
// 【关键】平衡位置是 **0（水平）**。v2 把 trim 当成"永久静态前倾"，
// 于是船落水后一直歪着头、不回正 —— 这就是问题根因。
// 正确做法：船首下沉只是**初始位移**，弹簧把它拉回水平，阻尼让它在两下内停住。
// ---------------------------------------------------------------------------
export function createSpringResponse(o = {}) {
  const theta0Deg = o.theta0 ?? -4.2;
  /** 初始角速度（度/秒）—— 触水瞬间水对船首的冲击力矩，靠它把船首"压"下去 */
  const v0Deg = o.v0 ?? 0;
  const omega = o.omega ?? 1.75;
  const zeta = o.zeta ?? 0.22;
  const delay = o.delay ?? 0;
  const theta0 = THREE.MathUtils.degToRad(theta0Deg);
  const v0 = THREE.MathUtils.degToRad(v0Deg);
  const wd = omega * Math.sqrt(Math.max(1e-6, 1 - zeta * zeta));
  const B = (v0 + zeta * omega * theta0) / wd;
  let t = -Infinity;
  let last = theta0Deg;

  return {
    theta0Deg, v0Deg, omega, zeta, wd,
    period: (Math.PI * 2) / omega,
    trigger() { t = 0; last = theta0Deg; },
    reset() { t = -Infinity; last = 0; },
    get active() { return t > -1; },
    get settled() { return t > -1 && Math.abs(last) < 1.0; },
    get value() { return last; },
    /** @returns {number} 角度（度），正 = 抬头 / 右倾；平衡态恒为 0（回正） */
    update(dt) {
      if (t === -Infinity) return 0;
      t += dt;
      const s = Math.max(0, t - delay);
      const e = Math.exp(-zeta * omega * s);
      last = THREE.MathUtils.radToDeg(e * (theta0 * Math.cos(wd * s) + B * Math.sin(wd * s)));
      return last;
    },
  };
}

/**
 * 触水俯仰：flare 抬头进场 → 水冲击把船首压下去 → 弹簧回正到水平
 * 典型参数 theta0=+2.4°（进场抬头）、v0=−22°/s（水冲击）→ 先低头到约 −4.3°，再回正。
 */
export function createPitchResponse(o = {}) {
  return createSpringResponse({
    theta0: o.theta0 ?? o.trim ?? 2.4,
    v0: o.v0 ?? -22,
    omega: o.omega ?? 1.75,
    zeta: o.zeta ?? 0.22,
    delay: o.delay ?? 0,
  });
}

// ---------------------------------------------------------------------------
// 水面浮筒停泊时的气泡串（细节增益）
// ---------------------------------------------------------------------------
export function createBubbleTrail(o = {}) {
  const N = o.count ?? 220;
  const pos = new Float32Array(N * 3);
  const speed = new Float32Array(N);
  let seed = 4242;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (rnd() - 0.5) * (o.spread ?? 6);
    pos[i * 3 + 1] = -rnd() * 4;
    pos[i * 3 + 2] = (rnd() - 0.5) * (o.spread ?? 6);
    speed[i] = 2.0 + rnd() * 1.6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: new THREE.Color('#E8F0EE'), size: 0.35, sizeAttenuation: true,
    transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.name = 'Bubbles';
  pts.userData.noMerge = true;
  pts.visible = false;

  function update(dt, active) {
    pts.visible = !!active;
    if (!active) return;
    for (let i = 0; i < N; i++) {
      pos[i * 3 + 1] += speed[i] * dt;
      if (pos[i * 3 + 1] > 0) {
        pos[i * 3 + 1] = -3 - rnd() * 2;
        pos[i * 3] = (rnd() - 0.5) * 6;
        pos[i * 3 + 2] = (rnd() - 0.5) * 6;
      }
    }
    geo.attributes.position.needsUpdate = true;
  }

  return { points: pts, update };
}

export default {
  createWater, createBuoyancy, createBowSplash, createSplash,
  createSpringResponse, createPitchResponse,
  createBubbleTrail, WAVES, SPLASH_CONFIG,
};
