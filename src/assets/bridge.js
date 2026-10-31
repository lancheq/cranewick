/**
 * bridge.js — ② 开启桥（v9 重做：18 m 净跨 · **通车路桥** · 蒸汽朋克）
 * 见 docs/STYLE_PROMPT.md §4/§6/§7。
 *
 * 用户历次修正（不得回潮）：
 *   · "大桥不要做成古堡的样子，需要通车不要用实心的墙"  ⇒ 无塔、无实心石墙；桥面有车行道+人行道+栏杆；
 *                                                        主体是**外露铆接板梁 + 桁架**，结构看得穿
 *   · "过于哥特式""要蒸汽朋克"                        ⇒ 起桥动力全部外露：液压蓄能器 + 齿轮组 + 配重钢索
 *   · 尺度 18 m 净跨（＝ 4 个车长），桥面宽 9.36，开 70° / 12.5 s
 *
 * 局部坐标：桥轴 = X，跨中 x = 0；水面 y = 0；堤顶 y = 2.2；桥面顶 y = 2.8。
 * 铰点在 x = ±9（堤墙内表面），单叶长 9 m。
 */
import * as THREE from 'three';
import { C, BANDS } from '../core/palette.js';
import { M, lamp, makeSignal, toon } from '../core/materials.js';
import { applyWall } from '../core/textures.js';
import { H, BRIDGE, CANAL } from '../core/scale.js';
import {
  bevelBox, boxGeo, cylGeo, sphereGeo, coneGeo,
  rivets, pipe, railing, truss, gear, gearPair, addOutline,
  strutBetween, updateStrut, unitStrut, bearingBlock, tagThinMembers,
} from '../core/primitives.js';

export const SPEC = {
  span: BRIDGE.clearSpan,        // 18 净跨
  leafLen: BRIDGE.leafLen,       // 9 单叶
  openDeg: BRIDGE.openDeg,       // 70
  openRate: BRIDGE.openRate,     // 5.6 °/s → 12.5 s
  deckW: BRIDGE.deckW,           // 9.36
  deckT: BRIDGE.deckT,           // 0.9
  deckY: BRIDGE.deckY,           // 2.8 桥面顶
  towerH: BRIDGE.towerH,         // 6.4 机械塔架
  cwT: BRIDGE.counterweightT,
  cwTravel: BRIDGE.cwTravel,
  gateDrop: BRIDGE.gateDrop,
  roadW: 6.6,                    // 车行道（双车道）
  walkW: 1.38,                   // 人行道（单侧）
  kerb: 0.14,
  quayY: CANAL.quayY,                        // 2.2 堤顶（原来漏了这个字段 → 全 NaN）
  hingeY: BRIDGE.deckY - BRIDGE.deckT / 2,   // 2.35
  approachEnd: 13.4,             // 引道外端 = 沿河步道外缘
};
SPEC.gateClear = SPEC.span / 2 - 0.2;

function makeMaterials() {
  return {
    block: applyWall(M.stone({ bands: [0.2, 0.48, 0.9], outlineWidth: 0.03 }), 'stoneBlock', [2, 2]),
    blockDark: applyWall(M.stone({ bands: [0.22, 0.5, 0.88], outlineWidth: 0.028 }), 'brickBlue', [3, 2]),
    deckSlab: applyWall(M.stone({ bands: [0.3, 0.62, 1.0], outline: false }), 'stoneBlock', [2.4, 3]),
    iron: M.iron({ bands: [0.26, 0.56, 1.0], outlineWidth: 0.028 }),
    ironDark: M.iron({ color: C.ironLo, bands: [0.24, 0.52, 0.96], outlineWidth: 0.026 }),
    steel: M.iron({ color: new THREE.Color('#5A626B'), bands: [0.26, 0.58, 1.0], outlineWidth: 0.03 }),
    brass: M.brass({ bands: BANDS.metal, outlineWidth: 0.03 }),
    brassDark: M.brass({ color: C.brassLo, bands: BANDS.metal, outlineWidth: 0.028 }),
    bronze: M.bronze({ bands: BANDS.metal, outlineWidth: 0.03 }),
    copper: M.bronze({ color: new THREE.Color('#A55F3A'), bands: BANDS.metal, outlineWidth: 0.026 }),
    wood: M.wood({ bands: [0.26, 0.56, 1.0], outlineWidth: 0.024 }),
    stripeDark: toon(new THREE.Color('#1E2024'), { bands: [0.3, 0.62, 1.0], outline: false }),
    stripeWarm: toon(new THREE.Color('#D8A93A'), { bands: [0.34, 0.68, 1.0], outline: false }),
    // 管廊上的绝缘子：瓷件，浅暖白 —— 之前写成 MT.canvas（本表无此键）⇒ 退化成恒亮默认材质
    ceramic: M.stone({ color: new THREE.Color('#DCD5C6'), bands: [0.3, 0.6, 1.0], outlineWidth: 0.012 }),
    lampWarm: lamp(C.lampWarm, 1.6),
    lampRed: lamp(new THREE.Color('#C8433A'), 2.0),
  };
}

