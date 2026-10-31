/**
 * bridge_roll.js — ⑧ 开启桥「**滚开式可动钢桁架**」版（v9.4 新增，用户指定方向）
 *
 * ============================================================================
 * 与既有 bridge.js（仰开式）的关系
 * ============================================================================
 * bridge.js 是**仰开叶 + 门式框架**（保留不动）。本文件是**另一个版本**，供拍板对比：
 *   「不用仰开叶，改成沿轨道水平滚开的两扇钢桁架，没有竖起来的构件」—— 用户原话
 *
 * 机构 = **Scherzer 滚动开启桥（rolling lift / 滚开式）**，三个必须做对的点：
 *   ① 桥叶不是绕固定铰点转，而是**边转边沿轨道后退**：枢轴水平位移 = R·θ
 *      （R = 滚弧半径，θ = 转角）。这是"滚开"与"仰开"的本质区别。
 *   ② 滚弧（quadrant）是桥叶后下方的一段圆弧齿板，**始终有且仅有一点落在水平轨道上**；
 *      随桥叶转动，接触点在齿弧上的局部角从 270° 走到 270°+θ。
 *   ③ 配重挂在枢轴后侧，**开桥时下落入桥台凹槽** —— 所以桥台要开槽，不需要任何塔架。
 *
 * 【可读性约束（本版重写的原因）】
 *   第一版把滚弧埋进了桥台石体里 —— 而"滚"恰恰是这一版唯一的卖点。
 *   本版桥台做成**开放凹槽**：石作用低矮基座 + 后壁 + 内侧壁，**滚弧与滚轨走在槽的
 *   外侧空档里**，从侧面/俯视都能看到弧板、齿、滚轮与下落的配重。
 *   动力装置移到**引道桥面下方**，保证"桥面以上 0 构件"这句话是真的。
 *
 * 关键运动学（本文件唯一真值来源）：
 *   θ        = min(1, openT) · openDeg
 *   枢轴 x    = ±(span/2 + R·θ)        ← 后退量 = R·θ
 *   桥叶转角   = −θ（两侧同号，靠 rotation.y 镜像朝向）
 *   接触点局部角 = 270° + θ
 */
import * as THREE from 'three';
import { C, BANDS } from '../core/palette.js';
import { M, lamp, toon, makeSignal } from '../core/materials.js';
import { applyWall } from '../core/textures.js';
import { H, CANAL } from '../core/scale.js';
import {
  bevelBox, boxGeo, cylGeo, sphereGeo, coneGeo,
  rivets, pipe, addOutline,
  strutBetween, updateStrut, unitStrut, tagThinMembers,
} from '../core/primitives.js';

export const SPEC = {
  span: 18,                    // m 通航净跨
  leafLen: 9.2,                // m 单叶长（中央留 0.4 咬合）
  deckW: 9.36,                 // m 桥面宽
  deckT: 0.42,                 // m 桥面板厚
  deckY: CANAL.quayY + 0.60,   // m 桥面顶标高 = 2.8
  trussH: 2.30,                // m 下承式桁架高
  quadrantR: 1.50,             // m 滚弧半径（决定后退行程 = R·θ）
  bays: 6,                     // 桁架节间数
  openDeg: 70,                 // °
  openRate: 5.6,               // °/s → 12.5 s
  quayY: CANAL.quayY,          // 2.2 堤顶
  roadW: 6.60,                 // m 车行道（双车道）
  walkW: 1.38,                 // m 人行道（单侧）
  kerb: 0.14,
  approachEnd: 17.6,           // m 引道外端（要盖住挂在引道下方的动力装置）
};

/** 桥台外缘 x（要容下整个后退行程 + 动力装置） */
export const ABUT_OUT = SPEC.span / 2 + SPEC.quadrantR * THREE.MathUtils.degToRad(SPEC.openDeg) + 1.9;

/** 枢轴标高（滚弧圆心） */
const PIVOT_Y = SPEC.deckY - SPEC.deckT / 2;
/** 滚弧接触点所在的轨道面标高 */
const TRACK_Y = PIVOT_Y - SPEC.quadrantR;
/** 最大后退行程 = R·θmax */
const ROLL_MAX = SPEC.quadrantR * THREE.MathUtils.degToRad(SPEC.openDeg);
/** 主桁架所在的 z 平面（滚弧也在这一平面，便于"看得穿"） */
const BZ = SPEC.deckW / 2 - 0.18;

