/**
 * canal.js — ⑤ 运河 + 石砌河堤（v9 重做：威尼斯口径 · 蒸汽朋克）
 * 见 docs/STYLE_PROMPT.md §4/§6/§7。
 *
 * 用户历次修正（不得回潮）：
 *   · "水道可以考虑参考威尼斯水道的设计"            ⇒ 窄而深：宽 18 / 深 3
 *   · "河堤也需要细化成石质的和下水道排水口之类"      ⇒ 大块方石贴图堤墙 + 压顶 + 出水口拱 + 入水石阶
 *   · 原 riverside 是 110 m 宽大河 + 仓库区，尺度与方向都不对 ⇒ 整体作废
 *
 * 局部坐标：运河中心线 x = 0；水面 y = 0；堤顶 y = +2.2。
 *   堤墙内表面 x = ±9；堤墙厚 1.2；沿河步道 x ∈ [9, 12.2]
 */
import * as THREE from 'three';
import { C, BANDS } from '../core/palette.js';
import { M, lamp, toon } from '../core/materials.js';
import { applyWall } from '../core/textures.js';
import { H, CANAL } from '../core/scale.js';
import {
  bevelBox, boxGeo, cylGeo, sphereGeo, coneGeo,
  rivets, pipe, railing, addOutline,
  strutBetween, unitStrut, tagThinMembers, mergeByMaterial,
} from '../core/primitives.js';
import { buildSteamLamp } from './street.js';

export const SPEC = {
  width: CANAL.width,      // 18 中心到中心
  half: CANAL.width / 2,   // 9 堤墙内表面
  depth: CANAL.depth,      // 3.0 水深
  quayY: CANAL.quayY,      // 2.2 堤顶
  wallT: CANAL.wallT,      // 1.2 堤墙厚
  walk: CANAL.walk,        // 3.2 沿河步道
  stepW: CANAL.stepW,
  outfallW: CANAL.outfallW,
  bollardStep: CANAL.bollardStep,
  len: 180,                // 沿河长度（沿 Z）
  bedY: CANAL.bedY,        // 河床（唯一来源 = scale.js）
};

function makeMaterials() {
  return {
    block: applyWall(M.stone({ bands: [0.2, 0.48, 0.9], outlineWidth: 0.03 }), 'stoneBlock', [2.4, 24]),
    blockDark: applyWall(M.stone({ bands: [0.22, 0.5, 0.88], outlineWidth: 0.028 }), 'brickBlue', [3, 14]),
    // 压顶：长条石（缝少而深）—— 码头特有的砌法
    coping: applyWall(M.stone({ bands: [0.2, 0.48, 0.9], outlineWidth: 0.032 }), 'quayCurb', [1, 34]),
    // 步道：**不规则旧石板**（湿痕 + 补过的洞）
    // 原来它与街道路面共用同一张贴图对象 —— 所以用户会说「码头河堤过于规整、和街上没区别」。
    // 根因是 textures.finish() 的缓存 key 不含 repeat，第二个 repeat 被静默忽略（已修）。
    slab: applyWall(M.stone({ bands: [0.3, 0.62, 1.0], outline: false }), 'quayFlag', [1.4, 26]),
    stain: toon(new THREE.Color('#2A2A26'), { bands: [0.24, 0.5, 0.9], outline: false }),
    weed: toon(new THREE.Color('#38452E'), { bands: [0.24, 0.54, 0.96], outlineWidth: 0.018 }),
    iron: M.iron({ bands: [0.26, 0.56, 1.0], outlineWidth: 0.028 }),
    ironDark: M.iron({ color: C.ironLo, bands: [0.24, 0.52, 0.96], outlineWidth: 0.026 }),
    steel: M.iron({ color: new THREE.Color('#5A626B'), bands: [0.26, 0.58, 1.0], outlineWidth: 0.026 }),
    brass: M.brass({ bands: BANDS.metal, outlineWidth: 0.03 }),
    brassDark: M.brass({ color: C.brassLo, bands: BANDS.metal, outlineWidth: 0.028 }),
    bronze: M.bronze({ bands: BANDS.metal, outlineWidth: 0.03 }),
    copper: M.bronze({ color: new THREE.Color('#A55F3A'), bands: BANDS.metal, outlineWidth: 0.026 }),
    verdigris: M.verdigris({ bands: BANDS.metal, outlineWidth: 0.026 }),
    wood: M.wood({ bands: [0.26, 0.56, 1.0], outlineWidth: 0.026 }),
    lampWarm: lamp(C.lampWarm, 1.7),
  };
}