/** 压力表 */
function gauge(parent, pos, MT, face = 0.16) {
  const g = new THREE.Mesh(cylGeo(face, face, 0.07, 12), MT.brass);
  g.rotation.x = Math.PI / 2; g.position.fromArray(pos); parent.add(g);
  const f = new THREE.Mesh(new THREE.CircleGeometry(face * 0.74, 12), MT.lampWarm);
  f.position.set(pos[0], pos[1], pos[2] + 0.05); f.userData.noOutline = true; parent.add(f);
}

// ---------------------------------------------------------------------------
// 桥叶：**外露铆接板梁**（不是实心墙）—— 车行道 + 人行道 + 栏杆
// 局部原点 = 铰点；叶体沿 −dir·X 延伸
// ---------------------------------------------------------------------------
function buildLeaf(MT, dir) {
  const g = new THREE.Group();
  g.name = `Leaf_${dir > 0 ? 'E' : 'W'}`;
  const L = SPEC.leafLen, W = SPEC.deckW, T = SPEC.deckT;

  // 两道纵向主梁（外露钢板梁，带腹板加劲肋）
  for (const z of [-W / 2 + 0.5, 0, W / 2 - 0.5]) {
    const girder = new THREE.Mesh(bevelBox(L - 0.4, T * 0.86, 0.34, 0.06, 2), MT.steel);
    girder.position.set(-dir * L / 2, 0, z);
    girder.castShadow = true;
    g.add(girder);
    // 腹板加劲肋（看得穿的结构）
    const nR = Math.round(L / 1.1);
    for (let i = 0; i <= nR; i++) {
      const bx = -dir * (0.5 + (L - 1.0) * (i / nR));
      strutBetween(g, [bx, -T * 0.42, z], [bx, T * 0.42, z], { radius: 0.05, mat: MT.ironDark, name: 'Stiffener' });
    }
  }
  // 横向次梁
  for (let i = 1; i < 8; i++) {
    const bx = -dir * (L * i) / 8;
    const beam = new THREE.Mesh(boxGeo(0.16, T * 0.6, W - 1.0), MT.ironDark);
    beam.position.set(bx, 0, 0);
    g.add(beam);
  }
  // 底板 + 桥面铺装
  const soffit = new THREE.Mesh(boxGeo(L - 0.2, 0.14, W), MT.ironDark);
  soffit.position.set(-dir * L / 2, -T / 2 + 0.07, 0);
  soffit.userData.noOutline = true;
  g.add(soffit);
  const pave = new THREE.Mesh(boxGeo(L - 0.1, 0.2, SPEC.roadW), MT.deckSlab);
  pave.position.set(-dir * L / 2, T / 2 - 0.1, 0);
  pave.receiveShadow = true;
  pave.castShadow = true;
  g.add(pave);
  // 两侧人行道（比车行道高一个路缘）
  for (const sz of [1, -1]) {
    const walk = new THREE.Mesh(boxGeo(L - 0.1, 0.2, SPEC.walkW), MT.deckSlab);
    walk.position.set(-dir * L / 2, T / 2 - 0.06, sz * (SPEC.roadW / 2 + SPEC.walkW / 2));
    walk.receiveShadow = true;
    g.add(walk);
    const kerb = new THREE.Mesh(boxGeo(L - 0.1, SPEC.kerb + 0.1, 0.16), MT.block);
    kerb.position.set(-dir * L / 2, T / 2 - 0.08, sz * (SPEC.roadW / 2 + 0.08));
    g.add(kerb);
    // 黄铜栏杆（通车路桥必须有）
    const rail = railing(g, L - 0.4, { height: H.railH, radius: 0.045, posts: Math.round(L / 2.4), mat: MT.brass });
    rail.rotation.y = Math.PI / 2;
    rail.position.set(-dir * L / 2, T / 2 + SPEC.walkW * 0 + 0.02, sz * (W / 2 - 0.06));
  }
  // 车道黄铜分道线
  const cl = new THREE.Mesh(boxGeo(L - 0.3, 0.02, 0.08), MT.brassDark);
  cl.position.set(-dir * L / 2, T / 2 + 0.11, 0);
  cl.userData.noOutline = true;
  g.add(cl);

  // 铰轴（贯穿铰点）
  const trunnion = new THREE.Mesh(cylGeo(0.34, 0.34, W + 1.2, 16), MT.bronze);
  trunnion.rotation.x = Math.PI / 2;
  g.add(trunnion);
  for (const sz of [-1, 1]) {
    const plate = new THREE.Mesh(bevelBox(1.2, T + 1.0, 0.22, 0.08, 2), MT.iron);
    plate.position.set(-dir * 0.4, 0, sz * (W / 2 - 0.2));
    g.add(plate);
  }

  // 尾臂（铰点后方，连配重 / 液压缸）
  const tailArm = new THREE.Group();
  tailArm.name = 'TailArm';
  const arm = new THREE.Mesh(bevelBox(2.6, 0.4, 0.5, 0.08, 2), MT.steel);
  arm.position.set(dir * 1.4, -0.5, 0);
  tailArm.add(arm);
  for (const sz of [-1, 1]) {
    strutBetween(tailArm, [0, -0.3, sz * 1.6], [dir * 2.8, -0.7, sz * 1.6], { radius: 0.14, mat: MT.steel, name: 'TailTie' });
  }
  g.add(tailArm);

  g.userData.parts = {
    dir, trunnion, tailArm,
    tailLocal: new THREE.Vector3(dir * 2.8, -0.7, 0),
  };
  return g;
}

