/**
 * cityplan.js — 城市肌理：按**真实欧洲城市（布鲁日 Bruges）的建筑关系**，用现有资源填充
 *
 * ============================================================================
 * 为什么选布鲁日
 * ============================================================================
 * 本项目的语汇是「砖石 + 运河 + 窄街 + 黄铜高光」，与布鲁日这种中世纪佛兰德
 * 布料贸易城市几乎同构：运河穿城、临水是仓库与商宅、街巷窄而密、广场由连续山墙房围合。
 * 而且它的关系**可量化、可核查**，不是"看着像"。
 *
 * 采信的真实关系（来源：Bruges Markt / Medieval Cityscape 等城市史资料）：
 *   ① **Markt 广场 ≈ 100 m 见方，四周由连续的 5–6 层山墙房围合**（"continuous line of
 *      buildings, mostly five to six stories"）⇒ 广场四周必须**连续排满**，不留空档
 *   ② **Reie 河从广场一侧经过，该侧有 Waterhall（有顶卸货廊）与 Reiekaai（露天码头）**
 *      ⇒ 运河**紧贴广场一侧**，且临水面是有顶的仓库/商宅
 *   ③ **内 / 中 / 外三道同心运河环；内环绕历史中心，沿线是仓库与商宅**
 *      ⇒ 主运河之外再加一道**窄的环形运河**，形成"被两条水道夹住的街区"
 *   ④ **街道自广场放射展开；靠运河一侧的巷道更窄**（供步行与手推车）
 *      ⇒ 沿运河走主街（宽 11 m），横向巷道更窄（7 m）
 *   ⑤ **天际线由塔控制**（布鲁日：钟楼 83 m + 三座教堂塔）
 *      ⇒ 本项目语汇下用**工厂烟囱**与**广场中央发电塔**作垂直标志（现有资源，不发明新零件）
 *
 * ============================================================================
 * 只做"排布"，不发明零件
 * ============================================================================
 *   道路铺装 / 联排楼 …… 复用 street 模块（克隆后裁掉它自带的场地地面，避免共面打架）
 *   街区住宅 ……………… 复用 citykit.buildResidential
 *   街区内部小体量 ……… 复用 citykit.buildVilla
 *   工业边缘 ……………… 复用 citykit.buildFactory（26 m 烟囱 = 天际线竖标）
 *   广场 …………………… 复用 citykit.buildPlaza（中央发电塔 = 市政标志）
 */
import * as THREE from 'three';
import { CITY, CANAL } from '../core/scale.js';
import { safeClone, mergeByMaterial, boxGeo, cylGeo, sphereGeo } from '../core/primitives.js';
import { M } from '../core/materials.js';
import { applyWall } from '../core/textures.js';
import { buildResidential, buildVilla, buildFactory, buildPlaza, makeMaterials as makeCityMaterials } from '../assets/citykit.js';

/** 本世界的可用坐标（与 assemble.js 保持一致；改这里就要同步改那里） */
/**
 * 默认机位（index.html 的 camera.pos）。
 * 【铁律】任何建筑都不得压在这个点上：本项目已经踩过一次 ——
 * 给 (40, −46) 放了一栋别墅，而那正好是主视角的相机位置，结果整个主视角被自家房子挡死。
 * 城市肌理每次扩展都要过一遍这个判定。
 */
export const CAM_CLEAR = { x: -1.5, z: -104, r: 14 };   // 机位在运河上方，本来就没建筑
const hitsCamClear = (x, z, hx = 7, hz = 8) =>
  Math.abs(x - CAM_CLEAR.x) < CAM_CLEAR.r + hx && Math.abs(z - CAM_CLEAR.z) < CAM_CLEAR.r + hz;

/**
 * 视线通廊：建筑还不得压在「机位 → 目标」这条线上。
 * 只做"机位周围多大范围"是不够的 —— 实测被挡死的那栋楼离机位 8 m 却正好在视线上。
 * 这里在 XZ 平面上算点到线段的距离，小于 r 就跳过。
 */
export const SIGHT = { from: [-1.5, -104], to: [0, 8], r: 16 };   // 视线沿运河轴线
export function hitsSightline(x, z, r = 9) {
  const [ax, az] = SIGHT.from, [bx, bz] = SIGHT.to;
  const vx = bx - ax, vz = bz - az;
  const L2 = vx * vx + vz * vz || 1;
  let t = ((x - ax) * vx + (z - az) * vz) / L2;
  t = Math.max(0, Math.min(1.5, t));
  return Math.hypot(x - (ax + vx * t), z - (az + vz * t)) < r;
}

/**
 * 道路走廊（**矩形占用带**，含道路两侧的临街楼）。
 * 【为什么必须有】上一版把街区住宅按 |x| 分行铺开，z 方向摆到 ±7.5 ——
 * 正好横跨 z≈0 那条主路（主路自身加上两侧临街楼要占 z ∈ [−11, 11]），
 * 结果是"道路全被房子占满"。任何建筑在落位前都要过一遍这张表。
 * 用矩形而不是"到道路中线的距离"，因为道路两侧的临街楼是**一起**占宽的。
 */