// ---------------------------------------------------------------------------
// 堤墙（迎水面）：大块方石 + 压顶 + 壁龛 + 水线污痕 + 系船环/柱
// ---------------------------------------------------------------------------
function buildQuayWall(MT, sgn) {
  const g = new THREE.Group();
  g.name = `QuayWall_${sgn > 0 ? 'E' : 'W'}`;
  const xIn = sgn * SPEC.half;
  const xOut = sgn * (SPEC.half + SPEC.wallT);
  const cx = (xIn + xOut) / 2;
  const h = SPEC.quayY - SPEC.bedY;

  // 墙身
  const body = new THREE.Mesh(boxGeo(SPEC.wallT, h, SPEC.len), MT.block);
  body.position.set(cx, SPEC.bedY + h / 2, 0);
  body.receiveShadow = true;
  g.add(body);
  // 压顶（外挑 0.35）
  const coping = new THREE.Mesh(boxGeo(SPEC.wallT + 0.7, 0.42, SPEC.len), MT.coping);
  coping.position.set(cx - sgn * 0.25, SPEC.quayY + 0.21, 0);
  coping.receiveShadow = true;
  coping.castShadow = true;
  g.add(coping);
  // 挑口滴水线
  const drip = new THREE.Mesh(boxGeo(SPEC.wallT + 0.9, 0.1, SPEC.len), MT.blockDark);
  drip.position.set(cx - sgn * 0.32, SPEC.quayY - 0.02, 0);
  drip.userData.noOutline = true;
  g.add(drip);

  // 壁柱（每 6 m，迎水面凸出）+ 壁龛
  const n = Math.floor(SPEC.len / 6);
  for (let i = 0; i <= n; i++) {
    const z = -SPEC.len / 2 + (SPEC.len * i) / n;
    const pil = new THREE.Mesh(boxGeo(0.45, h - 1.2, 0.9), MT.block);
    pil.position.set(xIn - sgn * 0.22, SPEC.bedY + (h - 1.2) / 2 + 0.6, z);
    pil.receiveShadow = true;
    g.add(pil);
    const cap = new THREE.Mesh(boxGeo(0.7, 0.3, 1.2), MT.coping);
    cap.position.set(xIn - sgn * 0.3, SPEC.quayY - 0.35, z);
    g.add(cap);
    if (i < n) {
      const zc = z + SPEC.len / (2 * n);
      const niche = new THREE.Mesh(boxGeo(0.3, 1.4, 0.9), MT.ironDark);
      niche.position.set(xIn - sgn * 0.06, SPEC.quayY - 1.5, zc);
      niche.userData.noOutline = true;
      g.add(niche);
    }
  }

  // 水线污痕（三条，越高越淡）+ 苔藓带
  for (const [yy, hh, op] of [[0.55, 0.9, 0.9], [1.5, 0.6, 0.5], [-0.6, 0.7, 0.7]]) {
    const st = new THREE.Mesh(boxGeo(0.1, hh, SPEC.len), MT.stain);
    st.position.set(xIn - sgn * 0.015, yy, 0);
    st.material = MT.stain.clone();
    st.material.transparent = true;
    st.material.opacity = op;
    st.userData.noOutline = true;
    g.add(st);
  }
  const weed = new THREE.Mesh(boxGeo(0.2, 0.4, SPEC.len), MT.weed);
  weed.position.set(xIn - sgn * 0.09, 0.06, 0);
  g.add(weed);

  // 系船柱（堤顶）+ 铁系船环（墙面）
  const bollards = [];
  const nb = Math.floor(SPEC.len / SPEC.bollardStep);
  for (let i = 0; i <= nb; i++) {
    const z = -SPEC.len / 2 + 3 + (SPEC.len - 6) * (i / nb);
    const b = new THREE.Mesh(cylGeo(0.16, 0.2, 0.62, 10), MT.bronze);
    b.position.set(sgn * (SPEC.half - 0.55), SPEC.quayY + 0.73, z);
    b.castShadow = true;
    g.add(b);
    const bc = new THREE.Mesh(sphereGeo(0.18, 10), MT.bronze);
    bc.position.set(sgn * (SPEC.half - 0.55), SPEC.quayY + 1.06, z);
    g.add(bc);
    strutBetween(g, [sgn * (SPEC.half - 0.2), SPEC.quayY + 0.42, z], [sgn * (SPEC.half - 0.55), SPEC.quayY + 0.66, z],
      { radius: 0.07, mat: MT.bronze, name: 'BollardBase' });
    bollards.push(b);
    // 墙面铁环
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 12), MT.iron);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(xIn - sgn * 0.12, SPEC.quayY - 0.9, z + SPEC.bollardStep / 2);
    g.add(ring);
  }
  g.userData.parts = { bollards, h };
  return g;
}