function makeMaterials() {
  return {
    stone: M.stone({ bands: [0.22, 0.5, 0.92], outlineWidth: 0.03 }),
    stoneDark: M.stone({ color: new THREE.Color('#4A453E'), bands: [0.2, 0.46, 0.9], outlineWidth: 0.028 }),
    truss: M.iron({ color: new THREE.Color('#39424A'), bands: [0.24, 0.54, 1.0], outlineWidth: 0.03 }),
    trussDeep: M.iron({ color: new THREE.Color('#242B31'), bands: [0.22, 0.5, 0.98], outlineWidth: 0.028 }),
    steel: M.iron({ color: new THREE.Color('#5A626B'), bands: [0.26, 0.58, 1.0], outlineWidth: 0.028 }),
    iron: M.iron({ bands: [0.26, 0.58, 1.0], outlineWidth: 0.028 }),
    ironDark: M.iron({ color: C.ironLo, bands: [0.24, 0.52, 0.96], outlineWidth: 0.026 }),
    brass: M.brass({ bands: BANDS.metal, outlineWidth: 0.03 }),
    brassDark: M.brass({ color: C.brassLo, bands: BANDS.metal, outlineWidth: 0.028 }),
    bronze: M.bronze({ bands: BANDS.metal, outlineWidth: 0.03 }),
    copper: M.bronze({ color: new THREE.Color('#A55F3A'), bands: BANDS.metal, outlineWidth: 0.026 }),
    verdigris: M.verdigris({ bands: BANDS.metal, outlineWidth: 0.024 }),
    wood: M.wood({ bands: [0.26, 0.56, 1.0], outlineWidth: 0.024 }),
    ceramic: M.stone({ color: new THREE.Color('#DCD5C6'), bands: [0.3, 0.6, 1.0], outlineWidth: 0.012 }),
    /** 桥面铺装：车行道与街道同族（都是车行道），人行道用方石 */
    roadSlab: applyWall(M.stone({ bands: [0.3, 0.62, 1.0], outline: false }), 'settFan', [1.4, 7]),
    walkSlab: applyWall(M.stone({ bands: [0.3, 0.62, 1.0], outline: false }), 'stoneBlock', [0.6, 8]),
    stripeDark: toon(new THREE.Color('#1E2024'), { bands: [0.3, 0.62, 1.0], outline: false }),
    stripeWarm: toon(new THREE.Color('#D8A93A'), { bands: [0.34, 0.68, 1.0], outline: false }),
    lampWarm: lamp(C.lampWarm, 1.6),
    lampRed: lamp(new THREE.Color('#C8433A'), 2.0),
  };
}