// ---------------------------------------------------------------------------
// 机械塔架（取代城堡塔）：四腿铆接钢桁架 + 液压蓄能器 + 齿轮组 + 配重
// ---------------------------------------------------------------------------
function buildPylon(MT, sgn, heavy) {
  const g = new THREE.Group();
  g.name = `Pylon_${sgn > 0 ? 'E' : 'W'}`;
  const Ht = SPEC.towerH;
  const legR = 2.4;
  const cx = sgn * (SPEC.span / 2 + 0.6);

  // -------------------------------------------------------------------------
  // 门式框架（v9.3 重做）
  // 【为什么必须这样】旧版把立柱放在 cx ± 2.4 ⇒ 立柱落在 x = 7.2 处，
  //   而桥叶占 x 0–10、z ±4.68 ⇒ **桥叶旋转时直接穿过立柱**（扫掠审计给出 42 处相交，
  //   10° 就撞）。bascule 桥的机械必须"骑"在桥面两侧之外，不能压在桥叶的扫掠体里。
  // 现在的构造：立柱全部在 |z| = 5.4（桥面半宽 4.68 之外），机构架在铰点外侧。
  // -------------------------------------------------------------------------
  const HtP = SPEC.towerH + 3.6;          // 门架高（要够桥叶抬到 70° 时通过）
  const zLeg = 5.4;                      // 立柱横向位置（桥面 z ±4.68 之外）
  const xIn = cx - sgn * 1.6;            // 内侧柱
  const xOut = cx + sgn * 1.6;           // 外侧柱

  // 基座（石，横跨两侧柱脚）
  // 两块独立基座（分列桥面两侧）—— 整块基座会横跨铰点、压在桥叶扫掠体里（扫掠审计抓到）
  for (const sz of [-1, 1]) {
    // ★ 基座原来 5.2 × 0.9 × 2.0 且中心落在步道上 —— 实测把 3.2 m 宽河堤步道堵掉 2 m。
    //   现在：高度 0.9 → 0.34（读作"矮台"，可以直接迈过去，不是一堵墙），
    //         x 向 5.2 → 3.9 并朝运河侧内收 0.45（让出步道）。
    const pad = new THREE.Mesh(boxGeo(3.9, 0.34, 1.7), MT.blockDark);
    pad.position.set(cx - sgn * 0.45, SPEC.quayY + 0.17, sz * 5.9);
    pad.castShadow = true;
    pad.receiveShadow = true;
    g.add(pad);
  }

  // 四根立柱：两两分列 z = ±5.4，x 分内外两排 → 门式框架
  for (const sz of [-1, 1]) {
    for (const lx of [xIn, xOut]) {
      strutBetween(g, [lx, SPEC.quayY + 0.9, sz * zLeg], [lx, SPEC.quayY + HtP, sz * zLeg],
        { radius: 0.17, mat: MT.steel, name: 'PylonLeg' });
    }
    // 同侧两柱之间的横撑 + X 撑（在 x 方向连接内外两排）
    for (let lvl = 0; lvl < 3; lvl++) {
      const y0 = SPEC.quayY + 0.9 + (HtP * lvl) / 3;
      const y1 = SPEC.quayY + 0.9 + (HtP * (lvl + 1)) / 3;
      strutBetween(g, [xIn, y0, sz * zLeg], [xOut, y0, sz * zLeg], { radius: 0.09, mat: MT.steel, name: 'PylonTie' });
      strutBetween(g, [xIn, y0, sz * zLeg], [xOut, y1, sz * zLeg], { radius: 0.07, mat: MT.brassDark, name: 'PylonBrace' });
      strutBetween(g, [xOut, y0, sz * zLeg], [xIn, y1, sz * zLeg], { radius: 0.07, mat: MT.brassDark, name: 'PylonBrace' });
    }
    // 里侧柱向外的斜撑（落地稳定）
    strutBetween(g, [cx, SPEC.quayY + 0.9, sz * zLeg], [cx + sgn * 3.6, SPEC.quayY + 0.9, sz * zLeg],
      { radius: 0.12, mat: MT.steel, name: 'PylonFoot' });
  }
  // 两道门头横梁（沿 z 跨过桥面正上方，标高高于桥叶 70° 时的最高点）
  const beamY = SPEC.quayY + HtP;
  for (const lx of [xIn, xOut]) {
    strutBetween(g, [lx, beamY, -zLeg], [lx, beamY, zLeg], { radius: 0.2, mat: MT.steel, name: 'PylonBeam' });
  }
  const cap = new THREE.Mesh(bevelBox(4.4, 0.36, zLeg * 2 + 0.8, 0.1, 2), MT.steel);
  cap.position.set(cx, beamY + 0.2, 0);
  cap.castShadow = true;
  g.add(cap);
  rivets(g, { from: [cx - 2.0, beamY + 0.4, zLeg + 0.4], to: [cx + 2.0, beamY + 0.4, zLeg + 0.4], spacing: 0.34, normal: [0, 0, 1], mat: MT.brassDark });

  // —— 机械平台：架在铰点外侧（x = cx + sgn*2.6），桥叶扫掠体之外 ——
  const mcx = cx + sgn * 2.6;
  const plate = new THREE.Mesh(bevelBox(4.6, 0.3, 7.6, 0.1, 2), MT.iron);
  plate.position.set(mcx, SPEC.quayY + 1.5, 0);
  plate.castShadow = true;
  g.add(plate);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      strutBetween(g, [mcx + sx * 1.9, SPEC.quayY + 0.9, sz * 3.3], [mcx + sx * 1.9, SPEC.quayY + 1.5, sz * 3.3],
        { radius: 0.12, mat: MT.steel, name: 'MachPost' });
    }
  }

  // —— 液压蓄能器（立式缸 + 可动重锤滑架 + 顶部滑轮）——
  const accX = mcx - sgn * 1.3, accZ = -1.8;
  const accH = 4.6;
  const accCyl = new THREE.Mesh(cylGeo(0.42, 0.48, accH, 14), MT.steel);
  accCyl.position.set(accX, SPEC.quayY + 0.9 + accH / 2, accZ);
  accCyl.castShadow = true;
  g.add(accCyl);
  for (let k = 1; k <= 3; k++) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 6, 16), MT.brass);
    hoop.position.set(accX, SPEC.quayY + 0.9 + (accH * k) / 4, accZ);
    hoop.rotation.x = Math.PI / 2;
    g.add(hoop);
  }
  const ramGroup = new THREE.Group();
  ramGroup.name = 'AccRam';
  const ramWeight = new THREE.Mesh(bevelBox(1.3, 1.0, 1.3, 0.12, 2), MT.iron);
  ramWeight.castShadow = true;
  ramGroup.add(ramWeight);
  const ramCollar = new THREE.Mesh(cylGeo(0.52, 0.52, 0.3, 14), MT.bronze);
  ramGroup.add(ramCollar);
  ramGroup.position.set(accX, SPEC.quayY + 0.9 + accH + 0.6, accZ);
  g.add(ramGroup);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      strutBetween(g, [accX + sx * 0.72, SPEC.quayY + 0.9, accZ + sz * 0.72],
        [accX + sx * 0.72, SPEC.quayY + 0.9 + accH + 1.6, accZ + sz * 0.72],
        { radius: 0.07, mat: MT.iron, name: 'AccGuide' });
    }
  }
  const sheave = new THREE.Mesh(cylGeo(0.4, 0.4, 0.2, 14), MT.bronze);
  sheave.rotation.x = Math.PI / 2;
  sheave.position.set(accX, SPEC.quayY + 0.9 + accH + 1.9, accZ);
  g.add(sheave);
  gauge(g, [accX + 0.55, SPEC.quayY + 0.9 + accH * 0.6, accZ + 0.2], MT, 0.14);

  // —— 齿轮组（24/18/12，节圆相切）+ 轴承座 ——
  const gearY = SPEC.quayY + 2.6, gearZ = 3.2;   // 摆臂在 z=±1.6，齿轮组必须在它之外
  const m = 0.1, teeth = [24, 18, 12];
  const gr = teeth.map((t) => (m * t) / 2);
  let gx = mcx - sgn * 1.6;
  const gearWheels = [];
  for (let i = 0; i < teeth.length; i++) {
    const w = gear(g, teeth[i], { module: m, thickness: 0.34, pos: [gx, gearY, gearZ], name: `Gear_${teeth[i]}T` });
    w.userData.teeth = teeth[i];
    gearWheels.push(w);
    bearingBlock(g, { shaftRadius: 0.18, height: 0.4, pos: [gx, gearY - 0.42, gearZ] });
    gx += sgn * (gr[i] + (gr[i + 1] ?? 0) + 0.006 * (i + 1));   // 向外侧走，不能朝桥叶方向
  }
  // 齿轮护罩（半开，露一半）
  const guard = new THREE.Mesh(boxGeo(3.4, 2.2, 0.14), MT.steel);
  guard.position.set(mcx + sgn * 0.6, gearY + 0.9, gearZ + 0.5);
  guard.userData.noOutline = true;
  g.add(guard);
  // 液压缸 → 桥叶尾臂（行程实时重算）
  const cylBody = new THREE.Mesh(cylGeo(0.26, 0.3, 2.2, 12), MT.bronze);
  cylBody.position.set(mcx - sgn * 1.6, SPEC.quayY + 2.0, 1.6);
  g.add(cylBody);
  const pistonRod = unitStrut(g, 0.1, MT.brass, 'PistonRod');
  // 配重（与桥叶尾臂刚性联动）
  const cwGroup = new THREE.Group();
  cwGroup.name = 'Counterweight';
  const cwBody = new THREE.Mesh(bevelBox(1.5, 1.5, 1.5, 0.14, 2), MT.iron);
  cwBody.castShadow = true;
  cwGroup.add(cwBody);
  cwGroup.position.set(mcx + sgn * 1.5, SPEC.quayY + 0.9 + 3.2, 2.0);
  g.add(cwGroup);
  // 配重导轨
  for (const sx of [-1, 1]) {
    strutBetween(g, [mcx + sgn * 1.5 + sx * 0.9, SPEC.quayY + 1.5, 2.0],
      [mcx + sgn * 1.5 + sx * 0.9, SPEC.quayY + 1.5 + 4.4, 2.0],
      { radius: 0.1, mat: MT.iron, name: 'CwRail' });
  }
  // 蒸汽管 + 阀门手轮
  pipe(g, [
    [accX, SPEC.quayY + 0.9 + accH * 0.2, accZ],
    [accX, SPEC.quayY + 0.6, accZ - 1.2],
    [mcx - sgn * 1.4, SPEC.quayY + 0.9, gearZ - 1.8],
  ], { radius: 0.13, mat: MT.copper, segments: 22, flanges: false, name: 'PylonSteam' });
  for (const vx of [mcx - sgn * 1.8, mcx + sgn * 0.9]) {
    const v = new THREE.Mesh(cylGeo(0.2, 0.2, 0.34, 10), MT.bronze);
    v.position.set(vx, SPEC.quayY + 1.6, gearZ - 1.8);
    g.add(v);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.045, 6, 14), MT.brass);
    wheel.position.set(vx, SPEC.quayY + 2.0, gearZ - 1.8);
    wheel.rotation.x = Math.PI / 2;
    g.add(wheel);
  }
  // 指示灯（装在顶梁上）
  const signal = makeSignal({ size: heavy ? 1.0 : 0.85, name: `Signal_${sgn > 0 ? 'E' : 'W'}` });
  signal.position.set(cx, beamY + 1.3, 0);
  signal.rotation.y = sgn > 0 ? Math.PI : 0;
  g.add(signal);

  g.userData.parts = {
    sgn, cx, gearWheels, ramGroup, sheave, pistonRod, cwGroup,
    cylAnchor: [mcx - sgn * 1.6, SPEC.quayY + 2.0, 1.6],
    rampBaseY: SPEC.quayY + 1.5 + accH + 0.6,
    mcx, beamY, zLeg,
    signal,
  };
  return g;
}

