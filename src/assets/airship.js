/**
 * airship.js — 单体资产 ① 飞艇 `HMS PENDRAGON`
 * 对应 docs/ART_BIBLE.md 6.2 / 5.3。
 *
 * 局部坐标：+X = 船首，气囊轴心 y = SPEC.envCenterY，龙骨最低点 y = SPEC.keelY。
 *
 * 【装配铁律】任何"把 A 连到 B"的零件，必须用 primitives.strutBetween(p0, p1)
 * 按两个真实端点生成，禁止手调 position + rotation —— 这是"零件悬空不连接"的唯一正解。
 */
import * as THREE from 'three';
import { C, BANDS, TONE } from '../core/palette.js';
import { M, toon, lamp } from '../core/materials.js';
import {
  bevelBox, boxGeo, cylGeo, sphereGeo, coneGeo, mesh,
  rivets, rivetPanel, gear, gearPair, gearGeo, pipe, addOutline,
  strutBetween, updateStrut, unitStrut, bearingBlock, mountFlange, tagThinMembers,
} from '../core/primitives.js';

// ---------------------------------------------------------------------------
// 规格常量（数值经浮力自洽校验，见 SELF-CHECK）
// ---------------------------------------------------------------------------
export const SPEC = {
  lengthTotal: 86,        // m 全长（含首尾外伸结构）
  envLength: 62,          // m 气囊长
  envDiameter: 24,        // m 气囊直径
  envCenterY: 2.5,        // m 气囊轴心高度（抬升，给吊舱上层建筑腾出空间）
  ribCount: 12,           // 道
  gondolaLen: 30,         // m
  gondolaW: 8,            // m
  gondolaH: 10.2,         // m
  gondolaTopY: -9.9,      // m 吊舱顶面
  pontoonLen: 24,         // m 浮筒长
  pontoonDia: 4.0,        // m 浮筒直径（v3 由 4.6 收细，避免"太笨重"）
  pontoonZ: 3.9,          // m 浮筒横向偏置（v3 由 2.4 外移，拉开站距消除"重心不稳"）
  pontoonStrut: 1.2,      // m 吊舱底→浮筒顶 吊架长度
  paddleRadius: 2.6,      // m 桨轮半径
  paddleBeam: 5.5,        // m 桨轮摆动臂长
  paddlePivotX: 4.5,      // m
  paddlePivotY: -17.0,    // m
  paddlePivotZ: 4.15,     // m
  paddleStowDeg: 12,      // ° 摆动臂自竖直方向的收折角（向舷外倾）
  paddleDeployDeg: 147,   // ° 摆动臂自竖直方向的展开角（>90° 即指向斜下外方）
  /** 展开几何自检：臂端 y = pivotY + beam·cos(147°) ≈ -21.6 ⇒ 桨轮下缘 -24.2，
   *  水线 -22.5 ⇒ 入水 1.7 m ✓；收折时臂端 y = -11.6 ⇒ 桨轮下缘 -14.2，完全离水 ✓ */
  propDiameter: 8.4,      // m（v3 由 6.2 放大，原尺寸在 86 m 艇身上读不出来）
  propBlades: 3,
  finSpan: 12,            // m 十字尾鳍展长
  draft: 2.8,             // m 设计吃水（v3：浮筒收细后同步下调，保持 ~70% 浸没）
  mass: 430,              // t 总质量
  waterplaneArea: 150,    // m² 水线面积（两浮筒，含端部收缩修正 0.85）
};

// 派生量（保证几何与浮力自洽，禁止手改）
SPEC.gondolaBottomY = SPEC.gondolaTopY - SPEC.gondolaH;                              // -20.1
SPEC.gondolaMidY = SPEC.gondolaTopY - SPEC.gondolaH / 2;                             // -15.0
SPEC.pontoonCenterY = SPEC.gondolaBottomY - SPEC.pontoonStrut - SPEC.pontoonDia / 2; // -23.3
SPEC.keelY = SPEC.pontoonCenterY - SPEC.pontoonDia / 2;                              // -25.3
SPEC.draftComputed = SPEC.mass / (1.025 * SPEC.waterplaneArea);                      // 2.80 m ✓
/** 水线宽度自检：2·√(r² − (r−d)²) = 2·√(2.0² − 0.8²) = 3.67 m
 *  A_wp = 2 × 24 × 3.67 × 0.85 = 150 m² ✓ 与上表一致 */

/** 漂浮时飞艇原点的高度（= 局部水线高度的绝对值） */
export const FLOAT_Y = -SPEC.keelY - SPEC.draft;   // 22.7 m

const ENV_R = SPEC.envDiameter / 2;      // 12
const ENV_HL = SPEC.envLength / 2;       // 31
const ENV_C = SPEC.envCenterY;           // 2.5
const RIB_SPACING = SPEC.envLength / (SPEC.ribCount - 1);
const ENV_EXP = 1 / 2.6;

// ---------------------------------------------------------------------------
// 气囊型线
// ---------------------------------------------------------------------------
/**
 * 气囊半径型线。
 * 【v4 修正】收束（pinch）的相位必须与环肋位置对齐：
 *   环肋在 x = −ENV_HL + i·RIB_SPACING，所以相位用 (x + ENV_HL)。
 *   v3 写成 cos(2π·x/SPACING)，而 ENV_HL/SPACING = 31/5.636 = 5.5 恰好差半个周期
 *   ⇒ 肋骨正落在"鼓包"上、收束跑到两根肋骨之间 —— 这就是"龙骨没对齐"的根因。
 */
function envRadius(x) {
  const u = THREE.MathUtils.clamp((2 * x) / SPEC.envLength, -1, 1);
  const base = Math.pow(Math.max(0, 1 - u * u), ENV_EXP);
  const phase = (2 * Math.PI * (x + ENV_HL)) / RIB_SPACING;
  const pinch = 1 - 0.018 * (0.5 + 0.5 * Math.cos(phase));   // 环肋处最小
  return ENV_R * base * pinch;
}

// ---------------------------------------------------------------------------
// 【重要】气囊相关的坐标约定
// 下面三个函数返回的都是 **root 坐标系下的绝对 y**（已含 ENV_C）。
// 因此挂气囊的零件一律直接 add 到 root 或 envelope 组，且 envelope 组不得再整体平移，
// 否则会二次叠加 ENV_C —— 这就是 v2 里"顶部排气阀/管箍浮在气囊上方 2.5 m"的根因。
// ---------------------------------------------------------------------------
/** 气囊下表面在 (x, z) 处的绝对 y */
function envLowerY(x, z) {
  const r = envRadius(x) * 1.005;
  const zz = Math.min(Math.abs(z), r * 0.995);
  return ENV_C - Math.sqrt(Math.max(0, r * r - zz * zz));
}
/** 气囊上表面在 (x, z) 处的绝对 y */
function envUpperY(x, z) {
  const r = envRadius(x) * 1.005;
  const zz = Math.min(Math.abs(z), r * 0.995);
  return ENV_C + Math.sqrt(Math.max(0, r * r - zz * zz));
}
/** 气囊外表面点（给定纵坐标与环向角），绝对坐标 */
function envPoint(x, ang, scale = 1.005) {
  const r = envRadius(x) * scale;
  return [x, ENV_C + Math.sin(ang) * r, Math.cos(ang) * r];
}

// ---------------------------------------------------------------------------
// 材质
// ---------------------------------------------------------------------------
function makeMaterials() {
  return {
    canvas: M.canvas({ color: new THREE.Color('#E3DAC3'), bands: [0.20, 0.46, 0.86], outlineWidth: 0.02 }),
    canvasDark: M.canvas({ color: new THREE.Color('#8E8676'), bands: [0.22, 0.5, 0.92], outlineWidth: 0.018 }),
    brass: M.brass({ bands: [0.30, 0.62, 1.0], outlineWidth: 0.022 }),
    brassDark: M.brass({ color: C.brassLo, bands: [0.26, 0.55, 1.0], outlineWidth: 0.022 }),
    bronze: M.bronze({ bands: [0.3, 0.6, 1.0], outlineWidth: 0.02 }),
    iron: M.iron({ bands: [0.3, 0.6, 1.0], outlineWidth: 0.022 }),
    wood: M.wood({ bands: [0.28, 0.58, 1.0], outlineWidth: 0.02 }),
    rope: M.rope({ outlineWidth: 0 }),
    verdigris: M.verdigris({ bands: [0.3, 0.62, 1.0], outlineWidth: 0.018 }),
    glass: M.glassLamp({ color: C.accentVerdigris, opacity: 0.6 }),
    window: lamp(C.lampWarm, 1.35),
    searchlight: lamp(new THREE.Color('#FFF0D0'), 2.4),
    steam: toon(new THREE.Color('#EDE9E1'), { bands: BANDS.soft, outlineWidth: 0, transparent: true, opacity: 0.85 }),
  };
}

