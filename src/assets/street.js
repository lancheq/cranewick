/**
 * street.js — ③ 街道（v9 重做：11 m 窄街 · 蒸汽朋克 · 石板路）
 * 见 docs/STYLE_PROMPT.md §4/§5/§6/§7。
 *
 * 用户历次修正（不得回潮）：
 *   · "街道比较狭窄，车道是双车道旁边有人行道"  ⇒ 车行 6.6 + 人行 2.2×2 ＝ 11.0
 *   · "应该使用石板路"（车行区也是石板，不是小方石）
 *   · "窗户没能正常显示" ⇒ 对比度必须做出来：暗玻璃（比墙暗）+ **亮黄铜窗棂** + 暖色窗内光 + 亮窗台
 *   · "岗亭过多了留一个即可" ⇒ 报亭只留 1 个
 *   · "房屋墙壁准备几种砖墙贴图不要使用纯色块" ⇒ 走 src/core/textures.js 六种墙面
 */
import * as THREE from 'three';
import { C, BANDS } from '../core/palette.js';
import { M, lamp, toon } from '../core/materials.js';
import { applyWall } from '../core/textures.js';
import { H, STREET } from '../core/scale.js';
import {
  bevelBox, boxGeo, cylGeo, sphereGeo, coneGeo,
  rivets, pipe, railing, addOutline,
  strutBetween, unitStrut, tagThinMembers, mergeByMaterial,
} from '../core/primitives.js';

export const SPEC = {
  len: 64,
  lane: STREET.lane,
  road: STREET.road,          // 6.6 双车道
  walk: STREET.walk,          // 2.2
  kerb: STREET.kerb,          // 0.14
  total: STREET.total,        // 11.0
  gutter: STREET.road / 2 - 0.35,
  gratingStep: 16,
  lampH: STREET.lampH,        // 3.6
  lampStep: 14,
  facadeZ: STREET.total / 2,  // 5.5 建筑红线
  floors: [3, 4, 3, 2],
  kioskCount: 1,              // ★ 坚决只留一个
};

function makeMaterials() {
  const wall = (kind, rep) => applyWall(M.brick({ bands: BANDS.wall, outlineWidth: 0.026 }), kind, rep);
  return {
    wallRed: wall('brickRed', [3, 3]),
    wallBuff: wall('brickBuff', [3, 3]),
    wallSooty: wall('brickSooty', [3, 2]),
    wallPlaster: applyWall(M.stone({ bands: BANDS.wall, outlineWidth: 0.024 }), 'plaster', [3, 3]),
    stone: applyWall(M.stone({ bands: [0.2, 0.48, 0.9], outlineWidth: 0.026 }), 'stoneBlock', [2, 2]),
    // 车行道：**扇形小方石 + 车辙磨光带** —— 与河堤的不规则旧石板明确区分
    roadSlab: applyWall(M.stone({ bands: [0.3, 0.62, 1.0], outline: false }), 'settFan', [2.2, 24]),
    // 人行道：规则大石板
    walkSlab: applyWall(M.stone({ bands: [0.3, 0.62, 1.0], outline: false }), 'stoneBlock', [1.8, 16]),
    iron: M.iron({ bands: [0.26, 0.56, 1.0], outlineWidth: 0.026 }),
    ironDark: M.iron({ color: C.ironLo, bands: [0.24, 0.52, 0.96], outlineWidth: 0.024 }),
    steel: M.iron({ color: new THREE.Color('#5A626B'), bands: [0.26, 0.58, 1.0], outlineWidth: 0.026 }),
    brass: M.brass({ bands: BANDS.metal, outlineWidth: 0.028 }),
    brassDark: M.brass({ color: C.brassLo, bands: BANDS.metal, outlineWidth: 0.026 }),
    bronze: M.bronze({ bands: BANDS.metal, outlineWidth: 0.028 }),
    copper: M.bronze({ color: new THREE.Color('#A55F3A'), bands: BANDS.metal, outlineWidth: 0.026 }),
    verdigris: M.verdigris({ bands: BANDS.metal, outlineWidth: 0.024 }),
    wood: M.wood({ bands: [0.26, 0.56, 1.0], outlineWidth: 0.024 }),
    canvas: M.canvas({ color: new THREE.Color('#C9BFA6'), bands: [0.28, 0.6, 0.96], outlineWidth: 0.02 }),
    glass: M.glassLamp({ color: C.accentVerdigris, opacity: 0.45 }),
    // ★ 窗户对比三件套
    winDark: toon(new THREE.Color('#1A242C'), { bands: [0.16, 0.4, 0.9], outline: false }),
    winLit: lamp(new THREE.Color('#FFC271'), 1.15),
    lampWarm: lamp(C.lampWarm, 1.7),
    paintRed: toon(new THREE.Color('#A8352C'), { bands: [0.26, 0.56, 1.0], outlineWidth: 0.02 }),
  };
}

