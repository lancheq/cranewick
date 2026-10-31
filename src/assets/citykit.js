/**
 * citykit.js — 预设城市建筑套件（可复用素材）
 * 对应 docs/DECISIONS.md F-01 / F-06 与 src/core/scale.js。
 *
 * 风格铁律：**蒸汽朋克 = 蒸汽机 / 工业革命机械构建的近未来科幻体系**
 *   ✓ 结构外露（看得见动力从哪来）  ✓ 机械可动件  ✓ 黄铜 + 铸铁 + 铜管 + 铆接钢板 + 压力容器
 *   ✗ 哥特尖拱 / 尖塔 / 雉堞 / 纯石砌体量 / 阴郁低饱和
 *
 * 五类组件签名统一，供全场景按需布置与实例化：
 *   buildResidential(o) 居民楼 · buildVilla(o) 小别墅 · buildFactory(o) 工厂
 *
 * 约定：参数化出变体；返回 Group；`userData.parts` 暴露可动件与挂点；
 *       组件内**禁止写死世界坐标**（位置由调用方给）。
 */
import * as THREE from 'three';
import { C, BANDS } from '../core/palette.js';
import { M, lamp, toon } from '../core/materials.js';
import {
  bevelBox, boxGeo, cylGeo, sphereGeo, coneGeo, mesh,
  rivets, pipe, railing, truss, gear, gearPair, addOutline, refHuman,
  strutBetween, updateStrut, unitStrut, bearingBlock, mountFlange, tagThinMembers,
} from '../core/primitives.js';
import { H, CITY, STREET, CANAL } from '../core/scale.js';
import { applyWall } from '../core/textures.js';

// ---------------------------------------------------------------------------
// 材质（蒸汽朋克口径：暖铜 + 铸铁 + 铆接钢）
// ---------------------------------------------------------------------------
export function makeMaterials(MT) {
  if (MT) return MT;
  // 墙面一律走程序化贴图（砖/石/抹灰共 6 种），禁止纯色块
  const brickA = M.brick({ bands: BANDS.wall, outlineWidth: 0.026 });
  const brickB = M.brick({ bands: BANDS.wall, outlineWidth: 0.026 });
  const brickC = M.brick({ bands: BANDS.wall, outlineWidth: 0.026 });
  const brickD = M.brick({ bands: BANDS.wall, outlineWidth: 0.026 });
  const stoneT = M.stone({ bands: [0.2, 0.48, 0.9], outlineWidth: 0.026 });
  const plasterT = M.stone({ bands: BANDS.wall, outlineWidth: 0.024 });
  applyWall(brickA, 'brickRed',   [3, 3]);
  applyWall(brickB, 'brickBuff',  [3, 3]);
  applyWall(brickC, 'brickSooty', [3, 2]);
  applyWall(brickD, 'brickBlue',  [3, 3]);
  applyWall(stoneT, 'stoneBlock', [2, 2]);
  applyWall(plasterT, 'plaster',  [3, 3]);
  return {
    brickA, brickB, brickC, brickD, stoneT, plasterT,
    brick: brickA, brickWarm: brickB, brickSooty: brickC, brickEngineered: brickD,
    stoneTextured: stoneT, plasterTextured: plasterT,
    stone: stoneT,
    stoneDark: M.stone({ color: new THREE.Color('#575146'), bands: [0.22, 0.5, 0.88], outlineWidth: 0.024 }),
    iron: M.iron({ bands: [0.26, 0.56, 1.0], outlineWidth: 0.028 }),
    ironDark: M.iron({ color: C.ironLo, bands: [0.24, 0.52, 0.96], outlineWidth: 0.026 }),
    steel: M.iron({ color: new THREE.Color('#5A626B'), bands: [0.26, 0.58, 1.0], outlineWidth: 0.028 }),
    brass: M.brass({ bands: [0.3, 0.62, 1.0], outlineWidth: 0.03 }),
    brassDark: M.brass({ color: C.brassLo, bands: [0.24, 0.52, 1.0], outlineWidth: 0.028 }),
    bronze: M.bronze({ bands: [0.28, 0.58, 1.0], outlineWidth: 0.028 }),
    copper: M.bronze({ color: new THREE.Color('#A55F3A'), bands: [0.3, 0.6, 1.0], outlineWidth: 0.028 }),
    verdigris: M.verdigris({ bands: [0.26, 0.58, 1.0], outlineWidth: 0.026 }),
    wood: M.wood({ bands: [0.26, 0.56, 1.0], outlineWidth: 0.026 }),
    glass: M.glassLamp({ color: C.accentVerdigris, opacity: 0.42 }),
    window: toon(new THREE.Color('#1F2A30'), { bands: [0.16, 0.4, 0.9], outline: false }),
    windowLit: lamp(new THREE.Color('#FFC271'), 1.15),
    lampWarm: lamp(C.lampWarm, 1.6),
    grass: toon(new THREE.Color('#42502F'), { bands: [0.34, 0.62, 0.98], outline: false }),
    gravel: M.stone({ color: new THREE.Color('#6B665C'), bands: [0.3, 0.6, 0.98], outline: false }),
    flower: toon(new THREE.Color('#8A4A55'), { bands: [0.3, 0.62, 1.0], outline: false }),
    foliage: toon(new THREE.Color('#3A4A31'), { bands: [0.26, 0.54, 0.96], outlineWidth: 0.02 }),
    water: toon(new THREE.Color('#2B4448'), { bands: [0.24, 0.5, 0.94], outline: false }),
    // ↓ 以下四项都是被引用但表里缺键的（缺键 ⇒ 默认 MeshBasicMaterial ⇒ 恒亮「发光」）：
    //   steamGlow 是发电塔顶的蒸汽柱 —— 缺键时它变成一坨**不透明纯白锥**，就是「顶部发光」的真凶
    slateRoof: M.stone({ color: new THREE.Color('#4A4E52'), bands: [0.3, 0.6, 0.98], outlineWidth: 0.012 }),
    rope: M.rope({ outlineWidth: 0 }),
    canvas: M.canvas({ color: new THREE.Color('#C9BFA6'), bands: BANDS.soft, outlineWidth: 0.012 }),
    steamGlow: (() => {
      const m = toon(new THREE.Color('#FFF0D6'), { bands: [0.6, 1.0], outline: false });
      m.transparent = true; m.opacity = 0.42; m.depthWrite = false; return m;
    })(),
  };
}

/** 蒸汽朋克通用件：外露铜管段（带法兰）+ 压力表盘 */
function steamRun(parent, pts, MT, r = 0.09) {
  pipe(parent, pts, { radius: r, mat: MT.copper, segments: 26, flanges: false, name: 'SteamRun' });
  for (const p of pts) {
    const f = new THREE.Mesh(new THREE.TorusGeometry(r * 1.9, r * 0.34, 6, 12), MT.brass);
    f.position.fromArray(p);
    parent.add(f);
  }
}
function pressureGauge(parent, pos, MT, face = 0.16, lit = false) {
  const g = new THREE.Mesh(cylGeo(face, face, 0.07, 12), MT.brass);
  g.rotation.x = Math.PI / 2;
  g.position.fromArray(pos);
  parent.add(g);
  // v9.2：表盘面不再自发光（原来 HDR 面片在全场景里「刺眼」）
  const f = new THREE.Mesh(new THREE.CircleGeometry(face * 0.76, 12), lit ? MT.lampWarm : MT.brassDark);
  f.position.set(pos[0], pos[1], pos[2] + 0.04);
  f.userData.noOutline = true;
  parent.add(f);
}
/** 铆接钢板带（沿水平边） */
function rivetBand(parent, x0, x1, y, z, MT, step = 0.34) {
  rivets(parent, { from: [x0, y, z], to: [x1, y, z], spacing: step, normal: [0, 0, Math.sign(z) || 1], mat: MT.brassDark });
}