// ---------------------------------------------------------------------------
// 气囊
// ---------------------------------------------------------------------------
function buildEnvelope(MT) {
  const g = new THREE.Group();
  g.name = 'Envelope';
  // 【注意】这里【不能】整体平移 y = ENV_C：envLowerY / envUpperY / envPoint 已返回
  // root 坐标系下的绝对 y，再整体平移一次就会二次叠加 → 顶部阀门与管箍会浮在
  // 气囊上方 2.5 m。这就是 v2 实拍里"艇上面的钉子还是悬浮了"的根因。

  // 【v5 修正 · 关键】几何变换的顺序不能错：
  //   ❌ translate 在前、mesh.rotation 在后 —— 旋转会把 Y 向偏移转到 X 轴上，
  //      结果是气囊在 Y 上没抬起来（还低 2.5 m）、同时在 X 上前移了 2.5 m，
  //      而环肋/龙骨线按绝对高度摆放 ⇒ 全都不贴合 = "龙骨没对齐"。
  //   ✅ 先把几何转成 +X 轴，再 translate 抬到绝对高度；mesh 不再做旋转。
  const pts = [];
  const N = 180;
  for (let i = 0; i <= N; i++) {
    const x = -ENV_HL + (2 * ENV_HL * i) / N;
    pts.push(new THREE.Vector2(Math.max(envRadius(x), 0.0001), x));
  }
  const shellGeo = new THREE.LatheGeometry(pts, 64);
  shellGeo.rotateZ(-Math.PI / 2);          // ① 轴 Y → +X
  shellGeo.translate(0, ENV_C, 0);         // ② 再抬到绝对轴心高度
  const hull = new THREE.Mesh(shellGeo, MT.canvas);
  hull.castShadow = true;
  // 气囊是超大平滑曲面，接收阴影只会换来满屏阴影痤疮（提高 shadowMap/normalBias 都压不干净）。
  // 它仍然向外投影（会落在吊舱与水面上），但不自接收 —— 这是本项目最干净的解。
  hull.receiveShadow = false;
  hull.name = 'EnvelopeShell';
  g.add(hull);

  // 12 道环肋：青铜暖中间调（近黑的铸铁在象牙白气囊上会读成一堆黑箍）
  for (let i = 0; i < SPEC.ribCount; i++) {
    const x = -ENV_HL + i * RIB_SPACING;
    const r = envRadius(x);
    if (r < 1.2) continue;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.004, 0.15, 6, 40), MT.bronze);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(x, ENV_C, 0);
    ring.castShadow = true;
    ring.name = `Rib_${i}`;
    g.add(ring);
  }

  // 纵向龙骨线 ×4（采样加密到 96 点，用 centripetal 差值，贴死型线不打飘）
  for (const ang of [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75]) {
    const path = [];
    for (let i = 0; i <= 96; i++) {
      const x = -ENV_HL + (2 * ENV_HL * i) / 96;
      path.push(envPoint(x, ang, 1.012));
    }
    pipe(g, path, { radius: 0.12, mat: MT.brassDark, segments: 160, flanges: false, name: 'KeelLine' });
  }

  // 首尾深色装饰带
  for (const [a, b] of [[-0.96, -0.74], [0.74, 0.96]]) {
    for (let i = 0; i < 6; i++) {
      const t = a + ((b - a) * i) / 5;
      const x = t * ENV_HL;
      const band = new THREE.Mesh(new THREE.TorusGeometry(envRadius(x) * 1.006, 0.3, 6, 40), MT.canvasDark);
      band.rotation.y = Math.PI / 2;
      band.position.set(x, ENV_C, 0);
      g.add(band);
    }
  }

  // 顶部排气阀（绝对坐标：底座落在外表面 + 安装法兰，法兰略微嵌进曲面消除缝隙）
  for (let i = 1; i < SPEC.ribCount - 1; i += 3) {
    const x = -ENV_HL + i * RIB_SPACING;
    const surface = envUpperY(x, 0);
    mountFlange(g, {
      radius: 0.62, thickness: 0.18, pos: [x, surface - 0.13, 0], bolts: 8, name: `ValveFlange_${i}`,
    });
    const valve = new THREE.Mesh(cylGeo(0.44, 0.52, 1.0, 12), MT.bronze);
    valve.position.set(x, surface + 0.36, 0);
    g.add(valve);
    const cap = new THREE.Mesh(cylGeo(0.64, 0.44, 0.32, 12), MT.brass);
    cap.position.set(x, surface + 0.98, 0);
    g.add(cap);
    // 泄压支管接回气囊表面（终点用真实表面点）
    pipe(g, [
      [x, surface + 0.42, 0.36],
      [x + 0.9, surface - 0.6, 0.9],
      [x + 1.4, envUpperY(x + 1.4, 1.6) - 0.02, 1.6],
    ], { radius: 0.12, mat: MT.brass, segments: 24, flanges: false, name: 'ValvePipe' });
  }

  // 船名横幅：几何按型线贴合，绝不悬空
  g.add(buildNameBanner(MT, 2.0));

  return g;
}

/**
 * 弧形面片：绕 +X 轴、贴在气囊 +Z 侧的曲面。
 * 半径由 radiusFn(x) 给出 → 直接跟随气囊型线，所以面板**永远贴死**在气囊上。
 * UV 显式定义：u = 沿船纵长（文字行进方向），v = 沿环向。
 */
