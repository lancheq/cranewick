/**
 * audit.js — 几何体检：穿模 / 悬空 的**程序化**审计
 *
 * 为什么必须程序化：一个机械场景有上千个零件，"靠截图看有没有悬空/穿模"必然漏。
 * 这里用两个**单侧可靠**的判据：
 *
 *  1) 悬空（零假阳性）
 *     AABB 是保守包围盒 ⇒ 若某零件的 AABB 与所有其他零件都不接触（距离 > tol），
 *     则它**一定**没和任何东西接触 ⇒ 铁定悬空。
 *     反过来（AABB 接触）不能证明真接触，所以这个判据只用来找悬空，不会误报。
 *
 *  2) 穿模（给"嫌疑清单"，按深度排序）
 *     AABB 相交是真相交的超集 ⇒ 会有大量假阳性（相邻零件本该贴合）。
 *     故加三重过滤：① 交集体积 > 较小零件体积的 ratio；② 排除父子/同组；
 *     ③ 排除被标记为"结构穿插"的零件（撑杆/铆钉本就该埋进母体）。
 *
 *  3) 扫掠穿模（针对可动件）
 *     可动件（桨叶/桥叶/桨轮/桅杆/舵面）的穿模只发生在某个姿态区间内，
 *     静止姿态查不出来。故对姿态参数采样，逐姿态做 AABB 相交检查。
 */
import * as THREE from 'three';

const _b1 = new THREE.Box3();
const _b2 = new THREE.Box3();
const _v = new THREE.Vector3();
const _isect = new THREE.Box3();

/** 零件的可读路径（用于报告定位到具体节点） */
function pathOf(node, root) {
  const parts = [];
  let p = node;
  while (p && p !== root) {
    parts.unshift(p.name || p.type);
    p = p.parent;
  }
  return parts.join('/');
}

function boxVolume(b) {
  if (b.isEmpty()) return 0;
  b.getSize(_v);
  return Math.max(0, _v.x) * Math.max(0, _v.y) * Math.max(0, _v.z);
}

function aabbDistance(a, b) {
  // 两 AABB 之间的最短距离（相交时为 0）
  const dx = Math.max(0, Math.max(a.min.x - b.max.x, b.min.x - a.max.x));
  const dy = Math.max(0, Math.max(a.min.y - b.max.y, b.min.y - a.max.y));
  const dz = Math.max(0, Math.max(a.min.z - b.max.z, b.min.z - a.max.z));
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * 采集所有实体的世界 AABB
 * @param {THREE.Object3D} root
 * @param {object} o { skipFilter, minTri }
 */
export function collect(root, o = {}) {
  root.updateMatrixWorld(true);
  const items = [];
  root.traverse((m) => {
    if (!m.isMesh || m.isInstancedMesh) return;
    if (o.skipInvisible !== false) {
      let p = m, hidden = false;
      while (p) { if (!p.visible) { hidden = true; break; } p = p.parent; }
      if (hidden) return;                                  // 父级隐藏 ⇒ 整棵子树都不算数
    }
    if ((m.name || '').endsWith('_outline')) return;   // 只排除描边外壳
    if (o.excludeNoOutline && m.userData.noOutline) return;
    if (o.skipFilter && o.skipFilter(m)) return;
    const geo = m.geometry;
    if (!geo) return;
    const tri = geo.index ? geo.index.count / 3 : (geo.attributes?.position?.count || 0) / 3;
    if (tri < (o.minTri ?? 0)) return;
    const box = new THREE.Box3().setFromObject(m);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    items.push({
      m, box, tri,
      vol: boxVolume(box),
      path: pathOf(m, root),
      group: (pathOf(m, root).split('/')[0] || ''),
      geo: geo.type,
      center: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)],
    });
  });
  return items;
}

/**
 * 悬空检测（零假阳性）：找出与所有其他零件 AABB 距离都 > tol 的零件
 * @returns {{floating: Array, components: Array, largest: number}}
 */
export function findFloating(root, o = {}) {
  const tol = o.tol ?? 0.06;                 // m 接触容差
  const minVol = o.minVol ?? 2e-4;           // m³ 忽略过小的装饰件
  const items = collect(root, o).filter((it) => it.vol >= minVol);
  const n = items.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (aabbDistance(items[i].box, items[j].box) <= tol) union(i, j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  }
  const comps = [...groups.values()].map((idxs) => ({
    idxs,
    vol: idxs.reduce((s, k) => s + items[k].vol, 0),
    items: idxs.map((k) => items[k]),
  })).sort((a, b) => b.vol - a.vol);

  // 悬空 = 除最大连通分量外的所有分量（按体积降序）
  const floating = comps.slice(1).map((c) => ({
    vol: +c.vol.toFixed(5),
    count: c.items.length,
    paths: c.items.slice(0, 6).map((it) => it.path),
  }));

  // 真正可疑的是**孤立的小岛**：整个结构因腾空（飞艇/连廊）而独立是正常的
  const small = comps.slice(1)
    .filter((c) => c.items.length <= (o.smallIslandMax ?? 6))
    .map((c) => ({
      vol: +c.vol.toFixed(5), count: c.items.length,
      paths: c.items.slice(0, 4).map((it) => `${it.path} [${it.geo}] @${it.center}`),
    }))
    .sort((a, b) => b.vol - a.vol);

  return {
    meshCount: n,
    componentCount: comps.length,
    largestCount: comps[0]?.items.length ?? 0,
    largestVol: +comps[0]?.vol.toFixed(3),
    floating,
    smallIslands: small,
  };
}