export const ROADS = [
  { x0: 12, x1: 152, z0: -11, z1: 11, tag: '主路（沿 x，过桥）' },
  { x0: 19.7, x1: 30.7, z0: -150, z1: 150, tag: '沿河街 E' },
  { x0: -30.7, x1: -19.7, z0: -150, z1: 150, tag: '沿河街 W' },
  // 河堤开阔带：堤沿 13.4 → 街的临街楼 19.7，这段**必须是空的**（否则河堤又被挡）
  { x0: 10, x1: 19.7, z0: -220, z1: 220, tag: '河堤开阔带 E' },
  { x0: -19.7, x1: -10, z0: -220, z1: 220, tag: '河堤开阔带 W' },
  // 巷道只做**西侧**：东侧 z≈68 / 130 正好落在 Markt 的南北围合排上（那是 force 的显式设计），
  // 两者必然打架 —— 与其互相让位，不如东侧不设巷道，把整块留给广场街区。
  { x0: -76, x1: -12, z0: 60, z1: 76, tag: '巷道 N1' },
  { x0: -76, x1: -12, z0: -76, z1: -60, tag: '巷道 S1' },
  { x0: -76, x1: -12, z0: 130, z1: 146, tag: '巷道 N2' },
  { x0: -76, x1: -12, z0: -146, z1: -130, tag: '巷道 S2' },
  { x0: 16, x1: 92, z0: 8, z1: 62, tag: '放射斜街 E' },
  { x0: -92, x1: -16, z0: 8, z1: 62, tag: '放射斜街 W' },
];

/** 建筑（矩形半宽 hx / 半深 hz）是否压在某条道路走廊上 */
export function onRoad(x, z, hx = 6, hz = 7) {
  for (const r of ROADS) {
    if (x - hx < r.x1 && x + hx > r.x0 && z - hz < r.z1 && z + hz > r.z0) return r.tag;
  }
  // 运河带同样要排除（含环运河；主运河由"河堤开阔带"覆盖）
  for (const r of ringHoles()) {
    if (x - hx < r.x1 && x + hx > r.x0 && z - hz < r.z1 && z + hz > r.z0) return '运河';
  }
  return null;
}

/**
 * ============================================================================
 * 同心运河环（布鲁日关系③：内 / 中 / 外三道同心运河环）
 * ============================================================================
 * 布鲁日的中世纪水网是**三道同心环**：内环绕历史中心（沿线是仓库与商宅），
 * 中环、外环逐层向外连到乡野。本场景用**三道矩形环**把这个关系表达出来：
 *   内环 x ∈ ±(58..64)，z ∈ ±(170..176)   —— 把"历史中心"（主运河 + 详细城区）圈在里面
 *   中环 x ∈ ±(140..147)，z ∈ ±(240..247)
 *   外环 x ∈ ±(250..257)，z ∈ ±(285..292) —— 最外一圈
 *
 * 【关键实现】运河 = **陆地被切掉的一条带**：
 *   ① 陆地不再是一整块大板，而是"整块陆地 − 所有运河带"的矩形集合（矩形减法）
 *   ② 每条带的两侧加石砌堤墙（从堤顶一直砌到水下）
 *   ③ 水面不用另做 —— 场景本身有一张覆盖全世界的水面，缺口处自然就是水
 *   ④ 带子**必须避开所有道路走廊**（本次把主路/斜街都缩短到内环以内），
 *      否则运河会把路切断、还得额外造桥
 */
export const CANAL_RINGS = [
  // 内环
  { axis: 'x', a: 86, b: 92, from: -176, to: 176, name: '内环-E' },
  { axis: 'x', a: -92, b: -86, from: -176, to: 176, name: '内环-W' },
  { axis: 'z', a: 170, b: 176, from: -86, to: 86, name: '内环-N' },
  { axis: 'z', a: -176, b: -170, from: -86, to: 86, name: '内环-S' },
  // 中环
  { axis: 'x', a: 174, b: 181, from: -247, to: 247, name: '中环-E' },
  { axis: 'x', a: -181, b: -174, from: -247, to: 247, name: '中环-W' },
  { axis: 'z', a: 240, b: 247, from: -174, to: 174, name: '中环-N' },
  { axis: 'z', a: -247, b: -240, from: -174, to: 174, name: '中环-S' },
  // 外环
  { axis: 'x', a: 262, b: 269, from: -296, to: 296, name: '外环-E' },
  { axis: 'x', a: -269, b: -262, from: -296, to: 296, name: '外环-W' },
  { axis: 'z', a: 288, b: 295, from: -262, to: 262, name: '外环-N' },
  { axis: 'z', a: -295, b: -288, from: -262, to: 262, name: '外环-S' },
];