// ---------------------------------------------------------------------------
// 下水道出水口拱（威尼斯/伦敦河堤的标志物）
// ---------------------------------------------------------------------------
function buildOutfall(MT, sgn, z) {
  const g = new THREE.Group();
  g.name = 'Outfall';
  const x = sgn * SPEC.half;
  const W = SPEC.outfallW, Hh = 2.1;

  // 拱券：半圆环 + 楔形拱石
  const arch = new THREE.Mesh(new THREE.TorusGeometry(W / 2, 0.3, 8, 20, Math.PI), MT.coping);
  arch.rotation.y = Math.PI / 2;
  arch.position.set(x - sgn * 0.08, Hh, z);
  g.add(arch);
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (i / 8);
    const stone = new THREE.Mesh(boxGeo(0.5, 0.56, 0.5), MT.block);
    stone.position.set(x - sgn * 0.08, Hh + Math.cos(a) * (W / 2 + 0.28), z + Math.sin(a) * (W / 2 + 0.28));
    stone.rotation.x = -a + Math.PI / 2;
    g.add(stone);
  }
  // 两侧墩
  for (const dz of [-W / 2 - 0.5, W / 2 + 0.5]) {
    const pier = new THREE.Mesh(boxGeo(0.7, Hh + 0.7, 0.9), MT.block);
    pier.position.set(x - sgn * 0.06, (Hh + 0.7) / 2 - 0.1, z + dz);
    pier.receiveShadow = true;
    g.add(pier);
  }
  // 洞口（深腔内壁）+ 铁格栅
  const throat = new THREE.Mesh(boxGeo(1.5, Hh + 0.4, W), MT.ironDark);
  throat.position.set(x + sgn * 0.65, Hh / 2, z);
  throat.userData.noOutline = true;
  g.add(throat);
  for (let i = 0; i < 6; i++) {
    const bz = z - W / 2 + (W * (i + 0.5)) / 6;
    strutBetween(g, [x - sgn * 0.34, 0.12, bz], [x - sgn * 0.34, Hh + 0.5, bz],
      { radius: 0.055, mat: MT.iron, name: 'OutfallGrille' });
  }
  strutBetween(g, [x - sgn * 0.34, 0.12, z - W / 2], [x - sgn * 0.34, 0.12, z + W / 2],
    { radius: 0.05, mat: MT.iron, name: 'OutfallGrille' });
  // 出水痕迹（贴着洞口根部，不是飘在水上的板）
  const flow = new THREE.Mesh(boxGeo(1.4, 0.04, W * 0.7), MT.lampWarm);
  flow.position.set(x - sgn * 0.75, 0.02, z);
  flow.material = MT.lampWarm.clone();
  flow.material.transparent = true;
  flow.material.opacity = 0.28;
  flow.userData.noOutline = true;
  g.add(flow);
  // 铭牌（黄铜）
  const plate = new THREE.Mesh(boxGeo(0.06, 0.36, 0.9), MT.brassDark);
  plate.position.set(x - sgn * 0.34, Hh + 0.95, z);
  g.add(plate);
  return g;
}

// ---------------------------------------------------------------------------
// 入水石阶（威尼斯式，从步道下到水面）
// ---------------------------------------------------------------------------
function buildWaterStair(MT, sgn, z) {
  const g = new THREE.Group();
  g.name = 'WaterStair';
  const w = SPEC.stepW;
  const steps = 9;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const st = new THREE.Mesh(boxGeo(w, 0.3, 0.62), MT.block);
    st.position.set(sgn * (SPEC.half - 0.2 - t * 0.4), SPEC.quayY - 0.15 - t * (SPEC.quayY + 0.6), z + t * 4.6);
    st.receiveShadow = true;
    g.add(st);
  }
  // 侧墙
  for (const dz of [-0.55, 5.0]) {
    const wall = new THREE.Mesh(boxGeo(w + 0.5, SPEC.quayY + 1.0, 0.5), MT.blockDark);
    wall.position.set(sgn * (SPEC.half - 0.3), (SPEC.quayY - 0.2) / 2 - 0.3, z + dz);
    g.add(wall);
  }
  // 黄铜扶手 + 立柱（立柱落座在台阶上）
  const rx = sgn * (SPEC.half + 0.15);
  strutBetween(g, [rx, SPEC.quayY + 0.95, z - 0.5], [rx, SPEC.quayY + 0.95, z + 5.0],
    { radius: 0.05, mat: MT.brass, name: 'StairRail' });
  for (let k = 0; k <= 3; k++) {
    const t = k / 3;
    const zz = z - 0.5 + 5.5 * t;
    const stepY = SPEC.quayY - 0.15 - t * (SPEC.quayY + 0.6) + 0.15;
    strutBetween(g, [rx, stepY, zz], [rx, SPEC.quayY + 0.9, zz],
      { radius: 0.035, mat: MT.brass, name: 'StairRailPost' });
  }
  return g;
}