// ===========================================================================
// ① 居民楼（联排 / 多层公寓）
// 语言：砖基 + 外挑铆接铁阳台 + 外挂铜管 + 屋顶压力罐 + 底商卷帘门
// ===========================================================================
export function buildResidential(o = {}) {
  const MT = makeMaterials(o.materials);
  const cfg = { ...CITY.residential, ...o };
  const w = cfg.w, d = cfg.d, floors = cfg.floors;
  const fh = H.floor;
  const hh = floors * fh;
  const g = new THREE.Group();
  g.name = 'Residential';

  // 石基 + 砖身
  const plinth = new THREE.Mesh(bevelBox(w + 0.4, 1.0, d + 0.4, 0.16, 2), MT.stoneDark);
  plinth.position.y = 0.5;
  plinth.receiveShadow = true;
  g.add(plinth);
  // 墙面：按 cfg.wall 序号在 6 种里挑（原来只有 brick / brickWarm 两种 ⇒ 一眼看过去全一样）
  const WALLS = [MT.brick, MT.brickWarm, MT.brickSooty, MT.brickEngineered, MT.plasterTextured, MT.stoneTextured];
  const wallMat = WALLS[((cfg.wall ?? (cfg.seed ?? 0)) % WALLS.length + WALLS.length) % WALLS.length];
  const body = new THREE.Mesh(boxGeo(w, hh, d), wallMat);
  body.position.y = hh / 2 + 0.6;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // 檐口（铆接钢板，不是石线脚）
  const cornice = new THREE.Mesh(bevelBox(w + 0.7, 0.42, d + 0.7, 0.1, 2), MT.steel);
  cornice.position.y = hh + 0.85;
  cornice.castShadow = true;
  g.add(cornice);
  rivets(g, { from: [-w / 2 - 0.2, hh + 1.08, d / 2 + 0.36], to: [w / 2 + 0.2, hh + 1.08, d / 2 + 0.36], spacing: 0.36, normal: [0, 0, 1], mat: MT.brass });

  // -------------------------------------------------------------------------
  // 屋顶：**四款样式**（用户："都是一样的房顶和高度"）
  //   tank  压力罐 + 黄铜穹顶 + 排气管（蒸汽朋克的原味）
  //   gable 双坡瓦屋顶 + 屋脊 + 老虎窗 + 砖砌烟囱
  //   flat  平顶 + 女儿墙 + 水柜 + 管束（工业阁楼）
  //   saw   锯齿形屋顶（厂房语汇）+ 通风帽
  // 屋顶是"远看相像"的主要信息，四款混排就能把一条街的重复感打掉。
  // -------------------------------------------------------------------------
  const roofY = hh + 0.6;
  const roofKind = cfg.roof ?? 'tank';
  if (roofKind === 'gable') {
    const rise = 2.2 + (cfg.roofSeed ?? 0) % 3 * 0.4;
    const pitch = Math.atan2(rise, d / 2);
    const slabLen = Math.hypot(d / 2, rise) + 0.2;
    for (const sz of [-1, 1]) {
      const slab = new THREE.Mesh(boxGeo(w + 0.9, 0.28, slabLen), MT.slateRoof);
      slab.position.set(0, roofY + rise / 2, sz * d / 4);
      slab.rotation.x = sz * -pitch;
      slab.castShadow = true;
      g.add(slab);
    }
    const ridge = new THREE.Mesh(cylGeo(0.18, 0.18, w + 1.1, 8), MT.brassDark);
    ridge.rotation.z = Math.PI / 2;
    ridge.position.set(0, roofY + rise + 0.05, 0);
    g.add(ridge);
    // 老虎窗 ×2 + 砖砌烟囱
    for (const sx of [-w * 0.26, w * 0.24]) {
      const dor = new THREE.Mesh(boxGeo(1.5, 1.3, 1.2), wallMat);
      dor.position.set(sx, roofY + rise * 0.62, -d * 0.2);
      g.add(dor);
      const dfr = new THREE.Mesh(boxGeo(0.95, 0.8, 0.08), MT.window);
      dfr.position.set(sx, roofY + rise * 0.62, -d * 0.2 - 0.64);
      dfr.userData.noOutline = true;
      g.add(dfr);
    }
    const chim = new THREE.Mesh(boxGeo(1.0, 2.6, 1.0), wallMat);
    chim.position.set(w * 0.32, roofY + rise * 0.5 + 1.3, d * 0.24);
    chim.castShadow = true;
    g.add(chim);
    const chimCap = new THREE.Mesh(boxGeo(1.3, 0.24, 1.3), MT.stoneDark);
    chimCap.position.set(w * 0.32, roofY + rise * 0.5 + 2.7, d * 0.24);
    g.add(chimCap);
  } else if (roofKind === 'flat') {
    for (const sz of [-1, 1]) {
      const par = new THREE.Mesh(boxGeo(w + 0.5, 0.8, 0.3), MT.stoneDark);
      par.position.set(0, roofY + 0.4, sz * (d / 2 + 0.1));
      g.add(par);
    }
    for (const sx of [-1, 1]) {
      const par = new THREE.Mesh(boxGeo(0.3, 0.8, d + 0.5), MT.stoneDark);
      par.position.set(sx * (w / 2 + 0.1), roofY + 0.4, 0);
      g.add(par);
    }
    const cistern = new THREE.Mesh(cylGeo(1.0, 1.0, 1.7, 12), MT.iron);
    cistern.position.set(-w * 0.2, roofY + 0.85, d * 0.18);
    cistern.castShadow = true;
    g.add(cistern);
    for (const dx of [-0.45, 0.45]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.06, 6, 14), MT.brassDark);
      hoop.position.set(-w * 0.2 + dx, roofY + 0.85, d * 0.18);
      hoop.rotation.x = Math.PI / 2;
      g.add(hoop);
    }
    for (let k = 0; k < 3; k++) {
      const pipe = new THREE.Mesh(cylGeo(0.16, 0.16, 1.6 + k * 0.5, 8), MT.copper);
      pipe.position.set(w * 0.16 + k * 0.5, roofY + 0.8 + k * 0.25, -d * 0.22);
      g.add(pipe);
    }
  } else if (roofKind === 'saw') {
    const teeth = 3;
    for (let k = 0; k < teeth; k++) {
      const tw = w / teeth;
      const tx = -w / 2 + tw * (k + 0.5);
      const glass = new THREE.Mesh(boxGeo(tw * 0.9, 1.8, d * 0.86), MT.window);
      glass.position.set(tx, roofY + 0.9, 0);
      glass.rotation.x = -0.5;
      glass.userData.noOutline = true;
      g.add(glass);
      const cap = new THREE.Mesh(boxGeo(tw * 0.94, 0.26, d * 0.9), MT.slateRoof);
      cap.position.set(tx, roofY + 1.85, 0);
      cap.rotation.x = -0.5;
      g.add(cap);
    }
    const hood = new THREE.Mesh(cylGeo(0.9, 1.1, 1.0, 10), MT.brass);
    hood.position.set(w * 0.3, roofY + 2.6, 0);
    g.add(hood);
  } else {
    const tank = new THREE.Mesh(cylGeo(1.15, 1.15, 2.4, 14), MT.steel);
    tank.rotation.z = Math.PI / 2;
    tank.position.set(-w * 0.22, hh + 2.3, 0);
    tank.castShadow = true;
    g.add(tank);
    for (const dx of [-0.7, 0.7]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.07, 6, 16), MT.brass);
      hoop.position.set(-w * 0.22 + dx, hh + 2.3, 0);
      hoop.rotation.y = Math.PI / 2;
      g.add(hoop);
    }
    const dome = new THREE.Mesh(sphereGeo(1.0, 14, 9, 0, Math.PI * 2, 0, Math.PI / 2), MT.brass);
    dome.position.set(w * 0.24, hh + 1.3, 0);
    g.add(dome);
    const vent = new THREE.Mesh(cylGeo(0.22, 0.28, 2.6, 10), MT.iron);
    vent.position.set(w * 0.36, hh + 2.4, d * 0.28);
    g.add(vent);
    const ventCap = new THREE.Mesh(cylGeo(0.44, 0.24, 0.26, 10), MT.brass);
    ventCap.position.set(w * 0.36, hh + 3.75, d * 0.28);
    g.add(ventCap);
  }

  // 外挂铜管（两条竖向蒸汽主管，含法兰）
  for (const sx of [-w / 2 + 0.5, w / 2 - 0.5]) {
    steamRun(g, [
      [sx, 0.9, d / 2 + 0.22],
      [sx, hh * 0.5, d / 2 + 0.24],
      [sx, hh + 0.6, d / 2 + 0.22],
    ], MT, 0.1);
  }
  // 二楼压力表盘（外露，说明这栋楼在用蒸汽）
  pressureGauge(g, [w * 0.1, 0.6 + fh * 1.5, d / 2 + 0.12], MT, 0.15);

  // 各层：窗 + 外挑铆接铁阳台
  const bays = cfg.bays;
  const winW = 1.15, winH = 1.7;
  for (let f = 1; f < floors; f++) {
    const y = 0.6 + f * fh;
    for (let b = 0; b < bays; b++) {
      const x = bays === 1 ? 0 : -w / 2 + (w / (bays + 1)) * (b + 1);
      // 窗套（钢）+ 暗玻璃 + 十字窗棂
      const fr = new THREE.Mesh(boxGeo(winW + 0.3, winH + 0.3, 0.16), MT.steel);
      fr.position.set(x, y + winH / 2 + 0.5, d / 2 + 0.04);
      g.add(fr);
      const gl = new THREE.Mesh(boxGeo(winW, winH, 0.06), ((f * 5 + b) % 4 === 0) ? MT.windowLit : MT.window);
      gl.position.set(x, y + winH / 2 + 0.5, d / 2 + 0.13);
      gl.userData.noOutline = true;
      g.add(gl);
      strutBetween(g, [x, y + 0.5, d / 2 + 0.18], [x, y + winH + 0.5, d / 2 + 0.18], { radius: 0.035, mat: MT.brassDark, name: 'Mullion' });
      strutBetween(g, [x - winW / 2, y + winH / 2 + 0.5, d / 2 + 0.18], [x + winW / 2, y + winH / 2 + 0.5, d / 2 + 0.18], { radius: 0.035, mat: MT.brassDark, name: 'Mullion' });
      // 阳台（外挑 0.9 m 铆接钢板 + 黄铜栏杆）
      if (((f + b) % 2 === 0)) {
        const deck = new THREE.Mesh(boxGeo(winW + 1.0, 0.14, 0.95), MT.steel);
        deck.position.set(x, y - 0.1, d / 2 + 0.48);
        deck.castShadow = true;
        g.add(deck);
        for (const bx of [-winW / 2 - 0.2, winW / 2 + 0.2]) {
          strutBetween(g, [x + bx, y - 0.05, d / 2 + 0.9], [x + bx, y + 0.55, d / 2 + 0.02],
            { radius: 0.045, mat: MT.brass, name: 'BalconyTie' });
        }
        const br = railing(g, winW + 1.0, { height: H.railH, radius: 0.035, posts: 4, mat: MT.brass });
        br.position.set(x, y - 0.03, d / 2 + 0.9);
      }
    }
  }

  // 底层：卷帘门 + 店招铁架 + 门外蒸汽排气管
  const shutter = new THREE.Mesh(boxGeo(2.6, 2.1, 0.1), MT.iron);
  shutter.position.set(-w * 0.24, 1.65, d / 2 + 0.08);
  g.add(shutter);
  for (let i = 0; i < 6; i++) {
    const louver = new THREE.Mesh(boxGeo(2.5, 0.06, 0.05), MT.brassDark);
    louver.position.set(-w * 0.24, 0.75 + i * 0.32, d / 2 + 0.15);
    g.add(louver);
  }
  const door = new THREE.Mesh(boxGeo(1.2, H.door, 0.12), MT.wood);
  door.position.set(w * 0.2, 1.1, d / 2 + 0.08);
  g.add(door);
  strutBetween(g, [w * 0.2, 2.6, d / 2 + 0.02], [w * 0.2, 2.6, d / 2 + 1.1], { radius: 0.06, mat: MT.iron, name: 'SignArm' });
  strutBetween(g, [w * 0.2, 2.6, d / 2 + 1.05], [w * 0.2, 2.15, d / 2 + 1.05], { radius: 0.03, mat: MT.brassDark, name: 'SignHang' });
  const board = new THREE.Mesh(bevelBox(0.06, 0.5, 0.9, 0.03), MT.wood);
  board.position.set(w * 0.2, 2.3, d / 2 + 1.05);
  g.add(board);
  const dl = new THREE.Mesh(cylGeo(0.11, 0.14, 0.3, 8), MT.lampWarm);
  dl.position.set(w * 0.2, 2.75, d / 2 + 0.34);
  dl.userData.noOutline = true;
  g.add(dl);

  g.userData.parts = {
    type: 'residential', w, d, floors, hh,
    /** 挂点：商铺招牌位 / 街灯位 / 管接口 */
    anchors: {
      sign: [w * 0.2, 2.6, d / 2 + 1.05],
      lamp: [w * 0.2, 2.86, d / 2 + 0.34],
      steamIn: [-w / 2 + 0.5, 0.9, d / 2 + 0.22],
    },
    emissive: [dl],
  };
  return g;
}

