/**
 * vehicles.js — 单体资产 ④ 车辆与行人
 * 对应 docs/ART_BIBLE.md 5.4 / 6.4。
 *
 * 局部坐标：车辆沿 +X 前进，轮轴沿 Z；车底（地面）y = 0。
 * 三型车 + 行人：蒸汽马车 / 蒸汽机动车 / 双层公共马车（Omnibus）+ 行人（1.75 m，头身比 1:6.2）
 *
 * 命名可动件（供动画层驱动）：
 *   车辆 parts.wheels[]（绕 Z 转）、parts.steamAnchor（排汽点）
 *   行人 parts.legL / legR / torso / hat / cane
 */
import * as THREE from 'three';
import { C, BANDS } from '../core/palette.js';
import { M, lamp, toon } from '../core/materials.js';
import {
  bevelBox, boxGeo, cylGeo, sphereGeo, coneGeo, mesh,
  rivets, pipe, railing, addOutline, refHuman,
  strutBetween, unitStrut, tagThinMembers,
} from '../core/primitives.js';

// ---------------------------------------------------------------------------
// 规格
// ---------------------------------------------------------------------------
export const SPEC = {
  carriage: { len: 4.2, w: 2.0, h: 2.4, wheelR: 0.9, wheelFrontR: 0.72 },
  motor: { len: 5.6, w: 2.2, h: 2.6, wheelR: 1.1 },
  omnibus: { len: 5.4, w: 2.3, h: 3.6, wheelR: 0.95 },
  person: { h: 1.75, headRatio: 6.2, shuffleAmp: 0.03, shuffleHz: 0.8 },
};

// ---------------------------------------------------------------------------
// 材质
// ---------------------------------------------------------------------------
export function makeMaterials() {
  return {
    wood: M.wood({ bands: [0.26, 0.56, 1.0], outlineWidth: 0.03 }),
    woodDark: M.wood({ color: new THREE.Color('#33210F'), bands: [0.24, 0.52, 0.96], outlineWidth: 0.028 }),
    painted: M.wood({ color: new THREE.Color('#2C3F46'), bands: [0.24, 0.54, 1.0], outlineWidth: 0.03 }),
    paintedRed: M.wood({ color: new THREE.Color('#6E2C26'), bands: [0.24, 0.54, 1.0], outlineWidth: 0.03 }),
    iron: M.iron({ bands: [0.26, 0.56, 1.0], outlineWidth: 0.03 }),
    ironDark: M.iron({ color: C.ironLo, bands: [0.24, 0.52, 0.96], outlineWidth: 0.028 }),
    brass: M.brass({ bands: [0.3, 0.62, 1.0], outlineWidth: 0.032 }),
    brassDark: M.brass({ color: C.brassLo, bands: [0.24, 0.52, 1.0], outlineWidth: 0.03 }),
    bronze: M.bronze({ bands: [0.28, 0.58, 1.0], outlineWidth: 0.03 }),
    rope: M.rope({ outlineWidth: 0 }),
    canvas: M.canvas({ color: new THREE.Color('#B8AE95'), bands: [0.28, 0.6, 0.96], outlineWidth: 0.026 }),
    cloth: M.canvas({ color: new THREE.Color('#4A4148'), bands: [0.26, 0.56, 0.96], outlineWidth: 0.026 }),
    clothLight: M.canvas({ color: new THREE.Color('#8C8378'), bands: [0.28, 0.58, 0.96], outlineWidth: 0.026 }),
    skin: M.canvas({ color: new THREE.Color('#C7A38A'), bands: [0.3, 0.6, 0.96], outlineWidth: 0.024 }),
    hat: M.iron({ color: new THREE.Color('#1D1F24'), bands: [0.26, 0.56, 1.0], outlineWidth: 0.024 }),
fender: toon(new THREE.Color('#2A2D33'), { bands: [0.26, 0.56, 1.0], outlineWidth: 0.028 }),
    lampWarm: lamp(C.lampWarm, 1.6),
    glass: M.glassLamp({ color: C.accentVerdigris, opacity: 0.5 }),
    window: toon(new THREE.Color('#26333A'), { bands: [0.18, 0.42, 0.9], outline: false }),
  };
}

// ---------------------------------------------------------------------------
// 辐条轮（轮轴沿 Z ⇒ 绕 Z 滚动）
// ---------------------------------------------------------------------------
function buildWheel(MT, r, o = {}) {
  const g = new THREE.Group();
  g.name = 'Wheel';
  const spokes = o.spokes ?? 12;
  const w = o.width ?? 0.12;
  // 轮辋
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 8, 28), MT.woodDark);
  rim.castShadow = true;
  g.add(rim);
  // 铁箍
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(r + 0.05, 0.045, 6, 28), MT.ironDark);
  g.add(tyre);
  // 轮毂
  const hub = new THREE.Mesh(cylGeo(0.13, 0.13, w * 2.6, 10), MT.brassDark);
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
  // 辐条（木制，带锥度）
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    strutBetween(g, [Math.cos(a) * 0.16, Math.sin(a) * 0.16, 0],
      [Math.cos(a) * (r - 0.06), Math.sin(a) * (r - 0.06), 0],
      { radius: 0.035, mat: MT.woodDark, name: 'Spoke' });
  }
  g.userData.parts = { r };
  return g;
}