// ===========================================================================
// 桥叶：下承式钢桁架 + 桥面 + 后下方滚弧齿板 + 配重 + 滚轮 + 驱动耳板
// 局部坐标：枢轴在原点；**桥面向 local −x 延伸**（朝航道）；后侧为 local +x
// ===========================================================================
function buildLeaf(MT, sgn) {
  const g = new THREE.Group();
  g.name = `RollLeaf_${sgn > 0 ? 'E' : 'W'}`;
  // ★ 局部 −x = 桥面延伸方向（朝向航道）。西叶必须绕 y 转 180°，
  //   否则桥面朝**外侧**伸出、直接压在引道上（扫掠审计抓到；第一版漏了这一行）。
  //   pose() 只改 rotation.z，rotation.y 只在这里设一次。
  if (sgn < 0) g.rotation.y = Math.PI;
  const L = SPEC.leafLen, W = SPEC.deckW, R = SPEC.quadrantR, TH = SPEC.trussH;
  const bz = BZ;
  const xT = -L;                            // 桥叶外端（朝航道）
  const xH = 0;                             // 铰侧
  const bays = SPEC.bays;
  const bx = (xT - xH) / bays;              // 节间长（负）

  // ---------------------------------------------------------- 桥面板 + 铺装
  const deckCx = (xT + xH) / 2 - 0.125;
  const deck = new THREE.Mesh(boxGeo(L - 0.25, SPEC.deckT, W), MT.trussDeep);
  deck.position.set(deckCx, 0.21, 0);
  deck.castShadow = true;
  deck.receiveShadow = true;
  g.add(deck);
  const road = new THREE.Mesh(boxGeo(L - 0.25, 0.05, SPEC.roadW), MT.roadSlab);
  road.position.set(deckCx, SPEC.deckT / 2 + 0.005, 0);
  road.userData.noOutline = true;
  road.receiveShadow = true;
  g.add(road);
  for (const sz of [-1, 1]) {
    const walk = new THREE.Mesh(boxGeo(L - 0.25, 0.06, SPEC.walkW), MT.walkSlab);
    walk.position.set(deckCx, SPEC.deckT / 2 + 0.02, sz * (W / 2 - SPEC.walkW / 2 - 0.05));
    walk.userData.noOutline = true;
    g.add(walk);
    const kerb = new THREE.Mesh(boxGeo(L - 0.25, SPEC.kerb, 0.16), MT.stone);
    kerb.position.set(deckCx, SPEC.deckT / 2 + 0.07, sz * (SPEC.roadW / 2 + 0.06));
    g.add(kerb);
    // 栏杆（两侧，人行道外缘）
    const rz = sz * (W / 2 - 0.05);
    for (const y of [H.railH * 0.55, H.railH]) {
      strutBetween(g, [xT + 0.2, SPEC.deckT / 2 + y, rz], [xH - 0.1, SPEC.deckT / 2 + y, rz],
        { radius: 0.042, mat: MT.brass, name: 'Railing' });
    }
    for (let i = 0; i <= bays; i++) {
      const px = xH + bx * i;
      strutBetween(g, [px, SPEC.deckT / 2, rz], [px, SPEC.deckT / 2 + H.railH, rz],
        { radius: 0.036, mat: MT.brassDark, name: 'RailPost' });
    }
  }
  for (const d of [-0.16, 0.16]) {
    const line = new THREE.Mesh(boxGeo(L - 0.3, 0.012, 0.06), MT.stripeWarm);
    line.position.set(deckCx, SPEC.deckT / 2 + 0.032, d);
    line.userData.noOutline = true;
    g.add(line);
  }

  // ------------------------------------------------------- 下承式主桁架（两侧）
  for (const sz of [-1, 1]) {
    const z = sz * bz;
    const bot = new THREE.Mesh(boxGeo(L, 0.28, 0.24), MT.truss);
    bot.position.set(deckCx + 0.125, -0.05, z);
    bot.castShadow = true;
    g.add(bot);
    const top = new THREE.Mesh(boxGeo(L, 0.26, 0.26), MT.truss);
    top.position.set(deckCx + 0.125, TH, z);
    top.castShadow = true;
    g.add(top);
    for (let i = 0; i <= bays; i++) {
      const px = xH + bx * i;
      strutBetween(g, [px, 0.08, z], [px, TH - 0.08, z], { radius: 0.10, mat: MT.truss, name: 'Vert' });
      if (i < bays) {
        const nx = xH + bx * (i + 1);
        const dir = i % 2 === 0;
        strutBetween(g, [dir ? px : nx, 0.08, z], [dir ? nx : px, TH - 0.08, z],
          { radius: 0.095, mat: MT.truss, name: 'Diag' });
      }
      // 节点板（黄铜，让"节点"读得出来）
      const gp = new THREE.Mesh(bevelBox(0.40, 0.40, 0.30, 0.03, 2), MT.brassDark);
      gp.position.set(px, 0.06, z);
      g.add(gp);
      const gp2 = gp.clone();
      gp2.position.y = TH - 0.04;
      g.add(gp2);
      // 上弦横梁
      strutBetween(g, [px, TH, -bz], [px, TH, bz], { radius: 0.075, mat: MT.trussDeep, name: 'TopBeam' });
    }
  }
  // 上弦平面 X 撑（铰侧两节间）
  for (let i = 0; i < 2; i++) {
    const a = xH + bx * i, b = xH + bx * (i + 1);
    strutBetween(g, [a, TH, -bz], [b, TH, bz], { radius: 0.055, mat: MT.trussDeep, name: 'TopX' });
    strutBetween(g, [a, TH, bz], [b, TH, -bz], { radius: 0.055, mat: MT.trussDeep, name: 'TopX' });
  }
  // 端门架
  for (const ex of [xT, xH]) {
    strutBetween(g, [ex, TH + 0.14, -bz], [ex, TH + 0.14, bz], { radius: 0.085, mat: MT.truss, name: 'Portal' });
    const kx = ex + (ex < 0 ? 0.55 : -0.55);
    strutBetween(g, [ex, TH + 0.14, -bz], [kx, TH - 0.45, -bz], { radius: 0.06, mat: MT.trussDeep, name: 'PortalKnee' });
    strutBetween(g, [ex, TH + 0.14, bz], [kx, TH - 0.45, bz], { radius: 0.06, mat: MT.trussDeep, name: 'PortalKnee' });
  }

  // ================= 滚弧齿板（后下方圆弧）：接触点局部角 270° → 270°+θ =================
  const A0 = THREE.MathUtils.degToRad(262);
  const A1 = THREE.MathUtils.degToRad(352);
  for (const sz of [-1, 1]) {
    const z = sz * bz;
    const ring = new THREE.RingGeometry(R - 0.22, R, 34, 1, A0, A1 - A0);
    const arc = new THREE.Mesh(ring, MT.truss);
    arc.position.set(0, 0, z);
    arc.castShadow = true;
    g.add(arc);
    // 内腹板（薄环，读得出是"实体弧板"）
    const web = new THREE.Mesh(new THREE.RingGeometry(R - 0.80, R - 0.26, 28, 1, A0 + 0.05, A1 - A0 - 0.1), MT.trussDeep);
    web.position.set(0, 0, z + sz * 0.02);
    g.add(web);
    // 外缘齿（"滚"的判据）
    const nT = 30;
    for (let k = 0; k <= nT; k++) {
      const a = A0 + (A1 - A0) * (k / nT);
      const tooth = new THREE.Mesh(boxGeo(0.11, 0.14, 0.17), MT.brass);
      tooth.position.set(Math.cos(a) * (R + 0.05), Math.sin(a) * (R + 0.05), z);
      tooth.rotation.z = a - Math.PI / 2;
      g.add(tooth);
    }
    // 径向加劲肋
    for (let k = 0; k <= 5; k++) {
      const a = A0 + (A1 - A0) * (k / 5);
      strutBetween(g, [Math.cos(a) * (R - 0.74), Math.sin(a) * (R - 0.74), z],
        [Math.cos(a) * (R - 0.10), Math.sin(a) * (R - 0.10), z],
        { radius: 0.055, mat: MT.truss, name: 'QuadRib' });
    }
    // 弧板外缘的黄铜包边（读得出"这是导轨面"）
    const rim = new THREE.Mesh(new THREE.RingGeometry(R - 0.045, R + 0.02, 34, 1, A0, A1 - A0), MT.brass);
    rim.position.set(0, 0, z);
    g.add(rim);
  }
  // 弧板之间的横向连系
  for (let k = 0; k <= 3; k++) {
    const a = THREE.MathUtils.degToRad(270) + (THREE.MathUtils.degToRad(348) - THREE.MathUtils.degToRad(270)) * (k / 3);
    const y = Math.sin(a) * (R - 0.4), x = Math.cos(a) * (R - 0.4);
    strutBetween(g, [x, y, -bz], [x, y, bz], { radius: 0.06, mat: MT.trussDeep, name: 'QuadTie' });
  }
  // 滚轮（接触点两侧）
  // ★ 不能刚性固定：接触点在**桥叶局部系**里随 θ 从 270° 走到 270°+θ，
  //   所以每帧要把滚轮摆到局部角 φ = 270°+θ（半径 R-0.17，使轮底正好落在轨道面）。
  //   固定不动的话轮子会随桥叶一起上飘 —— 实测最低点 1.09 → 1.90 m，离开轨面 0.81 m。
  const rollers = [];
  for (const sz of [-1, 1]) {
    const roll = new THREE.Mesh(cylGeo(0.17, 0.17, 0.30, 14), MT.bronze);
    roll.rotation.x = Math.PI / 2;
    roll.name = 'Roller';
    g.add(roll);
    const hub = new THREE.Mesh(cylGeo(0.075, 0.075, 0.38, 10), MT.brass);
    hub.rotation.x = Math.PI / 2;
    g.add(hub);
    rollers.push({ roll, hub, z: sz * bz });
  }

  // ------------------------------- 配重（枢轴后侧，开桥时下落入桥台凹槽）
  const cw = new THREE.Group();
  cw.name = 'Counterweight';
  const cwW = 1.10, cwH = 1.00, cwD = W * 0.54;   // 内壁内移后要相应收窄
  const cwBox = new THREE.Mesh(bevelBox(cwW, cwH, cwD, 0.07, 2), MT.ironDark);
  cwBox.castShadow = true;
  cw.add(cwBox);
  rivets(cw, {
    from: [-cwW / 2 + 0.09, cwH / 2 - 0.05, cwD / 2],
    to: [cwW / 2 - 0.09, cwH / 2 - 0.05, cwD / 2],
    spacing: 0.16, normal: [0, 1, 0], mat: MT.brassDark,
  });
  for (const dz of [-cwD / 2 + 0.06, cwD / 2 - 0.06]) {
    const band = new THREE.Mesh(boxGeo(cwW + 0.05, 0.07, 0.05), MT.brass);
    band.position.set(0, 0, dz);
    cw.add(band);
  }
  const cwEye = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.03, 6, 12), MT.brass);
  cwEye.position.set(0, cwH / 2 + 0.12, 0);
  cw.add(cwEye);
  cw.position.set(1.00, -0.90, 0);
  g.add(cw);
  for (const sz of [-1, 1]) {
    strutBetween(g, [0.08, 0.60, sz * (W * 0.30)], [0.96, -0.38, sz * (W * 0.30)],
      { radius: 0.075, mat: MT.brass, name: 'CwHanger' });
  }

  // ---------------- 驱动耳板：装在**滚弧板外侧**（液压缸在桁架面之外推它）
  const lugs = [];
  for (const sz of [-1, 1]) {
    const lug = new THREE.Group();
    lug.name = 'DriveLug';
    // 液压缸与耳板必须在**桥叶最外缘（栏杆 z ±4.63 / 桥面 z ±4.68）之外**
    lug.position.set(0.86, -1.62, sz * (bz + 0.80));
    const plate = new THREE.Mesh(boxGeo(0.30, 0.34, 0.10), MT.bronze);
    lug.add(plate);
    const pin = new THREE.Mesh(cylGeo(0.06, 0.06, 0.36, 10), MT.brass);
    pin.rotation.x = Math.PI / 2;
    lug.add(pin);
    g.add(lug);
    lugs.push(lug);
    // 托臂：把耳板连回滚弧板（否则耳板悬空 0.8 m）
    for (const dy of [-0.12, 0.12]) {
      strutBetween(g, [0.86 + dy, -1.62, sz * (bz + 0.02)], [0.86 + dy, -1.62, sz * (bz + 0.78)],
        { radius: 0.055, mat: MT.iron, name: 'LugArm' });
    }
  }

  return {
    g, sgn, rollers, cw, lugs,
    pose(openT) {
      const th = THREE.MathUtils.clamp(openT, 0, 1) * THREE.MathUtils.degToRad(SPEC.openDeg);
      g.rotation.z = -th;
      // ★ "滚开"的定义：枢轴沿轨道后退 R·θ
      g.position.x = sgn * (SPEC.span / 2 + SPEC.quadrantR * th);
      // 滚轮：① 摆到接触点（局部角 270°+θ）② 纯滚动自转
      const phi = -Math.PI / 2 + th;                 // 270° = -π/2
      const rad = SPEC.quadrantR - 0.17;
      for (const r of rollers) {
        const px = Math.cos(phi) * rad, py = Math.sin(phi) * rad;
        r.roll.position.set(px, py, r.z);
        r.hub.position.set(px, py, r.z);
        r.roll.rotation.y = -sgn * (SPEC.quadrantR * th) / 0.17;
      }
      return th;
    },
  };
}