function steamRun(parent, pts, MT, r = 0.075) {
  pipe(parent, pts, { radius: r, mat: MT.copper, segments: 20, flanges: false, name: 'WallPipe' });
  for (const p of pts) {
    const f = new THREE.Mesh(new THREE.TorusGeometry(r * 1.9, r * 0.32, 6, 12), MT.brass);
    f.position.fromArray(p);
    parent.add(f);
  }
}
function gauge(parent, pos, MT, face = 0.13) {
  const g = new THREE.Mesh(cylGeo(face, face, 0.07, 12), MT.brass);
  g.rotation.x = Math.PI / 2;
  g.position.fromArray(pos);
  parent.add(g);
  const f = new THREE.Mesh(new THREE.CircleGeometry(face * 0.74, 12), MT.lampWarm);
  f.position.set(pos[0], pos[1], pos[2] + 0.05);
  f.userData.noOutline = true;
  parent.add(f);
}

// ---------------------------------------------------------------------------
function buildPaving(MT) {
  const g = new THREE.Group();
  g.name = 'Paving';
  const L = SPEC.len, R = SPEC.road / 2;

  const road = new THREE.Mesh(new THREE.PlaneGeometry(L, SPEC.road), MT.roadSlab);
  road.rotation.x = -Math.PI / 2;
  road.receiveShadow = true;
  road.userData.noOutline = true;
  g.add(road);
  const centerLine = new THREE.Mesh(boxGeo(L, 0.02, 0.09), MT.brassDark);
  centerLine.position.set(0, 0.012, 0);
  centerLine.userData.noOutline = true;
  g.add(centerLine);
  for (const sgn of [1, -1]) {
    const gutter = new THREE.Mesh(boxGeo(L, 0.05, 0.7), MT.ironDark);
    gutter.position.set(0, 0.006, sgn * SPEC.gutter);
    gutter.userData.noOutline = true;
    g.add(gutter);
    const kerb = new THREE.Mesh(boxGeo(L, 0.3, 0.24), MT.stone);
    kerb.position.set(0, SPEC.kerb - 0.15, sgn * (R + 0.12));
    kerb.castShadow = true;
    kerb.receiveShadow = true;
    g.add(kerb);
    const n = Math.floor(L / 1.6);
    const im = new THREE.InstancedMesh(boxGeo(0.04, SPEC.kerb + 0.02, 0.26), MT.ironDark, n);
    im.userData.noOutline = true;
    const d = new THREE.Object3D();
    for (let i = 0; i < n; i++) { d.position.set(-L / 2 + 0.8 + i * 1.6, SPEC.kerb / 2, sgn * (R + 0.12)); d.updateMatrix(); im.setMatrixAt(i, d.matrix); }
    im.instanceMatrix.needsUpdate = true;
    g.add(im);
    const walk = new THREE.Mesh(boxGeo(L, 0.3, SPEC.walk), MT.walkSlab);
    walk.position.set(0, SPEC.kerb - 0.15, sgn * (R + 0.24 + SPEC.walk / 2));
    walk.receiveShadow = true;
    walk.userData.noOutline = true;
    g.add(walk);
  }

  // 排水：铸铁格栅（含井腔制造「深」）
  for (const sgn of [1, -1]) {
    const n = Math.floor(L / SPEC.gratingStep) + 1;
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + 5 + i * SPEC.gratingStep;
      const z = sgn * SPEC.gutter;
      const frame = new THREE.Mesh(boxGeo(0.8, 0.1, 0.6), MT.stone);
      frame.position.set(x, 0.02, z);
      g.add(frame);
      const rim = new THREE.Mesh(boxGeo(0.68, 0.1, 0.5), MT.ironDark);
      rim.position.set(x, 0.04, z);
      g.add(rim);
      const cavity = new THREE.Mesh(boxGeo(0.58, 0.44, 0.4), MT.ironDark);
      cavity.position.set(x, -0.2, z);
      cavity.userData.noOutline = true;
      g.add(cavity);
      const bars = 6;
      const im = new THREE.InstancedMesh(boxGeo(0.58, 0.07, 0.04), MT.iron, bars);
      im.userData.noOutline = true;
      const d = new THREE.Object3D();
      for (let k = 0; k < bars; k++) { d.position.set(x, 0.09, z - 0.2 + k * 0.08); d.updateMatrix(); im.setMatrixAt(k, d.matrix); }
      im.instanceMatrix.needsUpdate = true;
      g.add(im);
    }
  }
  // 沿街蒸汽总管 + 检修阀
  for (const sgn of [1, -1]) {
    const z = sgn * (R + 0.24 + SPEC.walk - 0.35);
    pipe(g, [[-L / 2, SPEC.kerb + 0.14, z], [0, SPEC.kerb + 0.14, z], [L / 2, SPEC.kerb + 0.14, z]],
      { radius: 0.1, mat: MT.ironDark, segments: 20, flanges: false, name: 'MainPipe' });
    for (let i = 0; i < 3; i++) {
      const vx = -L / 2 + 12 + i * 22;
      const valve = new THREE.Mesh(cylGeo(0.16, 0.16, 0.44, 8), MT.bronze);
      valve.position.set(vx, SPEC.kerb + 0.4, z);
      g.add(valve);
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 6, 12), MT.brass);
      wheel.position.set(vx, SPEC.kerb + 0.74, z);
      wheel.rotation.x = Math.PI / 2;
      g.add(wheel);
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
function buildTerrace(MT, o = {}) {
  const g = new THREE.Group();
  g.name = 'Terrace';
  const w = o.w ?? 7.2, floors = o.floors ?? 3, side = o.side ?? 1;
  const fh = H.floor, d = 9.5;
  const hh = floors * fh;
  const wallMat = [MT.wallRed, MT.wallBuff, MT.wallPlaster, MT.wallSooty][(o.seed ?? 0) % 4];

  const body = new THREE.Mesh(boxGeo(w - 0.12, hh, d), wallMat);
  body.position.set(0, hh / 2 + SPEC.kerb, side * (d / 2 + 0.12));
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  const plinth = new THREE.Mesh(boxGeo(w, 0.9, d + 0.2), MT.stone);
  plinth.position.set(0, SPEC.kerb + 0.45, side * (d / 2 + 0.12));
  g.add(plinth);
  const cornice = new THREE.Mesh(bevelBox(w + 0.5, 0.34, d + 0.5, 0.09, 2), MT.steel);
  cornice.position.set(0, hh + SPEC.kerb + 0.05, side * (d / 2 + 0.12));
  cornice.castShadow = true;
  g.add(cornice);
  rivets(g, {
    from: [-w / 2 - 0.1, hh + SPEC.kerb + 0.24, side * (d / 2 + 0.38)],
    to: [w / 2 + 0.1, hh + SPEC.kerb + 0.24, side * (d / 2 + 0.38)],
    spacing: 0.34, normal: [0, 0, side], mat: MT.brassDark,
  });
  // 屋顶：压力罐 + 排气管 + 烟囱 + 铜绿烟囱罐
  const tank = new THREE.Mesh(cylGeo(0.7, 0.7, 1.7, 12), MT.steel);
  tank.rotation.z = Math.PI / 2;
  tank.position.set(-w * 0.24, hh + SPEC.kerb + 1.3, side * d * 0.4);
  tank.castShadow = true;
  g.add(tank);
  for (const dx of [-0.5, 0.5]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.05, 6, 14), MT.brass);
    hoop.position.set(-w * 0.24 + dx, hh + SPEC.kerb + 1.3, side * d * 0.4);
    hoop.rotation.y = Math.PI / 2;
    g.add(hoop);
  }
  const vent = new THREE.Mesh(cylGeo(0.16, 0.2, 1.9, 10), MT.iron);
  vent.position.set(w * 0.26, hh + SPEC.kerb + 1.4, side * d * 0.34);
  g.add(vent);
  const ventCap = new THREE.Mesh(cylGeo(0.34, 0.18, 0.2, 10), MT.brass);
  ventCap.position.set(w * 0.26, hh + SPEC.kerb + 2.4, side * d * 0.34);
  g.add(ventCap);
  const chimney = new THREE.Mesh(boxGeo(0.62, 1.5, 0.62), MT.wallSooty);
  chimney.position.set(-w * 0.4, hh + SPEC.kerb + 0.75, side * d * 0.72);
  g.add(chimney);
  const pot = new THREE.Mesh(cylGeo(0.14, 0.17, 0.5, 8), MT.verdigris);
  pot.position.set(-w * 0.4, hh + SPEC.kerb + 1.72, side * d * 0.72);
  g.add(pot);

  // 外挂铜管 + 压力表
  for (const sx of [-w / 2 + 0.5, w / 2 - 0.5]) {
    steamRun(g, [
      [sx, SPEC.kerb + 0.9, -side * 0.4],
      [sx, hh * 0.55, -side * 0.44],
      [sx, hh + SPEC.kerb, -side * 0.36],
    ], MT, 0.08);
  }
  gauge(g, [w * 0.08, SPEC.kerb + fh * 1.55, -side * 0.2], MT, 0.14);

  // ---- 窗：暗玻璃 + 亮黄铜棂 + 暖窗内光 + 亮窗台（对比度是重点）----
  const winW = 1.05, winH = 1.7;
  const bays = Math.max(2, Math.round(w / 2.6));
  for (let f = 1; f <= floors; f++) {
    for (let b = 0; b < bays; b++) {
      const x = -w / 2 + (w / (bays + 1)) * (b + 1);
      const y = SPEC.kerb + (f - 1) * fh + 1.75;
      const zf = -side * 0.02;   // ★ 朝街面 = -side
      const fr = new THREE.Mesh(boxGeo(winW + 0.3, winH + 0.3, 0.2), MT.stone);
      fr.position.set(x, y, zf);
      g.add(fr);
      const lit = ((f * 7 + b * 3 + (o.seed ?? 0)) % 5) === 0;
      const gl = new THREE.Mesh(boxGeo(winW, winH, 0.08), lit ? MT.winLit : MT.winDark);
      gl.position.set(x, y, zf - side * 0.07);
      gl.userData.noOutline = true;
      g.add(gl);
      // ★ 亮黄铜窗棂
      strutBetween(g, [x, y - winH / 2, zf - side * 0.12], [x, y + winH / 2, zf - side * 0.12],
        { radius: 0.035, mat: MT.brass, name: 'MullionV' });
      strutBetween(g, [x - winW / 2, y, zf - side * 0.12], [x + winW / 2, y, zf - side * 0.12],
        { radius: 0.035, mat: MT.brass, name: 'MullionH' });
      for (const ex of [-winW / 2 - 0.02, winW / 2 + 0.02]) {
        strutBetween(g, [x + ex, y - winH / 2, zf - side * 0.12], [x + ex, y + winH / 2, zf - side * 0.12],
          { radius: 0.04, mat: MT.brassDark, name: 'WinFrame' });
      }
      const sill = new THREE.Mesh(boxGeo(winW + 0.44, 0.12, 0.34), MT.stone);
      sill.position.set(x, y - winH / 2 - 0.18, zf - side * 0.1);
      sill.castShadow = true;
      g.add(sill);
      const drip = new THREE.Mesh(boxGeo(winW + 0.4, 0.035, 0.06), MT.brass);
      drip.position.set(x, y - winH / 2 - 0.26, zf - side * 0.26);
      drip.userData.noOutline = true;
      g.add(drip);
      if (f === 2 && b === 0) {
        const deck = new THREE.Mesh(boxGeo(winW + 1.0, 0.12, 0.8), MT.steel);
        deck.position.set(x, y - winH / 2 - 0.32, zf - side * 0.45);
        deck.castShadow = true;
        g.add(deck);
        for (const bx of [-winW / 2 - 0.3, winW / 2 + 0.3]) {
          strutBetween(g, [x + bx, y - winH / 2 - 0.26, zf - side * 0.8], [x + bx, y - winH / 2 + 0.4, zf - side * 0.1],
            { radius: 0.04, mat: MT.brass, name: 'BalconyTie' });
        }
        const br = railing(g, winW + 1.0, { height: H.railH, radius: 0.032, posts: 4, mat: MT.brass });
        br.position.set(x, y - winH / 2 - 0.26, zf - side * 0.8);
      }
    }
  }

  // 底层：门 + 门灯 + （部分）卷帘门与店招
  const door = new THREE.Mesh(boxGeo(1.15, H.door, 0.14), MT.wood);
  door.position.set(0, SPEC.kerb + H.door / 2, -side * 0.02);
  g.add(door);
  const hood = new THREE.Mesh(bevelBox(1.8, 0.14, 0.9, 0.05, 2), MT.brassDark);
  hood.position.set(0, SPEC.kerb + H.door + 0.35, -side * 0.45);
  g.add(hood);
  const dl = new THREE.Mesh(cylGeo(0.09, 0.12, 0.26, 8), MT.lampWarm);
  dl.position.set(0.85, SPEC.kerb + 2.5, -side * 0.26);
  dl.userData.noOutline = true;
  g.add(dl);
  if ((o.seed ?? 0) % 2 === 0) {
    const shut = new THREE.Mesh(boxGeo(1.9, 1.9, 0.1), MT.iron);
    shut.position.set(w * 0.28, SPEC.kerb + 1.0, -side * 0.02);
    g.add(shut);
    for (let i = 0; i < 5; i++) {
      const lv = new THREE.Mesh(boxGeo(1.85, 0.05, 0.05), MT.brassDark);
      lv.position.set(w * 0.28, SPEC.kerb + 0.3 + i * 0.34, -side * 0.08);
      g.add(lv);
    }
    strutBetween(g, [w * 0.1, SPEC.kerb + 2.7, -side * 0.02], [w * 0.1, SPEC.kerb + 2.7, -side * 0.95],
      { radius: 0.055, mat: MT.iron, name: 'SignArm' });
    strutBetween(g, [w * 0.1, SPEC.kerb + 2.7, -side * 0.9], [w * 0.1, SPEC.kerb + 2.3, -side * 0.9],
      { radius: 0.028, mat: MT.brassDark, name: 'SignHang' });
    const board = new THREE.Mesh(bevelBox(0.05, 0.45, 0.8, 0.025), MT.wood);
    board.position.set(w * 0.1, SPEC.kerb + 2.42, -side * 0.9);
    g.add(board);
  }
  g.userData.parts = { w, floors, hh, side, d };
  return g;
}

