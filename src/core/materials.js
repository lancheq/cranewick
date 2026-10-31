/**
 * materials.js — CRANEWICK 材质工厂（全项目唯一材质来源）
 * 对应 docs/ART_BIBLE.md 第三章。
 *
 * 【铁律一】所有物体必须经此处创建材质。禁止 new THREE.MeshStandardMaterial() 裸奔。
 *
 * 管线：MeshToonMaterial(gradientMap 色阶) + onBeforeCompile 注入边缘光 + 反向外壳描边
 */
import * as THREE from 'three';
import { C, X, BANDS, TONE } from './palette.js';

// ---------------------------------------------------------------------------
// 全局共享 uniform：改这里 = 改全场景边缘光
// ---------------------------------------------------------------------------
// v8.1：边缘光由"冷蓝灰"改为"暖金" —— 这是让黄铜发亮最有效的一招
const uRimColor = { value: (C.rimGold || C.skyDuskHi).clone() };
const uRimStrength = { value: 0.44 };
const uRimPower = { value: 3.0 };

/** 运行时全局调参入口（预览页可挂到 window.__style 上直播调） */
export const STYLE = {
  rimColor: uRimColor.value,
  get rimStrength() { return uRimStrength.value; },
  set rimStrength(v) { uRimStrength.value = v; },
  get rimPower() { return uRimPower.value; },
  set rimPower(v) { uRimPower.value = v; },
  outlineWidth: 0.012,
  outlineEnabled: true,
};

// ---------------------------------------------------------------------------
// 色阶贴图（1×N DataTexture，Nearest 采样 → 硬边台阶）
// ---------------------------------------------------------------------------
const gradCache = new Map();