function arcPanelGeo(radiusFn, arc, xLen, centerY, segX = 40, segA = 20) {
  const pos = [], uvs = [], idx = [];
  for (let i = 0; i <= segX; i++) {
    const x = -xLen / 2 + (xLen * i) / segX;
    const R = radiusFn(x);
    for (let j = 0; j <= segA; j++) {
      const a = -arc / 2 + (arc * j) / segA;
      pos.push(x, centerY + R * Math.sin(a), R * Math.cos(a));
      uvs.push(i / segX, j / segA);
    }
  }
  const stride = segA + 1;
  for (let i = 0; i < segX; i++) {
    for (let j = 0; j < segA; j++) {
      const a = i * stride + j;
      const b = a + stride;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function buildNameBanner(MT, centerX) {
  const grp = new THREE.Group();
  grp.name = 'NameBanner';

  const arc = 0.88;
  const xLen = 18;
  const midR = envRadius(centerX) * 1.012;
  const arcLen = midR * arc;

  const CW = 1024, CH = Math.round((CW * arcLen) / xLen);
  const cv = document.createElement('canvas');
  cv.width = CW; cv.height = CH;
  const ctx = cv.getContext('2d');

  // 深色铭牌底 + 黄铜外框 + 象牙白字 —— 对比度必须足够，否则等同于没画
  ctx.fillStyle = '#46341F';
  ctx.fillRect(0, 0, CW, CH);
  ctx.strokeStyle = '#B0803C';
  ctx.lineWidth = Math.max(8, CH * 0.024);
  const m = CH * 0.06;
  ctx.strokeRect(m, m, CW - m * 2, CH - m * 2);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const TEXT = 'H M S   P E N D R A G O N';
  let fs = 240;
  for (let i = 0; i < 200; i++) {
    ctx.font = `bold ${fs}px "Times New Roman", Georgia, serif`;
    if (ctx.measureText(TEXT).width <= CW * 0.86 && fs <= CH * 0.38) break;
    fs -= 2;
  }
  ctx.fillStyle = '#EFE4C8';
  ctx.fillText(TEXT, CW / 2, CH / 2);
  const half = Math.min(CW * 0.4, ctx.measureText(TEXT).width / 2 + fs * 0.4);
  ctx.strokeStyle = '#B0803C';
  ctx.lineWidth = Math.max(4, fs * 0.05);
  for (const dy of [-fs * 0.85, fs * 0.85]) {
    ctx.beginPath();
    ctx.moveTo(CW / 2 - half, CH / 2 + dy);
    ctx.lineTo(CW / 2 + half, CH / 2 + dy);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  // 关键：半径跟随型线（含环肋收束）→ 面板贴死气囊；y 用绝对高度 ENV_C
  const geo = arcPanelGeo((x) => envRadius(centerX + x) * 1.014, arc, xLen, ENV_C, 48, 22);
  // 贴图本身已经带了底色，材质 color 必须给白 —— 否则 color × map 会把铭牌二次压黑
  const mat = M.canvas({ color: new THREE.Color('#FFFFFF'), bands: [0.34, 0.62, 0.95], outline: false });
  mat.map = tex;
  mat.side = THREE.DoubleSide;
  mat.emissive = new THREE.Color('#2A2016');
  mat.emissiveIntensity = 0.18;

  const panel = new THREE.Mesh(geo, mat);
  panel.userData.noOutline = true;
  grp.add(panel);

  // 面板四角铆接压条，进一步消除"贴纸感"
  const edgeMat = MT.brassDark;
  for (const ex of [-xLen / 2 + 0.5, xLen / 2 - 0.5]) {
    for (const ea of [-arc / 2 + 0.09, arc / 2 - 0.09]) {
      const r = envRadius(centerX + ex) * 1.03;
      const bar = new THREE.Mesh(boxGeo(0.9, 0.16, 0.24), edgeMat);
      bar.position.set(ex, ENV_C + r * Math.sin(ea), r * Math.cos(ea));
      bar.rotation.x = -ea;
      grp.add(bar);
    }
  }
  grp.position.x = centerX;
  return grp;
}

// ---------------------------------------------------------------------------
// 吊舱
// ---------------------------------------------------------------------------
function buildGondola(MT) {
  const g = new THREE.Group();
  g.name = 'Gondola';

  const L = SPEC.gondolaLen, W = SPEC.gondolaW;
  const topY = SPEC.gondolaTopY, botY = SPEC.gondolaBottomY, midY = SPEC.gondolaMidY;
  const hullTopY = topY - 3.2;             // 主船体顶面（上面是上层建筑）
  const hullH = hullTopY - botY;           // 6.5 m
  const hullMidY = (hullTopY + botY) / 2;

  const hullBody = new THREE.Mesh(bevelBox(L * 0.72, hullH, W, 0.5, 3), MT.wood);
  hullBody.position.set(-1.5, hullMidY, 0);
  hullBody.castShadow = true; hullBody.receiveShadow = true;
  hullBody.name = 'GondolaHull';
  g.add(hullBody);

  // 首尾收窄
  const prow = new THREE.Mesh(new THREE.CylinderGeometry(0.001, W * 0.5, L * 0.2, 12, 1), MT.wood);
  prow.rotation.z = -Math.PI / 2;
  prow.position.set(L * 0.46 - 1.5, hullMidY, 0);
  prow.scale.y = hullH / W;
  prow.castShadow = true;
  g.add(prow);
  const stern = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.5, W * 0.26, L * 0.24, 12, 1), MT.wood);
  stern.rotation.z = -Math.PI / 2;
  stern.position.set(-L * 0.48 - 1.5, hullMidY, 0);
  stern.scale.y = hullH / W;
  stern.castShadow = true;
  g.add(stern);

  // 黄铜腰线 + 铆钉
  for (const z of [-W / 2 - 0.04, W / 2 + 0.04]) {
    for (const y of [hullMidY + 2.0, hullMidY - 1.6]) {
      const strip = new THREE.Mesh(boxGeo(L * 0.94, 0.24, 0.16), MT.brass);
      strip.position.set(-1.5, y, z);
      g.add(strip);
    }
    rivets(g, {
      from: [-L * 0.47 - 1.5, hullMidY + 2.0, z],
      to: [L * 0.47 - 1.5, hullMidY + 2.0, z],
      spacing: 0.5, normal: [0, 0, z > 0 ? 1 : -1], mat: MT.brassDark,
    });
  }

  // 舷窗（含舷侧加强环）
  for (let i = 0; i < 7; i++) {
    const x = -10.5 + i * 2.9;
    for (const z of [-W / 2 - 0.02, W / 2 + 0.02]) {
      const frame = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.13, 6, 16), MT.brass);
      frame.position.set(x, hullMidY + 0.4, z);
      g.add(frame);
      const win = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16), MT.window);
      win.position.set(x, hullMidY + 0.4, z + (z > 0 ? 0.06 : -0.06));
      win.rotation.y = z > 0 ? 0 : Math.PI;
      win.userData.noOutline = true;
      g.add(win);
    }
  }

  // 上层甲板
  const deck = new THREE.Mesh(bevelBox(L * 0.42, 0.36, W * 0.9, 0.1), MT.brass);
  deck.position.set(3.0, hullTopY + 0.2, 0);
  deck.castShadow = true; deck.receiveShadow = true;
  g.add(deck);

  // 驾驶室（落在甲板上，四周有窗）
  const wh = { w: 5.4, h: 2.9, d: 4.6, x: 5.4, y: 0 };
  wh.y = hullTopY + 0.38 + wh.h / 2;
  const wheelhouse = new THREE.Mesh(bevelBox(wh.w, wh.h, wh.d, 0.28, 3), MT.wood);
  wheelhouse.position.set(wh.x, wh.y, 0);
  wheelhouse.castShadow = true;
  wheelhouse.name = 'Wheelhouse';
  g.add(wheelhouse);
  const glazing = new THREE.Mesh(boxGeo(wh.w + 0.16, 1.15, wh.d + 0.16), MT.window);
  glazing.position.set(wh.x, wh.y + 0.45, 0);
  glazing.userData.noOutline = true;
  g.add(glazing);
  const roof = new THREE.Mesh(bevelBox(wh.w + 0.6, 0.28, wh.d + 0.6, 0.1), MT.brass);
  roof.position.set(wh.x, hullTopY + 0.38 + wh.h + 0.14, 0);
  g.add(roof);
  // 驾驶室四角立柱（把屋顶连到甲板，避免"屋顶悬空"）
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      strutBetween(g, [
        wh.x + sx * (wh.w / 2 - 0.16), hullTopY + 0.38, sz * (wh.d / 2 - 0.16),
      ], [
        wh.x + sx * (wh.w / 2 - 0.16), hullTopY + 0.38 + wh.h + 0.14, sz * (wh.d / 2 - 0.16),
      ], { radius: 0.1, mat: MT.brassDark, name: 'WheelhousePost', castShadow: false });
    }
  }

  // 压力表盘（挂在驾驶室侧面）
  for (let i = 0; i < 3; i++) {
    const gauge = new THREE.Mesh(cylGeo(0.3, 0.3, 0.14, 12), MT.brass);
    gauge.rotation.x = Math.PI / 2;
    gauge.position.set(wh.x + 1.4 + i * 0.8, wh.y + 0.2, -wh.d / 2 - 0.08);
    g.add(gauge);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.24, 12), MT.window);
    face.position.set(gauge.position.x, gauge.position.y, -wh.d / 2 - 0.16);
    face.rotation.y = Math.PI;
    face.userData.noOutline = true;
    g.add(face);
  }

  // 锅炉（卧式，落在甲板上）
  const boilerY = hullTopY + 0.38 + 1.45;
  const boiler = new THREE.Mesh(cylGeo(1.45, 1.45, 6.2, 16), MT.bronze);
  boiler.rotation.z = Math.PI / 2;
  boiler.position.set(-8.0, boilerY, 0);
  boiler.castShadow = true;
  g.add(boiler);
  for (const fx of [-2.4, 0, 2.4]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(1.57, 0.14, 6, 20), MT.brass);
    hoop.position.set(-8.0 + fx, boilerY, 0);
    hoop.rotation.y = Math.PI / 2;
    g.add(hoop);
  }
  // 锅炉鞍座 → 甲板（连接件）
  for (const sx of [-2.2, 2.2]) {
    strutBetween(g, [-8.0 + sx, hullTopY + 0.38, 0], [-8.0 + sx, boilerY - 1.3, 0],
      { radius: 0.2, mat: MT.iron, name: 'BoilerSaddle' });
  }
  const chimney = new THREE.Mesh(cylGeo(0.55, 0.78, 4.6, 12), MT.iron);
  chimney.position.set(-8.0, boilerY + 3.2, 0);
  chimney.castShadow = true;
  g.add(chimney);
  const chimCap = new THREE.Mesh(cylGeo(0.95, 0.62, 0.5, 12), MT.brass);
  chimCap.position.set(-8.0, boilerY + 5.5, 0);
  g.add(chimCap);

  // ---------------------------------------------------------------------------
  // 【v5.2 左右不对称】右舷：探照灯（全场仅此一台）；左舷：排烟道 + 立式气缸组
  // 为什么不对称：机械舱把蒸汽排到一侧、探照灯装另一侧，才像真干活的船；
  //               左右镜像会立刻显得"模型感"。
  // ---------------------------------------------------------------------------
  const sl1 = buildSearchlight(MT);
  sl1.position.set(9.6, hullTopY + 2.0, 3.1);
  sl1.rotation.y = -0.3;
  g.add(sl1);
  // 右舷尾部的小工作灯（同侧但小一号，避免"对称感"回潮）
  const workLamp = buildSearchlight(MT);
  workLamp.position.set(-9.6, hullTopY + 1.5, 3.1);
  workLamp.rotation.y = -0.55;
  workLamp.scale.setScalar(0.62);
  g.add(workLamp);

  // --- 左舷设备区：排烟道 ---
  const stackX = -2.4, stackZ = -3.3, stackH = 6.4;
  const stack = new THREE.Mesh(cylGeo(0.46, 0.62, stackH, 14), MT.iron);
  stack.position.set(stackX, hullTopY + stackH / 2 + 0.6, stackZ);
  stack.castShadow = true;
  g.add(stack);
  for (const t of [0.28, 0.62]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.07, 6, 16), MT.brassDark);
    hoop.position.set(stackX, hullTopY + 0.6 + stackH * t, stackZ);
    hoop.rotation.x = Math.PI / 2;
    g.add(hoop);
  }
  const stackCap = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.52, 0.52, 14, 1, true), MT.brass);
  stackCap.position.set(stackX, hullTopY + 0.6 + stackH + 0.2, stackZ);
  g.add(stackCap);
  const stackBase = new THREE.Mesh(bevelBox(2.0, 0.5, 2.0, 0.1), MT.iron);
  stackBase.position.set(stackX, hullTopY + 0.55, stackZ);
  g.add(stackBase);
  pipe(g, [
    [stackX, hullTopY + 0.9, stackZ],
    [stackX - 2.6, hullTopY + 0.85, stackZ - 0.7],
    [-7.6, hullTopY + 1.3, -2.6],
  ], { radius: 0.12, mat: MT.brassDark, segments: 30, flanges: false, name: 'ExhaustRun' });

  // --- 左舷设备区：立式气缸组 ×2 + 曲柄飞轮 ---
  const crankC = [2.5, hullTopY + 4.5, -3.3];
  const crankR = 0.7;
  const cylBank = [];
  for (const cx of [1.4, 3.6]) {
    const body = new THREE.Mesh(cylGeo(0.42, 0.48, 2.6, 14), MT.bronze);
    body.position.set(cx, hullTopY + 2.3, stackZ);
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(cylGeo(0.56, 0.44, 0.34, 14), MT.brass);
    head.position.set(cx, hullTopY + 3.76, stackZ);
    g.add(head);
    for (const dy of [-0.7, 0.7]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.06, 6, 14), MT.brassDark);
      hoop.position.set(cx, hullTopY + 2.3 + dy, stackZ);
      hoop.rotation.x = Math.PI / 2;
      g.add(hoop);
    }
    const seat = new THREE.Mesh(bevelBox(1.3, 0.4, 1.3, 0.08), MT.iron);
    seat.position.set(cx, hullTopY + 0.75, stackZ);
    g.add(seat);
    pipe(g, [
      [cx, hullTopY + 3.9, stackZ - 0.5],
      [cx - 0.6, hullTopY + 3.6, stackZ + 1.1],
      [stackX, hullTopY + 4.6, stackZ + 1.6],
    ], { radius: 0.06, mat: MT.brass, segments: 22, flanges: false, name: 'SteamFeed2' });
    const rod = unitStrut(g, 0.09, MT.brass, 'PistonRod2');
    cylBank.push({ body, head, rod, x: cx, topY: hullTopY + 3.76, z: stackZ });
  }
  // 曲柄飞轮 + 曲柄销（两缸共用）
  const fw = new THREE.Mesh(cylGeo(0.95, 0.95, 0.24, 20), MT.bronze);
  fw.rotation.x = Math.PI / 2;
  fw.position.set(crankC[0], crankC[1], crankC[2]);
  g.add(fw);
  const fwRim = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.09, 6, 22), MT.brass);
  fwRim.position.set(crankC[0], crankC[1], crankC[2]);
  g.add(fwRim);
  // 飞轮支座
  strutBetween(g, [crankC[0], crankC[1] - 1.0, crankC[2]], [crankC[0], hullTopY + 0.9, crankC[2]],
    { radius: 0.16, mat: MT.iron, name: 'CrankPost' });
  const crankPin = new THREE.Mesh(cylGeo(0.12, 0.12, 0.46, 8), MT.brass);
  g.add(crankPin);

  // 首部撑杆
  strutBetween(g, [L * 0.5 - 0.4, hullTopY - 0.4, 0], [L * 0.62 + 2.2, hullMidY + 0.6, 0],
    { radius: 0.2, mat: MT.brass, name: 'BowBoom' });
  const noseTip = new THREE.Mesh(coneGeo(0.62, 1.5, 10), MT.bronze);
  noseTip.rotation.z = -Math.PI / 2;
  // v7.2 修：艏撑杆末端在 L*0.62+2.2，艏尖原先在 +3.4 ⇒ 悬空 0.45 m
  noseTip.position.set(L * 0.62 + 2.95, hullMidY + 0.6, 0);
  g.add(noseTip);

  g.userData.parts = {
    hullBody, hullTopY, hullMidY, midY, topY, botY, boilerY, wheelhouse,
    searchlights: [sl1, workLamp],
    stack, stackCap, cylBank, fw, crankPin,
    crankCenter: crankC, crankRadius: crankR,
  };
  return g;
}

function buildSearchlight(MT) {
  const g = new THREE.Group();
  g.name = 'Searchlight';
  const y = -1.9;
  // 底座 + 立柱（落到甲板）
  const base = new THREE.Mesh(bevelBox(1.3, 0.22, 1.3, 0.06), MT.iron);
  base.position.set(0, -2.0, 0);
  g.add(base);
  strutBetween(g, [0, -1.9, 0], [0, -0.15, 0], { radius: 0.16, mat: MT.brass, name: 'SL_Post' });
  // 灯体
  const body = new THREE.Mesh(cylGeo(0.66, 0.52, 1.5, 14), MT.brass);
  body.rotation.z = Math.PI / 2;
  g.add(body);
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 0.62, 0.9, 18, 1, true), MT.brassDark);
  dish.rotation.z = Math.PI / 2;
  dish.position.x = 1.05;
  g.add(dish);
  const face = new THREE.Mesh(new THREE.CircleGeometry(1.05, 20), MT.searchlight);
  face.rotation.y = Math.PI / 2;
  face.position.x = 1.44;
  face.userData.noOutline = true;
  g.add(face);
  // 水平转轴（连接灯体与立柱）
  strutBetween(g, [0, -0.12, 0], [0, 0, 0], { radius: 0.14, mat: MT.bronze, name: 'SL_Yoke' });
  g.userData.parts = { face };
  return g;
}