// ---------------------------------------------------------------------------
// 沿河步道 + 黄铜栏杆 + 街灯（复用街道同款灯，保证城市语言统一）
// ---------------------------------------------------------------------------
function buildPromenade(MT, sgn) {
  const g = new THREE.Group();
  g.name = `Promenade_${sgn > 0 ? 'E' : 'W'}`;
  const x0 = sgn * (SPEC.half + SPEC.wallT);
  const x1 = sgn * (SPEC.half + SPEC.wallT + SPEC.walk);
  const cx = (x0 + x1) / 2;

  const deck = new THREE.Mesh(boxGeo(SPEC.walk, 0.3, SPEC.len), MT.slab);
  deck.position.set(cx, SPEC.quayY + 0.15, 0);
  deck.receiveShadow = true;
  deck.userData.noOutline = true;
  g.add(deck);
  // 靠墙侧排水浅沟
  const ch = new THREE.Mesh(boxGeo(0.4, 0.08, SPEC.len), MT.ironDark);
  ch.position.set(x0 + sgn * 0.4, SPEC.quayY + 0.3, 0);
  ch.userData.noOutline = true;
  g.add(ch);
  // 临水黄铜栏杆
  const rail = railing(g, SPEC.len * 0.99, { height: H.railH, radius: 0.055, posts: Math.round(SPEC.len / 5), mat: MT.brass });
  rail.rotation.y = Math.PI / 2;
  rail.position.set(sgn * (SPEC.half + SPEC.wallT - 0.25), SPEC.quayY + 0.3, 0);
  // 沿河功能管（铜）+ 支架
  pipe(g, [[0, SPEC.quayY + 0.5, -SPEC.len / 2], [0, SPEC.quayY + 0.5, 0], [0, SPEC.quayY + 0.5, SPEC.len / 2]],
    { radius: 0.09, mat: MT.copper, segments: 24, flanges: false, name: 'QuayPipe' }).position.x = x0 + sgn * 0.7;
  return g;
}


// ---------------------------------------------------------------------------
export function build(opts = {}) {
  const MT = makeMaterials();
  const root = new THREE.Group();
  root.name = 'Canal';

  const walls = [buildQuayWall(MT, 1), buildQuayWall(MT, -1)];
  const promenades = [buildPromenade(MT, 1), buildPromenade(MT, -1)];
  root.add(...walls, ...promenades);

  // 河床（水下暗色体块，避免看穿）
  const bed = new THREE.Mesh(boxGeo(SPEC.width + SPEC.wallT * 2, 0.8, SPEC.len), MT.stain);
  bed.position.set(0, SPEC.bedY - 0.4, 0);
  bed.userData.noOutline = true;
  root.add(bed);

  // 下水道出水口拱（两岸各 2，错开布置）
  const outfalls = [
    buildOutfall(MT, 1, -46), buildOutfall(MT, 1, 38),
    buildOutfall(MT, -1, 12), buildOutfall(MT, -1, -70),
  ];
  root.add(...outfalls);

  // 入水石阶（两岸各 1）
  const stairs = [buildWaterStair(MT, 1, -12), buildWaterStair(MT, -1, 52)];
  root.add(...stairs);

  // 沿河街灯（复用街道同款）
  const lamps = [];
  for (const sgn of [1, -1]) {
    for (let i = 0; i < 7; i++) {
      const z = -SPEC.len / 2 + 12 + i * 24;
      const l = buildSteamLamp(MT, [
        sgn * (SPEC.half + SPEC.wallT + SPEC.walk - 0.5), SPEC.quayY + 0.3, z + (sgn > 0 ? 6 : 0),
      ]);
      lamps.push(l);
      root.add(l);
    }
  }


  const thinTagged = tagThinMembers(root, {
    torusTubeMax: 0.36, tubeRadiusMax: 0.26, cylRadiusMax: 0.3, boxMinAxis: 0.2,
  });
  if (opts.outline !== false) {
    const targets = [];
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.material?.userData?.family === 'emissive') return;
      if (o.userData.noOutline) return;
      const geo = o.geometry;
      if (!geo) return;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      if ((geo.boundingSphere?.radius ?? 0) > 400) return;
      targets.push(o);
    });
    for (const m of targets) addOutline(m);
    root.userData.outlinedCount = targets.length;
  }
  root.userData.thinTagged = thinTagged;

  root.userData.parts = {
    SPEC, walls, promenades, outfalls, stairs, lamps,
    setNight(on) {
      const k = on ? 1 : 0.3;
      MT.lampWarm.color.copy(C.lampWarm).multiplyScalar(1.7 * k);
    },
  };
  return root;
}

export default { build, SPEC };