// ---------------------------------------------------------------------------
function buildSteamLamp(MT, pos) {
  const g = new THREE.Group();
  g.name = 'SteamLamp';
  if (pos) g.position.fromArray(pos);
  const h = SPEC.lampH;
  const base = new THREE.Mesh(coneGeo(0.28, 0.62, 8), MT.iron);
  base.position.y = 0.31;
  base.castShadow = true;
  g.add(base);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.045, 6, 12), MT.brass);
  ring.position.y = 0.6; ring.rotation.x = Math.PI / 2;
  g.add(ring);
  const pole = new THREE.Mesh(cylGeo(0.055, 0.1, h - 1.1, 10), MT.iron);
  pole.position.y = 0.62 + (h - 1.1) / 2;
  pole.castShadow = true;
  g.add(pole);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    strutBetween(g, [Math.sin(a) * 0.075, 0.7, Math.cos(a) * 0.075], [Math.sin(a) * 0.055, h - 0.75, Math.cos(a) * 0.055],
      { radius: 0.016, mat: MT.brassDark, name: 'Flute' });
  }
  const lanY = h - 0.75;
  const fBot = new THREE.Mesh(cylGeo(0.3, 0.2, 0.1, 4), MT.brass);
  fBot.position.y = lanY;
  g.add(fBot);
  const fTop = new THREE.Mesh(cylGeo(0.22, 0.32, 0.12, 4), MT.brass);
  fTop.position.y = lanY + 0.68;
  g.add(fTop);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    strutBetween(g, [Math.sin(a) * 0.26, lanY + 0.05, Math.cos(a) * 0.26], [Math.sin(a) * 0.26, lanY + 0.63, Math.cos(a) * 0.26],
      { radius: 0.022, mat: MT.brassDark, name: 'LanternPost' });
  }
  const glass = new THREE.Mesh(cylGeo(0.24, 0.26, 0.54, 4), MT.glass);
  glass.position.y = lanY + 0.34; glass.rotation.y = Math.PI / 4;
  glass.userData.noOutline = true;
  g.add(glass);
  const burner = new THREE.Mesh(cylGeo(0.11, 0.14, 0.26, 8), MT.lampWarm);
  burner.position.y = lanY + 0.28;
  burner.userData.noOutline = true;
  g.add(burner);
  const flame = new THREE.Mesh(sphereGeo(0.1, 8), MT.lampWarm);
  flame.position.y = lanY + 0.44;
  flame.userData.noOutline = true;
  g.add(flame);
  const cap = new THREE.Mesh(coneGeo(0.32, 0.3, 4), MT.brass);
  cap.position.y = lanY + 0.86; cap.rotation.y = Math.PI / 4;
  g.add(cap);
  const fin = new THREE.Mesh(sphereGeo(0.055, 8), MT.brass);
  fin.position.y = lanY + 1.05;
  g.add(fin);
  steamRun(g, [[0.09, 0.9, 0.03], [0.15, 1.6, 0.05]], MT, 0.026);
  g.userData.parts = { emissive: [burner, flame] };
  return g;
}