// ===========================================================================
// ② 小别墅
// 语言：两层 + 玻璃温室 + 铜制风向标 + 外部锅炉罐 + 院墙铁门
// ===========================================================================
export function buildVilla(o = {}) {
  const MT = makeMaterials(o.materials);
  const cfg = { ...CITY.villa, ...o };
  const w = cfg.w, d = cfg.d, floors = cfg.floors;
  const fh = H.floor;
  const hh = floors * fh;
  const g = new THREE.Group();
  g.name = 'Villa';

  const body = new THREE.Mesh(boxGeo(w, hh, d), MT.brickWarm);
  body.position.y = hh / 2 + 0.45;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  const plinth = new THREE.Mesh(bevelBox(w + 0.5, 0.9, d + 0.5, 0.14, 2), MT.stone);
  plinth.position.y = 0.45;
  g.add(plinth);
  // 坡屋顶（两坡 + 脊）
  const roofH = 2.2;
  const roofGeo = new THREE.CylinderGeometry(0.001, w * 0.72, roofH, 4, 1, false);
  const roof = new THREE.Mesh(roofGeo, MT.slateRoof || MT.stoneDark);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, (d * 0.78) / (w * 0.72));
  roof.position.y = hh + 0.5 + roofH / 2;
  roof.castShadow = true;
  g.add(roof);
  const ridge = new THREE.Mesh(boxGeo(w * 0.5, 0.16, 0.3), MT.ironDark);
  ridge.position.y = hh + 0.5 + roofH;
  g.add(ridge);

  // 烟囱 + 铜制风向标（会转，是这套件里唯一的可动件之一）
  const chim = new THREE.Mesh(boxGeo(0.8, 2.6, 0.7), MT.brick);
  chim.position.set(-w * 0.3, hh + 1.7, 0);
  chim.castShadow = true;
  g.add(chim);
  const chimCap = new THREE.Mesh(boxGeo(1.05, 0.2, 0.95), MT.stone);
  chimCap.position.set(-w * 0.3, hh + 3.05, 0);
  g.add(chimCap);
  const pot = new THREE.Mesh(cylGeo(0.16, 0.2, 0.6, 10), MT.verdigris);
  pot.position.set(-w * 0.3, hh + 3.45, 0);
  g.add(pot);

  const vanePivot = new THREE.Group();
  vanePivot.name = 'WeatherVane';
  vanePivot.position.set(w * 0.28, hh + 2.9, 0);
  const vaneRod = new THREE.Mesh(cylGeo(0.03, 0.03, 1.2, 6), MT.brass);
  vaneRod.position.y = 0.6;
  vanePivot.add(vaneRod);
  const arrow = new THREE.Mesh(boxGeo(0.7, 0.05, 0.05), MT.brass);
  arrow.position.y = 1.18;
  vanePivot.add(arrow);
  const tail = new THREE.Mesh(boxGeo(0.24, 0.26, 0.03), MT.brass);
  tail.position.set(-0.32, 1.18, 0);
  vanePivot.add(tail);
  const cardinal = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.02, 6, 12), MT.brass);
  cardinal.rotation.x = Math.PI / 2;
  cardinal.position.y = 1.02;
  vanePivot.add(cardinal);
  g.add(vanePivot);

  // 玻璃温室（侧翼，铜框 + 玻璃）
  const ghW = 3.2, ghD = d * 0.7, ghH = 2.5;
  const gh = new THREE.Group();
  gh.name = 'Conservatory';
  gh.position.set(w / 2 + ghW / 2 - 0.2, 0, 0);
  const ghBase = new THREE.Mesh(bevelBox(ghW, 0.6, ghD, 0.1), MT.stone);
  ghBase.position.y = 0.3;
  gh.add(ghBase);
  const ghGlass = new THREE.Mesh(boxGeo(ghW - 0.3, ghH - 0.6, ghD - 0.3), MT.glass);
  ghGlass.position.y = 0.6 + (ghH - 0.6) / 2;
  ghGlass.userData.noOutline = true;
  gh.add(ghGlass);
  for (const z of [-ghD / 2 + 0.15, ghD / 2 - 0.15]) {
    strutBetween(gh, [0, 0.6, z], [0, ghH, z], { radius: 0.05, mat: MT.brass, name: 'GhPost' });
  }
  for (const x of [-ghW / 2 + 0.15, ghW / 2 - 0.15]) {
    strutBetween(gh, [x, 0.6, -ghD / 2], [x, ghH, -ghD / 2], { radius: 0.05, mat: MT.brass, name: 'GhPost' });
    strutBetween(gh, [x, 0.6, ghD / 2], [x, ghH, ghD / 2], { radius: 0.05, mat: MT.brass, name: 'GhPost' });
  }
  // 玻璃暖房的蒸汽加热管（这是它存在的理由）
  steamRun(gh, [
    [-ghW * 0.32, 0.4, -ghD * 0.32],
    [ghW * 0.32, 0.4, -ghD * 0.32],
    [ghW * 0.32, 0.4, ghD * 0.32],
    [-ghW * 0.32, 0.4, ghD * 0.32],
  ], MT, 0.07);
  const ghRoof = new THREE.Mesh(new THREE.CylinderGeometry(0.001, ghW * 0.6, 1.0, 4, 1, false), MT.brassDark);
  ghRoof.rotation.y = Math.PI / 4;
  ghRoof.scale.set(1, 1, (ghD * 0.66) / (ghW * 0.6));
  ghRoof.position.y = ghH + 0.5;
  gh.add(ghRoof);
  g.add(gh);

  // 外部锅炉罐（证明这栋房子自己烧蒸汽）
  const boiler = new THREE.Mesh(cylGeo(0.62, 0.62, 1.5, 14), MT.steel);
  boiler.rotation.z = Math.PI / 2;
  boiler.position.set(-w / 2 - 0.9, 1.0, -d * 0.2);
  boiler.castShadow = true;
  g.add(boiler);
  for (const dx of [-0.45, 0.45]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.05, 6, 14), MT.brass);
    hoop.position.set(-w / 2 - 0.9 + dx, 1.0, -d * 0.2);
    hoop.rotation.y = Math.PI / 2;
    g.add(hoop);
  }
  steamRun(g, [
    [-w / 2 - 0.9, 1.4, -d * 0.2],
    [-w / 2 - 0.9, 2.4, -d * 0.2],
    [-w / 2 - 0.2, 2.6, 0],
  ], MT, 0.08);

  // 窗（2 层）
  for (let f = 0; f < floors; f++) {
    for (let i = 0; i < 2; i++) {
      const x = -w * 0.24 + i * w * 0.48;
      const y = 0.45 + f * fh + 1.5;
      const fr = new THREE.Mesh(boxGeo(1.2, 1.7, 0.14), MT.steel);
      fr.position.set(x, y, d / 2 + 0.03);
      g.add(fr);
      const gl = new THREE.Mesh(boxGeo(1.0, 1.5, 0.06), (f === 1 && i === 1) ? MT.windowLit : MT.window);
      gl.position.set(x, y, d / 2 + 0.11);
      gl.userData.noOutline = true;
      g.add(gl);
    }
  }
  // 门 + 门灯
  const door = new THREE.Mesh(boxGeo(1.2, H.door, 0.14), MT.wood);
  door.position.set(0, 1.5, d / 2 + 0.06);
  g.add(door);
  const hood = new THREE.Mesh(bevelBox(1.9, 0.16, 1.0, 0.06, 2), MT.brassDark);
  hood.position.set(0, 2.85, d / 2 + 0.5);
  g.add(hood);
  const dl = new THREE.Mesh(cylGeo(0.1, 0.13, 0.3, 8), MT.lampWarm);
  dl.position.set(0.95, 2.5, d / 2 + 0.34);
  dl.userData.noOutline = true;
  g.add(dl);

  // 院墙 + 铁门
  const yardW = w + ghW + 4.0;
  for (const sz of [-1, 1]) {
    const wall = new THREE.Mesh(boxGeo(yardW, 1.1, 0.35), MT.stone);
    wall.position.set(ghW * 0.2, 0.55, sz * (d / 2 + 2.6));
    wall.castShadow = true;
    g.add(wall);
    for (let i = 0; i <= 6; i++) {
      const pier = new THREE.Mesh(boxGeo(0.45, 1.3, 0.5), MT.stoneDark);
      pier.position.set(-yardW / 2 + (yardW * i) / 6 + ghW * 0.2, 0.65, sz * (d / 2 + 2.6));
      g.add(pier);
    }
  }
  const gate = new THREE.Mesh(boxGeo(0.1, 1.5, 2.4), MT.iron);
  gate.position.set(-w * 0.1, 0.75, d / 2 + 2.6);
  g.add(gate);
  const gateArch = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.07, 6, 14, Math.PI), MT.brassDark);
  gateArch.rotation.y = Math.PI / 2;
  gateArch.position.set(-w * 0.1, 1.6, d / 2 + 2.6);
  g.add(gateArch);

  g.userData.parts = {
    type: 'villa', w, d, floors, hh, yardW,
    vane: vanePivot,
    anchors: { lamp: [0.95, 2.5, d / 2 + 0.34], steamIn: [-w / 2 - 0.9, 1.4, -d * 0.2] },
    emissive: [dl],
  };
  return g;
}