// ---------------------------------------------------------------------------
// 车灯
// ---------------------------------------------------------------------------
function buildCarLamp(MT, o = {}) {
  const g = new THREE.Group();
  g.name = 'CarLamp';
  const body = new THREE.Mesh(coneGeo(0.16, 0.3, 8), MT.brass);
  body.rotation.z = Math.PI / 2;
  g.add(body);
  const lens = new THREE.Mesh(sphereGeo(0.13, 10), MT.lampWarm);
  lens.position.x = 0.16;
  lens.userData.noOutline = true;
  g.add(lens);
  const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.15, 0.14, 10, 1, true), MT.brassDark);
  hood.rotation.z = Math.PI / 2;
  hood.position.x = 0.26;
  g.add(hood);
  const bracket = new THREE.Mesh(boxGeo(0.1, 0.18, 0.1), MT.ironDark);
  bracket.position.x = -0.16;
  g.add(bracket);
  g.userData.parts = { lens };
  return g;
}

/**
 * 给一棵树加反向外壳描边。
 * 阈值与 v8 的 build() 一致（默认 0.9 m 半径）：只给大件加外壳 ——
 * 螺栓/辐条/小装饰加壳视觉无差别，却会让 draw call 翻倍。
 */
function outlineTree(root, threshold = 0.9) {
  const targets = [];
  root.traverse((m) => {
    if (!m.isMesh || m.isInstancedMesh) return;
    if (m.material?.userData?.family === 'emissive') return;
    if (m.userData.noOutline) return;
    const geo = m.geometry;
    if (!geo) return;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const r = (geo.boundingSphere?.radius ?? 0) * Math.max(m.scale.x, m.scale.y, m.scale.z);
    if (r < threshold) return;
    targets.push(m);
  });
  for (const m of targets) addOutline(m);
  return targets.length;
}