// ---------------------------------------------------------------------------
// 引道 + 封道系统（栏杆 + 警示牌），比 v8 更轻
// ---------------------------------------------------------------------------
function buildApproach(MT, sgn) {
  const g = new THREE.Group();
  g.name = `Approach_${sgn > 0 ? 'E' : 'W'}`;
  const x0 = sgn * (SPEC.span / 2 + 0.6);
  const x1 = sgn * SPEC.approachEnd;
  const len = Math.abs(x1 - x0);
  const cx = (x0 + x1) / 2;
  // 引道板（与桥面等高，缓坡落到堤顶）
  const seg = 4;
  for (let i = 0; i < seg; i++) {
    const t0 = i / seg, t1 = (i + 1) / seg;
    const xa = x0 + (x1 - x0) * t0, xb = x0 + (x1 - x0) * t1;
    const ya = SPEC.deckY - 0.85 + (SPEC.deckY - SPEC.quayY) * (-1 + t0 * 2) * 0;
    const yb = ya;
    const sl = new THREE.Mesh(boxGeo(Math.abs(xb - xa) + 0.2, 0.34, SPEC.deckW), MT.deckSlab);
    sl.position.set((xa + xb) / 2, SPEC.deckY - 0.17, 0);
    sl.receiveShadow = true;
    g.add(sl);
    // 引道侧挡梁
    for (const sz of [1, -1]) {
      const side = new THREE.Mesh(boxGeo(Math.abs(xb - xa) + 0.2, 0.5, 0.16), MT.steel);
      side.position.set((xa + xb) / 2, SPEC.deckY - 0.35, sz * (SPEC.deckW / 2));
      g.add(side);
    }
  }
  // 引道栏杆
  const r1 = railing(g, len * 0.96, { height: H.railH, radius: 0.045, posts: 5, mat: MT.brass });
  r1.position.set(cx, SPEC.deckY + 0.02, SPEC.deckW / 2 - 0.06);
  const r2 = railing(g, len * 0.96, { height: H.railH, radius: 0.045, posts: 5, mat: MT.brass });
  r2.position.set(cx, SPEC.deckY + 0.02, -(SPEC.deckW / 2 - 0.06));
  // 引道下的支墩（看得见结构）
  for (const bx of [x0 + (x1 - x0) * 0.3, x0 + (x1 - x0) * 0.72]) {
    for (const sz of [-1, 1]) {
      strutBetween(g, [bx, SPEC.quayY, sz * (SPEC.deckW / 2 - 0.4)], [bx, SPEC.deckY - 0.34, sz * (SPEC.deckW / 2 - 0.4)],
        { radius: 0.12, mat: MT.steel, name: 'ApproachPost' });
    }
  }

  // 封道栏杆（黄黑斜纹，杆长 6.2）
  const gateX = sgn * (SPEC.span / 2 + 2.4);
  const gate = new THREE.Group();
  gate.name = 'BoomGate';
  gate.position.set(gateX, SPEC.deckY, sgn * 2.6);
  const gBase = new THREE.Mesh(bevelBox(0.7, 0.95, 0.7, 0.1), MT.iron);
  gBase.position.y = 0.48;
  gBase.castShadow = true;
  gate.add(gBase);
  const gCw = new THREE.Mesh(bevelBox(0.55, 0.55, 0.55, 0.08), MT.ironDark);
  gCw.position.set(0, 0.5, sgn * 0.62);
  gate.add(gCw);
  const arm = new THREE.Group();
  arm.name = 'GateArm';
  const armLen = 6.2, nStripe = 11, segL = armLen / nStripe;
  for (let i = 0; i < nStripe; i++) {
    const s = new THREE.Mesh(boxGeo(0.16, 0.16, segL), i % 2 ? MT.stripeWarm : MT.stripeDark);
    s.position.set(0, 0, -sgn * (segL * (i + 0.5)));
    arm.add(s);
  }
  for (let i = 0; i < 3; i++) {
    const lx = new THREE.Mesh(sphereGeo(0.1, 8), MT.lampRed);
    lx.position.set(0.12, 0.13, -sgn * (armLen * (0.25 + i * 0.25)));
    lx.userData.noOutline = true;
    arm.add(lx);
  }
  gate.add(arm);
  g.add(gate);

  // 警示牌（黄铜柱 + 铸铁匾 + 警钟 + 红灯）
  const sx = sgn * (SPEC.span / 2 + 3.4);
  const sign = new THREE.Group();
  sign.name = 'WarningSign';
  sign.position.set(sx, SPEC.deckY, sgn * (SPEC.deckW / 2 + 0.9));
  const post = new THREE.Mesh(cylGeo(0.1, 0.13, 2.3, 10), MT.brass);
  post.position.y = 1.15;
  post.castShadow = true;
  sign.add(post);
  const plate = new THREE.Mesh(bevelBox(1.7, 0.5, 0.09, 0.04), MT.iron);
  plate.position.y = 2.0;
  sign.add(plate);
  const face = new THREE.Mesh(boxGeo(1.55, 0.36, 0.04), MT.brassDark);
  face.position.set(0, 2.0, sgn * 0.06);
  face.userData.noOutline = true;
  sign.add(face);
  const yoke = new THREE.Mesh(boxGeo(0.6, 0.16, 0.16), MT.brassDark);
  yoke.position.y = 2.42;
  sign.add(yoke);
  const bell = new THREE.Group();
  bell.name = 'Bell';
  const bellBody = new THREE.Mesh(coneGeo(0.24, 0.36, 10), MT.bronze);
  bellBody.position.y = -0.18;
  bell.add(bellBody);
  const ball = new THREE.Mesh(sphereGeo(0.06, 8), MT.brass);
  ball.position.y = -0.4;
  bell.add(ball);
  bell.position.set(0, 2.56, 0);
  sign.add(bell);
  const sl = new THREE.Mesh(sphereGeo(0.18, 10), lamp(new THREE.Color('#C8433A'), 0.2));
  sl.position.y = 2.92;
  sl.userData.noOutline = true;
  sign.add(sl);
  g.add(sign);

  g.userData.parts = { gate, bell, signLamp: sl, len, cx };
  return g;
}