// ---------------------------------------------------------------------------
// 蒸汽动力舱：蒸汽机（驱动）→ 曲柄飞轮 → 24/18/12 齿轮组 → 输出轴 → 螺旋桨
// 每个齿轮的轴心、轴、轴承座、机架、管路都是真实连接的，读起来就是"动力在传出去"
// ---------------------------------------------------------------------------
const MACH = {
  module: 0.09,          // 齿轮模数 → 24T 节圆半径 1.08 m
  plateX: [-10.2, -0.6],
  plateY: [-19.3, -13.2],
  zOff: 0.34,            // 齿轮面相对吊舱侧壁的外偏
  shaftR: 0.17,
};

function buildMachinery(MT, gd) {
  const root = new THREE.Group();
  root.name = 'Machinery';
  const yProp = gd.midY - 2.2;              // 与螺旋桨同高 → 输出轴是一条直线
  const m = MACH.module;

  const train = [];   // 齿轮链
  const crankPins = [];

  for (const side of [1, -1]) {
    const g = new THREE.Group();
    g.name = `Machinery_${side > 0 ? 'S' : 'P'}`;
    const zPlane = side * (SPEC.gondolaW / 2 + MACH.zOff);   // 齿轮所在平面
    const zPlate = side * (SPEC.gondolaW / 2 + 0.06);

    // --- 机架板（螺栓固定在吊舱侧壁）---
    const pw = MACH.plateX[1] - MACH.plateX[0];
    const ph = MACH.plateY[1] - MACH.plateY[0];
    const plate = new THREE.Mesh(bevelBox(pw, ph, 0.14, 0.03), MT.iron);
    plate.position.set((MACH.plateX[0] + MACH.plateX[1]) / 2, (MACH.plateY[0] + MACH.plateY[1]) / 2, zPlate);
    plate.castShadow = true;
    g.add(plate);
    // 机架板与吊舱之间的连接肘板
    for (const x of [MACH.plateX[0] + 1.0, MACH.plateX[1] - 1.0]) {
      strutBetween(g, [x, MACH.plateY[0] + 0.6, side * SPEC.gondolaW / 2], [x, MACH.plateY[0] + 0.6, zPlate],
        { radius: 0.13, mat: MT.brassDark, name: 'Bracket' });
    }

    // --- 齿轮链：24T（曲柄飞轮）→ 18T → 12T（输出）---
    const teeth = [24, 18, 12];
    const radii = teeth.map((t) => (m * t) / 2);
    const centers = [];
    let cx = -3.6;
    for (let i = 0; i < teeth.length; i++) {
      centers.push([cx, yProp]);
      cx -= radii[i] + radii[i + 1] + 0.005;   // 节圆外切 → 齿真正啮合
    }

    const wheels = [];
    for (let i = 0; i < teeth.length; i++) {
      const [gx, gy] = centers[i];
      const gr = gear(g, teeth[i], {
        module: m, thickness: 0.34, pos: [gx, gy, zPlane], name: `Gear_${teeth[i]}T_${side > 0 ? 'S' : 'P'}`,
      });
      gr.userData.teeth = teeth[i];
      gr.userData.pitchRadius = radii[i];
      // 相位对齐：让齿插进对方齿槽
      gr.rotation.z = (i % 2 ? Math.PI / teeth[i] : 0);
      wheels.push(gr);

      // 轴 + 两端轴承座
      const shaft = new THREE.Mesh(cylGeo(MACH.shaftR, MACH.shaftR, 0.95, 10), MT.bronze);
      shaft.rotation.x = Math.PI / 2;
      shaft.position.set(gx, gy, zPlate + side * 0.12);
      g.add(shaft);
      bearingBlock(g, {
        shaftRadius: MACH.shaftR, height: 0.42, mat: MT.bronze,
        pos: [gx, gy - 0.34, zPlate + side * 0.12],
      });
      // 轮辐（把齿轮与轴连起来，避免"齿轮浮在轴上"）
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        strutBetween(g, [gx, gy, zPlane - side * 0.1],
          [gx + Math.cos(a) * radii[i] * 0.86, gy + Math.sin(a) * radii[i] * 0.86, zPlane - side * 0.1],
          { radius: 0.08, mat: MT.brassDark, name: 'Spoke', castShadow: false });
      }
    }
    train.push({ side, wheels, centers, radii, zPlane });

    // --- 蒸汽机（驱动源）：立式汽缸 + 活塞杆 → 曲柄 ---
    const cylX = -1.5;
    const cylTopY = MACH.plateY[1] - 0.3;
    const cylBotY = yProp + 0.9;
    const cylLen = cylTopY - cylBotY;
    const steamCyl = new THREE.Mesh(cylGeo(0.52, 0.58, cylLen, 14), MT.bronze);
    steamCyl.position.set(cylX, (cylTopY + cylBotY) / 2, zPlane);
    steamCyl.castShadow = true;
    g.add(steamCyl);
    for (const dy of [cylLen * 0.3, -cylLen * 0.3]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.09, 6, 16), MT.brass);
      hoop.position.set(cylX, (cylTopY + cylBotY) / 2 + dy, zPlane);
      hoop.rotation.x = Math.PI / 2;
      g.add(hoop);
    }
    // 汽缸两端的封头 + 蒸汽进气管（从锅炉连过来）
    strutBetween(g, [cylX, cylTopY, zPlane], [cylX, cylTopY + 0.5, zPlate],
      { radius: 0.14, mat: MT.brassDark, name: 'CylMount' });
    pipe(g, [
      [cylX, cylTopY - 0.1, zPlane + side * 0.5],
      [cylX - 2.0, MACH.plateY[1] - 0.6, zPlate + side * 0.9],
      [-7.4, gd.boilerY - 0.6, side * 1.1],
      [-8.0, gd.boilerY - 1.2, 0],
    ], { radius: 0.12, mat: MT.brass, segments: 40, flanges: false, name: 'SteamPipe' });
    // 排气管
    pipe(g, [
      [cylX, cylBotY + 0.2, zPlane + side * 0.5],
      [cylX + 0.6, cylBotY - 0.9, zPlate + side * 1.1],
      [-5.6, gd.topY - 4.0, side * 3.2],
    ], { radius: 0.1, mat: MT.brassDark, segments: 30, flanges: false, name: 'ExhaustPipe' });

    // 活塞杆（每帧按曲柄销位置重算）
    const rod = unitStrut(g, 0.11, MT.brass, 'PistonRod');
    const crankR = radii[0] * 0.62;
    const pin = new THREE.Mesh(cylGeo(0.13, 0.13, 0.4, 8), MT.bronze);
    pin.rotation.x = Math.PI / 2;
    pin.position.set(centers[0][0], yProp + crankR, zPlane + side * 0.24);
    g.add(pin);
    crankPins.push({ pin, rod, side, cx: centers[0][0], cy: yProp, r: crankR, zPlane, cylBotY, cylX });

    // --- 输出轴：12T 齿轮 → 前后两组螺旋桨吊舱 ---
    const [outX, outY] = centers[2];
    // 输出轴：终点必须落在换向齿轮箱中心（x = ±12），否则会有一截杆子凭空支出去
    strutBetween(g, [outX - 0.2, outY, zPlate], [12.0, outY, zPlate],
      { radius: 0.15, mat: MT.bronze, name: 'OutputShaftFore' });
    strutBetween(g, [outX - 0.2, outY, zPlate], [-12.0, outY, zPlate],
      { radius: 0.15, mat: MT.bronze, name: 'OutputShaftAft' });
    // 输出轴吊挂轴承（把长轴连到船身，否则是一根飘着的杆）
    for (const bx of [-11.0, -7.0, 3.0, 9.0]) {
      strutBetween(g, [bx, outY + 0.9, zPlate - side * 0.3], [bx, outY, zPlate],
        { radius: 0.09, mat: MT.brassDark, name: 'ShaftHanger', castShadow: false });
      const brg = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.08, 6, 12), MT.bronze);
      brg.position.set(bx, outY, zPlate);
      brg.rotation.y = Math.PI / 2;
      g.add(brg);
    }
    // 换向锥齿轮箱（输出轴 → 螺旋桨轴，真实传动里必须有这个）
    for (const bx of [-12, 12]) {
      const housing = new THREE.Mesh(bevelBox(1.5, 1.5, 1.5, 0.2), MT.iron);
      housing.position.set(bx, outY, zPlate);
      housing.castShadow = true;
      g.add(housing);
      const crown = new THREE.Mesh(gearGeo(18, 0.075, 0.24), MT.brass);
      crown.rotation.y = Math.PI / 2;
      crown.position.set(bx + (bx > 0 ? 0.75 : -0.75), outY, zPlate);
      g.add(crown);
      // 输出轴伸进箱体
      strutBetween(g, [bx, outY, zPlate], [bx + (bx > 0 ? 0.72 : -0.72), outY, zPlate],
        { radius: 0.16, mat: MT.bronze, name: 'BevelInput' });
      // 螺旋桨轴从箱体伸出去（另一根，沿 Z 折向吊舱）
      strutBetween(g, [bx, outY, zPlate], [bx, outY, side * 8.4],
        { radius: 0.16, mat: MT.bronze, name: 'BevelOutput' });
    }

    root.add(g);
  }

  root.userData.parts = { train, crankPins, yProp };
  return root;
}