// ---------------------------------------------------------------------------
// ① 蒸汽马车
// ---------------------------------------------------------------------------
export function buildCarriage(o = {}) {
  const S = SPEC.carriage;
  const MT = o.materials || makeMaterials();
  const g = new THREE.Group();
  g.name = 'SteamCarriage';

  // 底盘大梁 + 车轴
  const chassisY = S.wheelR + 0.28;
  for (const z of [-S.w / 2 + 0.35, S.w / 2 - 0.35]) {
    const rail = new THREE.Mesh(boxGeo(S.len - 0.3, 0.16, 0.16), MT.ironDark);
    rail.position.set(0, chassisY - 0.1, z);
    g.add(rail);
  }
  const axleF = new THREE.Mesh(cylGeo(0.07, 0.07, S.w), MT.iron);
  axleF.rotation.x = Math.PI / 2;
  axleF.position.set(S.len * 0.32, S.wheelFrontR, 0);
  g.add(axleF);
  const axleR = new THREE.Mesh(cylGeo(0.08, 0.08, S.w), MT.iron);
  axleR.rotation.x = Math.PI / 2;
  axleR.position.set(-S.len * 0.32, S.wheelR, 0);
  g.add(axleR);

  // 车厢（木 + 黄铜包边）
  const bodyY = chassisY + 0.9;
  const body = new THREE.Mesh(bevelBox(S.len * 0.62, 1.55, S.w * 0.94, 0.16, 2), MT.wood);
  body.position.set(-S.len * 0.08, bodyY, 0);
  body.castShadow = true;
  g.add(body);
  // 车顶（弧顶 + 行李架）
  const roof = new THREE.Mesh(cylGeo(S.w * 0.5, S.w * 0.5, S.len * 0.6, 14, 1, false, 0, Math.PI), MT.woodDark);
  roof.rotation.z = Math.PI / 2;
  roof.rotation.y = 0;
  roof.position.set(-S.len * 0.08, bodyY + 0.78, 0);
  roof.scale.set(1, 1, 0.32);
  roof.castShadow = true;
  g.add(roof);
  const rack = new THREE.Mesh(boxGeo(S.len * 0.5, 0.1, S.w * 0.8), MT.brassDark);
  rack.position.set(-S.len * 0.08, bodyY + 1.0, 0);
  g.add(rack);
  // 行李（两三个箱子，故意不等）
  const bags = [[-0.5, 0.34, 0.3], [0.15, 0.28, 0.5], [0.6, 0.24, 0.26]];
  for (const [bx, bh, bw] of bags) {
    const bag = new THREE.Mesh(bevelBox(bw * 1.6, bh, bw, 0.05), MT.clothLight);
    bag.position.set(-S.len * 0.08 + bx, bodyY + 1.0 + bh / 2 + 0.05, bw * 1.2);
    g.add(bag);
  }
  // 车窗（黄铜框 + 暗玻璃）
  for (const z of [-S.w * 0.47, S.w * 0.47]) {
    const win = new THREE.Mesh(boxGeo(0.92, 0.72, 0.06), MT.window);
    win.position.set(-S.len * 0.08 + 0.1, bodyY + 0.32, z);
    win.userData.noOutline = true;
    g.add(win);
    const fr = new THREE.Mesh(boxGeo(1.1, 0.9, 0.05), MT.brassDark);
    fr.position.set(-S.len * 0.08 + 0.1, bodyY + 0.32, z * 1.02);
    g.add(fr);
  }
  // 车厢黄铜腰线
  for (const z of [-S.w * 0.48, S.w * 0.48]) {
    const strip = new THREE.Mesh(boxGeo(S.len * 0.62, 0.08, 0.06), MT.brass);
    strip.position.set(-S.len * 0.08, bodyY - 0.6, z);
    g.add(strip);
  }

  // 驭者座（前置，带踏板与围栏）
  const benchY = chassisY + 0.78;
  const bench = new THREE.Mesh(bevelBox(1.1, 0.22, S.w * 0.8, 0.06), MT.woodDark);
  bench.position.set(S.len * 0.33, benchY, 0);
  g.add(bench);
  const benchBack = new THREE.Mesh(boxGeo(0.16, 0.72, S.w * 0.8), MT.woodDark);
  benchBack.position.set(S.len * 0.33 - 0.5, benchY + 0.42, 0);
  g.add(benchBack);
  // 挡板 + 脚蹬
  const dash = new THREE.Mesh(boxGeo(0.12, 0.5, S.w * 0.86), MT.wood);
  dash.position.set(S.len * 0.46, benchY + 0.2, 0);
  g.add(dash);
  // v7.2 修：脚蹬原在 y=wheelFrontR+0.1=0.82，而底盘大梁在 y=1.08 ⇒ 悬空 0.16 m
  const step = new THREE.Mesh(boxGeo(0.5, 0.1, 0.6), MT.ironDark);
  step.position.set(S.len * 0.42, chassisY - 0.16, 0);
  g.add(step);
  for (const sz of [-0.22, 0.22]) {
    // v7.2 补：脚踏与底盘大梁（在 z=±0.65）之间的横向吊架，否则脚蹬仍是孤岛
    strutBetween(g, [S.len * 0.42, chassisY - 0.14, sz], [S.len * 0.42, chassisY - 0.04, sz * 3.0],
      { radius: 0.04, mat: MT.iron, name: 'StepStay' });
  }

  // 车灯 ×2
  const lamps = [];
  for (const z of [-S.w * 0.36, S.w * 0.36]) {
    const cl = buildCarLamp(MT);
    cl.position.set(S.len * 0.5, benchY + 0.55, z);
    cl.rotation.y = -0.1 * Math.sign(z);
    lamps.push(cl);
    g.add(cl);
  }

  // 弹簧钢板（车厢与车轴之间，体现悬架）
  for (const sx of [S.len * 0.28, -S.len * 0.3]) {
    for (const z of [-S.w * 0.36, S.w * 0.36]) {
      const leaf = new THREE.Mesh(boxGeo(1.0, 0.06, 0.12), MT.iron);
      leaf.position.set(sx, chassisY - 0.22, z);
      leaf.rotation.z = 0.06;
      g.add(leaf);
    }
  }

  // 车轮 ×4（前轮小、后轮大）
  const wheels = [];
  const wheelDefs = [
    [S.len * 0.32, -S.w / 2, S.wheelFrontR],
    [S.len * 0.32, S.w / 2, S.wheelFrontR],
    [-S.len * 0.32, -S.w / 2, S.wheelR],
    [-S.len * 0.32, S.w / 2, S.wheelR],
  ];
  for (const [wx, wz, wr] of wheelDefs) {
    const wl = buildWheel(MT, wr, { spokes: wr > 0.8 ? 12 : 10, width: 0.1 });
    wl.position.set(wx, wr, wz);
    wheels.push(wl);
    g.add(wl);
  }

  g.userData.parts = { wheels, lamps, steamAnchor: [S.len * 0.5, benchY, 0], size: S };
  // 与其它资产模块一致：默认自描边，主板/装配层可显式关掉
  if (o.outline !== false) g.userData.outlined = outlineTree(g, o.outlineMinRadius ?? 0.9);
  return g;
}