// ===========================================================================
// 桥台：**开放凹槽**（低矮基座 + 后壁 + 内侧壁）＋ 外露滚轨 ＋ 槽外液压缸
// 设计要点：石作不覆盖滚弧所在的 z 平面（±BZ），滚弧与滚轨走在槽外侧空档里
// ===========================================================================
function buildAbutment(MT, sgn) {
  const g = new THREE.Group();
  g.name = `RollAbutment_${sgn > 0 ? 'E' : 'W'}`;
  const x0 = sgn * (SPEC.span / 2);          // 槽的内缘（靠航道）
  const xOut = sgn * ABUT_OUT;               // 槽的外缘
  const cx = (x0 + xOut) / 2;
  const depth = Math.abs(xOut - x0);
  const W = SPEC.deckW;
  // 内侧壁外表面：必须让开桥叶下弦（z ±4.38~4.62）与桥面板边（±4.68）——
  // 第一版取 BZ-0.45 = ±4.23，桥叶转到 70° 时下弦扫过内壁（扫掠审计抓到）
  const innerZ = BZ - 0.85;                  // = ±3.65

  // ---- 基座（坐在水里，低矮：顶面低于滚轨，绝不遮挡滚弧）----
  // 坑底要够深：配重随桥叶下滑的最低点约 y 0.55 ⇒ 坑底必须低于它
  const PIT_FLOOR_Y = TRACK_Y - 1.20;          // = -0.11
  const base = new THREE.Mesh(boxGeo(depth + 1.4, 4.0, W + 1.0), MT.stone);
  base.position.set(cx, PIT_FLOOR_Y - 2.0, 0);
  base.castShadow = true;
  base.receiveShadow = true;
  g.add(base);
  const floor = new THREE.Mesh(boxGeo(depth + 1.4, 0.18, W + 1.0), MT.stoneDark);
  floor.position.set(cx, PIT_FLOOR_Y - 0.09, 0);
  floor.receiveShadow = true;
  g.add(floor);

  // ---- 槽的内侧壁（两片，位于滚弧平面之内，不挡滚弧）----
  // 内壁顶面就压在堤顶标高：再高就会被桥叶的顶部桁架扫到
  const wallH = SPEC.quayY - (TRACK_Y - 0.5);   // 底 TRACK_Y-0.5 → 顶 quayY
  for (const sz of [-1, 1]) {
    const wall = new THREE.Mesh(boxGeo(depth, wallH, 0.50), MT.stone);
    wall.position.set(cx, (TRACK_Y - 0.5) + wallH / 2, sz * innerZ);
    wall.castShadow = true;
    wall.receiveShadow = true;
    g.add(wall);
    for (let i = 0; i <= 4; i++) {
      const px = x0 + sgn * (depth * i / 4);
      const pil = new THREE.Mesh(boxGeo(0.34, wallH - 0.1, 0.16), MT.stoneDark);
      pil.position.set(px, (TRACK_Y - 0.5) + (wallH - 0.1) / 2, sz * (innerZ + 0.32));
      g.add(pil);
    }
  }
  // ---- 槽的后壁（外端）----
  // 后壁拆成两片（只占内壁所在的 z 平面）—— 整幅横跨全宽会把桥叶的桁架平面圈进去
  for (const sz of [-1, 1]) {
    const back = new THREE.Mesh(boxGeo(0.9, wallH, 0.50), MT.stone);
    back.position.set(xOut - sgn * 0.45, (TRACK_Y - 0.5) + wallH / 2, sz * innerZ);
    back.castShadow = true;
    back.receiveShadow = true;
    g.add(back);
  }
  // ---- 压顶石（只压在槽内壁与后壁上，**不覆盖滚弧平面**）----
  for (const sz of [-1, 1]) {
    const cop = new THREE.Mesh(boxGeo(depth, 0.34, 0.85), MT.stone);
    cop.position.set(cx, SPEC.quayY + 0.17, sz * innerZ);
    cop.receiveShadow = true;
    cop.castShadow = true;
    g.add(cop);
    strutBetween(g, [x0 + sgn * 0.10, SPEC.quayY - 1.5, sz * (innerZ + 0.42)],
      [x0 + sgn * 0.10, SPEC.quayY + 0.34, sz * (innerZ + 0.42)],
      { radius: 0.075, mat: MT.brassDark, name: 'CornerAngle' });
  }
  for (const sz of [-1, 1]) {
    const copBack = new THREE.Mesh(boxGeo(1.2, 0.34, 0.85), MT.stone);
    copBack.position.set(xOut - sgn * 0.55, SPEC.quayY + 0.17, sz * innerZ);
    copBack.receiveShadow = true;
    g.add(copBack);
  }

  // ---- 槽外侧的低挡墙（只做在 |z| > 桁架平面之外，绝不进桥叶扫掠区）----
  for (const sz of [-1, 1]) {
    const side = new THREE.Mesh(boxGeo(depth + 1.4, 0.85, 0.45), MT.stoneDark);
    side.position.set(cx, PIT_FLOOR_Y + 0.43, sz * (BZ + 1.35));
    side.receiveShadow = true;
    g.add(side);
  }

  // ---- 滚轨：托梁（低矮）＋ 钢轨 ＋ 齿条，走在滚弧所在平面 ----
  const trackX0 = x0 + sgn * 0.25, trackX1 = xOut - sgn * 1.35;
  const trackCx = (trackX0 + trackX1) / 2;
  const trackLen = Math.abs(trackX1 - trackX0);
  for (const sz of [-1, 1]) {
    const z = sz * BZ;
    const beam = new THREE.Mesh(boxGeo(trackLen, 0.26, 0.52), MT.steel);
    beam.position.set(trackCx, TRACK_Y - 0.24, z);
    beam.castShadow = true;
    g.add(beam);
    const nSup = Math.max(2, Math.round(trackLen / 1.1));
    for (let i = 0; i <= nSup; i++) {
      const px = trackX0 + sgn * (trackLen * i / nSup);
      strutBetween(g, [px, TRACK_Y - 0.36, z], [px, TRACK_Y - 1.35, z],
        { radius: 0.075, mat: MT.iron, name: 'TrackBracket' });
    }
    const rail = new THREE.Mesh(boxGeo(trackLen, 0.10, 0.22), MT.brass);
    rail.position.set(trackCx, TRACK_Y - 0.06, z);
    g.add(rail);
    const nRack = Math.round(trackLen / 0.26);
    for (let i = 0; i <= nRack; i++) {
      const rx = trackX0 + sgn * (trackLen * i / nRack);
      const tooth = new THREE.Mesh(boxGeo(0.10, 0.11, 0.30), MT.brassDark);
      tooth.position.set(rx, TRACK_Y - 0.17, z);
      g.add(tooth);
    }
    for (const ex of [trackX0 - sgn * 0.2, trackX1 + sgn * 0.2]) {
      const stop = new THREE.Mesh(bevelBox(0.32, 0.40, 0.62, 0.04, 2), MT.ironDark);
      stop.position.set(ex, TRACK_Y - 0.12, z);
      g.add(stop);
    }
  }
  const nCross = Math.max(2, Math.round(trackLen / 0.9));
  for (let i = 0; i <= nCross; i++) {
    const px = trackX0 + sgn * (trackLen * i / nCross);
    // 横梁只在两侧（中间要留给配重下落 —— 整根横跨会被配重撞到）
    strutBetween(g, [px, TRACK_Y - 0.34, -BZ], [px, TRACK_Y - 0.34, -3.05],
      { radius: 0.06, mat: MT.ironDark, name: 'TrackCross' });
    strutBetween(g, [px, TRACK_Y - 0.34, 3.05], [px, TRACK_Y - 0.34, BZ],
      { radius: 0.06, mat: MT.ironDark, name: 'TrackCross' });
  }

  // ---- 液压缸（在桁架面之外、滚弧板上方）----
  const cylY = TRACK_Y + 0.62;
  const cylZ = BZ + 0.80;                      // 让开桥叶栏杆（z ±4.63）与桥面板边（±4.68）
  const cylX = xOut - sgn * 1.95;
  const ram = new THREE.Group();
  ram.name = 'RollRam';
  for (const sz of [-1, 1]) {
    const barrel = new THREE.Mesh(cylGeo(0.19, 0.19, 1.45, 14), MT.steel);
    barrel.rotation.z = Math.PI / 2;
    barrel.position.set(cylX - sgn * 0.72, cylY, sz * cylZ);
    barrel.castShadow = true;
    ram.add(barrel);
    const gland = new THREE.Mesh(cylGeo(0.235, 0.215, 0.20, 14), MT.brass);
    gland.rotation.z = Math.PI / 2;
    gland.position.set(cylX + sgn * 0.05, cylY, sz * cylZ);
    ram.add(gland);
    const anchor = new THREE.Mesh(bevelBox(0.36, 0.52, 0.46, 0.04, 2), MT.ironDark);
    anchor.position.set(cylX - sgn * 1.52, cylY, sz * cylZ);
    ram.add(anchor);
    strutBetween(ram, [cylX - sgn * 1.52, cylY - 0.28, sz * cylZ], [cylX - sgn * 1.52, TRACK_Y - 0.5, sz * (cylZ - 0.1)],
      { radius: 0.09, mat: MT.iron, name: 'RamPedestal' });
  }
  g.add(ram);

  // ---- 液压动力装置：卧式蓄能器（**压在桥面标高以下**）----
  const acc = new THREE.Group();
  acc.name = 'RollPowerPack';
  // 动力装置挂在**引道桥面下方**：桥台内已无空位（配重与滚弧要占满），
  // 且这样顶面天然低于桥面标高 2.8 ⇒ "桥面以上 0 构件"这句话成立。
  const accZ = W / 2 - 0.95;
  const accX = sgn * (ABUT_OUT + 1.95);
  const accY = SPEC.deckY - 0.95;               // 罐顶 ≈ 2.13 < 2.8
  for (const sz of [-1, 1]) {
    const tank = new THREE.Mesh(cylGeo(0.28, 0.28, 1.45, 14), MT.verdigris);
    tank.rotation.z = Math.PI / 2;
    tank.position.set(accX, accY, sz * accZ);
    tank.castShadow = true;
    acc.add(tank);
    const cap = new THREE.Mesh(cylGeo(0.16, 0.28, 0.20, 14), MT.brass);
    cap.rotation.z = Math.PI / 2;
    cap.position.set(accX + sgn * 0.82, accY, sz * accZ);
    acc.add(cap);
    for (const dx of [-0.42, 0.42]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.035, 6, 16), MT.brassDark);
      hoop.position.set(accX + dx, accY, sz * accZ);
      hoop.rotation.y = Math.PI / 2;
      acc.add(hoop);
    }
    const gd = new THREE.Mesh(cylGeo(0.12, 0.12, 0.05, 10), MT.brass);
    gd.rotation.x = Math.PI / 2;
    gd.position.set(accX - 0.18, accY, sz * (accZ + 0.30));
    acc.add(gd);
    const gf = new THREE.Mesh(new THREE.CircleGeometry(0.085, 10), MT.brassDark);
    gf.position.set(accX - 0.18, accY, sz * (accZ + 0.335));
    gf.userData.noOutline = true;
    acc.add(gf);
    // 高压管走在桁架平面之外（z 恒定 = cylZ），避免穿过滚弧
    pipe(acc, [
      [-sgn * (ABUT_OUT + 1.55), accY, sz * accZ],
      [cylX - sgn * 1.6, cylY + 0.34, sz * cylZ],
      [cylX, cylY + 0.26, sz * cylZ],
    ], { radius: 0.07, mat: MT.copper, segments: 16, flanges: false, name: 'AccPipe' });
  }
  const skid = new THREE.Mesh(bevelBox(1.9, 0.22, W - 1.4, 0.04, 2), MT.ironDark);
  skid.position.set(accX, accY - 0.36, 0);
  acc.add(skid);
  g.add(acc);

  // ---- 锁定楔（合桥后压住桥叶外端）----
  const wedge = new THREE.Group();
  wedge.name = 'LockWedge';
  const wBody = new THREE.Mesh(bevelBox(0.5, 0.34, 0.9, 0.05, 2), MT.bronze);
  wBody.position.set(x0 + sgn * 0.34, SPEC.deckY + 0.03, -(W / 2 - 0.62));
  wedge.add(wBody);
  const wScrew = new THREE.Mesh(cylGeo(0.07, 0.07, 0.5, 8), MT.brass);
  wScrew.rotation.z = Math.PI / 2;
  wScrew.position.set(x0 + sgn * 0.78, SPEC.deckY + 0.03, -(W / 2 - 0.62));
  wedge.add(wScrew);
  const wHand = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 6, 12), MT.brassDark);
  wHand.position.set(x0 + sgn * 1.05, SPEC.deckY + 0.03, -(W / 2 - 0.62));
  wHand.rotation.y = Math.PI / 2;
  wedge.add(wHand);
  g.add(wedge);

  // ---- 信号灯（低矮灯箱，不是塔）----
  const signal = makeSignal({ size: 0.72, name: 'Signal_' + (sgn > 0 ? 'E' : 'W') });
  signal.position.set(x0 + sgn * 0.62, SPEC.deckY + 0.62, W / 2 + 0.75);
  signal.rotation.y = sgn > 0 ? Math.PI : 0;
  g.add(signal);

  return { g, signal, anchorX: cylX + sgn * 0.10, anchorY: cylY, anchorZ: cylZ };
}