// ---------------------------------------------------------------------------
export function build(opts = {}) {
  const MT = makeMaterials();
  const root = new THREE.Group();
  root.name = 'Bridge';

  const leaves = [buildLeaf(MT, 1), buildLeaf(MT, -1)];
  leaves[0].position.set(SPEC.span / 2, SPEC.hingeY, 0);
  leaves[1].position.set(-SPEC.span / 2, SPEC.hingeY, 0);
  const pylons = [buildPylon(MT, 1, true), buildPylon(MT, -1, false)];
  const approaches = [buildApproach(MT, 1), buildApproach(MT, -1)];
  root.add(...leaves, ...pylons, ...approaches);

  // —— 跨桥工业管廊（蒸汽管 + 电报线 + 桁架）——
  const gantry = new THREE.Group();
  gantry.name = 'PipeGantry';
  const span = SPEC.span + 2.4;
  const gy = SPEC.quayY + SPEC.towerH - 1.2;
  truss(gantry, span, 1.1, { thickness: 0.16, bays: 14, mat: MT.steel });
  gantry.position.set(0, gy, -3.6);
  for (const sz of [-0.6, 0.6]) {
    pipe(gantry, [
      [-span / 2, 0.5, sz], [0, 0.5, sz], [span / 2, 0.5, sz],
    ], { radius: 0.16, mat: sz > 0 ? MT.copper : MT.steel, segments: 30, name: 'GantryPipe' });
  }
  for (let i = 0; i < 7; i++) {
    const px = -span / 2 + 2 + (span - 4) * (i / 6);
    const ins = new THREE.Mesh(cylGeo(0.05, 0.07, 0.24, 8), MT.ceramic);
    ins.position.set(px, 1.0, 0.9);
    gantry.add(ins);
  }
  root.add(gantry);

  // 桥体两侧的岸墙接驳（石）
  for (const sgn of [1, -1]) {
    const ab = new THREE.Mesh(boxGeo(2.2, 1.0, SPEC.deckW + 1.6), MT.blockDark);
    ab.position.set(sgn * (SPEC.span / 2 + 1.6), SPEC.deckY - 0.5, 0);
    ab.castShadow = true;
    ab.receiveShadow = true;
    root.add(ab);
  }

  // ---- 性能 + 描边 ----
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

  // ---- 状态驱动 ----
  const st = { leafDeg: 0, cwT: 0, gateT: 0, signal: 'red', mechRpm: 0 };
  const _p = new THREE.Vector3();
  const _tip = new THREE.Vector3();
  const signals = pylons.map((p) => p.userData.parts.signal);

  const setLeafDeg = (deg) => {
    const a = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(deg, 0, SPEC.openDeg));
    for (let i = 0; i < 2; i++) {
      const dir = leaves[i].userData.parts.dir;
      leaves[i].rotation.z = -dir * a;
    }
    st.leafDeg = deg;
  };
  const setCounterweight = () => {
    const k = st.leafDeg / SPEC.openDeg;
    st.cwT = k;
    for (let i = 0; i < 2; i++) {
      const lp = leaves[i].userData.parts, pp = pylons[i].userData.parts;
      pp.cwGroup.position.y = pp.rampBaseY + 1.2 - SPEC.cwTravel * k;
      // 尾臂端点在 root 坐标下的位置
      _p.copy(lp.tailLocal).applyAxisAngle(new THREE.Vector3(0, 0, 1), -lp.dir * THREE.MathUtils.degToRad(st.leafDeg));
      _tip.set(leaves[i].position.x + _p.x, leaves[i].position.y + _p.y, _p.z);
      // 液压缸活塞杆：缸座 → 尾臂端点
      updateStrut(pp.pistonRod, pp.cylAnchor, [_tip.x, _tip.y, _tip.z]);
    }
  };

  const setGateT = (u) => {
    st.gateT = THREE.MathUtils.clamp(u, 0, 1);
    const ang = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(92, 0, st.gateT));
    for (const ap of approaches) {
      const gt = ap.userData.parts.gate;
      gt.children.find((c) => c.name === 'GateArm').rotation.x = -ang * Math.sign(gt.position.z || 1);
      ap.userData.parts.signLamp.material.color.copy(new THREE.Color('#C8433A')).multiplyScalar(st.gateT > 0.05 ? 1.9 : 0.2);
    }
  };

  const setSignal = (s) => {
    st.signal = s;
    for (const sg of signals) sg.userData.parts.setState(s);
  };

  root.userData.parts = {
    SPEC, leaves, pylons, approaches, gantry, signals, state: st,
    setLeafDeg, setCounterweight, setGateT, setSignal,
    setMechRpm(r) { st.mechRpm = r; },
    /**
     * 每帧驱动
     * @param {number} t 秒
     * @param {object} s { leafDeg, gateT, signal, mechRpm, bellSwing }
     */
    drive(t, s = {}) {
      if (s.leafDeg !== undefined) { setLeafDeg(s.leafDeg); setCounterweight(); }
      if (s.gateT !== undefined) setGateT(s.gateT);
      if (s.signal) setSignal(s.signal);
      if (s.mechRpm !== undefined) st.mechRpm = s.mechRpm;
      const rpm = st.mechRpm;
      const ratios = [1, -24 / 18, 24 / 12];
      for (const p of pylons) {
        const pp = p.userData.parts;
        for (let k = 0; k < pp.gearWheels.length; k++) {
          const w = pp.gearWheels[k];
          const ph = k % 2 ? Math.PI / (w.userData.teeth || 18) : 0;
          w.rotation.z = ph + (t * rpm / 60) * Math.PI * 2 * ratios[k] * 0.3;
        }
        pp.sheave.rotation.z = -(t * rpm / 60) * Math.PI * 2 * 0.05;
        pp.ramGroup.position.y = pp.rampBaseY + 0.1 + Math.sin(t * 0.7) * 0.22 * (1 - st.cwT);
      }
      for (const sg of signals) sg.userData.parts.tick(t);
      const bellA = THREE.MathUtils.degToRad(s.bellSwing ?? 0);
      for (const ap of approaches) {
        const b = ap.getObjectByName('Bell');
        if (b) b.rotation.z = bellA * Math.sin(t * Math.PI / 2);
      }
    },
  };
  setLeafDeg(0); setCounterweight(); setGateT(0); setSignal('red');
  return root;
}

export default { build, SPEC };