// ===========================================================================
// ③ 工厂
// 语言：锯齿屋顶厂房 + 外露锅炉房 + 高烟囱 + 管廊 + 冷却塔 + 龙门吊 + 传送带
// ===========================================================================
export function buildFactory(o = {}) {
  const MT = makeMaterials(o.materials);
  const cfg = { ...CITY.factory, ...o };
  const w = cfg.w, d = cfg.d, hh = cfg.h, stackH = cfg.stackH;
  const g = new THREE.Group();
  g.name = 'Factory';

  // 厂房主体（铆接钢框架 + 砖填充）
  const body = new THREE.Mesh(boxGeo(w, hh, d), MT.brickSooty || MT.brick);
  body.position.y = hh / 2 + 0.4;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  const base = new THREE.Mesh(bevelBox(w + 0.6, 0.8, d + 0.6, 0.14, 2), MT.stoneDark);
  base.position.y = 0.4;
  g.add(base);
  // 外露钢柱（每隔 4 m 一根，看得见结构）
  for (let i = 0; i <= Math.round(w / 4); i++) {
    const x = -w / 2 + (w * i) / Math.round(w / 4);
    for (const sz of [1, -1]) {
      strutBetween(g, [x, 0.8, sz * (d / 2 + 0.12)], [x, hh + 0.4, sz * (d / 2 + 0.12)],
        { radius: 0.16, mat: MT.steel, name: 'FactoryColumn' });
    }
  }
  // 锯齿屋顶（3 跨：斜屋面 + 采光天窗朝向同一侧）
  const bays = 3;
  for (let i = 0; i < bays; i++) {
    const z = -d / 2 + (d * (i + 0.5)) / bays;
    const slope = new THREE.Mesh(boxGeo(w + 0.4, 0.24, d / bays * 0.9), MT.steel);
    slope.position.set(0, hh + 1.0, z);
    slope.rotation.x = 0.42;
    slope.castShadow = true;
    g.add(slope);
    // v8.1：原来是一整条大玻璃（被读成"太阳能板"）⇒ 改为竖向窄窗阵列 + 黄铜窗棂
    const nWin = Math.max(6, Math.round(w / 2.4));
    for (let wi = 0; wi < nWin; wi++) {
      const wx = -w / 2 + (w * (wi + 0.5)) / nWin;
      const pane = new THREE.Mesh(boxGeo(0.95, 1.5, 0.1), MT.window);
      pane.position.set(wx, hh + 1.85, z + d / bays * 0.42);
      pane.rotation.x = 0.18;
      pane.userData.noOutline = true;
      g.add(pane);
      for (const mx of [-0.5, 0, 0.5]) {
        strutBetween(g, [wx + mx, hh + 1.12, z + d / bays * 0.42], [wx + mx, hh + 2.6, z + d / bays * 0.42],
          { radius: 0.035, mat: MT.brassDark, name: 'FactoryMullion' });
      }
    }
  }
  // 外墙铆钉带
  for (const sz of [1, -1]) {
    rivetBand(g, -w / 2, w / 2, hh + 0.35, sz * (d / 2 + 0.12), MT, 0.42);
  }
  // 高烟囱（锥度 + 石箍 + 黄铜冠口）
  const stX = -w / 2 - 3.2;
  const segs = 6, d0 = 3.0, d1 = 1.6;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const r0 = (d0 + (d1 - d0) * t0) / 2;
    const r1 = (d0 + (d1 - d0) * t1) / 2;
    const seg = new THREE.Mesh(cylGeo(r1, r0, stackH / segs, 16), MT.brickWarm);
    seg.position.set(stX, stackH * (t0 + t1) / 2, 0);
    seg.castShadow = true;
    g.add(seg);
    const band = new THREE.Mesh(new THREE.TorusGeometry(r1 + 0.1, 0.11, 6, 20), MT.stone);
    band.position.set(stX, stackH * t1, 0);
    band.rotation.x = Math.PI / 2;
    g.add(band);
  }
  const crown = new THREE.Mesh(cylGeo(d1 * 0.62, d1 * 0.58, 0.9, 16), MT.stone);
  crown.position.set(stX, stackH + 0.3, 0);
  g.add(crown);
  const crownRing = new THREE.Mesh(new THREE.TorusGeometry(d1 * 0.66, 0.12, 6, 20), MT.brass);
  crownRing.position.set(stX, stackH + 0.78, 0);
  crownRing.rotation.x = Math.PI / 2;
  g.add(crownRing);

  // 外露锅炉房（一排锅炉罐 + 人孔 + 压力表）
  const blX = w / 2 + 2.6, blZ = -d * 0.3;
  const boilerHouse = new THREE.Mesh(boxGeo(5.4, 3.2, 6.0), MT.ironDark);
  boilerHouse.position.set(blX, 1.6, blZ);
  boilerHouse.castShadow = true;
  g.add(boilerHouse);
  for (let i = 0; i < 3; i++) {
    const bz = blZ - 1.9 + i * 1.9;
    const drum = new THREE.Mesh(cylGeo(0.72, 0.72, 2.4, 14), MT.steel);
    drum.rotation.z = Math.PI / 2;
    drum.position.set(blX + 3.0, 1.5, bz);
    drum.castShadow = true;
    g.add(drum);
    for (const dx of [-0.7, 0.7]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.06, 6, 16), MT.brass);
      hoop.position.set(blX + 3.0 + dx, 1.5, bz);
      hoop.rotation.y = Math.PI / 2;
      g.add(hoop);
    }
    // 人孔（黄铜椭圆盖）
    const manhole = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 6, 14), MT.brass);
    manhole.position.set(blX + 3.0, 2.24, bz);
    manhole.rotation.x = Math.PI / 2;
    g.add(manhole);
    pressureGauge(g, [blX + 3.72, 1.5, bz], MT, 0.14);
  }

  // 管廊（横跨厂房上空的管束，含支架）
  const gy = hh + 2.6;
  for (let k = 0; k < 3; k++) {
    pipe(g, [
      [stX, gy + k * 0.42, 0],
      [0, gy + k * 0.42, 0],
      [blX + 3.0, gy + k * 0.42, blZ],
    ], { radius: 0.13, mat: k === 1 ? MT.copper : MT.steel, segments: 24, name: 'PipeRack' });
  }
  for (const px of [-w * 0.3, 0, w * 0.3]) {
    strutBetween(g, [px, hh + 1.2, 0], [px, gy + 1.1, 0], { radius: 0.14, mat: MT.steel, name: 'RackPost' });
    strutBetween(g, [px - 0.6, gy + 1.2, 0], [px + 0.6, gy + 1.2, 0], { radius: 0.1, mat: MT.steel, name: 'RackBeam' });
  }

  // 冷却塔（分段圆台 + 顶部蒸汽口）
  const ctX = blX + 4.0, ctZ = d * 0.3;
  const ctSegs = 4, ctH = 11, ctBase = 3.4, ctTop = 2.2;
  for (let i = 0; i < ctSegs; i++) {
    const t0 = i / ctSegs, t1 = (i + 1) / ctSegs;
    const bulge = Math.sin(Math.PI * (t0 + t1) / 2) * 0.55;
    const r0 = (ctBase + (ctTop - ctBase) * t0) + bulge * 0.3;
    const r1 = (ctBase + (ctTop - ctBase) * t1) + bulge * 0.3;
    const seg = new THREE.Mesh(cylGeo(r1, r0, ctH / ctSegs, 18, 1, true), MT.steel);
    seg.position.set(ctX, ctH * (t0 + t1) / 2, ctZ);
    seg.castShadow = true;
    g.add(seg);
  }
  const ctRim = new THREE.Mesh(new THREE.TorusGeometry(ctTop + 0.16, 0.14, 6, 22), MT.brass);
  ctRim.position.set(ctX, ctH, ctZ);
  ctRim.rotation.x = Math.PI / 2;
  g.add(ctRim);
  const ctLadder = new THREE.Group();
  ctLadder.name = 'Ladder';
  for (const sz of [-1, 1]) {
    strutBetween(ctLadder, [ctX + ctBase, 0, ctZ + sz * 0.3], [ctX + ctTop, ctH, ctZ + sz * 0.3],
      { radius: 0.05, mat: MT.iron, name: 'LadderRail' });
  }
  for (let i = 0; i < 14; i++) {
    const t = i / 14;
    const r = ctBase + (ctTop - ctBase) * t + Math.sin(Math.PI * t) * 0.16;
    strutBetween(ctLadder, [ctX + r, ctH * t, ctZ - 0.3], [ctX + r, ctH * t, ctZ + 0.3],
      { radius: 0.03, mat: MT.iron, name: 'LadderRung' });
  }
  g.add(ctLadder);

  // 龙门吊（在厂房一端）
  const gantry = new THREE.Group();
  gantry.name = 'Gantry';
  const gx = w * 0.6, gH = hh + 5.0;
  for (const dz of [-d / 2 - 1, d / 2 + 1]) {
    strutBetween(gantry, [gx - 3, 0.6, dz], [gx - 3, gH, dz], { radius: 0.26, mat: MT.steel, name: 'GantryLeg' });
    strutBetween(gantry, [gx + 3, 0.6, dz], [gx + 3, gH, dz], { radius: 0.26, mat: MT.steel, name: 'GantryLeg' });
  }
  strutBetween(gantry, [gx - 3, gH, -d / 2 - 1], [gx - 3, gH, d / 2 + 1], { radius: 0.22, mat: MT.steel, name: 'GantryBeam' });
  strutBetween(gantry, [gx + 3, gH, -d / 2 - 1], [gx + 3, gH, d / 2 + 1], { radius: 0.22, mat: MT.steel, name: 'GantryBeam' });
  strutBetween(gantry, [gx - 3, gH + 0.6, -d / 2 - 1], [gx - 3, gH + 0.6, d / 2 + 1], { radius: 0.14, mat: MT.steel, name: 'GantryBeam2' });
  strutBetween(gantry, [gx + 3, gH + 0.6, -d / 2 - 1], [gx + 3, gH + 0.6, d / 2 + 1], { radius: 0.14, mat: MT.steel, name: 'GantryBeam2' });
  for (let i = 0; i < 9; i++) {
    const z0 = -d / 2 - 1 + ((d + 2) * i) / 9;
    const z1 = -d / 2 - 1 + ((d + 2) * (i + 1)) / 9;
    strutBetween(gantry, [gx - 3, gH, z0], [gx - 3, gH + 0.6, z1], { radius: 0.06, mat: MT.brassDark, name: 'GantryLace' });
    strutBetween(gantry, [gx - 3, gH + 0.6, z1], [gx - 3, gH, z1], { radius: 0.06, mat: MT.brassDark, name: 'GantryLace' });
    strutBetween(gantry, [gx + 3, gH, z0], [gx + 3, gH + 0.6, z1], { radius: 0.06, mat: MT.brassDark, name: 'GantryLace' });
  }
  const trolley = new THREE.Mesh(bevelBox(1.6, 0.9, 1.2, 0.1), MT.bronze);
  trolley.position.set(gx, gH + 1.1, 0);
  gantry.add(trolley);
  const hookBlk = new THREE.Mesh(bevelBox(0.7, 0.6, 0.6, 0.08), MT.iron);
  hookBlk.position.set(gx, gH - 1.6, 0);
  gantry.add(hookBlk);
  strutBetween(gantry, [gx, gH + 0.7, 0], [gx, gH - 1.6, 0], { radius: 0.06, mat: MT.rope, name: 'HookRope' });
  g.add(gantry);


  // -------------------------------------------------------------------------
  // v8.1 新增：蒸馏塔（分馏塔）—— 塔身分段 + 塔盘环 + 回流罐 + 冷凝盘管 + 爬梯
  // -------------------------------------------------------------------------
  const distX = -w / 2 - 8.0, distZ = d * 0.16;
  const distH = 16.0;
  const distSegs = 8;
  for (let i = 0; i < distSegs; i++) {
    const t0 = i / distSegs, t1 = (i + 1) / distSegs;
    const r = 1.15 - t0 * 0.22;
    const seg = new THREE.Mesh(cylGeo(r, r + 0.03, distH / distSegs, 18), MT.steel);
    seg.position.set(distX, 1.2 + distH * (t0 + t1) / 2, distZ);
    seg.castShadow = true;
    g.add(seg);
    // 塔盘环（每段一道凸环 —— 这是"蒸馏塔"的识别特征）
    const tray = new THREE.Mesh(new THREE.TorusGeometry(r + 0.13, 0.075, 6, 20), MT.copper);
    tray.position.set(distX, 1.2 + distH * t1, distZ);
    tray.rotation.x = Math.PI / 2;
    g.add(tray);
  }
  const distBase = new THREE.Mesh(cylGeo(1.7, 2.0, 1.2, 18), MT.ironDark);
  distBase.position.set(distX, 0.6, distZ);
  g.add(distBase);
  // 回流罐（塔顶横卧小罐）
  const reflux = new THREE.Mesh(cylGeo(0.5, 0.5, 1.8, 12), MT.brass);
  reflux.rotation.z = Math.PI / 2;
  reflux.position.set(distX + 1.3, 1.2 + distH + 0.6, distZ);
  g.add(reflux);
  // 冷凝盘管（一摞环）
  for (let i = 0; i < 5; i++) {
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.055, 6, 18), MT.copper);
    coil.position.set(distX - 1.4, 1.2 + distH * 0.66 + i * 0.3, distZ);
    coil.rotation.x = Math.PI / 2;
    g.add(coil);
  }
  pressureGauge(g, [distX + 1.28, 1.2 + distH * 0.4, distZ], MT, 0.16);
  pressureGauge(g, [distX + 1.28, 1.2 + distH * 0.72, distZ], MT, 0.16);
  // 爬梯
  for (const sz of [-1, 1]) {
    strutBetween(g, [distX + 1.2, 0.4, distZ + sz * 0.26], [distX + 1.2, 1.2 + distH + 0.2, distZ + sz * 0.26],
      { radius: 0.045, mat: MT.iron, name: 'DistLadder' });
  }
  for (let i = 0; i < 16; i++) {
    const t = i / 16;
    strutBetween(g, [distX + 1.2, 0.4 + (1.2 + distH - 0.2) * t, distZ - 0.26], [distX + 1.2, 0.4 + (1.2 + distH - 0.2) * t, distZ + 0.26],
      { radius: 0.028, mat: MT.iron, name: 'DistRung' });
  }

  // -------------------------------------------------------------------------
  // v8.1 新增：管道管廊 —— 4 路管束（2 铜 2 钢）+ 支架 + 阀门手轮
  // -------------------------------------------------------------------------
  const rackY = 5.6, rackZ = -d * 0.5 - 1.6;
  for (let n = 0; n < 4; n++) {
    pipe(g, [
      [distX, rackY + n * 0.38, distZ],
      [distX + 2, rackY + n * 0.38, rackZ],
      [blX + 4.0, rackY + n * 0.38, rackZ],
    ], { radius: 0.13, mat: n % 2 ? MT.steel : MT.copper, segments: 24, name: 'PipeRun' });
  }
  for (let i = 0; i <= 4; i++) {
    const px = distX + 2 + ((blX + 4.0 - distX - 2) * i) / 4;
    strutBetween(g, [px, 0.8, rackZ], [px, rackY + 1.3, rackZ], { radius: 0.11, mat: MT.steel, name: 'RackLeg' });
    strutBetween(g, [px - 0.4, rackY + 1.4, rackZ], [px + 0.4, rackY + 1.4, rackZ], { radius: 0.08, mat: MT.steel, name: 'RackCap' });
    strutBetween(g, [px - 0.4, rackY + 0.2, rackZ], [px + 0.4, rackY + 0.2, rackZ], { radius: 0.08, mat: MT.steel, name: 'RackCap' });
  }
  for (const vx of [distX + 6, distX + 14]) {
    const valve = new THREE.Mesh(cylGeo(0.3, 0.3, 0.5, 10), MT.bronze);
    valve.rotation.z = Math.PI / 2;
    valve.position.set(vx, rackY + 0.38, rackZ);
    g.add(valve);
    const wheelV = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.05, 6, 14), MT.brass);
    wheelV.position.set(vx, rackY + 0.9, rackZ);
    wheelV.rotation.x = Math.PI / 2;
    g.add(wheelV);
  }

  // -------------------------------------------------------------------------
  // v8.1 新增：流水线 —— 传送带 + 3 台工位机械 + 料架
  // -------------------------------------------------------------------------
  const line = new THREE.Group();
  line.name = 'ProductionLine';
  const lineZ = d * 0.62, lineY = 1.5;
  const lineLen = w * 0.8;
  const belt = new THREE.Mesh(boxGeo(lineLen, 0.16, 1.3), MT.ironDark);
  belt.position.set(0, lineY, lineZ);
  belt.castShadow = true;
  line.add(belt);
  // 皮带滚轮（可动件）
  const rollers = [];
  const nRoll = Math.round(lineLen / 1.1);
  for (let i = 0; i < nRoll; i++) {
    const r = new THREE.Mesh(cylGeo(0.16, 0.16, 1.35, 10), MT.steel);
    r.rotation.x = Math.PI / 2;
    r.position.set(-lineLen / 2 + (lineLen * (i + 0.5)) / nRoll, lineY - 0.02, lineZ);
    line.add(r);
    rollers.push(r);
  }
  // 侧挡板 + 支腿
  for (const sz of [-0.72, 0.72]) {
    const side = new THREE.Mesh(boxGeo(lineLen, 0.34, 0.1), MT.steel);
    side.position.set(0, lineY + 0.16, lineZ + sz);
    line.add(side);
    rivetBand(line, -lineLen / 2, lineLen / 2, lineY + 0.32, lineZ + sz, MT, 0.5);
  }
  for (let i = 0; i <= 4; i++) {
    const px = -lineLen / 2 + (lineLen * i) / 4;
    strutBetween(line, [px, 0.8, lineZ - 0.6], [px, lineY, lineZ - 0.6], { radius: 0.08, mat: MT.steel, name: 'LineLeg' });
    strutBetween(line, [px, 0.8, lineZ + 0.6], [px, lineY, lineZ + 0.6], { radius: 0.08, mat: MT.steel, name: 'LineLeg' });
  }
  // 三台工位机械：冲压机 / 车削转塔 / 钻床
  const stations = [];
  const stDefs = [
    { t: 0.24, kind: 'press' },
    { t: 0.5, kind: 'turret' },
    { t: 0.76, kind: 'drill' },
  ];
  for (const sd of stDefs) {
    const sx = -lineLen / 2 + lineLen * sd.t;
    const st = new THREE.Group();
    st.name = 'Station_' + sd.kind;
    st.position.set(sx, lineY, lineZ);
    if (sd.kind === 'press') {
      const frame = new THREE.Mesh(bevelBox(1.8, 3.0, 1.6, 0.2, 2), MT.iron);
      frame.position.y = 1.5;
      frame.castShadow = true;
      st.add(frame);
      const crown = new THREE.Mesh(bevelBox(2.1, 0.5, 1.9, 0.12, 2), MT.steel);
      crown.position.y = 3.2;
      st.add(crown);
      const ram = new THREE.Mesh(boxGeo(0.7, 0.9, 0.7), MT.bronze);
      ram.position.y = 2.2;
      st.add(ram);
      const wheelP = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.09, 6, 18), MT.brass);
      wheelP.position.y = 3.7;
      st.add(wheelP);
      st.userData.ram = ram;
    } else if (sd.kind === 'turret') {
      const bed = new THREE.Mesh(bevelBox(2.2, 0.7, 1.4, 0.14, 2), MT.iron);
      bed.position.y = 0.35;
      st.add(bed);
      const turret = new THREE.Mesh(cylGeo(0.55, 0.62, 0.8, 12), MT.steel);
      turret.position.y = 1.15;
      turret.castShadow = true;
      st.add(turret);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        strutBetween(st, [Math.sin(a) * 0.5, 1.4, Math.cos(a) * 0.5], [Math.sin(a) * 0.7, 1.9, Math.cos(a) * 0.7],
          { radius: 0.06, mat: MT.brassDark, name: 'TurretTool' });
      }
      st.userData.turret = turret;
    } else {
      const column = new THREE.Mesh(cylGeo(0.2, 0.26, 3.0, 12), MT.steel);
      column.position.set(-0.5, 1.5, 0);
      st.add(column);
      const head = new THREE.Mesh(bevelBox(0.9, 0.7, 0.8, 0.1, 2), MT.iron);
      head.position.set(0.2, 1.9, 0);
      st.add(head);
      const chuck = new THREE.Mesh(cylGeo(0.22, 0.22, 0.5, 10), MT.bronze);
      chuck.position.set(0.2, 1.15, 0);
      st.add(chuck);
      const table = new THREE.Mesh(boxGeo(1.1, 0.22, 0.9), MT.ironDark);
      table.position.set(0.2, 0.5, 0);
      st.add(table);
      st.userData.chuck = chuck;
    }
    stations.push(st);
    line.add(st);
  }
  // 料架（进料端）
  const rack = new THREE.Mesh(boxGeo(1.6, 0.6, 1.2), MT.iron);
  rack.position.set(-lineLen / 2 - 1.2, lineY, lineZ);
  line.add(rack);
  for (let i = 0; i < 4; i++) {
    const billet = new THREE.Mesh(cylGeo(0.16, 0.16, 1.0, 10), MT.brass);
    billet.rotation.z = Math.PI / 2;
    billet.position.set(lineLen / 2 + 1.0 + i * 0.3, lineY + 0.2, lineZ + (i % 2) * 0.4 - 0.2);
    line.add(billet);
  }
  g.add(line);

  g.userData.parts = {
    type: 'factory', w, d, h: hh, stackH,
    distillation: distX, productionLine: line, rollers, stations,
    gantry, coolingTower: { x: ctX, z: ctZ, h: ctH, r: ctTop },
    anchors: { steamOut: [stX, stackH + 0.9, 0], pipeRack: [0, gy + 1.4, 0] },
    emissive: [],
  };
  return g;
}