// ---------------------------------------------------------------------------
// 螺旋桨
// 【v2 的真错】旧代码把叶片做成了"沿轴方向的盒子"（长边在 X 上），
// 于是看起来像几片贴在轴上的小拨片 —— 这就是"太小了而且不太像"的根因。
// 正确做法：沿**径向**铺设，弦长沿轴、厚度沿切向，并用分段逐段加大桨距来近似扭转。
//
// holder 的局部坐标系约定（holder 由 rotation.x 定位到某个叶片角）：
//   局部 X = 桨轴方向（叶片**厚度**）
//   局部 Y = 径向（叶片**展向**）
//   局部 Z = 切向（叶片**弦长**）
//
// 【v4 修正的关键错误】弦长与厚度方向原本搞反了 90°：把弦长放在轴上、厚度放在切向 →
// 正面看只剩一条细缝，读成"从轮毂伸出的几根细杆"。真实螺旋桨从正面看是一圈**宽面片**，
// 面法线朝轴 —— 所以弦长必须在切向、厚度必须在轴向。
// ---------------------------------------------------------------------------
function buildPropeller(MT, radius) {
  const g = new THREE.Group();
  g.name = 'Propeller';

  const hubR = 0.95;
  const span = radius - hubR;
  const segs = 4;
  const chordRoot = 1.55, chordTip = 0.42;
  const pitchRoot = 0.22, pitchTip = 0.62;   // rad
  const thick = 0.14;

  // 桨毂 + 整流罩
  const hub = new THREE.Mesh(cylGeo(0.62, 0.78, 1.6, 16), MT.brass);
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  const hubCap = new THREE.Mesh(coneGeo(0.62, 1.5, 16), MT.bronze);
  hubCap.rotation.z = -Math.PI / 2;
  hubCap.position.x = 1.5;
  g.add(hubCap);

  const blades = new THREE.Group();
  blades.name = 'Blades';

  for (let i = 0; i < SPEC.propBlades; i++) {
    const holder = new THREE.Group();
    holder.rotation.x = (Math.PI * 2 * i) / SPEC.propBlades;   // 定位到叶片角

    // 分段桨叶：逐段收窄 + 逐段加大桨距 → 读起来就是"扭转的桨叶"
    for (let k = 0; k < segs; k++) {
      const t0 = k / segs, t1 = (k + 1) / segs;
      const r0 = hubR + span * t0;
      const r1 = hubR + span * t1;
      const tc = (k + 0.5) / segs;
      const chord = THREE.MathUtils.lerp(chordRoot, chordTip, Math.pow(tc, 0.85));
      const pitch = THREE.MathUtils.lerp(pitchRoot, pitchTip, tc);
      // X=厚度、Y=展向、Z=弦长
      const seg = new THREE.Mesh(bevelBox(thick, r1 - r0 + 0.02, chord, 0.035, 2), MT.brass);
      seg.position.set(0, (r0 + r1) / 2, 0);
      seg.rotation.y = pitch;        // 绕展向轴 —— 这才是"桨距"
      seg.castShadow = true;
      holder.add(seg);
    }

    // 叶根卡箍（把叶片与桨毂连起来）
    const cuff = new THREE.Mesh(boxGeo(0.62, 0.42, 0.5), MT.bronze);
    cuff.position.set(0, hubR + 0.05, 0);
    holder.add(cuff);
    strutBetween(holder, [0, hubR * 0.55, 0], [0, hubR + 0.1, 0],
      { radius: 0.16, mat: MT.brassDark, name: 'BladeShaft' });

    // 叶尖配重（黄铜小片，增强"实物感"）
    const tip = new THREE.Mesh(boxGeo(thick * 1.6, 0.30, chordTip * 0.9), MT.bronze);
    tip.position.set(0, radius - 0.12, 0);
    tip.rotation.y = pitchTip;
    holder.add(tip);

    blades.add(holder);
  }
  g.add(blades);

  const rootRing = new THREE.Mesh(new THREE.TorusGeometry(hubR * 1.02, 0.13, 6, 24), MT.brassDark);
  rootRing.rotation.y = Math.PI / 2;
  g.add(rootRing);

  g.userData.parts = { blades };
  return g;
}

function buildPropulsion(MT, gd, mach) {
  const g = new THREE.Group();
  g.name = 'Propulsion';
  const props = [];
  const yProp = mach.userData.parts.yProp;
  const R = SPEC.propDiameter / 2;

  // 【v4 修正】纵向吊臂原先在 (yProp+1.5, ±6.2)，距桨盘轴心只有 2.66 m < 桨半径 4.2 m
  // ⇒ 后桨（盘面 x=−10.1，在吊臂 x 跨度 −12..12 之内）的叶片直接切穿吊臂 = 穿模。
  // 改为「高位纵梁 + 每短舱独立吊架」：纵梁抬到桨盘扫掠圆之外，吊架只在 x=px 平面内
  // （距桨盘面 1.9 m），从几何上彻底避开叶片扫掠区。
  const ySpar = -8.4;          // 纵梁高度（在桨盘扫掠圆之上、收折桨轮之上、气囊之下）
  const zSpar = 7.0;

  for (const sgn of [1, -1]) {
    const zInner = sgn * (SPEC.gondolaW / 2);       // 吊舱侧壁
    const zS = sgn * zSpar;
    const zNac = sgn * 8.4;                         // 短舱位置

    // ★ 高位纵梁：到桨盘轴心 (yProp, zNac) 的距离 = √(8.8² + 1.4²) = 8.9 m > R+0.4 ✓
    const spar = new THREE.Mesh(boxGeo(24, 0.46, 0.62), MT.iron);
    spar.position.set(1.0, ySpar, zS);
    spar.castShadow = true;
    spar.name = 'OutriggerSpar';
    g.add(spar);

    // 纵梁 → 吊舱肩部的斜撑（径向同样远离桨盘）
    for (const bx of [-9.0, -3.0, 3.0, 9.0]) {
      strutBetween(g, [bx, -13.4, zInner], [bx, ySpar, zS], { radius: 0.15, mat: MT.brass, name: 'SparBrace' });
    }

    // 每短舱一套独立吊架（全部在 x = px 平面内 ⇒ 距桨盘面 1.9 m，不可能吃到叶片）
    for (const px of [12, -12]) {
      const nacelle = new THREE.Mesh(new THREE.CapsuleGeometry(0.78, 3.0, 6, 14), MT.brass);
      nacelle.rotation.z = Math.PI / 2;
      nacelle.position.set(px, yProp, zNac);
      nacelle.castShadow = true;
      g.add(nacelle);

      // V 形吊架
      strutBetween(g, [px, ySpar, sgn * (zSpar - 0.7)], [px, yProp + 0.5, zNac],
        { radius: 0.18, mat: MT.brass, name: 'NacellePylon' });
      strutBetween(g, [px, ySpar, sgn * (zSpar + 0.7)], [px, yProp + 0.5, zNac],
        { radius: 0.18, mat: MT.brass, name: 'NacellePylon' });
      // 短舱鞍座
      const saddle = new THREE.Mesh(boxGeo(1.5, 0.36, 1.5), MT.iron);
      saddle.position.set(px, yProp + 0.86, zNac);
      g.add(saddle);

      const prop = buildPropeller(MT, R);
      prop.position.set(px + 1.9, yProp, zNac);
      prop.userData.sgn = sgn;
      prop.userData.fore = px > 0;
      g.add(prop);
      props.push(prop);

      const cowl = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.7, 0.8, 16, 1, true), MT.brassDark);
      cowl.rotation.z = Math.PI / 2;
      cowl.position.set(px + 1.15, yProp, zNac);
      g.add(cowl);

      // 短舱尾锥
      const tail = new THREE.Mesh(coneGeo(0.78, 1.5, 12), MT.bronze);
      tail.rotation.z = -Math.PI / 2;
      tail.position.set(px - 2.4, yProp, zNac);
      g.add(tail);
    }
  }

  g.userData.parts = { props, yProp };
  return g;
}

// ---------------------------------------------------------------------------
// 侧边桅杆 + 风帆（v5.2 新增）
// 混合飞艇构型：舷外斜出桅杆挂帆捕风助航；入水前收帆、触水后折桅，收进舷侧。
//
// 结构：g(铰座) → tilt(外倾角，可动) → mast(折桅角，可动) → 桅杆/桁/帆/帆卷
// 收起原理：折桅角 8° → 86° ⇒ 桅杆从舷外斜立转到**平躺沿船身**（收在舷侧）
// 收帆原理：帆面沿桅杆方向压到 8%，桁下压，帆卷鼓起
// 外倾角取 52°：既让桅杆越过气囊下缘（z=4.3 处气囊下表面仅 −7.1 m），
//               又读得出"桅"而不是"撑杆"
// ---------------------------------------------------------------------------
function buildSailMast(MT, o = {}) {
  const side = o.side ?? 1;            // +1 右舷 / −1 左舷
  const L = o.length ?? 13;            // m 桅杆长
  const W = o.width ?? 5.5;            // m 帆宽（沿船轴方向）
  const g = new THREE.Group();
  g.name = `SailMast_${side > 0 ? 'S' : 'P'}_${o.index ?? 0}`;
  g.position.set(o.x ?? 0, o.pivotY ?? -12.4, side * (o.pivotZ ?? 4.3));

  // --- 铰座：固定在吊舱肩部（底座 + 肘板，不是悬空）---
  const base = new THREE.Mesh(bevelBox(2.4, 0.6, 1.6, 0.12), MT.iron);
  base.position.set(0, 0.3, side * -0.9);
  base.castShadow = true;
  g.add(base);
  for (const dx of [-0.9, 0.9]) {
    strutBetween(g, [dx, 0.3, side * -1.2], [dx, 0.3, 0],
      { radius: 0.14, mat: MT.brassDark, name: 'MastBracket' });
  }
  const axle = new THREE.Mesh(cylGeo(0.24, 0.24, 2.0, 10), MT.bronze);
  axle.rotation.x = Math.PI / 2;
  g.add(axle);

  const tilt = new THREE.Group();      // 外倾（可动）
  tilt.name = 'MastTilt';
  g.add(tilt);
  const mast = new THREE.Group();      // 折桅（可动）
  mast.name = 'MastFold';
  tilt.add(mast);

  // 桅杆本体
  const shaft = new THREE.Mesh(cylGeo(0.13, 0.30, L, 10), MT.wood);
  shaft.position.y = L / 2;
  shaft.castShadow = true;
  mast.add(shaft);
  for (let i = 1; i <= 4; i++) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.30 - i * 0.04, 0.055, 6, 12), MT.brassDark);
    hoop.position.y = (L * i) / 4.4;
    hoop.rotation.x = Math.PI / 2;
    mast.add(hoop);
  }
  const cap = new THREE.Mesh(coneGeo(0.16, 0.5, 8), MT.bronze);
  cap.position.y = L + 0.22;
  mast.add(cap);
  const block = new THREE.Mesh(boxGeo(0.34, 0.42, 0.26), MT.brassDark);
  block.position.set(0, L * 0.86, 0);
  mast.add(block);

  // 稳索（动态连杆，在 drive 里重算端点）
  const stayA = unitStrut(g, 0.06, MT.rope, 'MastStayFore');
  const stayB = unitStrut(g, 0.06, MT.rope, 'MastStayAft');

  // --- 帆：斜面四边形。挂在"桁枢轴"下，收帆时向桁收拢（不是向桅杆根部缩）---
  const sailPivot = new THREE.Group();
  sailPivot.position.y = L * 0.82;
  mast.add(sailPivot);
  const p = [[0, 0], [-W, -L * 0.18], [-W, -L * 0.64], [0, -L * 0.72]];
  const pos = [], uv = [], idx = [];
  for (const [x, y] of p) pos.push(x, y, 0);
  uv.push(1, 1, 0, 0.78, 0, 0.22, 1, 0);
  idx.push(0, 1, 2, 0, 2, 3);
  const sailGeo = new THREE.BufferGeometry();
  sailGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sailGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  sailGeo.setIndex(idx);
  sailGeo.computeVertexNormals();
  const sailMat = M.canvas({ color: new THREE.Color('#DCD2BA'), bands: [0.26, 0.58, 0.96], outline: false });
  sailMat.side = THREE.DoubleSide;
  const sail = new THREE.Mesh(sailGeo, sailMat);
  sail.name = 'Sail';
  sail.castShadow = true;
  sailPivot.add(sail);
  // 帆面横缝（3 道），与帆同组 ⇒ 收帆时一起收拢
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    strutBetween(sailPivot, [0, -L * 0.72 * t, 0], [-W * (1 - t * 0.1), -L * (0.18 + 0.46 * t), 0],
      { radius: 0.045, mat: MT.brassDark, name: 'SailSeam', castShadow: false });
  }
  // 帆脚杆（在帆组内，收帆时随之上移）
  strutBetween(sailPivot, [0, -L * 0.72, 0], [-W * 0.98, -L * 0.64, 0],
    { radius: 0.09, mat: MT.brass, name: 'BoomSpar' });

  // 桁（上缘斜杆）：独立于帆组，收帆时下压
  const gaff = new THREE.Group();
  gaff.name = 'Gaff';
  mast.add(gaff);
  strutBetween(gaff, [0, L * 0.82, 0], [-W * 0.98, L * 0.66, 0], { radius: 0.10, mat: MT.brass, name: 'GaffSpar' });

  // 收帆后的帆卷（卷在桅杆上，仅收帆时可见）
  const furl = new THREE.Mesh(cylGeo(0.26, 0.30, L * 0.72, 10), MT.canvasDark);
  furl.position.y = L * 0.46;
  furl.scale.setScalar(0.01);
  furl.userData.noOutline = true;
  mast.add(furl);

  g.userData.parts = {
    side, tilt, mast, sailPivot, sail, gaff, furl, stayA, stayB, L, W,
    tipLocal: new THREE.Vector3(0, L * 0.92, 0),
    anchor: [0, 0.3, side * -1.2],
  };
  return g;
}