function buildHydrant(MT, pos, ry = 0) {
  const g = new THREE.Group();
  g.name = 'FireHydrant';
  if (pos) g.position.fromArray(pos);
  g.rotation.y = ry;
  const Hh = 0.9;
  const flange = new THREE.Mesh(cylGeo(0.2, 0.24, 0.09, 12), MT.ironDark);
  flange.position.y = 0.045; flange.castShadow = true;
  g.add(flange);
  const barrel = new THREE.Mesh(cylGeo(0.1, 0.14, Hh * 0.6, 12), MT.paintRed);
  barrel.position.y = 0.09 + Hh * 0.3; barrel.castShadow = true;
  g.add(barrel);
  const waist = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.02, 6, 14), MT.paintRed);
  waist.position.y = 0.09 + Hh * 0.44; waist.rotation.x = Math.PI / 2;
  g.add(waist);
  for (const a of [0.6, -2.4]) {
    const cap = new THREE.Mesh(cylGeo(0.065, 0.075, 0.12, 8), MT.brass);
    cap.rotation.z = Math.PI / 2; cap.rotation.y = -a;
    cap.position.set(Math.cos(a) * 0.15, 0.09 + Hh * 0.34, Math.sin(a) * 0.15);
    g.add(cap);
  }
  const dome = new THREE.Mesh(sphereGeo(0.105, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), MT.brass);
  dome.position.y = 0.09 + Hh * 0.6;
  g.add(dome);
  const nut = new THREE.Mesh(cylGeo(0.045, 0.045, 0.05, 6), MT.bronze);
  nut.position.y = 0.09 + Hh * 0.6 + 0.09;
  g.add(nut);
  return g;
}