/** 点到线段（XZ 平面）的距离 */
function distToSeg(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const L2 = vx * vx + vz * vz || 1;
  let t = ((px - ax) * vx + (pz - az) * vz) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

/** 河堤步道带（|x| 10.2~13.4）：**任何**建筑都不得落在这里 */
const WALK_BAND = { x0: 9.6, x1: 14.0 };

/** 运河带 → 矩形（供陆地减法用） */
function ringHoles() {
  return CANAL_RINGS.map((c) => (c.axis === 'x'
    ? { x0: Math.min(c.a, c.b), x1: Math.max(c.a, c.b), z0: c.from, z1: c.to }
    : { x0: c.from, x1: c.to, z0: Math.min(c.a, c.b), z1: Math.max(c.a, c.b) }));
}

/**
 * 矩形减法：base 减去若干 holes，返回仍属于 base 的矩形集合。
 * 这是"把运河从陆地里挖掉"的正解 —— 比按固定步距打网格干净得多
 * （网格会在并没有运河的地方留下假缝）。
 */
export function subtractRects(base, holes) {
  let rects = [base];
  for (const h of holes) {
    const next = [];
    for (const r of rects) {
      if (r.x0 >= h.x1 || r.x1 <= h.x0 || r.z0 >= h.z1 || r.z1 <= h.z0) { next.push(r); continue; }
      if (h.x0 > r.x0) next.push({ x0: r.x0, x1: h.x0, z0: r.z0, z1: r.z1 });
      if (h.x1 < r.x1) next.push({ x0: h.x1, x1: r.x1, z0: r.z0, z1: r.z1 });
      const ix0 = Math.max(r.x0, h.x0), ix1 = Math.min(r.x1, h.x1);
      if (h.z0 > r.z0) next.push({ x0: ix0, x1: ix1, z0: r.z0, z1: h.z0 });
      if (h.z1 < r.z1) next.push({ x0: ix0, x1: ix1, z0: h.z1, z1: r.z1 });
    }
    rects = next;
  }
  return rects.filter((r) => r.x1 - r.x0 > 0.5 && r.z1 - r.z0 > 0.5);
}

/** 两侧陆地的矩形集合（assemble 用它在挖过运河的陆地上铺地） */
export function landRects(xInner, xOuter, zHalf) {
  const holes = ringHoles();
  const out = [];
  for (const sgn of [1, -1]) {
    const base = sgn > 0
      ? { x0: xInner, x1: xOuter, z0: -zHalf, z1: zHalf }
      : { x0: -xOuter, x1: -xInner, z0: -zHalf, z1: zHalf };
    out.push(...subtractRects(base, holes));
  }
  return out;
}

export const GEOM = {
  quayEdge: CANAL.half + CANAL.wallT + CANAL.walk,   // 13.4 步道外缘
  streetX: 19.5,                                     // 沿运河主街的街心
  landTopY: CANAL.quayY + 0.3,                       // 2.5 陆面标高
  streetLen: 64,                                     // = street 模块的长度（折弯时按它步进）
  bridgeHead: 13.4,                                  // 桥引道外缘 —— 主路从这里接上
  canalGap: 16,                                      // 主路与沿河路的交叉口留空（|z| < 16 不排沿河街段）
  laneZ: [68, -68, 132, -132],                       // 横向巷道（更窄）
  laneX0: 20, laneX1: 78,                            // 横向巷道自运河边向外（从开阔带外起）
  // 街区住宅的行（|x|）：
  // · 第 1 排必须退到沿河街的临街楼之外（街心 25.2 ⇒ 临街楼到 30.7）
  // · 第 2 排留给"街区进深"的读法
  blockRows: [44, 72],
  markt: { cx: 44, cz: 100, w: 58, d: 54 },          // Markt：西缘临运河（Reiekaai）
  factory: { x: -62, z: -88 },
  villas: [[-42, 46], [48, -14], [-46, -46], [58, 44]],
  ringCanal: { x: 100, xScale: 0.32 },               // 内环运河（窄，0.32×12.0 m）
  /**
   * 核心 / 远景的分界（用户：「只需要核心部分采用高精度模型，远景使用粗模」）。
   * 核心半径内 = 街道模块 + citykit 高精度建筑；半径外 = 只有"体块 + 檐口"两层的粗模。
   * 粗模全部合批，几乎不花 draw call，但能给出城市的尺度与天际线。
   */
  coreR: 80,                                         // m 核心半径：8 环以内的详细城区之外，粗模从 80 起就铺
                                                     // （原来 150 ⇒ 80~150 这一大圈是空地，用户立刻看出来了）
  backR: 320,                                        // m 远景粗模内缘之外铺到陆地边缘
  landX: 305,                                        // 陆地外缘（与 assemble 的 300 宽陆地对齐）
  landZ: 300,
  // Burg 次级广场（布鲁日：Burg 紧邻 Markt，是行政广场）
  // Burg 放在运河**西岸**、与 Markt 隔水相对：东岸桥—Markt 之间已经被放射斜街占满，
  // 硬塞进去必然和斜街的临街楼打架。隔水相对也更像布鲁日「两个广场一水之隔」的关系。
  burg: { cx: -44, cz: 100, w: 26, d: 34 },
};
/** 引道板半宽（z 向）：与 bridge.js 的 SPEC.deckW / 2 对齐（桥面宽 9.36） */
export const SPEC_DECKW_HALF = 4.68;

/**
 * 沿折线连续排街段。
 * 每段仍用 64 m 的原模块，靠累计 yaw 把它**折弯** —— 这样街道不再是横平竖直的方格，
 * 而是像真实老城那样一段一段地偏转（关系④"街道自广场放射展开"）。
 * 段与段严格首尾相接（按方向向量步进），所以不会出缝。
 */
function chainStreet(parent, proto, o) {
  const L = o.len ?? 64;
  let x = o.x, z = o.z, yaw = o.yaw;
  const bend = o.bend ?? 0;
  const made = [];
  for (let i = 0; i < (o.n ?? 1); i++) {
    const dx = Math.cos(yaw), dz = -Math.sin(yaw);      // rotation.y = yaw 时局部 +x 的世界方向
    const seg = safeClone(proto);
    seg.rotation.y = yaw;
    seg.position.set(x + dx * (L / 2), o.y2 ?? 2.5, z + dz * (L / 2));
    const site = seg.getObjectByName('StreetSite');      // 裁掉自带场地地面（多段会共面打架）
    if (site) site.parent.remove(site);
    parent.add(seg);
    // ── 按矩形裁剪：桥头两侧的人行道必须让出来 ──
    // 主路（沿 x）两侧的临街楼从桥引道外缘（x=13.4）就开始，正好把**桥头那段河堤步道堵死**。
    // 这里给一个"禁建矩形"，落在里面的临街楼一律删掉 —— 步道就能从桥下穿过去。
    if (o.pruneRect) {
      seg.updateMatrixWorld(true);
      const doomed0 = [];
      const T0 = new THREE.Vector3();
      seg.traverse((m) => {
        if (!m.name || !m.name.startsWith('Terrace')) return;
        m.getWorldPosition(T0);
        const q = o.pruneRect;
        if (T0.x > q.x0 && T0.x < q.x1 && T0.z > q.z0 && T0.z < q.z1) doomed0.push(m);
      });
      for (const m of doomed0) m.parent && m.parent.remove(m);
      if (doomed0.length && o.stats) o.stats.prunedBridge = (o.stats.prunedBridge || 0) + doomed0.length;
    }
    // ── 按侧裁剪：用户要求"把沿河一排的房屋删了留出河堤步行道" ──
    // 街模块两侧都有临街楼；靠运河那一侧要整排删掉，把河堤步道让出来。
    if (o.pruneCanalSide !== false && o.canalAxis) {
      seg.updateMatrixWorld(true);
      const cx = seg.position.x, cz = seg.position.z;
      const doomed = [];
      seg.traverse((m) => {
        if (!m.name || !m.name.startsWith('Terrace')) return;
        const p = new THREE.Vector3();
        m.getWorldPosition(p);
        // 对沿河街（沿 z）来说，"临河"= 世界 x 更靠近运河的一侧
        const nearerCanal = o.canalAxis === 'x'
          ? Math.abs(p.x) < Math.abs(cx) - 0.5
          : Math.abs(p.z) < Math.abs(cz) - 0.5;
        if (nearerCanal) doomed.push(m);
      });
      for (const m of doomed) m.parent && m.parent.remove(m);
      if (doomed.length && o.stats) o.stats.prunedQuay = (o.stats.prunedQuay || 0) + doomed.length;
    }
    made.push(seg);
    x += dx * L; z += dz * L;
    yaw += bend;
  }
  return made;
}

/** 横向巷道的铺装（窄巷，7 m；比主街 11 m 窄 —— 关系④） */
function buildLane(MT, len) {
  const g = new THREE.Group();
  g.name = 'CityLane';
  const road = new THREE.Mesh(new THREE.PlaneGeometry(len, 5.0), MT.laneSlab);
  road.rotation.x = -Math.PI / 2;
  road.receiveShadow = true;
  road.userData.noOutline = true;
  g.add(road);
  for (const sz of [-1, 1]) {
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.0), MT.laneWalk);
    walk.rotation.x = -Math.PI / 2;
    walk.position.set(0, 0.02, sz * 3.0);
    walk.receiveShadow = true;
    walk.userData.noOutline = true;
    g.add(walk);
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(len, 0.18, 0.16), MT.laneKerb);
    kerb.position.set(0, 0.09, sz * 2.5);
    g.add(kerb);
  }
  return g;
}