// ---------------------------------------------------------------------------
// 可折叠侧桨轮（蒸汽船大桨轮）——降落水面后展开
// 摆动臂绕 X 轴在铰点旋转；桨轮保持在 XY 平面内（转轴恒为 Z），读起来像平行四边形连杆
// ---------------------------------------------------------------------------
function buildPaddleWheel(MT, side) {
  const g = new THREE.Group();
  g.name = `PaddleWheel_${side > 0 ? 'S' : 'P'}`;

  const P = [SPEC.paddlePivotX, SPEC.paddlePivotY, side * SPEC.paddlePivotZ];
  const R = SPEC.paddleRadius;
  const beam = SPEC.paddleBeam;
  const zWheel = side * (SPEC.paddlePivotZ + 0.35);

  // --- 摆动臂（两根平行杆 + 横撑），绕 X 轴在铰点旋转 ---
  const arm = new THREE.Group();
  arm.name = 'PaddleArm';
  arm.position.fromArray(P);
  for (const dz of [0, 0.9]) {
    const a = new THREE.Mesh(boxGeo(0.34, beam, 0.3), MT.brass);
    a.position.set(0, beam / 2, side * dz * 0.5);
    a.castShadow = true;
    arm.add(a);
  }
  for (let i = 1; i <= 3; i++) {
    const cross = new THREE.Mesh(boxGeo(0.22, 0.22, 1.1), MT.brassDark);
    cross.position.set(0, (beam * i) / 4, side * 0.22);
    arm.add(cross);
  }
  // 铰点轴承座（固定在吊舱侧壁，臂从它里面转出来）
  const pivotBase = new THREE.Mesh(bevelBox(1.5, 1.1, 0.5, 0.1), MT.iron);
  pivotBase.position.set(P[0], P[1], side * (SPEC.gondolaW / 2 + 0.1));
  pivotBase.castShadow = true;
  g.add(pivotBase);
  strutBetween(g, [P[0], P[1], side * SPEC.gondolaW / 2], [P[0], P[1], side * SPEC.paddlePivotZ],
    { radius: 0.22, mat: MT.bronze, name: 'PaddlePivotShaft' });
  g.add(arm);

  // --- 桨轮（独立于臂：位置沿臂端弧线走，但轮平面恒为 XY，转轴恒为 Z）---
  const wheel = new THREE.Group();
  wheel.name = 'PaddleWheelBody';
  const hub = new THREE.Mesh(cylGeo(0.42, 0.42, 2.4, 12), MT.bronze);
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  for (const dz of [-1.15, 1.15]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.16, 8, 36), MT.brass);
    rim.position.z = dz;
    rim.castShadow = true;
    wheel.add(rim);
  }
  // 8 片桨叶（可羽化折叠）
  // 工作面：板面法线 = 切向（推水）；收折面：绕自身径向轴转 90°，板面躺进轮平面
  const paddles = [];
  const NP = 8;
  for (let i = 0; i < NP; i++) {
    const holder = new THREE.Group();
    holder.rotation.z = (Math.PI * 2 * i) / NP;
    const blade = new THREE.Mesh(boxGeo(2.2, 0.35, 2.4), MT.wood);   // 径向长 × 切向薄 × 轴向宽
    blade.position.x = R - 1.1;
    blade.castShadow = true;
    holder.add(blade);
    // 叶片与轮毂/轮缘的连接支臂
    strutBetween(holder, [0.4, 0, 0], [R - 1.6, 0, 0],
      { radius: 0.13, mat: MT.brassDark, name: 'BladeArm', castShadow: false });
    for (const dz of [-1.15, 1.15]) {
      strutBetween(holder, [0.4, 0, dz], [R - 1.4, 0, dz],
        { radius: 0.1, mat: MT.brassDark, name: 'BladeArm2', castShadow: false });
    }
    wheel.add(holder);
    paddles.push({ holder, blade });
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    strutBetween(wheel, [0, 0, 0], [Math.cos(a) * R * 0.95, Math.sin(a) * R * 0.95, 0],
      { radius: 0.1, mat: MT.brass, name: 'WheelSpoke' });
  }
  g.add(wheel);

  // --- 蒸汽促动缸（把摆动臂推下去 / 收起来）---
  const actuator = unitStrut(g, 0.26, MT.bronze, 'PaddleActuator');
  const actuatorMount = new THREE.Mesh(bevelBox(1.1, 0.9, 0.4, 0.08), MT.iron);
  actuatorMount.position.set(P[0] - 2.6, P[1] - 0.7, side * (SPEC.gondolaW / 2 + 0.1));
  g.add(actuatorMount);
  // 促动缸的缸体（随动件，按行程重算）
  const actBody = unitStrut(g, 0.34, MT.brassDark, 'PaddleActuatorBody');

  // 收折状态下的桨叶存放挂钩
  const stowHook = new THREE.Mesh(boxGeo(0.3, 0.3, 0.7), MT.brassDark);
  stowHook.position.set(P[0] + 0.4, P[1] + 2.0, side * (SPEC.gondolaW / 2 + 0.35));
  g.add(stowHook);

  g.userData.parts = {
    arm, wheel, paddles, actuator, actBody, actuatorMount,
    P, R, beam, side, mountPoint: [P[0] - 2.6, P[1] - 1.2, side * (SPEC.gondolaW / 2 + 0.32)],
  };
  return g;
}

// ---------------------------------------------------------------------------
// 浮筒 ×2（真实吊架连接）
// ---------------------------------------------------------------------------
function buildPontoons(MT, gd) {
  const g = new THREE.Group();
  g.name = 'Pontoons';
  const FL = SPEC.pontoonLen;
  const FR = SPEC.pontoonDia / 2;
  const cy = SPEC.pontoonCenterY;
  const botY = SPEC.gondolaBottomY;
  const zP = SPEC.pontoonZ;

  for (const sideSgn of [1, -1]) {
    const z = sideSgn * zP;
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(FR, FL - FR * 2, 8, 22), MT.canvasDark);
    hull.rotation.z = Math.PI / 2;
    hull.position.set(-0.5, cy, z);
    hull.castShadow = true;
    hull.name = `Pontoon_${sideSgn > 0 ? 'S' : 'P'}`;
    g.add(hull);

    // 黄铜箍
    for (let i = 0; i < 6; i++) {
      const x = -0.5 - (FL - 4) / 2 + ((FL - 4) * i) / 5;
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(FR * 1.03, 0.16, 6, 20), MT.brass);
      hoop.rotation.y = Math.PI / 2;
      hoop.position.set(x, cy, z);
      g.add(hoop);
    }
    // 艏部防撞包
    const bow = new THREE.Mesh(sphereGeo(FR * 1.02, 14), MT.brass);
    bow.position.set(-0.5 + FL / 2, cy, z);
    g.add(bow);

    // 吊架：吊舱底 → 浮筒顶，V 形四组，全部按真实端点生成
    for (const px of [-6.6, -1.0, 4.6]) {
      for (const dz of [-0.85, 0.85]) {
        strutBetween(g,
          [-0.5 + px + dz * 0.5, botY, z],
          [-0.5 + px + dz * 1.6, cy + FR * 0.92, z],
          { radius: 0.17, mat: MT.brass, name: 'PontoonStrut' });
      }
      // 吊架横梁 + 与吊舱底的连接板
      const beam = new THREE.Mesh(boxGeo(2.6, 0.26, 1.9), MT.iron);
      beam.position.set(-0.5 + px, botY - 0.1, z);
      g.add(beam);
      strutBetween(g, [-0.5 + px, botY, z], [-0.5 + px, cy + FR, z],
        { radius: 0.2, mat: MT.brassDark, name: 'PontoonPost' });
    }

    // 系泊钩
    const cleat = new THREE.Mesh(boxGeo(1.3, 0.32, 0.42), MT.brass);
    cleat.position.set(-0.5 + FL * 0.42, cy + FR * 0.7, z);
    g.add(cleat);
  }

  // 两浮筒之间的横向拉杆 + 交叉斜撑（把站距"焊死"，消除重心不稳的观感）
  for (const px of [-8.0, -0.5, 7.0]) {
    strutBetween(g, [-0.5 + px, cy, -zP], [-0.5 + px, cy, zP],
      { radius: 0.13, mat: MT.brass, name: 'PontoonTie' });
  }
  for (const [xa, xb] of [[-9.0, 6.5], [6.5, -9.0]]) {
    strutBetween(g, [-0.5 + xa, botY - 0.4, -zP], [-0.5 + xb, cy + FR * 0.7, zP],
      { radius: 0.12, mat: MT.brassDark, name: 'PontoonBrace' });
    strutBetween(g, [-0.5 + xa, botY - 0.4, zP], [-0.5 + xb, cy + FR * 0.7, -zP],
      { radius: 0.12, mat: MT.brassDark, name: 'PontoonBrace' });
  }

  return g;
}