// ===========================================================================
// ⑤ 广场
// 语言：石板铺装 + 中央液压压力机式纪念塔 + 街灯 ×4 + 花坛 + 信息牌 + 栓马/系车柱
// ===========================================================================
export function buildPlaza(o = {}) {
  const MT = makeMaterials(o.materials);
  const cfg = { ...CITY.plaza, ...o };
  const w = cfg.w, d = cfg.d;
  const g = new THREE.Group();
  g.name = 'Plaza';

  // 铺装（石板 + 深色镶边）
  const floor = new THREE.Mesh(boxGeo(w, 0.3, d), MT.stone);
  floor.position.y = 0.15;
  floor.receiveShadow = true;
  floor.userData.noOutline = true;
  g.add(floor);
  for (const inset of [[w * 0.42, 0.3, d * 0.9], [w * 0.9, 0.3, d * 0.42]]) {
    const band = new THREE.Mesh(boxGeo(inset[0], 0.34, inset[2]), MT.stoneDark);
    band.position.y = 0.17;
    band.userData.noOutline = true;
    g.add(band);
  }
  const medallion = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.34, 6, 32), MT.stoneDark);
  medallion.rotation.x = Math.PI / 2;
  medallion.position.y = 0.18;
  medallion.userData.noOutline = true;
  g.add(medallion);


  // -------------------------------------------------------------------------
  // v8.1：中央塔由"液压压力机纪念碑"改为**发电塔**（保留立式压力容器 + 可动机构 + 表盘内核）
  //   结构：石钢基座 → 四腿铆接钢架（X 撑）→ 卧式锅炉罐 → 顶部发电机房
  //          + 可动飞轮/电枢 + 黄铜压力穹顶 + 蒸汽柱 + 配电盘 + 外送铜管
  // -------------------------------------------------------------------------
  const mon = new THREE.Group();
  mon.name = 'GeneratorTower';
  const legR = 1.9, towerH = 9.4;

  // 基座
  const baseStep = new THREE.Mesh(cylGeo(2.9, 3.3, 0.8, 8), MT.stoneDark);
  baseStep.position.y = 0.7;
  baseStep.castShadow = true;
  mon.add(baseStep);
  const basePlinth = new THREE.Mesh(cylGeo(2.1, 2.6, 1.0, 8), MT.stone);
  basePlinth.position.y = 1.6;
  mon.add(basePlinth);

  // 四腿塔架 + X 撑（看得见结构）
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const lx = Math.sin(a) * legR, lz = Math.cos(a) * legR;
    strutBetween(mon, [lx, 2.1, lz], [lx * 0.92, 2.1 + towerH, lz * 0.92],
      { radius: 0.16, mat: MT.steel, name: 'GenLeg' });
  }
  for (let lvl = 0; lvl < 3; lvl++) {
    const y0 = 2.4 + (towerH * lvl) / 3, y1 = 2.4 + (towerH * (lvl + 1)) / 3;
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const a1 = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4;
      strutBetween(mon, [Math.sin(a0) * legR, y0, Math.cos(a0) * legR], [Math.sin(a1) * legR, y0, Math.cos(a1) * legR],
        { radius: 0.07, mat: MT.brassDark, name: 'GenRing' });
      strutBetween(mon, [Math.sin(a0) * legR, y0, Math.cos(a0) * legR], [Math.sin(a1) * legR, y1, Math.cos(a1) * legR],
        { radius: 0.07, mat: MT.brassDark, name: 'GenBrace' });
      strutBetween(mon, [Math.sin(a1) * legR, y0, Math.cos(a1) * legR], [Math.sin(a0) * legR, y1, Math.cos(a0) * legR],
        { radius: 0.07, mat: MT.brassDark, name: 'GenBrace' });
    }
  }

  // 卧式锅炉罐（架在塔架中部，含箍、人孔、压力表）
  const boilerY = 2.4 + towerH * 0.42;
  const boiler = new THREE.Mesh(cylGeo(0.95, 0.95, 3.6, 16), MT.steel);
  boiler.rotation.z = Math.PI / 2;
  boiler.position.y = boilerY;
  boiler.castShadow = true;
  mon.add(boiler);
  for (const dx of [-1.3, 0, 1.3]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.075, 6, 18), MT.brass);
    hoop.position.set(dx, boilerY, 0);
    hoop.rotation.y = Math.PI / 2;
    mon.add(hoop);
  }
  for (const dx of [-0.7, 0.9]) {
    const manhole = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 6, 14), MT.brass);
    manhole.position.set(dx, boilerY + 0.94, 0);
    manhole.rotation.x = Math.PI / 2;
    mon.add(manhole);
  }
  pressureGauge(mon, [1.9, boilerY + 0.4, 0], MT, 0.18);
  pressureGauge(mon, [1.9, boilerY - 0.4, 0], MT, 0.18);

  // 顶部发电机房（铆接包厢 + 可动飞轮/电枢 + 压力穹顶 + 蒸汽柱）
  const genY = 2.4 + towerH;
  const house = new THREE.Mesh(bevelBox(3.2, 2.0, 2.6, 0.18, 2), MT.iron);
  house.position.y = genY + 1.0;
  house.castShadow = true;
  mon.add(house);
  rivets(mon, { from: [-1.4, genY + 2.06, 1.35], to: [1.4, genY + 2.06, 1.35], spacing: 0.34, normal: [0, 0, 1], mat: MT.brassDark });
  // 飞轮/电枢（**可动件**）
  const flywheel = new THREE.Group();
  flywheel.name = 'Armature';
  const fwDisc = new THREE.Mesh(cylGeo(1.15, 1.15, 0.36, 22), MT.bronze);
  fwDisc.rotation.x = Math.PI / 2;
  flywheel.add(fwDisc);
  const fwRim = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.13, 6, 24), MT.brass);
  flywheel.add(fwRim);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    strutBetween(flywheel, [0, 0, 0], [Math.cos(a) * 1.05, Math.sin(a) * 1.05, 0], { radius: 0.07, mat: MT.brass, name: 'ArmSpoke' });
  }
  flywheel.position.set(0, genY + 1.0, 1.55);
  mon.add(flywheel);
  // 曲柄连杆：飞轮 → 塔架上的泵（把"在动"传导出去）
  const crankRod = unitStrut(mon, 0.09, MT.steel, 'CrankRod');
  const pumpBody = new THREE.Mesh(cylGeo(0.34, 0.4, 1.2, 12), MT.bronze);
  pumpBody.position.set(1.5, genY - 0.4, 1.55);
  mon.add(pumpBody);
  // 压力穹顶
  // v9.2：穹顶原为亮黄铜 ⇒ 全场景里刺眼。改为氧化铜（verdigris）+ 黄铜压条
  const dome = new THREE.Mesh(sphereGeo(1.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), MT.verdigris);
  dome.position.y = genY + 2.1;
  mon.add(dome);
  const finial = new THREE.Mesh(sphereGeo(0.2, 10), MT.verdigris);
  finial.position.y = genY + 3.7;
  mon.add(finial);
  // 蒸汽柱（半透明锥，静态几何表现"在排气"）
  const plume = new THREE.Mesh(coneGeo(1.1, 4.2, 12), MT.steamGlow);
  plume.position.y = genY + 5.7;
  plume.userData.noOutline = true;
  mon.add(plume);

  // 配电盘（一排表盘 + 刀闸）
  const panel = new THREE.Mesh(bevelBox(2.2, 1.6, 0.3, 0.08, 2), MT.ironDark);
  panel.position.set(0, 2.6, legR + 0.9);
  panel.castShadow = true;
  mon.add(panel);
  for (let i = 0; i < 3; i++) {
    pressureGauge(mon, [-0.7 + i * 0.7, 2.9, legR + 1.07], MT, 0.17);
    const sw = new THREE.Mesh(boxGeo(0.1, 0.34, 0.08), MT.brass);
    sw.position.set(-0.7 + i * 0.7, 2.25, legR + 1.07);
    sw.rotation.x = -0.4;
    mon.add(sw);
  }
  // 外送铜管（接向城区）
  steamRun(mon, [
    [1.2, 2.2, legR + 0.5],
    [3.0, 1.6, legR + 1.2],
    [4.6, 0.9, legR + 2.0],
  ], MT, 0.11);
  g.add(mon);

  // 街灯 ×4（与公园同款，保证城市语言统一）
  const lamps = [];
  for (const [lx, lz] of [[w * 0.4, d * 0.4], [-w * 0.4, d * 0.4], [w * 0.4, -d * 0.4], [-w * 0.4, -d * 0.4]]) {
    const l = new THREE.Group();
    l.name = 'PlazaLamp';
    l.position.set(lx, 0, lz);
    const base = new THREE.Mesh(coneGeo(0.36, 0.9, 8), MT.iron);
    base.position.y = 0.45;
    l.add(base);
    const pole = new THREE.Mesh(cylGeo(0.08, 0.14, 3.0, 10), MT.iron);
    pole.position.y = 2.3;
    l.add(pole);
    const cage = new THREE.Mesh(cylGeo(0.26, 0.32, 0.68, 4), MT.brass);
    cage.position.y = 4.05;
    l.add(cage);
    const core = new THREE.Mesh(cylGeo(0.18, 0.22, 0.54, 8), MT.lampWarm);
    core.position.y = 4.05;
    core.userData.noOutline = true;
    l.add(core);
    const cap = new THREE.Mesh(coneGeo(0.4, 0.4, 4), MT.brass);
    cap.position.y = 4.6;
    l.add(cap);
    g.add(l);
    lamps.push(l);
  }

  // 花坛 ×4（石边 + 土 + 花）
  for (const [fx, fz] of [[w * 0.34, 0], [-w * 0.34, 0], [0, d * 0.38], [0, -d * 0.38]]) {
    const bed = new THREE.Group();
    bed.name = 'FlowerBed';
    bed.position.set(fx, 0, fz);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.22, 6, 20), MT.stoneDark);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.42;
    bed.add(rim);
    const soil = new THREE.Mesh(cylGeo(1.4, 1.4, 0.4, 16), MT.gravel);
    soil.position.y = 0.35;
    soil.userData.noOutline = true;
    bed.add(soil);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + (i % 2) * 0.2;
      const r = 0.5 + (i % 3) * 0.32;
      const fl = new THREE.Mesh(sphereGeo(0.16, 8), MT.flower);
      fl.position.set(Math.sin(a) * r, 0.62, Math.cos(a) * r);
      bed.add(fl);
    }
    g.add(bed);
  }

  // 信息牌 + 系车柱
  const boardFrame = new THREE.Mesh(bevelBox(2.2, 1.4, 0.12, 0.06, 2), MT.iron);
  boardFrame.position.set(w * 0.42, 1.9, -d * 0.3);
  boardFrame.rotation.y = -Math.PI / 2;
  g.add(boardFrame);
  const boardFace = new THREE.Mesh(boxGeo(0.06, 1.2, 2.0), MT.canvas);
  boardFace.position.set(w * 0.42 - 0.09, 1.9, -d * 0.3);
  boardFace.userData.noOutline = true;
  g.add(boardFace);
  for (const sz of [-0.8, 0.8]) {
    strutBetween(g, [w * 0.42, 1.2, -d * 0.3 + sz], [w * 0.42, 0.3, -d * 0.3 + sz],
      { radius: 0.06, mat: MT.iron, name: 'BoardPost' });
  }
  const posts = [];
  for (const [px, pz] of [[-w * 0.42, d * 0.3], [-w * 0.42, -d * 0.3], [w * 0.44, d * 0.32]]) {
    const p = new THREE.Mesh(cylGeo(0.16, 0.2, 0.9, 10), MT.bronze);
    p.position.set(px, 0.75, pz);
    p.castShadow = true;
    g.add(p);
    const cap = new THREE.Mesh(sphereGeo(0.18, 8), MT.bronze);
    cap.position.set(px, 1.25, pz);
    g.add(cap);
    posts.push(p);
  }

  g.userData.parts = {
    type: 'plaza', w, d, monument: mon, armature: flywheel, steamPlume: plume, lamps, posts,
    anchors: { center: [0, 0, 0], board: [w * 0.42, 1.9, -d * 0.3] },
    emissive: lamps.map((l) => l.children.find((c) => c.material === MT.lampWarm)).filter(Boolean),
  };
  return g;
}