function buildPillarBox(MT, pos, scale = 0.72) {
  const g = new THREE.Group();
  g.name = 'PillarBox';
  if (pos) g.position.fromArray(pos);
  g.scale.setScalar(scale);
  const h = 1.9;
  const base = new THREE.Mesh(cylGeo(0.4, 0.46, 0.3, 6), MT.iron);
  base.position.y = 0.15; base.castShadow = true;
  g.add(base);
  const body = new THREE.Mesh(cylGeo(0.38, 0.4, h - 0.75, 6), MT.paintRed);
  body.position.y = 0.3 + (h - 0.75) / 2; body.castShadow = true;
  g.add(body);
  const cap = new THREE.Mesh(coneGeo(0.43, 0.3, 6), MT.ironDark);
  cap.position.y = h - 0.34;
  g.add(cap);
  const knob = new THREE.Mesh(sphereGeo(0.07, 8), MT.brass);
  knob.position.y = h - 0.16;
  g.add(knob);
  const slot = new THREE.Mesh(boxGeo(0.42, 0.06, 0.1), MT.brassDark);
  slot.position.set(0, h - 0.62, 0.34);
  g.add(slot);
  const door = new THREE.Mesh(boxGeo(0.36, 0.36, 0.07), MT.brassDark);
  door.position.set(0, 0.8, 0.36);
  g.add(door);
  return g;
}