// ---------------------------------------------------------------------------
// 尾组：尾桁（把气囊与尾鳍真正连起来）+ 十字尾鳍 + 舵面
// ---------------------------------------------------------------------------
function finBasis(outward) {
  const d = outward.clone().normalize();
  const fwd = new THREE.Vector3(1, 0, 0);
  const y = fwd.clone().addScaledVector(d, -fwd.dot(d)).normalize();
  const z = new THREE.Vector3().crossVectors(d, y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(d, y, z));
}

function buildTail(MT) {
  const g = new THREE.Group();
  g.name = 'Tail';

  const envTailX = -ENV_HL + 1.0;          // -30
  const boomEndX = -SPEC.lengthTotal / 2 + 5.0;   // -38
  const span = SPEC.finSpan / 2;
  const chordAft = 4.8;

  // --- 尾桁：由气囊尾端渐缩到鳍根，八根撑杆 + 环箍 ---
  const rStart = envRadius(envTailX) * 0.92;
  const rEnd = 1.5;
  for (let i = 0; i <= 4; i++) {
    const t0 = i / 5, t1 = (i + 1) / 5;
    const x0 = THREE.MathUtils.lerp(envTailX, boomEndX, t0);
    const x1 = THREE.MathUtils.lerp(envTailX, boomEndX, t1);
    const r0 = THREE.MathUtils.lerp(rStart, rEnd, t0);
    const r1 = THREE.MathUtils.lerp(rStart, rEnd, t1);
    for (let k = 0; k < 8; k++) {
      const a0 = (k / 8) * Math.PI * 2;
      const a1 = ((k + 1) / 8) * Math.PI * 2;
      // 环箍（八边形近似）
      strutBetween(g, [x1, ENV_C + Math.sin(a0) * r1, Math.cos(a0) * r1],
        [x1, ENV_C + Math.sin(a1) * r1, Math.cos(a1) * r1],
        { radius: 0.1, mat: MT.brassDark, name: 'BoomHoop', castShadow: false });
      // 纵向杆
      strutBetween(g, [x0, ENV_C + Math.sin(a0) * r0, Math.cos(a0) * r0],
        [x1, ENV_C + Math.sin(a0) * r1, Math.cos(a0) * r1],
        { radius: 0.11, mat: MT.brass, name: 'BoomChord' });
      // 交叉斜撑
      if (i % 2 === 0) {
        strutBetween(g, [x0, ENV_C + Math.sin(a0) * r0, Math.cos(a0) * r0],
          [x1, ENV_C + Math.sin(a1) * r1, Math.cos(a1) * r1],
          { radius: 0.08, mat: MT.brassDark, name: 'BoomDiag', castShadow: false });
      }
    }
  }
  // 尾桁根部的连接法兰（与气囊尾端接死）
  mountFlange(g, {
    radius: rStart * 0.98, thickness: 0.22, seg: 24,
    pos: [envTailX + 0.2, ENV_C, 0], rot: [0, 0, Math.PI / 2], bolts: 10, name: 'BoomFlange',
  });

  // --- 十字尾鳍 ---
  const s = new THREE.Shape();
  s.moveTo(0, -chordAft * 0.45);
  s.lineTo(span * 0.86, chordAft * 0.5);
  s.lineTo(span, chordAft * 0.16);
  s.lineTo(span * 0.98, -chordAft * 0.5);
  s.lineTo(span * 0.28, -chordAft * 0.72);
  s.closePath();
  const finGeo = new THREE.ExtrudeGeometry(s, {
    depth: 0.24, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 1, curveSegments: 1,
  });
  finGeo.translate(0, 0, -0.12);

  const fins = [];
  for (const d of [
    { v: new THREE.Vector3(0, 1, 0), name: 'Fin_Top' },
    { v: new THREE.Vector3(0, -1, 0), name: 'Fin_Bottom' },
    { v: new THREE.Vector3(0, 0, 1), name: 'Fin_Stbd' },
    { v: new THREE.Vector3(0, 0, -1), name: 'Fin_Port' },
  ]) {
    const fin = new THREE.Group();
    fin.name = d.name;
    fin.quaternion.copy(finBasis(d.v));
    fin.position.set(boomEndX, ENV_C, 0);

    const panel = new THREE.Mesh(finGeo, MT.canvasDark);
    panel.castShadow = true;
    fin.add(panel);

    // 鳍面骨架：展向肋 + 前后缘包边
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const ribBar = new THREE.Mesh(boxGeo(0.9, 0.16, 0.34), MT.brass);
      ribBar.position.set(span * t, chordAft * (0.36 - t * 0.6), 0);
      fin.add(ribBar);
    }
    const edge = new THREE.Mesh(boxGeo(span * 0.98, 0.24, 0.36), MT.brass);
    edge.position.set(span * 0.5, -chordAft * 0.6, 0);
    edge.rotation.z = -0.06;
    fin.add(edge);
    const edge2 = new THREE.Mesh(boxGeo(span * 0.9, 0.2, 0.32), MT.brass);
    edge2.position.set(span * 0.45, chordAft * 0.48, 0);
    edge2.rotation.z = -0.05;
    fin.add(edge2);

    // 鳍根与尾桁的连接肘板
    strutBetween(g, [boomEndX - 0.6, ENV_C, 0],
      [boomEndX + 0.4, ENV_C + d.v.y * 1.2, d.v.z * 1.2],
      { radius: 0.16, mat: MT.brassDark, name: 'FinRoot' });

    g.add(fin);
    fins.push(fin);
  }

  // 尾锥 + 尾灯
  const tailCone = new THREE.Mesh(coneGeo(1.3, 3.2, 12), MT.brass);
  tailCone.rotation.z = Math.PI / 2;
  tailCone.position.set(boomEndX - 2.4, ENV_C, 0);
  g.add(tailCone);
  const tailLamp = new THREE.Mesh(sphereGeo(0.42, 12), lamp(new THREE.Color('#C8433A'), 2.2));
  tailLamp.position.set(boomEndX - 4.2, ENV_C, 0);
  tailLamp.userData.noOutline = true;
  g.add(tailLamp);

  // ---- 方向舵（绕 Y 轴左右偏转）：装在**垂直鳍**（±Y）的后缘 ----
  // 铰点必须落在鳍的后缘 x = boomEndX − chordAft·0.45，不是鳍的中段
  const rudder = new THREE.Group();
  rudder.name = 'Rudder';
  const hingeX = boomEndX - chordAft * 0.46;
  rudder.position.set(hingeX, ENV_C, 0);
  for (const sy of [1, -1]) {
    // 舵面：竖直板（厚度沿 Z），绕 Y 转 → 左右摆 ✓ 看得见
    const p = new THREE.Mesh(bevelBox(2.2, 3.6, 0.18, 0.05), MT.canvasDark);
    p.position.set(-1.1, sy * 4.2, 0);
    p.castShadow = true;
    rudder.add(p);
    strutBetween(rudder, [0, sy * 2.6, 0], [0, sy * 6.0, 0],
      { radius: 0.09, mat: MT.brassDark, name: 'RudderHinge' });
  }
  g.add(rudder);

  // ---- 升降舵（绕 Z 轴上下偏转）：装在**水平鳍**（±Z）的后缘 ----
  // 【v4 修正】v3 的舵面是 (1.1, 3.6, 0.2) 竖直薄板 + rotation.z ⇒ 绕 Z 转等于在自身平面内自转，
  //          视觉上完全不动。必须做成**水平板（厚度沿 Y）**，绕 Z 转才会上下抬。
  const elevator = new THREE.Group();
  elevator.name = 'Elevator';
  elevator.position.set(hingeX, ENV_C, 0);
  for (const sz of [1, -1]) {
    const p = new THREE.Mesh(bevelBox(2.2, 0.18, 3.4, 0.05), MT.canvasDark);
    p.position.set(-1.1, 0, sz * 4.2);
    p.castShadow = true;
    elevator.add(p);
    strutBetween(elevator, [0, 0, sz * 2.6], [0, 0, sz * 6.0],
      { radius: 0.09, mat: MT.brassDark, name: 'ElevatorHinge' });
  }
  g.add(elevator);

  g.userData.parts = { fins, rudder, elevator, tailLamp, boomEndX, span, hingeX };
  return g;
}