function gradientMap(stops) {
  const key = stops.join(',');
  if (gradCache.has(key)) return gradCache.get(key);
  const data = new Uint8Array(stops.map((s) => Math.round(Math.min(1, s) * 255)));
  const tex = new THREE.DataTexture(data, stops.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  gradCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------------------
// 边缘光注入
// ---------------------------------------------------------------------------
const RIM_MARK = '/*CRANEWICK_RIM*/';
const RIM_PARS = `
${RIM_MARK}
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform float uRimPower;
`;

function rimify(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = uRimColor;
    shader.uniforms.uRimStrength = uRimStrength;
    shader.uniforms.uRimPower = uRimPower;

    shader.fragmentShader = RIM_PARS + shader.fragmentShader;

    const TOKEN = '#include <opaque_fragment>';
    const inject = `
      {
        vec3 rimN = normalize( normal );
        vec3 rimV = normalize( vViewPosition );
        float rimF = pow( 1.0 - clamp( dot( rimN, rimV ), 0.0, 1.0 ), uRimPower );
        outgoingLight += uRimColor * ( rimF * uRimStrength );
      }
      ${TOKEN}`;

    if (shader.fragmentShader.includes(TOKEN)) {
      shader.fragmentShader = shader.fragmentShader.replace(TOKEN, inject);
    }
    // 若注入点不存在则静默跳过：退化为纯色阶 toon，不会崩
  };
  material.customProgramCacheKey = () => 'cranewick-toon-rim-v1';
  return material;
}

// ---------------------------------------------------------------------------
// 基础 toon 材质
// ---------------------------------------------------------------------------
/**
 * @param {string|THREE.Color} color
 * @param {object} o  { bands, emission, emissiveIntensity, outline, outlineWidth, side, flatShading }
 */
export function toon(color, o = {}) {
  const col = color instanceof THREE.Color ? color : new THREE.Color(color);
  const stops = o.bands || BANDS.hard;

  const m = new THREE.MeshToonMaterial({
    color: col,
    gradientMap: gradientMap(stops),
    side: o.side ?? THREE.FrontSide,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    depthWrite: o.depthWrite ?? true,
    fog: o.fog !== false,
  });
  // 注：MeshToonMaterial 在 r186 不接受 flatShading。
  // 需要硬边明暗的物体请改用 geometry.toNonIndexed() + computeVertexNormals()。

  if (o.emission) {
    m.emissive = o.emission instanceof THREE.Color ? o.emission.clone() : new THREE.Color(o.emission);
    m.emissiveIntensity = o.emissiveIntensity ?? 0.12;
  }

  rimify(m);

  // 描边宽度挂在 material.userData，由 outline.js 读取
  m.userData.outlineWidth = o.outline === false ? 0 : (o.outlineWidth ?? STYLE.outlineWidth);
  m.userData.family = o.family || 'generic';
  return m;
}

// ---------------------------------------------------------------------------
// 六族材质工厂（ART_BIBLE 3.x 表）
// ---------------------------------------------------------------------------
export const M = {
  /** 黄铜：高光硬边、窄锐 */
  brass: (o = {}) => toon(o.color || C.brass, {
    family: 'brass',
    bands: o.bands || BANDS.metal,
    outlineWidth: o.outlineWidth ?? 0.014,
    emission: o.emission,
    emissiveIntensity: o.emissiveIntensity,
    ...o,
    color: undefined,
  }),

  /** 暗黄铜 / 氧化 */
  brassLo: (o = {}) => toon(C.brassLo, { family: 'brass', bands: BANDS.metal, ...o }),

  /** 铜绿：屋顶、排水管 */
  verdigris: (o = {}) => toon(C.copperOx, { family: 'brass', bands: BANDS.metal, ...o }),

  /** 青铜铸件 */
  bronze: (o = {}) => toon(C.bronze, { family: 'brass', bands: BANDS.metal, ...o }),

  /** 铸铁：暗哑 */
  iron: (o = {}) => toon(o.color || C.iron, {
    family: 'iron',
    bands: BANDS.hard,
    outlineWidth: o.outlineWidth ?? 0.016,
    ...o,
    color: undefined,
  }),

  /** 石材：近哑光 */
  stone: (o = {}) => toon(o.color || C.stone, {
    family: 'stone',
    bands: BANDS.hard,
    outlineWidth: o.outlineWidth ?? 0.012,
    ...o,
    color: undefined,
  }),

  /** 砖：联排楼、烟囱 */
  brick: (o = {}) => toon(C.brick, { family: 'stone', ...o }),

  /** 木材 */
  wood: (o = {}) => toon(C.wood, { family: 'wood', bands: BANDS.hard, ...o }),

  /** 帆布：无高光、双色阶、柔软 */
  canvas: (o = {}) => toon(o.color || C.canvasIvory, {
    family: 'canvas',
    bands: BANDS.soft,
    outlineWidth: o.outlineWidth ?? 0.01,
    ...o,
    color: undefined,
  }),

  /** 缆绳 */
  rope: (o = {}) => toon(C.hempRope, { family: 'canvas', bands: BANDS.soft, outlineWidth: 0, ...o }),

  /** 玻璃（灯罩）：半透明 */
  glassLamp: (o = {}) => toon(o.color || C.accentVerdigris, {
    family: 'glass',
    bands: BANDS.hard,
    transparent: true,
    opacity: 0.62,
    outline: false,
    ...o,
  }),

  /** 河水（本体仅在 water.js 用 ShaderMaterial，此处给个兜底） */
  water: (o = {}) => toon(C.waterDeep, { family: 'water', bands: BANDS.hard, outline: false, ...o }),
};

// ---------------------------------------------------------------------------
// 自发光材质（灯 / 指示灯）—— HDR，靠 Bloom 溢出
// ---------------------------------------------------------------------------
export function lamp(color, gain = TONE.lampGain, o = {}) {
  const c = (color instanceof THREE.Color ? color : new THREE.Color(color)).clone().multiplyScalar(gain);
  const m = new THREE.MeshBasicMaterial({ color: c, fog: o.fog !== false, toneMapped: false });
  m.userData.outlineWidth = 0;
  m.userData.family = 'emissive';
  m.userData.baseColor = (color instanceof THREE.Color ? color : new THREE.Color(color)).clone();
  m.userData.gain = gain;
  return m;
}

/** 指示灯四态（ART_BIBLE 6.1） */
export const SIGNAL = {
  red: '#C8433A',
  amber: '#E2913C',
  green: '#4E9A6A',
  off: '#243029',
};

/**
 * 创建一具指示灯：灯箱 + 玻璃罩 + 内部发光体
 * @returns {{group:THREE.Group, setState:(s:string)=>void, tick:(t:number)=>void}}
 */
export function makeSignal(o = {}) {
  const size = o.size ?? 0.5;
  const group = new THREE.Group();
  group.name = o.name || 'Signal';

  const boxMat = M.brass({ bands: BANDS.detail });
  const box = new THREE.Mesh(new THREE.BoxGeometry(size * 1.5, size * 2.4, size * 1.1), boxMat);
  // 手工倒角：外扩一圈细边
  const flange = new THREE.Mesh(new THREE.BoxGeometry(size * 1.7, size * 0.18, size * 1.28), boxMat);
  flange.position.y = size * 0.95;
  const flange2 = flange.clone();
  flange2.position.y = -size * 0.95;
  group.add(box, flange, flange2);

  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(size * 0.52, 16, 12),
    M.glassLamp({ color: C.accentVerdigris, opacity: 0.55 })
  );
  lens.position.z = size * 0.55;
  group.add(lens);

  const bulbMat = lamp(SIGNAL.off, 0.25);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(size * 0.34, 12, 10), bulbMat);
  bulb.position.z = size * 0.55;
  group.add(bulb);

  // 遮光檐
  const hood = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.62, size * 0.78, size * 0.22, 10), boxMat);
  hood.position.set(0, size * 0.72, size * 0.5);
  hood.rotation.x = 0.35;
  group.add(hood);

  let state = 'red';
  let blinkHz = 0;

  function setState(s) {
    state = s;
    if (s === 'red') { bulbMat.color.set(SIGNAL.red).multiplyScalar(TONE.lampGain); blinkHz = 0; }
    else if (s === 'red-blink') { bulbMat.color.set(SIGNAL.red).multiplyScalar(TONE.lampGain); blinkHz = 1.5; }
    else if (s === 'amber-blink') { bulbMat.color.set(SIGNAL.amber).multiplyScalar(TONE.lampGain); blinkHz = 3.0; }
    else if (s === 'green') { bulbMat.color.set(SIGNAL.green).multiplyScalar(TONE.lampGain); blinkHz = 0; }
    else { bulbMat.color.set(SIGNAL.off).multiplyScalar(0.25); blinkHz = 0; }
  }

  function tick(t) {
    if (blinkHz > 0) {
      const on = Math.sin(t * Math.PI * 2 * blinkHz) > 0;
      bulbMat.color.copy(bulbMat.userData.baseColor || bulbMat.color);
      const base = new THREE.Color(
        state === 'amber-blink' ? SIGNAL.amber : SIGNAL.red
      );
      bulbMat.color.copy(base).multiplyScalar(on ? TONE.lampGain : 0.12);
      lens.material.opacity = on ? 0.75 : 0.5;
    }
  }

  group.userData.parts = { bulb, lens, bulbMat, setState, tick, get state() { return state; } };
  return group;
}

export default { M, toon, lamp, makeSignal, STYLE };