/** 报亭 —— 全街只留一个 */
function buildKiosk(MT, pos) {
  const g = new THREE.Group();
  g.name = 'NewsKiosk';
  if (pos) g.position.fromArray(pos);
  const w = 2.3, hh = 2.4;
  const body = new THREE.Mesh(cylGeo(w * 0.5, w * 0.52, hh, 6), MT.wallRed);
  body.position.y = hh / 2 + SPEC.kerb;
  body.castShadow = true;
  g.add(body);
  const eave = new THREE.Mesh(cylGeo(w * 0.62, w * 0.56, 0.2, 6), MT.brass);
  eave.position.y = hh + SPEC.kerb + 0.1;
  g.add(eave);
  const canopy = new THREE.Mesh(coneGeo(w * 0.68, 0.6, 6), MT.canvas);
  canopy.position.y = hh + SPEC.kerb + 0.5;
  g.add(canopy);
  const tip = new THREE.Mesh(coneGeo(0.08, 0.32, 6), MT.brass);
  tip.position.y = hh + SPEC.kerb + 0.94;
  g.add(tip);
  for (let i = 0; i < 3; i++) {
    const a = -0.45 + i * 0.45;
    const win = new THREE.Mesh(boxGeo(0.55, 0.95, 0.08), MT.winLit);
    win.position.set(Math.sin(a) * (w * 0.5 + 0.02), SPEC.kerb + 1.3, Math.cos(a) * (w * 0.5 + 0.02));
    win.rotation.y = a;
    win.userData.noOutline = true;
    g.add(win);
  }
  const counter = new THREE.Mesh(boxGeo(1.1, 0.09, 0.45), MT.brassDark);
  counter.position.set(0, SPEC.kerb + 1.05, w * 0.5 + 0.18);
  g.add(counter);
  steamRun(g, [[-0.86, SPEC.kerb + 0.3, 0.3], [-1.24, SPEC.kerb + 0.8, 0.58]], MT, 0.04);
  return g;
}