// ---------------------------------------------------------------------------
// ② 蒸汽机动车
// ---------------------------------------------------------------------------
export function buildMotorCar(o = {}) {
  const S = SPEC.motor;
  const MT = o.materials || makeMaterials();
  const g = new THREE.Group();
  g.name = 'SteamMotorCar';

  const chassisY = 0.55;
  // 底盘
  const chassis = new THREE.Mesh(boxGeo(S.len * 0.92, 0.22, S.w * 0.82), MT.ironDark);
  chassis.position.set(0, chassisY, 0);
  g.add(chassis);

  // 前置锅炉（卧式）+ 烟囱
  const boilerY = chassisY + 0.75;
  const boiler = new THREE.Mesh(cylGeo(0.52, 0.52, 1.5, 16), MT.bronze);
  boiler.rotation.z = Math.PI / 2;
  boiler.position.set(S.len * 0.34, boilerY, 0);
  boiler.castShadow = true;
  g.add(boiler);
  for (const bx of [-0.5, 0, 0.5]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.06, 6, 18), MT.brass);
    hoop.position.set(S.len * 0.34 + bx, boilerY, 0);
    hoop.rotation.y = Math.PI / 2;
    g.add(hoop);
  }
  // 烟囱（前部）
  const stack = new THREE.Mesh(cylGeo(0.15, 0.2, 1.7, 12), MT.iron);
  stack.position.set(S.len * 0.4, boilerY + 1.0, 0);
  g.add(stack);
  const stackCap = new THREE.Mesh(cylGeo(0.26, 0.16, 0.22, 12), MT.brass);
  stackCap.position.set(S.len * 0.4, boilerY + 1.9, 0);
  g.add(stackCap);
  // 锅炉给水管
  pipe(g, [
    [S.len * 0.2, boilerY + 0.4, 0.4],
    [0.2, boilerY + 0.6, 0.62],
    [-0.8, chassisY + 0.9, 0.5],
  ], { radius: 0.06, mat: MT.brass, segments: 20, flanges: false, name: 'FeedPipe' });

  // 后置蒸汽机（气缸组 + 飞轮）
  const engX = -S.len * 0.24;
  const engY = chassisY + 0.5;
  for (const dx of [-0.34, 0.34]) {
    const cyl = new THREE.Mesh(cylGeo(0.26, 0.3, 0.9, 12), MT.iron);
    cyl.position.set(engX + dx, engY + 0.1, 0);
    g.add(cyl);
    const head = new THREE.Mesh(cylGeo(0.32, 0.26, 0.16, 12), MT.brass);
    head.position.set(engX + dx, engY + 0.62, 0);
    g.add(head);
  }
  const flywheel = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 6, 22), MT.brassDark);
  flywheel.position.set(engX, engY + 0.1, S.w * 0.42);
  g.add(flywheel);
  const fwDisc = new THREE.Mesh(cylGeo(0.4, 0.4, 0.08, 18), MT.ironDark);
  fwDisc.rotation.x = Math.PI / 2;
  fwDisc.position.set(engX, engY + 0.1, S.w * 0.42);
  g.add(fwDisc);

  // 黄铜水箱（后置，带箍）
  const tank = new THREE.Mesh(cylGeo(0.44, 0.44, 1.1, 14), MT.brass);
  tank.rotation.z = Math.PI / 2;
  tank.position.set(-S.len * 0.42, engY + 0.85, 0);
  tank.castShadow = true;
  g.add(tank);
  for (const bx of [-0.32, 0.32]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.05, 6, 16), MT.brassDark);
    hoop.position.set(-S.len * 0.42 + bx, engY + 0.85, 0);
    hoop.rotation.y = Math.PI / 2;
    g.add(hoop);
  }

  // 驾驶室（带帆布顶篷 + 挡风玻璃）
  const cabY = chassisY + 1.05;
  const cab = new THREE.Mesh(bevelBox(1.5, 1.0, S.w * 0.88, 0.12, 2), MT.paintedRed);
  cab.position.set(0.2, cabY, 0);
  cab.castShadow = true;
  g.add(cab);
  const canopy = new THREE.Mesh(boxGeo(1.8, 0.1, S.w * 0.9), MT.canvas);
  canopy.position.set(0.2, cabY + 0.95, 0);
  canopy.rotation.z = -0.04;
  g.add(canopy);
  for (const sx of [-0.66, 1.06]) {
    for (const sz of [-S.w * 0.4, S.w * 0.4]) {
      strutBetween(g, [sx + 0.2, cabY + 0.4, sz], [sx + 0.2, cabY + 0.9, sz],
        { radius: 0.045, mat: MT.brassDark, name: 'CanopyPost' });
    }
  }
  const windshield = new THREE.Mesh(boxGeo(0.06, 0.6, S.w * 0.78), MT.window);
  windshield.position.set(0.96, cabY + 0.5, 0);
  windshield.rotation.z = -0.16;
  windshield.userData.noOutline = true;
  g.add(windshield);
  // 转向柄 + 仪表
  const tiller = new THREE.Mesh(cylGeo(0.05, 0.05, 0.9, 8), MT.brass);
  tiller.rotation.z = -0.9;
  tiller.position.set(0.66, cabY + 0.5, 0);
  g.add(tiller);
  // 车灯
  const lamps = [];
  for (const z of [-S.w * 0.34, S.w * 0.34]) {
    const cl = buildCarLamp(MT);
    cl.position.set(S.len * 0.5, boilerY + 0.5, z);
    cl.scale.setScalar(1.15);
    lamps.push(cl);
    g.add(cl);
  }

  // 车轮 ×4（黄铜辐条）
  const wheels = [];
  for (const [wx, wz] of [[S.len * 0.32, -S.w / 2], [S.len * 0.32, S.w / 2],
    [-S.len * 0.32, -S.w / 2], [-S.len * 0.32, S.w / 2]]) {
    const wl = buildWheel(MT, S.wheelR, { spokes: 14, width: 0.14 });
    wl.position.set(wx, S.wheelR, wz);
    wheels.push(wl);
    g.add(wl);
  }
    // 踏板 + 挡泥板（v7.1 修正朝向：轴线沿 Z、壳面覆盖轮子上方）
  const fenderMat = MT.fender || MT.ironDark;
  for (const [wx, wz] of [[S.len * 0.32, -S.w / 2], [S.len * 0.32, S.w / 2],
    [-S.len * 0.32, -S.w / 2], [-S.len * 0.32, S.w / 2]]) {
    const fg = new THREE.CylinderGeometry(1.34, 1.34, 0.56, 20, 1, true, 0, Math.PI);
    fg.rotateX(-Math.PI / 2);
    fg.rotateZ(Math.PI / 2);
    const fender = new THREE.Mesh(fg, fenderMat);
    fender.position.set(wx, S.wheelR + 0.02, wz);
    fender.castShadow = true;
    fender.userData.noOutline = true;
    g.add(fender);
    // 挡泥板撑杆（把泥板连到车架，避免浮着）
    for (const dz of [-0.2, 0.2]) {
      strutBetween(g, [wx, S.wheelR + 1.32, wz + dz], [wx, chassisY + 0.1, wz * 0.72],
        { radius: 0.055, mat: MT.ironDark, name: 'FenderStay' });
    }
    // 泥板下沿包边（黄铜）
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1.36, 0.035, 6, 20, Math.PI), MT.brassDark);
    lip.position.set(wx, S.wheelR + 0.02, wz);
    lip.rotation.y = Math.PI / 2;
    g.add(lip);
  }

  g.userData.parts = {
    wheels, lamps, flywheel, stack,
    steamAnchor: [S.len * 0.4, boilerY + 2.0, 0], size: S,
  };
  // 与其它资产模块一致：默认自描边，主板/装配层可显式关掉
  if (o.outline !== false) g.userData.outlined = outlineTree(g, o.outlineMinRadius ?? 0.9);
  return g;
}