// ===========================================================================
// 主装配
// ===========================================================================
export function build(opts = {}) {
  const MT = makeMaterials();
  const root = new THREE.Group();
  root.name = 'RollingBasculeBridge';

  const leaves = [buildLeaf(MT, 1), buildLeaf(MT, -1)];
  const abutments = [buildAbutment(MT, 1), buildAbutment(MT, -1)];
  // ★ 桥叶的局部原点 = 枢轴（滚弧圆心），必须抬到 PIVOT_Y。
  //   第一版只设了 position.x，忘记设 y ⇒ 整片桥叶沉到 y=0，滚弧/滚轮/配重全扎进桥台
  //   （扫掠审计一次报出 104 处干涉，实际根因就这一条）。
  for (const l of leaves) l.g.position.y = PIVOT_Y;
  root.add(...leaves.map((l) => l.g), ...abutments.map((a) => a.g));

  // ---- 液压活塞杆（每叶两根，装在滚弧面之外）----
  const rods = [];
  for (let i = 0; i < 2; i++) {
    const l = leaves[i];
    for (const sz of [-1, 1]) {
      // 活塞杆挂在 root 下：updateStrut() 收的是**世界坐标端点**，
      // 若把它挂在桥叶下，会被桥叶的位移/旋转再变换一次（实测把桥叶 AABB 撑到 x=20.4）
      rods.push({ rod: unitStrut(root, 0.062, MT.brass, 'RollRod'), leaf: l, sgn: l.sgn, sz });
    }
  }

  // ---- 引道（自桥台往外接岸）----
  for (const sgn of [1, -1]) {
    const g = new THREE.Group();
    g.name = `RollApproach_${sgn > 0 ? 'E' : 'W'}`;
    // 引道自桥台外缘再退 1.0 m：桥叶开到 70° 时顶部桁架会伸到 x≈13.0，
    // 引道从这里起就不会被扫到（这 1 m 也正好读作一道伸缩缝）
    const x0 = sgn * (ABUT_OUT + 1.0);
    const x1 = sgn * SPEC.approachEnd;
    const len = Math.abs(x1 - x0);
    if (len > 0.2) {
      const cx = (x0 + x1) / 2;
      const slab = new THREE.Mesh(boxGeo(len, SPEC.deckT, SPEC.deckW), MT.trussDeep);
      slab.position.set(cx, SPEC.deckY - SPEC.deckT / 2, 0);
      slab.receiveShadow = true;
      g.add(slab);
      const surf = new THREE.Mesh(boxGeo(len, 0.05, SPEC.roadW), MT.roadSlab);
      surf.position.set(cx, SPEC.deckY + 0.005, 0);
      surf.userData.noOutline = true;
      g.add(surf);
      const nP = Math.max(1, Math.round(len / 2.2));
      for (const sz of [-1, 1]) {
        const kerb = new THREE.Mesh(boxGeo(len, SPEC.kerb, 0.16), MT.stone);
        kerb.position.set(cx, SPEC.deckY + 0.07, sz * (SPEC.roadW / 2 + 0.06));
        g.add(kerb);
        for (let i = 0; i <= nP; i++) {
          const px = x0 + sgn * (len * i / nP);
          strutBetween(g, [px, SPEC.deckY + 0.14, sz * (SPEC.deckW / 2 - 0.05)],
            [px, SPEC.deckY + 0.14 + H.railH, sz * (SPEC.deckW / 2 - 0.05)],
            { radius: 0.036, mat: MT.brassDark, name: 'AppPost' });
        }
        for (const y of [H.railH * 0.55, H.railH]) {
          strutBetween(g, [x0, SPEC.deckY + 0.14 + y, sz * (SPEC.deckW / 2 - 0.05)],
            [x1, SPEC.deckY + 0.14 + y, sz * (SPEC.deckW / 2 - 0.05)],
            { radius: 0.042, mat: MT.brass, name: 'AppRail' });
        }
      }
    }
    root.add(g);
  }

  // 中缝咬合搭接板
  for (const sgn of [1, -1]) {
    const lip = new THREE.Mesh(boxGeo(0.55, 0.10, SPEC.deckW - 0.7), MT.brass);
    lip.position.set(sgn * 0.12, SPEC.deckY + 0.05, 0);
    root.add(lip);
  }

  // ---- 桥台上的外露齿轮组（随 mecRpm 转，"动力在传"的可读证据）----
  const gearSets = [];
  for (const sgn of [1, -1]) {
    const gz = -(BZ + 0.80);
    const gy = SPEC.quayY + 0.05;
    let gx = ABUT_OUT - 0.75;
    const wheels = [];
    for (const rr of [0.30, 0.21, 0.14]) {
      const w = new THREE.Mesh(cylGeo(rr, rr, 0.09, 14), MT.brassDark);
      w.rotation.x = Math.PI / 2;
      w.position.set(sgn * gx, gy, gz);
      root.add(w);
      const teeth = Math.round(rr * 42);
      for (let k = 0; k < teeth; k++) {
        const a = (k / teeth) * Math.PI * 2;
        const t = new THREE.Mesh(boxGeo(0.04, 0.045, 0.08), MT.brass);
        t.position.set(sgn * gx + Math.cos(a) * (rr + 0.02), gy + Math.sin(a) * (rr + 0.02), gz);
        t.rotation.z = a;
        root.add(t);
      }
      wheels.push(w);
      gx += 0.30 + rr + 0.11;
    }
    const plate = new THREE.Mesh(bevelBox(1.6, 0.24, 0.7, 0.04, 2), MT.ironDark);
    plate.position.set(sgn * (ABUT_OUT - 0.62), gy - 0.30, gz);
    root.add(plate);
    gearSets.push({ wheels, ratios: [1, -0.30 / 0.21, 0.21 / 0.14] });
  }

  tagThinMembers(root, { torusTubeMax: 0.34, tubeRadiusMax: 0.26, cylRadiusMax: 0.3, boxMinAxis: 0.2 });
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

  const abAnchor = { 1: abutments[0], '-1': abutments[1] };
  const st = { openT: 0, openDeg: 0, rollback: 0, signal: 'red', mechRpm: 0 };
  const _tip = new THREE.Vector3();
  const _az = new THREE.Vector3();

  function refreshRods() {
    for (const it of rods) {
      const ab = abAnchor[String(it.sgn)];
      it.leaf.g.updateMatrixWorld(true);
      it.leaf.lugs[it.sz > 0 ? 1 : 0].getWorldPosition(_tip);
      // 西叶绕 y 转了 180° ⇒ 其耳板的世界 z = −局部 z，锚点也要跟着翻
      const zmir = it.sgn < 0 ? -1 : 1;
      _az.set(ab.anchorX, ab.anchorY, zmir * it.sz * ab.anchorZ);   // 缸座（同侧 z）
      updateStrut(it.rod, [_az.x, _az.y, _az.z], [_tip.x, _tip.y, _tip.z]);
    }
  }

  function setOpenT(v) {
    st.openT = THREE.MathUtils.clamp(v, 0, 1);
    st.openDeg = st.openT * SPEC.openDeg;
    st.rollback = st.openT * ROLL_MAX;
    for (const l of leaves) l.pose(st.openT);
    refreshRods();
    const sig = st.openT < 0.02 ? 'red' : (st.openT > 0.985 ? 'green' : 'amber-blink');
    for (const ab of abutments) {
      const p = ab.signal && ab.signal.userData && ab.signal.userData.parts;
      if (p && p.setState) p.setState(sig);
    }
  }
  setOpenT(0);

  root.userData.parts = {
    SPEC, leaves, abutments, state: st, gearSets,
    setOpenT,
    /**
     * 每帧驱动（与既有桥同一套调用签名，便于预览页复用）
     * @param {number} t 秒（绝对时间）
     * @param {object} s { openT, mechRpm }
     */
    drive(t, s = {}) {
      if (s.openT !== undefined) setOpenT(s.openT);
      st.mechRpm = s.mechRpm ?? st.mechRpm;
      for (const ab of abutments) {
        const p = ab.signal && ab.signal.userData && ab.signal.userData.parts;
        if (p && p.tick) p.tick(t);
      }
      const w = (st.mechRpm / 60) * Math.PI * 2;
      for (const gs of gearSets) {
        gs.wheels.forEach((wh, i) => { wh.rotation.z = t * w * gs.ratios[i] * 0.5; });
      }
      return st.mechRpm > 0 ? 1 : 0;
    },
    snapshot() {
      return {
        openT: st.openT,
        openDeg: st.openDeg,
        rollback: st.rollback,
        rollbackMax: ROLL_MAX,
        quadrantR: SPEC.quadrantR,
        pivotX: leaves[0].g.position.x,
        trackY: TRACK_Y,
        signal: st.openT < 0.02 ? 'red' : (st.openT > 0.985 ? 'green' : 'amber'),
        mechRpm: st.mechRpm,
      };
    },
  };
  return root;
}

export default { build, SPEC };