function buildAwning(MT, pos, width, side) {
  const g = new THREE.Group();
  g.name = 'Awning';
  if (pos) g.position.fromArray(pos);
  const out = 1.5, yy = SPEC.kerb + 2.7;
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(width, out * 1.1), MT.canvas);
  cloth.rotation.x = -Math.PI / 2 + 0.34;
  cloth.position.set(0, yy - 0.24, side * out / 2);
  cloth.userData.noOutline = true;
  g.add(cloth);
  const valance = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.3), MT.canvas);
  valance.position.set(0, yy - 0.56, side * out);
  valance.userData.noOutline = true;
  g.add(valance);
  for (const dx of [-width / 2 + 0.2, width / 2 - 0.2]) {
    strutBetween(g, [dx, yy, 0], [dx, yy - 0.5, side * out], { radius: 0.04, mat: MT.iron, name: 'AwnArm' });
  }
  return g;
}

// ---------------------------------------------------------------------------
export function build(opts = {}) {
  const MT = makeMaterials();
  const root = new THREE.Group();
  root.name = 'Street';

  const paving0 = buildPaving(MT);
  paving0.name = 'StreetPaving';
  root.add(paving0);

  // 场地（避免远处构件悬在虚空）
  const site = applyWall(M.stone({ bands: [0.3, 0.6, 0.98], outline: false }), 'stoneBlock', [20, 20]);
  const ground = new THREE.Mesh(boxGeo(200, 0.3, 140), site);
  ground.name = 'StreetSite';        // 命名以便克隆后裁剪（多个街段克隆时地面会共面打架）
  ground.position.y = -0.16;
  ground.receiveShadow = true;
  ground.userData.noOutline = true;
  root.add(ground);

  const terraces = [];
  const L = SPEC.len;
  for (const side of [1, -1]) {
    let x = -L / 2, k = 0;
    while (x < L / 2 - 1) {
      const w = [7.2, 6.0, 8.4, 6.6][(k + (side > 0 ? 1 : 0)) % 4];
      const floors = SPEC.floors[(k + (side > 0 ? 2 : 0)) % 4];
      const t = buildTerrace(MT, { w, floors, side, seed: k * 3 + (side > 0 ? 2 : 0) });
      t.name = 'Terrace' + (side > 0 ? 'P' : 'N');   // 命名以便按侧裁剪（临河那排要删掉留步道）
      t.position.set(x + w / 2, 0, side * SPEC.facadeZ);
      terraces.push(t);
      root.add(t);
      if (k % 3 === 1) {
        const aw = buildAwning(MT, [x + w / 2, 0, side * SPEC.facadeZ], w * 0.6, -side);
        root.add(aw);
      }
      x += w; k++;
    }
  }

  const lamps = [];
  for (const side of [1, -1]) {
    for (let i = 0; i < 5; i++) {
      const x = -L / 2 + 6 + i * SPEC.lampStep + (side > 0 ? SPEC.lampStep / 2 : 0);
      const l = buildSteamLamp(MT, [x, SPEC.kerb, side * (SPEC.road / 2 + 1.0)]);
      lamps.push(l);
      root.add(l);
    }
  }

  const hydrants = [
    buildHydrant(MT, [-L * 0.3, SPEC.kerb, SPEC.road / 2 + 1.8], -0.5),
    buildHydrant(MT, [L * 0.32, SPEC.kerb, -(SPEC.road / 2 + 1.8)], 2.2),
  ];
  root.add(...hydrants);
  const boxes = [buildPillarBox(MT, [-L * 0.1, SPEC.kerb, SPEC.road / 2 + 1.6])];
  root.add(...boxes);
  const kiosks = [buildKiosk(MT, [L * 0.22, 0, -(SPEC.road / 2 + 2.4)])];
  root.add(...kiosks);

  const thinTagged = tagThinMembers(root, {
    torusTubeMax: 0.34, tubeRadiusMax: 0.26, cylRadiusMax: 0.3, boxMinAxis: 0.2,
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
    SPEC, terraces, lamps, hydrants, boxes, kiosks,
    setNight(on) {
      const k = on ? 1 : 0.3;
      MT.lampWarm.color.copy(C.lampWarm).multiplyScalar(1.7 * k);
      MT.winLit.color.copy(new THREE.Color('#FFC271')).multiplyScalar(1.15 * k);
    },
    flicker(t, on) {
      const f = on ? 0.9 + 0.1 * Math.sin(t * 9.1) * Math.sin(t * 3.3) : 1;
      for (const l of lamps) l.scale.setScalar(f);
    },
  };
  return root;
}

/** 兼容旧命名（canal/riverside 若引用） */
export const buildStreetLamp = buildSteamLamp;
export { buildTerrace, buildSteamLamp, buildHydrant, buildKiosk as buildNewsKiosk };
export default { build, SPEC, buildStreetLamp };