// ---------------------------------------------------------------------------
// ③ 双层公共马车（Omnibus，上层露天堂座）
// ---------------------------------------------------------------------------
export function buildOmnibus(o = {}) {
  const S = SPEC.omnibus;
  const MT = o.materials || makeMaterials();
  const g = new THREE.Group();
  g.name = 'Omnibus';

  const chassisY = 0.62;
  const bodyW = S.w * 0.92;
  // 底盘
  const chassis = new THREE.Mesh(boxGeo(S.len * 0.94, 0.24, bodyW), MT.ironDark);
  chassis.position.set(0, chassisY, 0);
  g.add(chassis);

  // 下层车厢（封闭，带窗与门）
  const lowerH = 1.85;
  const lower = new THREE.Mesh(bevelBox(S.len * 0.84, lowerH, bodyW, 0.14, 2), MT.paintedRed);
  lower.position.set(0, chassisY + lowerH / 2 + 0.12, 0);
  lower.castShadow = true;
  g.add(lower);
  // 下层窗（每侧 4 扇）
  for (let i = 0; i < 4; i++) {
    const x = -S.len * 0.3 + i * (S.len * 0.2);
    for (const z of [-bodyW / 2, bodyW / 2]) {
      const win = new THREE.Mesh(boxGeo(0.7, 0.62, 0.06), MT.window);
      win.position.set(x, chassisY + 1.28, z);
      win.userData.noOutline = true;
      g.add(win);
      const fr = new THREE.Mesh(boxGeo(0.82, 0.74, 0.05), MT.brassDark);
      fr.position.set(x, chassisY + 1.28, z * 1.02);
      g.add(fr);
    }
  }
  // 黄铜腰线 + 铆钉
  for (const z of [-bodyW * 0.51, bodyW * 0.51]) {
    const strip = new THREE.Mesh(boxGeo(S.len * 0.86, 0.07, 0.05), MT.brass);
    strip.position.set(0, chassisY + 0.5, z);
    g.add(strip);
    rivets(g, {
      from: [-S.len * 0.42, chassisY + 0.5, z], to: [S.len * 0.42, chassisY + 0.5, z],
      spacing: 0.42, normal: [0, 0, Math.sign(z)], mat: MT.brassDark,
    });
  }
  // 车门（后侧）+ 门把
  const door = new THREE.Mesh(boxGeo(0.05, 1.4, 0.7), MT.woodDark);
  door.position.set(-S.len * 0.44, chassisY + 0.9, bodyW / 2);
  g.add(door);

  // 上层平台（露天堂座）
  const deckY = chassisY + lowerH + 0.3;
  const deck = new THREE.Mesh(boxGeo(S.len * 0.9, 0.14, bodyW), MT.woodDark);
  deck.position.set(0, deckY, 0);
  deck.castShadow = true;
  g.add(deck);
  // 堂座两排（横排朝前）
  for (const bx of [-S.len * 0.22, S.len * 0.06]) {
    const seat = new THREE.Mesh(boxGeo(0.5, 0.46, bodyW * 0.88), MT.cloth);
    seat.position.set(bx, deckY + 0.23, 0);
    g.add(seat);
    const back = new THREE.Mesh(boxGeo(0.1, 0.5, bodyW * 0.88), MT.cloth);
    back.position.set(bx - 0.28, deckY + 0.5, 0);
    g.add(back);
  }
  // 上层围栏
  const railG = railing(g, S.len * 0.9, { height: 0.85, radius: 0.05, posts: 8, mat: MT.brass });
  railG.position.set(0, deckY + 0.07, bodyW / 2 - 0.08);
  const railG2 = railing(g, S.len * 0.9, { height: 0.85, radius: 0.05, posts: 8, mat: MT.brass });
  railG2.position.set(0, deckY + 0.07, -bodyW / 2 + 0.08);
  const railFront = railing(g, bodyW * 0.9, { height: 0.85, radius: 0.05, posts: 4, mat: MT.brass });
  railFront.rotation.y = Math.PI / 2;
  railFront.position.set(S.len * 0.45, deckY + 0.07, 0);
  // 尾部弧形挡板
  const tailBoard = new THREE.Mesh(boxGeo(0.12, 0.7, bodyW * 0.9), MT.paintedRed);
  tailBoard.position.set(-S.len * 0.45, deckY + 0.42, 0);
  g.add(tailBoard);

  // 尾部旋梯（上层上下客）
  const stair = new THREE.Group();
  stair.name = 'Stair';
  for (let i = 0; i < 7; i++) {
    const st = new THREE.Mesh(boxGeo(0.42, 0.05, 0.3), MT.woodDark);
    st.position.set(-S.len * 0.34, chassisY + 0.9 + i * 0.24, bodyW / 2 + 0.28);
    st.rotation.z = 0.5;
    stair.add(st);
  }
  strutBetween(stair, [-S.len * 0.42, chassisY + 0.7, bodyW / 2 + 0.16],
    [-S.len * 0.18, deckY + 0.1, bodyW / 2 + 0.42], { radius: 0.05, mat: MT.brass, name: 'StairRail' });
  g.add(stair);

  // 驭者平台（前置，高座）
  const drvY = deckY + 0.5;
  const drvSeat = new THREE.Mesh(bevelBox(0.8, 0.2, bodyW * 0.5, 0.05), MT.woodDark);
  drvSeat.position.set(S.len * 0.38, drvY, 0);
  g.add(drvSeat);
  const drvBack = new THREE.Mesh(boxGeo(0.12, 0.6, bodyW * 0.5), MT.paintedRed);
  drvBack.position.set(S.len * 0.38 - 0.42, drvY + 0.34, 0);
  g.add(drvBack);
  // 前面两匹马的位置用挂钩表示
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 12), MT.brass);
  hook.position.set(S.len * 0.5, chassisY + 0.04, 0);
  g.add(hook);

  // 车灯 ×2
  const lamps = [];
  for (const z of [-bodyW * 0.36, bodyW * 0.36]) {
    const cl = buildCarLamp(MT);
    // v7.2 修：车体半长为 S.len*0.42，车灯原在 S.len*0.5 ⇒ 灯架离车体 0.27 m 悬空
    cl.position.set(S.len * 0.42, chassisY + 0.9, z);
    lamps.push(cl);
    g.add(cl);
  }

  // 车轮 ×4（后轮略大）
  const wheels = [];
  for (const [wx, wz, wr] of [[S.len * 0.34, -S.w / 2, S.wheelR * 0.92], [S.len * 0.34, S.w / 2, S.wheelR * 0.92],
    [-S.len * 0.32, -S.w / 2, S.wheelR], [-S.len * 0.32, S.w / 2, S.wheelR]]) {
    const wl = buildWheel(MT, wr, { spokes: 12, width: 0.12 });
    wl.position.set(wx, wr, wz);
    wheels.push(wl);
    g.add(wl);
  }

  g.userData.parts = { wheels, lamps, size: S, steamAnchor: [S.len * 0.5, chassisY + 1.0, 0] };
  // 与其它资产模块一致：默认自描边，主板/装配层可显式关掉
  if (o.outline !== false) g.userData.outlined = outlineTree(g, o.outlineMinRadius ?? 0.9);
  return g;
}