/**
 * 把城市肌理填进场景。
 * @param {THREE.Group} root   场景根
 * @param {object} src         { street, citykitMats } —— 用于克隆的源资产
 * @param {object} o           { outline, outlineMinRadius, maxBuildings }
 */
export function populate(root, src, o = {}) {
  const out = { buildings: 0, streets: 0, lanes: 0, drawn: 0, merged: 0, backdrop: 0, prunedQuay: 0, prunedCross: 0 };
  const G = GEOM;
  const landY = G.landTopY;
  // 城市肌理全部先挂进这一个组，最后**整体按材质合批**：
  // 逐栋合并只能省掉"栋内"的重复，93 栋仍有 ~930 个 draw call；
  // 整组合并后只剩"用到的材质数"（十几到二十几个）——静态城市就该这么批。
  const city = new THREE.Group();
  city.name = 'CityFabric';
  // ★ 全城**共用一套材质实例**。citykit 的工厂在未传 materials 时会各自新建一套，
  //   于是每栋楼的材质都是不同对象 ⇒ mergeByMaterial 无法跨栋归并（实测 58 栋留下 2432 个网格）。
  const CM = makeCityMaterials();

  // -------------------------------------------------------------------------
  // 1) 路网：**主路通桥 + 沿河街折弯 + 自桥头放射的斜街**
  //    · 主路（沿 x）自桥引道外缘 x=±13.4 向外接 —— 桥因此成为"街道中间那条路的延续"
  //    · 沿河街（沿 z）在 |z| < 16 处**断开**，把路口让给主路
  //    · 每段带一点点 yaw 累计 ⇒ 路是折的，不是方格
  //    · 全部复用 street 模块（它自带 4 种开间/层数的联排楼 + 遮阳篷 + 煤汽灯 + 消防栓 + 邮筒 + 岗亭）
  // -------------------------------------------------------------------------
  const streetRuns = [];
  if (src.street) {
    const L = G.streetLen, gap = G.canalGap, sx = G.streetX, bh = G.bridgeHead;
    // 主路（跨桥那条）—— 两侧各 2 段，微弱折弯
    // 主路只做 1 段（13.4 → 77.4），**止于内环运河之前**：运河不会切断道路，也就不必额外造桥
    // 主路：桥头 ±24 m 内不排临街楼（把河堤步道让出来）
    const NOBUILD_BRIDGE = { x0: -24, x1: 24, z0: -14, z1: 14 };
    streetRuns.push({ x: bh, z: 0, yaw: 0, n: 1, bend: 0.016, tag: 'mainE', prune: NOBUILD_BRIDGE });
    streetRuns.push({ x: -bh, z: 0, yaw: Math.PI, n: 1, bend: -0.016, tag: 'mainW', prune: NOBUILD_BRIDGE });
    // 沿河街（沿 z）—— 南北各 2 段，反向折弯，形成"逐渐偏离运河"的走向
    for (const sgn of [1, -1]) {
      // 西岸北段的沿河街只做 1 段：把 z 80~144 让给 Burg 次级广场，
      // 使广场**直接朝运河开**（与 Markt 同一条关系：广场一侧贴水）
      const nN = sgn > 0 ? 2 : 1;
      streetRuns.push({ x: sgn * sx, z: gap, yaw: -Math.PI / 2, n: nN, bend: sgn * 0.018, tag: 'canalN' + sgn });
      streetRuns.push({ x: sgn * sx, z: -gap, yaw: Math.PI / 2, n: 2, bend: -sgn * 0.018, tag: 'canalS' + sgn });
    }
    // 自桥头斜向广场的放射街（关系④：街道自广场放射展开）
    // 斜街同样只做 1 段（止于内环之前）
    streetRuns.push({ x: bh + 8, z: 16, yaw: -0.86, n: 1, bend: 0.02, tag: 'diagE', prune: { x0: -24, x1: 24, z0: -14, z1: 14 } });
    streetRuns.push({ x: -(bh + 8), z: 16, yaw: Math.PI + 0.86, n: 1, bend: -0.02, tag: 'diagW', prune: { x0: -24, x1: 24, z0: -14, z1: 14 } });

    const segLines = [];      // 每条街段的中心线（供"别人的房子不许压在我路上"判定）
    const madeAll = [];
    for (const r of streetRuns) {
      // 沿河街（canalN/canalS）要**删掉临河那一侧的临街楼**，把河堤步道让出来
      const isCanalRun = /^canal/.test(r.tag);
      const made = chainStreet(city, src.street, {
        x: r.x, z: r.z, yaw: r.yaw, bend: r.bend, n: r.n, len: L, y2: landY,
        canalAxis: isCanalRun ? 'x' : null,
        pruneCanalSide: isCanalRun,
        pruneRect: r.prune || null,
        stats: out,          // 统计对象由调用方传入（chainStreet 是模块级函数，拿不到 populate 的 out）
      });
      out.streets += r.n;
      for (const seg of made) {
        const dx = Math.cos(seg.rotation.y), dz = -Math.sin(seg.rotation.y);
        const ax = seg.position.x - dx * L / 2, az = seg.position.z - dz * L / 2;
        segLines.push({ a: [ax, az], b: [ax + dx * L, az + dz * L], tag: r.tag });
        madeAll.push({ seg, tag: r.tag });
      }
    }

    // ------------------------------------------------------------------------
    // 通用规则：**街模块自带的临街楼也必须彼此避让**
    // 这一条以前一直缺 —— 只有 citykit 的建筑过 onRoad()，而街道模块的临街楼从不受约束，
    // 于是"米字形"交汇处（主路 × 沿河街 × 放射斜街）里，一条街的临街楼横跨在另一条街的路面上。
    // 现在：某段的临街楼只要落在**别的**街段中心线 7.5 m 内（= 路面宽的一半 + 余量）就删掉；
    // 同一条 run 的相邻段按 tag 豁免；河堤步道带单独作为禁建区。
    // ------------------------------------------------------------------------
    const T0 = new THREE.Vector3();
    for (const { seg, tag } of madeAll) {
      seg.updateMatrixWorld(true);
      const doomed = [];
      seg.traverse((m) => {
        if (!m.name || !m.name.startsWith('Terrace')) return;
        m.getWorldPosition(T0);
        let kill = (Math.abs(T0.x) > WALK_BAND.x0 && Math.abs(T0.x) < WALK_BAND.x1);
        if (!kill) {
          // 横向巷道（只有铺装、没有街段中心线）：同样不许压
          for (const lz of G.laneZ) {
            if (Math.abs(T0.z - lz) < 5.5 && Math.abs(T0.x) < G.laneX1 + 2) { kill = true; break; }
          }
        }
        if (!kill) {
          for (const ln of segLines) {
            if (ln.tag === tag) continue;                       // 同一条街（含相邻段）豁免
            if (distToSeg(T0.x, T0.z, ln.a[0], ln.a[1], ln.b[0], ln.b[1]) < 7.5) { kill = true; break; }
          }
        }
        if (kill) doomed.push(m);
      });
      for (const m of doomed) if (m.parent) m.parent.remove(m);
      out.prunedCross = (out.prunedCross || 0) + doomed.length;
    }
  }

  // -------------------------------------------------------------------------
  // 2) 横向巷道（更窄）：自运河边向外，把街区切成一进一进的院子
  // -------------------------------------------------------------------------
  // 巷道铺装：直接用材质工厂生成（不要去猜源资产里哪张是铺装 —— 贴图没有 name，会静默取空）
  const laneMats = {
    laneSlab: applyWall(M.stone({ bands: [0.3, 0.62, 1.0], outline: false }), 'settFan', [1.6, 12]),
    laneWalk: applyWall(M.stone({ bands: [0.3, 0.62, 1.0], outline: false }), 'stoneBlock', [0.7, 12]),
    laneKerb: M.stone({ bands: [0.2, 0.48, 0.9], outlineWidth: 0.024 }),
  };
  {
    // 只做**西侧**（与 ROADS 表的巷道走廊一致）：东侧 z≈68/130 是 Markt 的南北围合排，
    // 那里不设巷道，整块留给广场街区。
    for (const z of G.laneZ) {
      const len = G.laneX1 - G.laneX0;
      const lane = buildLane(laneMats, len);
      lane.position.set(-(G.laneX0 + len / 2), landY + 0.01, z);
      city.add(lane);
      out.lanes++;
    }
  }

  // -------------------------------------------------------------------------
  // 3) 街区住宅：沿运河成排（临街面朝运河 —— 关系④/①）
  //    citykit 的 residential 是 w 沿 x、d 沿 z；要让长边（临街面）沿 z，绕 y 转 90°。
  // -------------------------------------------------------------------------
  const groups = [];
  const addB = (b, x, z, ry, opts = {}) => {
    if (hitsCamClear(x, z) || hitsSightline(x, z)) { out.skippedCam = (out.skippedCam || 0) + 1; return; }
    // ★ 道路走廊：建筑不得压在路上（见 ROADS 表的说明）
    if (!opts.force && onRoad(x, z, opts.hx ?? 6, opts.hz ?? 7)) {
      out.skippedRoad = (out.skippedRoad || 0) + 1;
      return;
    }
    b.position.set(x, landY, z);
    b.rotation.y = ry;
    mergeByMaterial(b, { filter: () => true });   // 栋内先合（减少整组时的输入块数）
    city.add(b);
    groups.push(b);
    out.buildings++;
  };
  const facing = (sgn) => (sgn > 0 ? Math.PI / 2 : -Math.PI / 2);   // 临街面朝运河
  /**
   * 确定性伪随机（同一 seed 每次构建结果一致，方便复现截图）。
   * 用自己的一套哈希，避免依赖 Math.random 导致每次刷新布局都在跳。
   */
  const hash = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
  /** 一栋住宅的"体量四件套"：开间 / 进深 / 层数 / 朝向微偏 —— 变化度全靠它 */
  const houseSpec = (n) => ({
    w: [11, 12.5, 14, 15, 16][Math.floor(hash(n * 1.7) * 5)],
    d: [9, 10, 11, 12][Math.floor(hash(n * 2.3) * 4)],
    // 层数拉到 2–6（原来只有 2–5，且 3/4 层占多数 ⇒ 天际线几乎一条线）
    floors: [2, 3, 3, 4, 4, 5, 5, 6][Math.floor(hash(n * 3.1) * 8)],
    // 屋顶四款混排 —— 这是"远看相像"的主要信息，也是打掉重复感的关键
    roof: ['tank', 'gable', 'flat', 'saw'][Math.floor(hash(n * 5.9) * 4)],
    wall: Math.floor(hash(n * 7.3) * 6),      // 6 种墙面（4 砖 + 抹灰 + 石）
    yaw: (hash(n * 4.7) - 0.5) * 0.09,
  });

  for (const sgn of [1, -1]) {
    for (let ri = 0; ri < G.blockRows.length; ri++) {
      const xr = G.blockRows[ri];
      // 靠运河的一排排满；后排只在相机活动区（|z| ≤ 70）铺，控制 draw call
      // 重点集中（用户：重点场景需要集中，后面是背景板可以简略一些）：
      // 第 0 排（临运河）铺到 |z| ≤ 84；第 1 排只在主戏附近 |z| ≤ 44。
      const zFrom = ri === 0 ? -84 : -44;
      const zTo = ri === 0 ? 84 : 44;
      let k = 0;
      for (let z = zFrom; z <= zTo; z += 20) {   // 排距 16→20：留出可见空隙，才读得出"一栋栋"
        // 跳过横向巷道所在的一跨（巷子要通出去）
        if (G.laneZ.some((lz) => Math.abs(z - lz) < 6)) continue;
        // 东侧 Markt 所在的那一段留给广场（关系②）
        if (sgn > 0 && z > G.markt.cz - G.markt.d / 2 - 8 && z < G.markt.cz + G.markt.d / 2 + 8 && ri === 0) continue;
        // Burg 次级广场同样要留出来（那一排楼原来正好压在广场中央）
        if (Math.abs(z - G.burg.cz) < G.burg.d / 2 + 10 && Math.abs(sgn * xr - G.burg.cx) < G.burg.w / 2 + 14) continue;
        const seed = (k * 7 + ri * 3 + (sgn > 0 ? 5 : 0));
        const HS = houseSpec(seed);
        const b = buildResidential({ w: HS.w, d: HS.d, floors: HS.floors, seed, materials: CM, roof: HS.roof, wall: HS.wall, roofSeed: seed });
        // 转 ±90° 后：开间 w 沿 z、进深 d 沿 x ⇒ 半深 hx = d/2、半宽 hz = w/2
        addB(b, sgn * xr, z, facing(sgn) + HS.yaw, { hx: HS.d / 2 + 0.5, hz: HS.w / 2 + 0.5 });
        k++;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4) Markt：广场（中央发电塔 = 市政标志）+ **四周连续围合的住宅**（关系①②）
  //    西缘就是运河码头 ⇒ 那一侧放"有顶仓库/商宅"（Waterhall / Reiekaai）
  // -------------------------------------------------------------------------
  const MK = G.markt;   // 注意：不能叫 M —— 会遮蔽从 materials.js 导入的材质工厂 M
  const plaza = buildPlaza({ materials: CM });
  plaza.position.set(MK.cx, landY, MK.cz);
  mergeByMaterial(plaza, { filter: () => true });
  city.add(plaza);
  out.buildings++;
  // 北 / 东 / 南 三边连续围合（临广场面朝内）
  const halfW = MK.w / 2, halfD = MK.d / 2;
  // 广场四周：**连续围合**（关系①），但每栋的开间/层数都不同 —— 围合不等于整齐划一
  for (let x = MK.cx - halfW + 8; x <= MK.cx + halfW - 8; x += 16) {
    const h1 = houseSpec(x * 1.3);
    addB(buildResidential({ w: h1.w, d: h1.d, floors: Math.max(3, h1.floors), seed: x, materials: CM, roof: h1.roof, wall: h1.wall, roofSeed: x }),
      x, MK.cz + halfD + 5, 0 + h1.yaw, { force: true });
    const h2 = houseSpec(x * 2.1);
    addB(buildResidential({ w: h2.w, d: h2.d, floors: h2.floors, seed: x + 3, materials: CM, roof: h2.roof, wall: h2.wall, roofSeed: x + 3 }),
      x, MK.cz - halfD - 5, Math.PI + h2.yaw, { force: true });
  }
  for (let z = MK.cz - halfD + 8; z <= MK.cz + halfD - 8; z += 16) {
    const h3 = houseSpec(z * 3.7);
    addB(buildResidential({ w: h3.w, d: h3.d, floors: Math.max(3, h3.floors), seed: z, materials: CM, roof: h3.roof, wall: h3.wall, roofSeed: z }),
      MK.cx + halfW + 5, z, -Math.PI / 2 + h3.yaw, { force: true });
  }
  // 西缘（临运河）：Waterhall —— 低矮的有顶仓库（2 层），沿码头排
  for (let z = MK.cz - halfD + 6; z <= MK.cz + halfD - 6; z += 12) {
    const h4 = houseSpec(z * 5.3);
    addB(buildResidential({ w: h4.w - 1, d: Math.max(8, h4.d - 1), floors: 2, seed: z + 1, materials: CM, roof: 'gable', wall: h4.wall, roofSeed: z + 1 }),
      G.quayEdge + 5.5, z, Math.PI / 2 + h4.yaw, { force: true });   // Waterhall 也是显式设计
  }

  // -------------------------------------------------------------------------
  // 5) 工业边缘：工厂 + 26 m 烟囱（天际线竖标，关系⑤）
  // -------------------------------------------------------------------------
  const fac = buildFactory({ materials: CM });
  fac.position.set(G.factory.x, landY, G.factory.z);
  fac.rotation.y = Math.PI / 2;
  mergeByMaterial(fac, { filter: () => true });
  city.add(fac);
  out.buildings++;

  // -------------------------------------------------------------------------
  // 6) 街区内部小体量：别墅（打破"整排等高"的呆板）
  // -------------------------------------------------------------------------
  for (const [vx, vz] of G.villas) {
    const v = buildVilla({ materials: CM });
    v.position.set(vx, landY, vz);
    v.rotation.y = ((vx + vz) % 4) * 0.4;
    mergeByMaterial(v, { filter: () => true });
    city.add(v);
    out.buildings++;
  }

  // -------------------------------------------------------------------------
  // 7) 远景粗模（核心之外）：只保留"体块 + 檐口"两层信息
  //    为什么这样做：① 远景本来就被雾和距离糊掉，细节毫无意义；
  //    ② 粗模全是简单方块，合批后几乎不花 draw call；
  //    ③ 它给出的是**天际线与城市尺度**，这正是远景真正需要的信息。
  // -------------------------------------------------------------------------
  {
    const c = G.coreR, step = 14;
    const XL = G.landX, ZL = G.landZ;
    let n = 0;
    for (let x = -XL; x <= XL; x += step) {
      for (let z = -ZL; z <= ZL; z += step) {
        const d = Math.max(Math.abs(x), Math.abs(z));
        if (d <= c) continue;                           // 核心内是高精度建筑，不放粗模
        const s1 = hash(x * 0.37 + z * 1.13);
        const s2 = hash(x * 1.71 + z * 0.29);
        // 块子做小（9~16 m）并且**不再抖动**：
        // 抖动会让"有效半宽"不可控，只能拿大裕量去兜，结果到处留空地。
        // 现在按每块的真实半宽精确让位，粗模可以一直贴到道路/运河边（留 1.5 m 步道）。
        const w = 9 + s1 * 7, dp = 8 + s2 * 6;
        if (onRoad(x, z, w / 2 + 1.5, dp / 2 + 1.5)) continue;
        // 高度层次：近处 6–16 m，远处 7–24 m（远景要的是天际线，不是细节）
        const hh = 6 + s1 * 10 + (d > 200 ? s2 * 8 : 0);
        const bx = new THREE.Mesh(new THREE.BoxGeometry(w, hh, dp), s1 > 0.5 ? CM.brickA : CM.brickC);
        bx.position.set(x, landY + hh / 2, z);         // 不抖动：位置即网格点
        city.add(bx);
        // 檐口（一条扁盒）：远景只要有"屋顶线"就够，不必做屋顶设备
        const corn = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.6, dp + 0.8), CM.steel);
        corn.position.set(bx.position.x, landY + hh + 0.3, bx.position.z);
        corn.rotation.y = bx.rotation.y;
        city.add(corn);
        n++;
      }
    }
    out.backdrop = n;
  }

  // -------------------------------------------------------------------------
  // 8) 同心运河环的堤墙（运河缺口靠陆地减法已经挖出来了，这里只补两侧石砌堤墙 + 压顶）
  //    水面不用另做：场景本身有一张覆盖全世界的水面，缺口处自然就是水。
  // -------------------------------------------------------------------------
  {
    const topY = landY + 0.34;          // 堤顶（与河堤同标高语言）
    const botY = -3.0;                  // 砌到水下
    const H2 = topY - botY;
    for (const c of CANAL_RINGS) {
      const a = Math.min(c.a, c.b), b = Math.max(c.a, c.b);
      const len = c.to - c.from, mid = (c.from + c.to) / 2;
      for (const edge of [a, b]) {
        const wall = new THREE.Mesh(
          c.axis === 'x' ? new THREE.BoxGeometry(0.55, H2, len) : new THREE.BoxGeometry(len, H2, 0.55),
          CM.stone);
        wall.position.set(
          c.axis === 'x' ? edge : mid, (topY + botY) / 2, c.axis === 'x' ? mid : edge);
        wall.receiveShadow = true;
        city.add(wall);
        // 压顶（长条石，与河堤同语言）
        const cop = new THREE.Mesh(
          c.axis === 'x' ? new THREE.BoxGeometry(1.1, 0.32, len) : new THREE.BoxGeometry(len, 0.32, 1.1),
          CM.stoneDark);
        cop.position.set(
          c.axis === 'x' ? edge : mid, topY + 0.02, c.axis === 'x' ? mid : edge);
        city.add(cop);
        out.ringSeg = (out.ringSeg || 0) + 1;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 9) Burg 次级广场（布鲁日：Burg 紧邻 Markt，是**行政广场** —— 关系①的次级版本）
  //    做法与 Markt 同源：铺装 + 四周高一点的围合 + 中央一个纪念性构件（喷泉）。
  // -------------------------------------------------------------------------
  {
    const BG = G.burg;
    // 铺装
    const pav = new THREE.Mesh(new THREE.PlaneGeometry(BG.w, BG.d), laneMats.laneSlab);
    pav.rotation.x = -Math.PI / 2;
    pav.position.set(BG.cx, landY + 0.012, BG.cz);
    pav.receiveShadow = true;
    pav.userData.noOutline = true;
    city.add(pav);
    // 中央喷泉（石盆 + 水面 + 石柱 + 黄铜出水 + 顶球）—— 用现有基元与材质，不发明零件
    const fx = BG.cx, fz = BG.cz;
    const basin = new THREE.Mesh(cylGeo(3.0, 3.5, 0.95, 16), CM.stone);
    basin.position.set(fx, landY + 0.48, fz);
    basin.castShadow = true;
    city.add(basin);
    const bwater = new THREE.Mesh(cylGeo(2.75, 2.75, 0.18, 16), CM.water);
    bwater.position.set(fx, landY + 0.86, fz);
    bwater.userData.noOutline = true;
    city.add(bwater);
    const col = new THREE.Mesh(cylGeo(0.42, 0.62, 3.2, 10), CM.stoneDark);
    col.position.set(fx, landY + 2.6, fz);
    col.castShadow = true;
    city.add(col);
    const spout = new THREE.Mesh(cylGeo(0.2, 0.2, 0.9, 8), CM.brass);
    spout.position.set(fx, landY + 4.4, fz);
    city.add(spout);
    const finial = new THREE.Mesh(sphereGeo(0.44, 12, 8), CM.brass);
    finial.position.set(fx, landY + 5.0, fz);
    city.add(finial);
    // 四周：**高一点的行政建筑**（5–6 层 + 山墙屋顶），三面围合
    const hw = BG.w / 2, hd = BG.d / 2;
    // 围合：北 / 南 两排 + 西侧一排；**临运河那一面留空** —— 广场朝水开，
    // 否则它就会像东岸 Markt 那样被自己的一排楼把水岸挡死。
    for (let x = BG.cx - hw + 7; x <= BG.cx + hw - 7; x += 14) {
      const h1 = houseSpec(x * 2.9);
      addB(buildResidential({
        w: h1.w, d: h1.d, floors: 5 + (x % 2 ? 1 : 0), seed: x * 3, materials: CM,
        roof: 'gable', wall: 5, roofSeed: x * 3,
      }), x, BG.cz - hd - 6, Math.PI, { force: true });
      const h2 = houseSpec(x * 3.7);
      addB(buildResidential({
        w: h2.w, d: h2.d, floors: 5 + (x % 3 ? 0 : 1), seed: x * 5, materials: CM,
        roof: 'gable', wall: 2, roofSeed: x * 5,
      }), x, BG.cz + hd + 6, 0, { force: true });
    }
    for (let z = BG.cz - hd + 8; z <= BG.cz + hd - 8; z += 14) {
      const h3 = houseSpec(z * 4.1);
      addB(buildResidential({
        w: h3.w, d: h3.d, floors: 5, seed: z * 7, materials: CM,
        roof: 'gable', wall: 0, roofSeed: z * 7,
      }), BG.cx - hw - 7, z, Math.PI / 2, { force: true });   // 西侧一排（背面朝外）
    }
  }

  // -------------------------------------------------------------------------
  // 10) 桥头步道连板：让河堤步道**连续**跨过桥引道
  //     引道板顶在 2.8、河堤步道面在 2.5 ⇒ 差 0.3 m，视觉上步道"被截断"。
  //     做法：在与引道同高的平面上补一段步道板（x 覆盖步道带 10.2~13.6），
  //          并在南北两端各加一块小斜坡，行人是"顺着坡上去"，不是撞上一道坎。
  // -------------------------------------------------------------------------
  {
    const walkX0 = 10.2, walkX1 = 13.6;
    const deckTop = landY + 0.30;                 // 与引道板顶齐平（引道 deckY ≈ 2.8）
    const zHalf = SPEC_DECKW_HALF;                // 引道板半宽（z 向）
    for (const sgn of [1, -1]) {
      const cx = sgn * (walkX0 + walkX1) / 2;
      const w = walkX1 - walkX0;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, zHalf * 2), laneMats.laneWalk);
      slab.position.set(cx, deckTop - 0.06, 0);
      slab.receiveShadow = true;
      city.add(slab);
      // 两端小坡（各 1.4 m 长，从步道面升到连板面）
      for (const sz of [-1, 1]) {
        const ramp = new THREE.Mesh(new THREE.BoxGeometry(w, 0.10, 1.5), laneMats.laneWalk);
        ramp.position.set(cx, (landY + deckTop) / 2 - 0.02, sz * (zHalf + 0.72));
        ramp.rotation.x = sz * -0.197;            // atan(0.30 / 1.5) ≈ 11°
        ramp.receiveShadow = true;
        city.add(ramp);
      }
      out.walkPatch = (out.walkPatch || 0) + 3;
    }
  }

  // ★ 整体按材质合批：静态城市肌理一次性收到"材质数"个 draw call。
  //   注意：城市部件普遍带 userData.noOutline（原意只是"别给这个零件加描边外壳"），
  //   而 mergeByMaterial 会因此跳过它们 —— 实测 58 栋楼因此仍留下 2015 个网格。
  //   城市是纯静态体块，这里把该标记**临时摘掉**再合批。
  city.traverse((m) => {
    if (m.userData && m.userData.noOutline) { m.userData.__noOutline = true; delete m.userData.noOutline; }
  });
  mergeByMaterial(city, { filter: () => true });
  let mergedMeshes = 0;
  city.traverse((m) => { if (m.isMesh) mergedMeshes++; });
  out.merged = mergedMeshes;
  root.add(city);

  out.drawn = out.buildings + out.streets + out.lanes;
  return out;
}

export default { populate, GEOM };