/**
 * 深穿插（穿模嫌疑清单）：AABB 交集体积占较小零件的比例 > ratio
 */
export function findDeepOverlaps(root, o = {}) {
  const ratio = o.ratio ?? 0.1;
  const tol = o.tol ?? 0.0;
  const minVol = o.minVol ?? 5e-4;
  // 结构穿插白名单：撑杆/铆钉/管路/销轴 本就该埋进母体
  const exempt = /Strut|Rivet|Spoke|Brace|Hanger|Pipe|Flute|Sill|Seam|Mull|Cable|Stay|Rod|Bolt|Grille|FenderStay|Guide|Riser/;
  const items = collect(root, o).filter((it) => it.vol >= minVol);
  const n = items.length;
  const hits = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = items[i], b = items[j];
      if (a.m === b.m) continue;
      // 父子关系排除
      let p = a.m.parent, isAnc = false;
      while (p) { if (p === b.m) { isAnc = true; break; } p = p.parent; }
      p = b.m.parent;
      let isAnc2 = false;
      while (p) { if (p === a.m) { isAnc2 = true; break; } p = p.parent; }
      if (isAnc || isAnc2) continue;
      if (exempt.test(a.path) || exempt.test(b.path)) continue;
      _isect.copy(a.box).intersect(b.box);
      if (_isect.isEmpty()) continue;
      const iv = boxVolume(_isect);
      if (iv <= 0) continue;
      const smaller = Math.min(a.vol, b.vol);
      const r = iv / smaller;
      if (r < ratio) continue;
      if (iv < (o.minIvol ?? 0.02)) continue;      // 绝对下限：滤掉"擦边"
      if (tol > 0 && aabbDistance(a.box, b.box) > tol) continue;
      hits.push({
        r: +r.toFixed(3),
        iv: +iv.toFixed(4),
        volA: +a.vol.toFixed(3), volB: +b.vol.toFixed(3),
        a: a.path, b: b.path,
        overlap: [
          +_isect.min.x.toFixed(3), +_isect.min.y.toFixed(3), +_isect.min.z.toFixed(3),
          +_isect.max.x.toFixed(3), +_isect.max.y.toFixed(3), +_isect.max.z.toFixed(3),
        ],
      });
    }
  }
  hits.sort((x, y) => y.r - x.r);
  return { pairs: hits.length, top: hits.slice(0, o.top ?? 25) };
}

/**
 * 扫掠穿模：对可动件的姿态采样，检查与静态件的深穿插
 * @param {object} cfg
 * @param {()=>void} cfg.apply  (u) => void 设置该姿态
 * @param {number[]} cfg.samples 姿态采样点（0..1 参数或角度数组）
 * @param {(m)=>boolean} cfg.movingFilter 判定"可动件"
 * @param {(m)=>boolean} cfg.staticFilter 判定"静态件"
 */
export function sweepCheck(cfg) {
  const found = new Map();
  for (const u of cfg.samples) {
    cfg.apply(u);
    const root = cfg.root;
    root.updateMatrixWorld(true);
    const moving = collect(root, { skipFilter: (m) => !cfg.movingFilter(m), minTri: 0 });
    const statics = collect(root, { skipFilter: (m) => !cfg.staticFilter(m), minTri: 0 });
    for (const mv of moving) {
      for (const st of statics) {
        if (mv.m === st.m) continue;
        // 排除父子
        let p = mv.m.parent, anc = false;
        while (p) { if (p === st.m) { anc = true; break; } p = p.parent; }
        let q = st.m.parent, anc2 = false;
        while (q) { if (q === mv.m) { anc2 = true; break; } q = q.parent; }
        if (anc || anc2) continue;
        _isect.copy(mv.box).intersect(st.box);
        if (_isect.isEmpty()) continue;
        const iv = boxVolume(_isect);
        if (iv <= 0) continue;
        const r = iv / Math.min(mv.vol, st.vol);
        if (r < (cfg.ratio ?? 0.06)) continue;
        const key = mv.path + ' ⟂ ' + st.path;
        const prev = found.get(key);
        if (!prev || r > prev.r) {
          found.set(key, {
            r: +r.toFixed(3), atU: u,
            moving: mv.path, statik: st.path,
            overlap: [
              +_isect.min.x.toFixed(2), +_isect.min.y.toFixed(2), +_isect.min.z.toFixed(2),
              +_isect.max.x.toFixed(2), +_isect.max.y.toFixed(2), +_isect.max.z.toFixed(2),
            ],
          });
        }
      }
    }
  }
  const list = [...found.values()].sort((a, b) => b.r - a.r);
  return { pairs: list.length, top: list.slice(0, cfg.top ?? 20) };
}

export default { collect, findFloating, findDeepOverlaps, sweepCheck };