// ---------------------------------------------------------------------------
// ④ 行人（1.75 m，头身比 1:6.2）
// 靠「礼帽 / 手杖 / 大衣剪影」三个特征区分英伦身份
// ---------------------------------------------------------------------------
export function buildPedestrian(o = {}) {
  const MT = o.materials || makeMaterials();
  const h = SPEC.person.h;
  const headD = h / SPEC.person.headRatio;      // 0.282
  const headR = headD / 2;
  const legH = h * 0.46;
  const torsoH = h - legH - headD * 1.15;
  const style = o.style ?? 0;                    // 0 绅士 / 1 淑女 / 2 工人

  const g = new THREE.Group();
  g.name = `Pedestrian_${style}`;

  const coatMat = style === 1 ? MT.cloth : (style === 2 ? MT.ironDark : MT.clothLight);
  const bodyG = new THREE.Group();
  bodyG.name = 'Body';
  g.add(bodyG);

  // 躯干（大衣：上宽下摆外扩）
  const torso = new THREE.Mesh(cylGeo(torsoH * 0.17, torsoH * 0.24, torsoH, 8), coatMat);
  torso.position.y = legH + torsoH / 2;
  torso.castShadow = true;
  bodyG.add(torso);
  // 大衣下摆（裙摆感）
  const skirt = new THREE.Mesh(cylGeo(torsoH * 0.24, torsoH * 0.3, torsoH * 0.34, 8), coatMat);
  skirt.position.y = legH + torsoH * 0.18;
  bodyG.add(skirt);
  // 肩
  const shoulders = new THREE.Mesh(cylGeo(torsoH * 0.22, torsoH * 0.18, torsoH * 0.14, 8), coatMat);
  shoulders.position.y = legH + torsoH * 0.94;
  bodyG.add(shoulders);
  // 手臂（一只插兜、一只持杖/提袋）
  const armR = new THREE.Mesh(cylGeo(h * 0.028, h * 0.034, torsoH * 0.82, 6), coatMat);
  armR.position.set(torsoH * 0.19, legH + torsoH * 0.52, 0);
  bodyG.add(armR);
  const armL = new THREE.Mesh(cylGeo(h * 0.028, h * 0.034, torsoH * 0.7, 6), coatMat);
  armL.position.set(-torsoH * 0.19, legH + torsoH * 0.58, 0.02);
  armL.rotation.z = 0.22;
  bodyG.add(armL);

  // 头 + 帽
  const head = new THREE.Mesh(sphereGeo(headR, 12), MT.skin);
  head.position.y = h - headR - 0.02;
  bodyG.add(head);
  const hat = new THREE.Group();
  hat.name = 'Hat';
  if (style === 1) {
    // 淑女：宽檐帽 + 面纱
    const brim = new THREE.Mesh(cylGeo(headR * 2.3, headR * 2.3, 0.02, 14), MT.cloth);
    brim.position.y = h - 0.01;
    hat.add(brim);
    const crown = new THREE.Mesh(cylGeo(headR * 0.9, headR * 1.0, 0.16, 12), MT.cloth);
    crown.position.y = h + 0.09;
    hat.add(crown);
    const feather = new THREE.Mesh(coneGeo(0.05, 0.34, 6), MT.canvas);
    feather.position.set(0.16, h + 0.2, 0);
    feather.rotation.z = -0.5;
    hat.add(feather);
  } else {
    // 绅士/工人：高筒礼帽（工人矮一点、无缎带）
    const topH = style === 2 ? 0.16 : 0.28;
    const crown = new THREE.Mesh(cylGeo(headR * 0.86, headR * 0.96, topH, 14), MT.hat);
    crown.position.y = h - 0.02 + topH / 2;
    hat.add(crown);
    const brim = new THREE.Mesh(cylGeo(headR * 1.5, headR * 1.5, 0.022, 14), MT.hat);
    brim.position.y = h - 0.02;
    hat.add(brim);
    if (style !== 2) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(headR * 0.92, 0.022, 6, 14), MT.cloth);
      band.position.y = h + 0.03;
      band.rotation.x = Math.PI / 2;
      hat.add(band);
    }
  }
  bodyG.add(hat);

  // 手杖 / 提袋（身份特征）
  let cane = null;
  if (style === 1) {
    const bag = new THREE.Mesh(boxGeo(0.16, 0.2, 0.09), MT.woodDark);
    bag.position.set(-torsoH * 0.24, legH + torsoH * 0.24, 0.04);
    bodyG.add(bag);
    strutBetween(bodyG, [-torsoH * 0.2, legH + torsoH * 0.5, 0.04], [-torsoH * 0.24, legH + torsoH * 0.36, 0.04],
      { radius: 0.02, mat: MT.rope, name: 'BagStrap' });
  } else {
    cane = new THREE.Group();
    cane.name = 'Cane';
    cane.position.set(torsoH * 0.2, 0, 0.06);
    const shaft = new THREE.Mesh(cylGeo(0.018, 0.022, h * 0.5, 6), MT.woodDark);
    shaft.position.y = h * 0.25;
    cane.add(shaft);
    const knob = new THREE.Mesh(sphereGeo(0.032, 8), MT.brass);
    knob.position.y = h * 0.5;
    cane.add(knob);
    bodyG.add(cane);
  }

  // 腿（可动：踱步）
  const legs = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group();
    leg.name = `Leg_${sx > 0 ? 'R' : 'L'}`;
    leg.position.set(sx * h * 0.048, legH, 0);
    const thigh = new THREE.Mesh(cylGeo(h * 0.032, h * 0.036, legH, 6), style === 1 ? MT.cloth : MT.ironDark);
    thigh.position.y = -legH / 2;
    leg.add(thigh);
    const shoe = new THREE.Mesh(bevelBox(0.09, 0.05, 0.22, 0.02), MT.hat);
    shoe.position.set(0, -legH + 0.025, 0.05);
    leg.add(shoe);
    bodyG.add(leg);
    legs.push(leg);
  }

  g.userData.parts = {
    h, style, legL: legs[1], legR: legs[0], body: bodyG, hat, cane,
    /** 等待时的原地踱步（振幅 0.03 m @ 0.8 Hz） */
    shuffle(t) {
      const A = SPEC.person.shuffleAmp;
      const w = Math.PI * 2 * SPEC.person.shuffleHz;
      legs[1].rotation.x = Math.sin(t * w) * (A * 6);
      legs[0].rotation.x = -Math.sin(t * w) * (A * 6);
      bodyG.position.y = Math.abs(Math.sin(t * w)) * A;
      bodyG.rotation.z = Math.sin(t * w * 0.5) * 0.012;
      if (cane) cane.rotation.z = Math.sin(t * w + 1.0) * 0.04;
    },
  };
  if (o.outline !== false) g.userData.outlined = outlineTree(g, o.outlineMinRadius ?? 0.9);
  return g;
}