// ---------------------------------------------------------------------------
// 气囊↔吊舱 吊索（真实端点 + 两端耳板）
// ---------------------------------------------------------------------------
function buildSuspension(MT) {
  const g = new THREE.Group();
  g.name = 'Suspension';
  const topY = SPEC.gondolaTopY;
  const halfZ = SPEC.gondolaW / 2 - 0.4;      // ±3.6

  for (const x of [-11, -4, 4, 11]) {
    for (const sz of [1, -1]) {
      const zEnv = sz * 7.2;
      const p0 = [x, envLowerY(x, zEnv), zEnv];
      const p1 = [x, topY + 0.05, sz * halfZ];
      strutBetween(g, p0, p1, { radius: 0.09, mat: MT.rope, name: 'SuspCable', castShadow: false });
      // 两端耳板
      const lugA = new THREE.Mesh(boxGeo(0.5, 0.3, 0.4), MT.brassDark);
      lugA.position.set(p0[0], p0[1] + 0.1, p0[2]);
      g.add(lugA);
      const lugB = new THREE.Mesh(boxGeo(0.5, 0.3, 0.4), MT.brassDark);
      lugB.position.set(p1[0], p1[1] - 0.05, p1[2]);
      g.add(lugB);
      // 与气囊表面的压条
      const strip = new THREE.Mesh(boxGeo(1.6, 0.14, 0.5), MT.brassDark);
      const ang = Math.atan2(0, zEnv) || (sz > 0 ? Math.PI / 2 : -Math.PI / 2);
      strip.position.set(x, envLowerY(x, zEnv) + 0.05, zEnv);
      g.add(strip);
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// 主装配
// ---------------------------------------------------------------------------
export function build(opts = {}) {
  const MT = makeMaterials();
  const root = new THREE.Group();
  root.name = 'Airship';

  const envelope = buildEnvelope(MT);
  const gondola = buildGondola(MT);
  const gd = gondola.userData.parts;
  const machinery = buildMachinery(MT, gd);
  const propulsion = buildPropulsion(MT, gd, machinery);
  const pontoons = buildPontoons(MT, gd);
  const suspension = buildSuspension(MT);
  const tail = buildTail(MT);
  const paddleWheels = [buildPaddleWheel(MT, 1), buildPaddleWheel(MT, -1)];
  // 侧边桅杆 + 风帆 ×4（每舷 2 根，前后错开，避免像"对称装饰"）
  // 尺寸：桅长 14–17 m、帆幅 6.2–7.5 m —— 小于这个量级在 86 m 艇身上读不出来
  const sailMasts = [
    buildSailMast(MT, { side: 1, x: 6.5, index: 0, length: 17.0, width: 7.5 }),
    buildSailMast(MT, { side: 1, x: -3.4, index: 1, length: 14.6, width: 6.4 }),
    buildSailMast(MT, { side: -1, x: 6.5, index: 0, length: 16.2, width: 7.1 }),
    buildSailMast(MT, { side: -1, x: -3.4, index: 1, length: 14.0, width: 6.2 }),
  ];

  root.add(envelope, gondola, machinery, propulsion, pontoons, suspension, tail,
    ...paddleWheels, ...sailMasts);

  const machParts = machinery.userData.parts;
  const gdParts = gondola.userData.parts;

  /** 桅帆收起程度 u ∈ [0,1]：0 = 满帆张开，1 = 收帆折桅贴舷 */
  function setSailStow(u) {
    const k = THREE.MathUtils.clamp(u, 0, 1);
    const tiltDeployed = THREE.MathUtils.degToRad(58);
    const tiltStowed = THREE.MathUtils.degToRad(24);
    const foldDeployed = THREE.MathUtils.degToRad(8);
    const foldStowed = THREE.MathUtils.degToRad(86);
    for (const sm of sailMasts) {
      const p = sm.userData.parts;
      // 单参数 u 映射成两段：先收帆（u=0 → 0.45），再折桅（u=0.35 → 1）
      // ⇒ 读起来是"先落帆、再收桅"，而不是帆桅同时缩
      const kSail = THREE.MathUtils.clamp(k / 0.45, 0, 1);
      const kFold = THREE.MathUtils.clamp((k - 0.35) / 0.65, 0, 1);
      // 外倾：收起时向内收，贴住舷侧
      p.tilt.rotation.x = p.side * THREE.MathUtils.lerp(tiltDeployed, tiltStowed, kFold);
      // 折桅：绕 Z 转到接近水平 ⇒ 桅杆平躺沿船身
      p.mast.rotation.z = THREE.MathUtils.lerp(foldDeployed, foldStowed, kFold);
      // 收帆：帆面向桁收拢
      p.sailPivot.scale.set(1 - 0.93 * kSail, 1 - 0.70 * kSail, 1);
      p.sail.visible = kSail < 0.995;
      // 桁下压 + 帆卷鼓起
      p.gaff.rotation.z = -0.55 * kSail;
      p.furl.scale.setScalar(THREE.MathUtils.lerp(0.01, 1, kSail));
      // 稳索按真实端点重算
      const tip = new THREE.Vector3(0, p.L * 0.92, 0)
        .applyQuaternion(p.mast.quaternion)
        .applyQuaternion(p.tilt.quaternion);
      const a = p.anchor;
      updateStrut(p.stayA, [a[0] + 1.9, a[1], a[2]], [tip.x, tip.y, tip.z]);
      updateStrut(p.stayB, [a[0] - 1.9, a[1], a[2]], [tip.x, tip.y, tip.z]);
    }
  }

  /** 展开程度 u ∈ [0,1]：0 = 收折贴舷，1 = 入水工作位 */
  function setPaddleDeploy(u) {
    const k = THREE.MathUtils.clamp(u, 0, 1);
    const stowRad = THREE.MathUtils.degToRad(SPEC.paddleStowDeg);
    const deployRad = THREE.MathUtils.degToRad(SPEC.paddleDeployDeg);
    const theta = THREE.MathUtils.lerp(stowRad, deployRad, k);   // 自竖直方向量起
    // 臂的局部 +Y 经 rotation.x = φ 后指向 (0, cosφ, sinφ)
    // 右舷 φ = +θ，左舷 φ = −θ  ⇒ 方向 = (0, cosθ, side·sinθ)
    const dirY = Math.cos(theta);
    const dirZ = Math.sin(theta);

    for (const pw of paddleWheels) {
      const p = pw.userData.parts;
      const { P, side, beam } = p;

      p.arm.rotation.x = side * theta;

      // 桨轮沿臂端弧线，但轮平面保持 XY（像平行四边形连杆，轮子始终保持竖直）
      p.wheel.position.set(P[0], P[1] + beam * dirY, P[2] + side * beam * dirZ);

      // 桨叶羽化：收折时绕自身径向轴转 90°，板面躺进轮平面
      const feather = THREE.MathUtils.lerp(Math.PI / 2, 0, k);
      for (const pl of p.paddles) pl.blade.rotation.x = feather;

      // 促动缸：缸体固定在吊舱侧，活塞杆推到臂中点
      const mid = [
        P[0],
        P[1] + beam * 0.55 * dirY,
        P[2] + side * beam * 0.55 * dirZ,
      ];
      updateStrut(p.actuator, p.mountPoint, mid);
      updateStrut(p.actBody, p.mountPoint, [
        THREE.MathUtils.lerp(p.mountPoint[0], mid[0], 0.45),
        THREE.MathUtils.lerp(p.mountPoint[1], mid[1], 0.45),
        THREE.MathUtils.lerp(p.mountPoint[2], mid[2], 0.45),
      ]);
    }
  }
  setPaddleDeploy(0);

  root.userData.parts = {
    envelope, gondola, machinery, propulsion, pontoons, suspension, tail, paddleWheels, sailMasts,
    materials: MT,
    props: propulsion.userData.parts.props,
    paddleDeploy: 0,
    sailStow: 0,
    waterlineY: SPEC.keelY + SPEC.draft,   // -22.5
    keelY: SPEC.keelY,
    draft: SPEC.draft,
    floatY: FLOAT_Y,
    setPaddleDeploy,
    setSailStow,

    /**
     * 动画驱动入口
     * 局部轴：+X 船首。俯仰 = rotation.z（正为抬头），横滚 = rotation.x
     * @param {number} t 秒
     * @param {object} s { altitude, pitch(deg), roll(deg), propRpm, propAftReverse,
     *                    elevator(deg), rudder(deg), paddleDeploy(0..1), gearRpm }
     */
    drive(t, s = {}) {
      const p = root.userData.parts;
      root.position.y = s.altitude ?? 0;
      root.rotation.z = THREE.MathUtils.degToRad(s.pitch ?? 0);
      root.rotation.x = THREE.MathUtils.degToRad(s.roll ?? 0);

      // 螺旋桨
      const rpm = s.propRpm ?? 0;
      for (const pr of p.props) {
        const sgn = pr.userData.sgn || 1;
        const fore = pr.userData.fore;
        const dir = fore ? 1 : (s.propAftReverse ? -1 : 1);
        pr.userData.parts.blades.rotation.x = (t * rpm / 60) * Math.PI * 2 * dir * sgn;
      }

      // 升降舵 / 方向舵
      const el = p.tail?.userData.parts?.elevator;
      if (el) el.rotation.z = THREE.MathUtils.degToRad(s.elevator ?? 0);
      const rud = p.tail?.userData.parts?.rudder;
      if (rud) rud.rotation.y = THREE.MathUtils.degToRad(s.rudder ?? Math.sin(t * 0.5) * 3);

      // 动力舱：齿轮按真实传动比转动（24T 主动 → 18T → 12T）+ 曲柄连杆跟随
      const grpm = s.gearRpm ?? rpm * 0.35;
      for (const tr of machParts.train) {
        // ω24 = 1 ；ω18 = −24/18 ；ω12 = −(18/12)·ω18 = +24/12
        const ratios = [1, -24 / 18, 24 / 12];
        for (let i = 0; i < tr.wheels.length; i++) {
          const w = tr.wheels[i];
          const ph = i % 2 ? Math.PI / (w.userData.teeth || 18) : 0;
          w.rotation.z = ph + (t * grpm / 60) * Math.PI * 2 * ratios[i] * 0.35;
        }
      }
      for (const cp of machParts.crankPins) {
        const ang = (t * grpm / 60) * Math.PI * 2 * 0.35;
        const px = cp.cx + Math.cos(ang) * cp.r;
        const py = cp.cy + Math.sin(ang) * cp.r;
        cp.pin.position.set(px, py, cp.zPlane + cp.side * 0.24);
        updateStrut(cp.rod, [cp.cylX, cp.cylBotY, cp.zPlane], [px, py, cp.zPlane + cp.side * 0.24]);
      }

      // 桨轮展开
      const dp = s.paddleDeploy ?? 0;
      if (dp !== p.paddleDeploy) {
        p.paddleDeploy = dp;
        p.setPaddleDeploy(dp);
      }
      // 桨轮随航行转动（与航速挂钩：用桨轮自身转速表达）
      const prpm = s.paddleRpm ?? 0;
      for (const pw of p.paddleWheels) {
        pw.userData.parts.wheel.rotation.z = (t * prpm / 60) * Math.PI * 2;
      }

      // 桅帆收起（入水同步）
      const ss = s.sailStow ?? 0;
      if (ss !== p.sailStow) { p.sailStow = ss; p.setSailStow(ss); }

      // 左舷立式气缸组：曲柄销 + 活塞杆行程实时重算
      if (gdParts.cylBank) {
        const c = gdParts.crankCenter, R = gdParts.crankRadius;
        const ang = (t * (s.auxRpm ?? Math.max(20, rpm * 0.5)) / 60) * Math.PI * 2;
        const px = c[0] + Math.cos(ang) * R;
        const py = c[1] + Math.sin(ang) * R;
        gdParts.crankPin.position.set(px, py, c[2]);
        for (const cy of gdParts.cylBank) {
          updateStrut(cy.rod, [cy.x, cy.topY, cy.z], [px, py, c[2]]);
        }
      }
      // 飞轮随曲柄同步
      if (gdParts.fw) gdParts.fw.rotation.y = (t * (s.auxRpm ?? Math.max(20, rpm * 0.5)) / 60) * Math.PI * 2;
    },
  };

  // --- 性能：小零件不投影 ---
  const shadowMin = opts.shadowMinRadius ?? 1.8;
  root.traverse((o) => {
    if (!o.isMesh || !o.castShadow) return;
    const geo = o.geometry;
    if (!geo) return;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const r = (geo.boundingSphere?.radius ?? 0) * Math.max(o.scale.x, o.scale.y, o.scale.z);
    if (r < shadowMin) o.castShadow = false;
  });

  // --- 细长构件不描边（否则整根管子被黑色外壳包住，读成"粗黑管"）---
  const thinTagged = tagThinMembers(root, {
    torusTubeMax: 0.42, tubeRadiusMax: 0.30, cylRadiusMax: 0.34, boxMinAxis: 0.26,
  });

  // --- 描边：只给英雄剪影 ---
  if (opts.outline !== false) {
    const threshold = opts.outlineMinRadius ?? 2.5;
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

  return root;
}

export default { build, SPEC, FLOAT_Y };