// ===========================================================================
// 套件预览装配：五类各一份排开 + 尺度参照（车 4.5 m 代理 + 行人 1.75 m）
// ===========================================================================
export function build(opts = {}) {
  const MT = makeMaterials();
  const root = new THREE.Group();
  root.name = 'CityKit';

  // 场地
  const ground = new THREE.Mesh(boxGeo(150, 0.4, 90), MT.gravel);
  ground.position.set(10, -0.2, 0);
  ground.receiveShadow = true;
  ground.userData.noOutline = true;
  root.add(ground);

  const residential = buildResidential({ seed: 0, materials: MT, floors: 3, bays: 3 });
  residential.position.set(-46, 0, -18);
  const villa = buildVilla({ materials: MT });
  villa.position.set(-24, 0, 20);
  const factory = buildFactory({ materials: MT });
  factory.position.set(6, 0, -18);
  const plaza = buildPlaza({ materials: MT });
  plaza.position.set(6, 0, 26);
  root.add(residential, villa, factory, plaza);

  // 尺度参照：4.5 m 车（用低多边形代理，真正的悬浮车稍后做）+ 1.75 m 行人
  const carProxy = new THREE.Group();
  carProxy.name = 'CarScaleRef_4.5m';
  const cab = new THREE.Mesh(bevelBox(4.5, 1.0, 2.0, 0.24, 2), MT.steel);
  cab.position.y = 1.2;
  cab.castShadow = true;
  carProxy.add(cab);
  const canopy = new THREE.Mesh(cylGeo(0.9, 0.9, 1.8, 12), MT.glass);
  canopy.rotation.z = Math.PI / 2;
  canopy.position.y = 1.9;
  canopy.userData.noOutline = true;
  carProxy.add(canopy);
  const skirt = new THREE.Mesh(boxGeo(4.0, 0.5, 1.8), MT.ironDark);
  skirt.position.y = 0.5;
  carProxy.add(skirt);
  // 悬浮气垫（蒸汽喷射口）
  for (const sx of [-1.4, 1.4]) {
    for (const sz of [-0.7, 0.7]) {
      strutBetween(carProxy, [sx, 0.35, sz], [sx, 0.05, sz * 1.6], { radius: 0.14, mat: MT.brass, name: 'HoverJet' });
    }
  }
  carProxy.position.set(-46, 0, 8);
  root.add(carProxy);

  const people = [];
  for (let i = 0; i < 8; i++) {
    const p = refHuman({ style: 'male', pose: 'stand' });
    p.position.set(-40 + i * 11, 0, 34 + (i % 2) * 2);
    p.rotation.y = -0.4 + i * 0.5;
    people.push(p);
    root.add(p);
  }

  tagThinMembers(root, { torusTubeMax: 0.4, tubeRadiusMax: 0.28, cylRadiusMax: 0.32, boxMinAxis: 0.22 });
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

  root.userData.parts = {
    residential, villa, factory, plaza, carProxy, people,
    /** 城市套件的"心跳"：风向标 / 纪念塔重锤 / 龙门吊小车 */
    drive(t, s = {}) {
      if (villa.userData.parts.vane) villa.userData.parts.vane.rotation.y = t * 0.18;
      // 发电塔：飞轮匀速转 + 曲柄连杆把运动传到泵（这是全场景的"心跳"）
      const mon = plaza.getObjectByName('GeneratorTower');
      if (mon) {
        const arm = mon.getObjectByName('Armature');
        const rod = mon.getObjectByName('CrankRod');
        if (arm) arm.rotation.z = -t * 2.2;
        if (rod) {
          const cx = Math.cos(-t * 2.2) * 1.05, cy = Math.sin(-t * 2.2) * 1.05;
          updateStrut(rod, [cx, 2.4 + 9.4 + 1.0 + cy, 1.55], [1.5, 2.4 + 9.4 - 0.4, 1.55]);
        }
      }
      // 工厂流水线：滚轮转 + 工位动作
      const line = factory.userData.parts.productionLine;
      if (line) {
        for (const r of (factory.userData.parts.rollers || [])) r.rotation.y = -t * 3.4;
        for (const st of (factory.userData.parts.stations || [])) {
          const tag = st.userData;
          if (tag.ram) tag.ram.position.y = 2.2 + Math.max(0, Math.sin(t * 1.6)) * -0.5;
          if (tag.turret) tag.turret.rotation.y = t * 0.9;
          if (tag.chuck) tag.chuck.rotation.y = t * 4.5;
        }
      }
      const gantry = factory.userData.parts.gantry;
      if (gantry) {
        const tr = gantry.children.find((c) => c.name === '' && c.geometry && c.geometry.type === 'BoxGeometry');
        if (tr) tr.position.z = Math.sin(t * 0.22) * 8;
      }
    },
  };
  return root;
}

export default { build, buildResidential, buildVilla, buildFactory, buildPlaza, makeMaterials };