// ---------------------------------------------------------------------------
// 主装配：车辆陈列 + 行人队列（单体拍板用）
// ---------------------------------------------------------------------------
export function build(opts = {}) {
  const MT = makeMaterials();
  const root = new THREE.Group();
  root.name = 'Vehicles';

  // 一段人行道/路面，作为比例参照与接地
  const groundTexMat = M.stone({ color: new THREE.Color('#6E6862'), bands: [0.34, 0.66, 1.0], outline: false });
  const ground = new THREE.Mesh(boxGeo(30, 0.2, 14), groundTexMat);
  ground.name = 'BoardGround';
  ground.position.set(0, -0.1, 0);
  ground.receiveShadow = true;
  ground.userData.noOutline = true;
  root.add(ground);
  // 收水线 + 一段路缘石（提示这是街面）
  const gutter = new THREE.Mesh(boxGeo(30, 0.08, 0.7), M.stone({ color: new THREE.Color('#4A453D'), bands: [0.3, 0.62, 1.0], outline: false }));
  gutter.name = 'BoardGutter';
  gutter.position.set(0, 0.02, -6.4);
  gutter.userData.noOutline = true;
  root.add(gutter);
  const kerb = new THREE.Mesh(boxGeo(30, 0.3, 0.3), M.stone({ bands: [0.2, 0.48, 0.9], outlineWidth: 0.024 }));
  kerb.name = 'BoardKerb';
  kerb.position.set(0, 0.15, -5.9);
  root.add(kerb);

  // --- 车辆：三型并排，间距按实际车长留出 ---
  const carriage = buildCarriage({ materials: MT, outline: false });
  carriage.position.set(-9.5, 0, -3.4);
  const motor = buildMotorCar({ materials: MT, outline: false });
  motor.position.set(-1.0, 0, -3.4);
  const omnibus = buildOmnibus({ materials: MT, outline: false });
  omnibus.position.set(8.0, 0, 0.4);
  root.add(carriage, motor, omnibus);

  // --- 行人：12 名，错落站立，风格混排 ---
  const people = [];
  const layout = [
    [-13.6, 2.6, 0], [-12.2, 3.3, 1], [-10.9, 2.2, 2], [-9.2, 3.6, 0], [-7.9, 2.9, 1],
    [-6.4, 2.3, 0], [-4.9, 3.4, 2], [-3.3, 2.7, 0], [3.2, 3.1, 1], [4.6, 2.4, 0],
    [6.1, 3.5, 2], [11.6, 3.0, 0],
  ];
  layout.forEach(([x, z, style], i) => {
    const ped = buildPedestrian({ style, materials: MT, outline: false });
    ped.position.set(x, 0.2, z);
    ped.rotation.y = -0.6 + (i % 3) * 0.9;
    people.push(ped);
    root.add(ped);
  });

  // --- 性能 ---
  const thinTagged = tagThinMembers(root, {
    torusTubeMax: 0.36, tubeRadiusMax: 0.26, cylRadiusMax: 0.3, boxMinAxis: 0.2,
  });
  if (opts.outline !== false) {
    const threshold = opts.outlineMinRadius ?? 0.9;
    const targets = [];
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh) return;
      if (o.material?.userData?.family === 'emissive') return;
      if (o.userData.noOutline) return;
      const geo = o.geometry;
      if (!geo) return;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const r = (geo.boundingSphere?.radius ?? 0) * Math.max(o.scale.x, o.scale.y, o.scale.z);
      if (r < threshold) return;
      targets.push(o);
    });
    for (const m of targets) addOutline(m);
    root.userData.outlinedCount = targets.length;
  }
  root.userData.thinTagged = thinTagged;

  root.userData.parts = {
    SPEC, carriage, motor, omnibus, people,
    vehicles: [
      { g: carriage, parts: carriage.userData.parts, name: '蒸汽马车' },
      { g: motor, parts: motor.userData.parts, name: '蒸汽机动车' },
      { g: omnibus, parts: omnibus.userData.parts, name: '双层公共马车' },
    ],
    /** 演示：车轮滚 + 行人踱步 */
    drive(t, s = {}) {
      const spd = s.speed ?? 0;             // m/s
      for (const v of [carriage, motor, omnibus]) {
        const R = 0.9;
        for (const w of v.userData.parts.wheels) {
          const r = w.userData.parts?.r ?? R;
          w.rotation.z = -(t * spd) / r;
        }
        if (v.userData.parts.flywheel) v.userData.parts.flywheel.rotation.z = t * 6;
      }
      for (const p of people) p.userData.parts.shuffle(t + (s.phase ?? 0));
    },
  };

  return root;
}

export default { build, buildCarriage, buildMotorCar, buildOmnibus, buildPedestrian, SPEC };
