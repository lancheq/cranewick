/**
 * primitives.js — 通用零件库（倒角 / 铆钉 / 齿轮 / 管道 / 栏杆 / 桁架 / 描边）
 * 对应 docs/ART_BIBLE.md 第四章「几何造型语言」。
 *
 * 造型语言五规则的程序化实现：
 *   4.1 倒角 bevelBox()      4.2 铆钉 rivets()      4.3 齿轮 gear()
 *   4.4 管道 pipe()          4.5 比例夸张（由各资产按 ART_BIBLE 表执行）
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import { C, TONE } from './palette.js';
import { M, toon, STYLE } from './materials.js';

// ---------------------------------------------------------------------------
// 几何快捷件
// ---------------------------------------------------------------------------

/** 倒角盒（4.1）。bevel 建议 0.02–0.05 m */
export function bevelBox(w, h, d, bevel = 0.03, seg = 2) {
  const b = Math.min(bevel, Math.min(w, h, d) * 0.45);
  return new RoundedBoxGeometry(w, h, d, seg, b);
}

/** 普通盒 */
export function boxGeo(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

/** 圆柱 */
export function cylGeo(rt, rb, h, seg = 16, open = false) {
  return new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
}

/** 圆环段（弯头 / 箍带）。arc 单位弧度 */
export function torusArcGeo(radius, tube, arc = Math.PI / 2, radialSeg = 8, tubularSeg = 24) {
  return new THREE.TorusGeometry(radius, tube, radialSeg, tubularSeg, arc);
}

/** 球 */
export function sphereGeo(r, seg = 16) { return new THREE.SphereGeometry(r, seg, Math.max(8, seg / 2)); }

/** 圆锥 */
export function coneGeo(r, h, seg = 16) { return new THREE.ConeGeometry(r, h, seg); }

/**
 * 建网格并挂到父级（省 boilerplate）
 */
export function mesh(parent, geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], name) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(pos[0], pos[1], pos[2]);
  m.rotation.set(rot[0], rot[1], rot[2]);
  if (name) m.name = name;
  parent.add(m);
  return m;
}

// ---------------------------------------------------------------------------
// 4.1 倒角：给已存在几何体加"视觉倒角"效果的高光细边
// ---------------------------------------------------------------------------
/** 沿盒体棱边加一圈细亮黄铜线，模拟加工倒角的高光 */
export function edgeHighlight(parent, w, h, d, mat, t = 0.02) {
  const g = new THREE.Group();
  const edges = [
    [new THREE.BoxGeometry(w, t, t), [0, h / 2, d / 2]],
    [new THREE.BoxGeometry(w, t, t), [0, -h / 2, d / 2]],
    [new THREE.BoxGeometry(w, t, t), [0, h / 2, -d / 2]],
    [new THREE.BoxGeometry(w, t, t), [0, -h / 2, -d / 2]],
    [new THREE.BoxGeometry(t, h, t), [w / 2, 0, d / 2]],
    [new THREE.BoxGeometry(t, h, t), [-w / 2, 0, d / 2]],
    [new THREE.BoxGeometry(t, h, t), [w / 2, 0, -d / 2]],
    [new THREE.BoxGeometry(t, h, t), [-w / 2, 0, -d / 2]],
  ];
  for (const [geo, p] of edges) mesh(g, geo, mat, p);
  parent.add(g);
  return g;
}

// ---------------------------------------------------------------------------
// 4.2 铆钉阵（InstancedMesh，一次 draw call）
// ---------------------------------------------------------------------------
const rivetGeo = sphereGeo(0.035, 8);

/**
 * 沿一条线段布置铆钉
 * @param {THREE.Object3D} parent
 * @param {{from:number[], to:number[], spacing?:number, normal?:number[], mat?:THREE.Material, radius?:number}} o
 */
export function rivets(parent, o) {
  const from = new THREE.Vector3().fromArray(o.from);
  const to = new THREE.Vector3().fromArray(o.to);
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  if (len < 1e-4) return null;
  dir.normalize();

  const spacing = o.spacing ?? 0.22;
  const n = Math.max(2, Math.round(len / spacing) + 1);
  const nrm = o.normal ? new THREE.Vector3().fromArray(o.normal).normalize() : null;

  const mat = o.mat || M.brass({ bands: [0.35, 0.7, 1.0] });
  const im = new THREE.InstancedMesh(rivetGeo, mat, n);
  im.name = o.name || 'Rivets';
  im.userData.noMerge = true;

  const s = o.radius ? o.radius / 0.035 : 1;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    dummy.position.copy(from).addScaledVector(dir, t * len);
    if (nrm) dummy.position.addScaledVector(nrm, 0.012);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    im.setMatrixAt(i, dummy.matrix);
  }
  im.instanceMatrix.needsUpdate = true;
  parent.add(im);
  return im;
}

/**
 * 在一个矩形面板边缘布置铆钉（自动一圈）
 * @param {THREE.Object3D} parent
 * @param {{w:number,h:number, offset?:number[], normal?:number[], spacing?:number, mat?:THREE.Material}} o
 * 面板位于 XY 平面，offset 是中心点
 */
export function rivetPanel(parent, o) {
  const { w, h } = o;
  const off = o.offset || [0, 0, 0];
  const inset = 0.07;
  const hw = w / 2 - inset, hh = h / 2 - inset;
  const z = off[2];
  const r1 = rivets(parent, { from: [off[0] - hw, off[1] + hh, z], to: [off[0] + hw, off[1] + hh, z], spacing: o.spacing, normal: o.normal, mat: o.mat });
  const r2 = rivets(parent, { from: [off[0] - hw, off[1] - hh, z], to: [off[0] + hw, off[1] - hh, z], spacing: o.spacing, normal: o.normal, mat: o.mat });
  const r3 = rivets(parent, { from: [off[0] - hw, off[1] - hh, z], to: [off[0] - hw, off[1] + hh, z], spacing: o.spacing, normal: o.normal, mat: o.mat });
  const r4 = rivets(parent, { from: [off[0] + hw, off[1] - hh, z], to: [off[0] + hw, off[1] + hh, z], spacing: o.spacing, normal: o.normal, mat: o.mat });
  return [r1, r2, r3, r4].filter(Boolean);
}

// ---------------------------------------------------------------------------
// 4.3 齿轮（模数 m=0.1，齿数仅允许 12/18/24）
// ---------------------------------------------------------------------------
const ALLOWED_TEETH = [12, 18, 24];

/**
 * 生成一个正齿轮几何体（ExtrudeGeometry + 中心孔）
 * @param {number} teeth 齿数，仅允许 12 / 18 / 24（ART_BIBLE 4.3）
 * @param {number} m 模数，默认 0.1
 * @param {number} thickness 齿宽（厚度）
 */
export function gearGeo(teeth = 18, m = 0.1, thickness = 0.06) {
  if (!ALLOWED_TEETH.includes(teeth)) {
    // 强制归一到最近合法齿数，避免风格漂移
    teeth = ALLOWED_TEETH.reduce((a, b) => (Math.abs(b - teeth) < Math.abs(a - teeth) ? b : a));
  }
  const rPitch = (m * teeth) / 2;
  const rOuter = rPitch + m * 0.95;
  const rRoot = Math.max(rPitch - m * 1.25, rPitch * 0.55);

  const step = (Math.PI * 2) / teeth;
  const toothAng = step * 0.46;
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    pts.push(new THREE.Vector2(Math.cos(a - step * 0.5 + step * 0.06) * rRoot, Math.sin(a - step * 0.5 + step * 0.06) * rRoot));
    pts.push(new THREE.Vector2(Math.cos(a - toothAng * 0.5) * rOuter, Math.sin(a - toothAng * 0.5) * rOuter));
    pts.push(new THREE.Vector2(Math.cos(a + toothAng * 0.5) * rOuter, Math.sin(a + toothAng * 0.5) * rOuter));
    pts.push(new THREE.Vector2(Math.cos(a + step * 0.5 - step * 0.06) * rRoot, Math.sin(a + step * 0.5 - step * 0.06) * rRoot));
  }
  const shape = new THREE.Shape(pts);

  const bore = rPitch * 0.22;
  const hole = new THREE.Path();
  hole.absarc(0, 0, bore, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: Math.min(0.004, thickness * 0.15),
    bevelSize: Math.min(0.004, thickness * 0.15),
    bevelSegments: 1,
    curveSegments: 4,
  });
  geo.translate(0, 0, -thickness / 2);
  geo.computeVertexNormals();
  // 记录节圆半径，便于传动装配
  geo.userData.pitchRadius = rPitch;
  return geo;
}

/** 齿轮网格（默认黄铜） */
export function gear(parent, teeth = 18, o = {}) {
  const m = o.module ?? 0.1;
  const th = o.thickness ?? 0.06;
  const geo = gearGeo(teeth, m, th);
  const mm = new THREE.Mesh(geo, o.mat || M.brass({ bands: [0.3, 0.62, 1.0] }));
  mm.name = o.name || `Gear_${teeth}T`;
  if (o.pos) mm.position.fromArray(o.pos);
  if (o.rot) mm.rotation.fromArray(o.rot);
  mm.userData.pitchRadius = geo.userData.pitchRadius;
  parent.add(mm);
  return mm;
}

/**
 * 生成可啮合的一对齿轮组（按节圆相切摆放）
 * @returns {{a:THREE.Mesh, b:THREE.Mesh, ratio:number}}
 */
export function gearPair(parent, teethA = 12, teethB = 18, o = {}) {
  const m = o.module ?? 0.1;
  const a = gear(parent, teethA, { module: m, thickness: o.thickness ?? 0.06, pos: [0, 0, 0], name: `Gear_${teethA}T` });
  const ra = a.userData.pitchRadius;
  const rb = (m * teethB) / 2;
  const b = gear(parent, teethB, {
    module: m,
    thickness: o.thickness ?? 0.06,
    pos: [ra + rb, 0, 0],
    name: `Gear_${teethB}T`,
  });
  // 相位对齐：让齿互相嵌入齿槽
  b.rotation.z = Math.PI / teethB;
  parent.add(a, b);
  return { a, b, ratio: teethB / teethA };
}

// ---------------------------------------------------------------------------
// 4.4 管道（沿路径 TubeGeometry，弯头自动圆滑）
// ---------------------------------------------------------------------------
/**
 * @param {THREE.Object3D} parent
 * @param {number[][]} points 路径点
 * @param {object} o { radius(仅允许0.06/0.12/0.25), mat, segments, closed, curve }
 */
const ALLOWED_PIPE_R = [0.06, 0.12, 0.25];
export function pipe(parent, points, o = {}) {
  let r = o.radius ?? 0.12;
  if (!ALLOWED_PIPE_R.includes(r)) r = ALLOWED_PIPE_R.reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a));

  const vs = points.map((p) => new THREE.Vector3().fromArray(p));
  // 默认用 centripetal：catmullrom 在控制点间距突变处会过冲，贴着曲面的走线会"陷进去/浮起来"
  const curve = new THREE.CatmullRomCurve3(vs, !!o.closed, o.curve ?? 'centripetal');
  const geo = new THREE.TubeGeometry(curve, o.segments ?? Math.max(16, vs.length * 8), r, o.radial ?? 8, !!o.closed);
  const mm = new THREE.Mesh(geo, o.mat || M.brass({ bands: [0.32, 0.65, 1.0] }));
  mm.name = o.name || 'Pipe';
  // 细管一律不描边（绝对宽度的黑壳会把管子糊成"粗黑管"）
  if (r < 0.22) mm.userData.noOutline = true;
  parent.add(mm);

  // 法兰箍（每段一个，强化工业感）
  if (o.flanges !== false) {
    const n = Math.max(2, vs.length - 1);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const pos = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan.clone().normalize());
      const fl = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.5, r * 1.5, r * 0.55, 10), o.flangeMat || o.mat || M.brassLo());
      fl.position.copy(pos);
      fl.quaternion.copy(q);
      parent.add(fl);
    }
  }
  return mm;
}

// ---------------------------------------------------------------------------
// 栏杆 / 桁架 / 铆接板（桥与街道复用）
// ---------------------------------------------------------------------------
/**
 * 黄铜栏杆：上下横杆 + 立柱 + 铆钉
 * @param {number} length 沿 X
 */
export function railing(parent, length, o = {}) {
  const g = new THREE.Group();
  g.name = o.name || 'Railing';
  const h = o.height ?? 1.1;
  const r = o.radius ?? 0.06;
  const n = o.posts ?? Math.max(3, Math.round(length / 1.6));
  const mat = o.mat || M.brass({ bands: [0.3, 0.62, 1.0] });

  // 立柱
  for (let i = 0; i < n; i++) {
    const x = -length / 2 + (length * i) / (n - 1);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.15, h, 8), mat);
    p.position.set(x, h / 2, 0);
    g.add(p);
    // 柱头球
    const cap = new THREE.Mesh(sphereGeo(r * 1.7, 8), mat);
    cap.position.set(x, h + r * 1.2, 0);
    g.add(cap);
  }
  // 横杆（三档高度）
  for (const y of [h, h * 0.55, h * 0.18]) {
    const bar = new THREE.Mesh(cylGeo(r * 0.75, r * 0.75, length, 8), mat);
    bar.rotation.z = Math.PI / 2;
    bar.position.y = y;
    g.add(bar);
  }
  // 立柱间的连续竖向细杆
  const filler = Math.round(length / 0.24);
  if (filler < 200) {
    const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(r * 0.4, r * 0.4, h * 0.82, 5), mat, filler);
    im.userData.noMerge = true;
    const d = new THREE.Object3D();
    for (let i = 0; i < filler; i++) {
      d.position.set(-length / 2 + (length * i) / (filler - 1), h * 0.58, 0);
      d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    g.add(im);
  }
  if (o.pos) g.position.fromArray(o.pos);
  if (o.rot) g.rotation.fromArray(o.rot);
  parent.add(g);
  return g;
}

/** 三角桁架（桥体、吊舱龙骨） */
export function truss(parent, length, height, o = {}) {
  const g = new THREE.Group();
  g.name = o.name || 'Truss';
  const bays = o.bays ?? Math.max(2, Math.round(length / 4));
  const mat = o.mat || M.iron({ bands: [0.3, 0.6, 1.0] });
  const t = o.thickness ?? 0.14;

  const chord = (y) => mesh(g, boxGeo(length, t, t), mat, [0, y, 0]);
  chord(height / 2);
  chord(-height / 2);

  for (let i = 0; i <= bays; i++) {
    const x = -length / 2 + (length * i) / bays;
    mesh(g, boxGeo(t, height, t), mat, [x, 0, 0]);
  }
  // 斜撑
  for (let i = 0; i < bays; i++) {
    const x0 = -length / 2 + (length * i) / bays;
    const x1 = -length / 2 + (length * (i + 1)) / bays;
    const diag = new THREE.Mesh(boxGeo(Math.hypot(x1 - x0, height), t * 0.8, t * 0.8), mat);
    diag.position.set((x0 + x1) / 2, 0, 0);
    diag.rotation.z = Math.atan2(height, x1 - x0) * (i % 2 ? -1 : 1);
    g.add(diag);
  }
  if (o.pos) g.position.fromArray(o.pos);
  parent.add(g);
  return g;
}

/** 带铆钉的金属板 */
export function platedPanel(parent, w, h, o = {}) {
  const th = o.thickness ?? 0.08;
  const mat = o.mat || M.iron({ bands: [0.3, 0.6, 1.0] });
  const g = new THREE.Group();
  g.name = o.name || 'Panel';
  mesh(g, bevelBox(w, h, th, 0.02), mat);
  if (o.rivets !== false) {
    rivetPanel(g, { w, h, offset: [0, 0, th / 2], normal: [0, 0, 1], spacing: o.spacing ?? 0.22 });
  }
  if (o.pos) g.position.fromArray(o.pos);
  if (o.rot) g.rotation.fromArray(o.rot);
  parent.add(g);
  return g;
}

// ---------------------------------------------------------------------------
// 描边（反向外壳法）—— 屏幕空间近似恒定宽度
// ---------------------------------------------------------------------------
const outlineMatCache = new Map();
function outlineMaterial(width) {
  if (outlineMatCache.has(width)) return outlineMatCache.get(width);
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uWidth: { value: width },
      uColor: { value: new THREE.Color(TONE.outline) },
    },
    vertexShader: `
      uniform float uWidth;
      void main() {
        vec3 p = position + normalize(normal) * uWidth;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4( uColor, 1.0 ); }`,
    side: THREE.BackSide,
    fog: false,
  });
  outlineMatCache.set(width, m);
  return m;
}

/**
 * 给网格加反向外壳描边。仅建议用于"英雄物件"（桥 / 飞艇 / 车辆），
 * 街道重复道具加描边会翻倍 draw call。
 */
export function addOutline(m, width) {
  if (!STYLE.outlineEnabled) return null;
  if (!m || !m.isMesh || m.userData.noOutline) return null;
  // 兜底：超大背景面（水面/大地/河堤）不需要描边，且描边外壳代价极大
  const _g = m.geometry;
  if (_g) {
    if (!_g.boundingSphere) _g.computeBoundingSphere();
    if ((_g.boundingSphere?.radius ?? 0) > (STYLE.outlineMaxRadius ?? 400)) return null;
  }
  const w = width ?? (m.material && m.material.userData.outlineWidth) ?? STYLE.outlineWidth;
  if (!w) return null;
  const shell = new THREE.Mesh(m.geometry, outlineMaterial(w));
  shell.name = (m.name || 'mesh') + '_outline';
  shell.userData.noMerge = true;
  shell.userData.noOutline = true;
  shell.castShadow = false;
  shell.receiveShadow = false;
  m.add(shell);
  return shell;
}

/** 递归给一棵子树所有网格加描边 */
export function outlineTree(root, width) {
  const list = [];
  root.traverse((o) => {
    if (!o.isMesh || o.userData.noOutline) return;
    // 已经有描边外壳的不要再加一层（各资产 build() 内已自加过，重复会翻倍几何开销）
    if (o.children.some((c) => c.name.endsWith('_outline'))) return;
    list.push(o);
  });
  for (const m of list) addOutline(m, width);
  return list.length;
}

// ---------------------------------------------------------------------------
// 合并（性能：把同材质的静态网格合批）
// ---------------------------------------------------------------------------
export function mergeByMaterial(root, opts = {}) {
  const groups = new Map();
  const drop = [];
  root.updateMatrixWorld(true);
  // 关键：烘焙的是「相对 root」的矩阵。若直接用 matrixWorld，而 root 自身又有位移/旋转，
  // 合批结果会被再叠加一次 root 的变换（与 C-03 同类错误）。
  const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();

  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    if (o.userData.noMerge || o.userData.noOutline) return;
    if (o.material && o.material.userData && o.material.userData.family === 'emissive') return;
    if (opts.filter && !opts.filter(o)) return;
    const key = o.material.uuid;
    if (!groups.has(key)) groups.set(key, { mat: o.material, geos: [] });
    const g = o.geometry.clone();
    g.applyMatrix4(_mergeTmp.multiplyMatrices(invRoot, o.matrixWorld));
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    }
    groups.get(key).geos.push(g);
    drop.push(o);
  });

  const created = [];
  for (const { mat, geos } of groups.values()) {
    if (!geos.length) continue;
    const anyNonIndexed = geos.some((g) => !g.index);
    let list = geos;
    if (anyNonIndexed) list = geos.map((g) => (g.index ? g.toNonIndexed() : g));
    const needUv = list.some((g) => !g.attributes.uv);
    if (needUv) {
      for (const g of list) {
        if (!g.attributes.uv) {
          const n = g.attributes.position.count;
          g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
        }
      }
    }
    try {
      const merged = BGU.mergeGeometries(list, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mm = new THREE.Mesh(merged, mat);
      mm.name = 'Merged_' + (mat.userData.family || 'mesh');
      root.add(mm);
      created.push(mm);
      for (const g of list) g.dispose();
    } catch (e) {
      // 合并失败则保留原网格，不影响正确性
      created.length = created.length;
      continue;
    }
  }
  // 只有确认合并成功后才移除原始网格
  if (created.length) for (const o of drop) { if (o.parent) o.parent.remove(o); }
  return created;
}

// ---------------------------------------------------------------------------
// 装配件：两点间连杆 / 轴承座 / 安装法兰
// 【重要】凡是"把 A 连到 B"的零件，一律用 strutBetween 按两个真实端点生成，
// 不要手调 position + rotation —— 那是"零件悬空不连接"的根因。
// ---------------------------------------------------------------------------
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _mergeTmp = new THREE.Matrix4();

/**
 * 在 p0 与 p1 之间生成一根精确连接的圆柱杆
 * @param {number[]} p0 [x,y,z]
 * @param {number[]} p1 [x,y,z]
 */
export function strutBetween(parent, p0, p1, o = {}) {
  const a = _v0.set(p0[0], p0[1], p0[2]).clone();
  const b = _v1.set(p1[0], p1[1], p1[2]).clone();
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 1e-5) return null;

  const r = o.radius ?? 0.18;
  const geo = o.geo ? o.geo : cylGeo(r, o.radiusEnd ?? r, len, o.seg ?? 8);
  const m = new THREE.Mesh(geo, o.mat || M.brass());
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(_up, dir.normalize());
  m.name = o.name || 'Strut';
  // 连杆/撑杆默认不投影：几百根杆件的阴影 pass 会白白吃掉几百个 draw call，视觉上几乎无差别
  if (o.castShadow === true) m.castShadow = true;
  parent.add(m);
  m.userData.ends = [a, b];
  return m;
}

/** 把已有连杆网格更新到新端点（用于液压缸/活塞杆这类行程变化的杆件，每帧调用） */
const _sa = new THREE.Vector3();
const _sb = new THREE.Vector3();
const _sd = new THREE.Vector3();
export function updateStrut(mesh, p0, p1) {
  _sa.set(p0[0], p0[1], p0[2]);
  _sb.set(p1[0], p1[1], p1[2]);
  _sd.subVectors(_sb, _sa);
  const len = _sd.length();
  if (len < 1e-5) return;
  mesh.position.copy(_sa).addScaledVector(_sd, 0.5);
  mesh.quaternion.setFromUnitVectors(_up, _sd.normalize());
  mesh.scale.y = len / (mesh.geometry.userData.baseLen || 1);
}

/** 生成一根"基准长度 1"的连杆，便于用 scale.y 拉伸（液压缸/活塞杆） */
export function unitStrut(parent, radius, mat, name) {
  const g = cylGeo(radius, radius, 1, 8);
  g.userData.baseLen = 1;
  const m = new THREE.Mesh(g, mat);
  m.name = name || 'UnitStrut';
  parent.add(m);
  return m;
}

/** 轴承座（托住转轴的小台） */
export function bearingBlock(parent, o = {}) {
  const g = new THREE.Group();
  g.name = o.name || 'Bearing';
  const r = o.shaftRadius ?? 0.22;
  const h = o.height ?? 0.5;
  const mat = o.mat || M.bronze();
  const base = new THREE.Mesh(bevelBox(r * 3.4, h, r * 2.4, 0.03), mat);
  base.position.y = -h / 2;
  g.add(base);
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.7, r * 1.7, r * 1.5, 12), mat);
  boss.rotation.x = Math.PI / 2;
  g.add(boss);
  const cap = new THREE.Mesh(new THREE.TorusGeometry(r * 1.35, r * 0.22, 6, 14), mat);
  cap.position.z = r * 0.75;
  g.add(cap);
  if (o.pos) g.position.fromArray(o.pos);
  if (o.rot) g.rotation.fromArray(o.rot);
  parent.add(g);
  return g;
}

/** 安装法兰（零件贴到曲面上的过渡件，消除"悬空感"） */
export function mountFlange(parent, o = {}) {
  const r = o.radius ?? 0.45;
  const t = o.thickness ?? 0.14;
  const mat = o.mat || M.brassLo();
  const f = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, t, o.seg ?? 12), mat);
  if (o.pos) f.position.fromArray(o.pos);
  if (o.rot) f.rotation.fromArray(o.rot);
  f.name = o.name || 'Flange';
  parent.add(f);
  // 一圈螺栓头 —— 必须坐在法兰端面上（默认恰好卡在厚度中间，会整圈埋进法兰里看不见）
  const n = o.bolts ?? 6;
  const boltH = t * 0.9;
  const boltGeo = cylGeo(r * 0.13, r * 0.13, boltH, 6);
  const im = new THREE.InstancedMesh(boltGeo, o.boltMat || M.bronze(), n);
  im.userData.noMerge = true;
  const d = new THREE.Object3D();
  const boltY = o.boltY ?? (t * 0.5 - boltH * 0.25);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    d.position.set(Math.cos(a) * r * 0.78, boltY, Math.sin(a) * r * 0.78);
    d.updateMatrix();
    im.setMatrixAt(i, d.matrix);
  }
  im.instanceMatrix.needsUpdate = true;
  f.add(im);
  return f;
}

/**
 * 安全克隆（重要）
 *
 * three 的 Object3D.clone() 内部对 userData 做 JSON.parse(JSON.stringify(...))。
 * 而本项目各资产的 userData.parts 里**存了零件对象引用**（这是既有约定，动画层要用），
 * 于是 clone 会撞上循环引用并抛 "Converting circular structure to JSON"。
 *
 * 解法：克隆前把 userData 临时清空，克隆完再还原原节点上的 userData（克隆体不带 parts 即可）。
 */
export function safeClone(node) {
  const saved = [];
  node.traverse((o) => {
    if (o.userData && Object.keys(o.userData).length) {
      saved.push([o, o.userData]);
      o.userData = {};
    }
  });
  let copy;
  try {
    copy = node.clone(true);
  } finally {
    for (const [o, ud] of saved) o.userData = ud;
  }
  return copy;
}

/**
 * 细长构件不要描边（重要）
 *
 * 反向外壳描边是**绝对宽度**（沿法线外扩 N 米）。对一根半径 0.09 m 的管路，
 * 0.022 m 的外扩 = 25%，于是整根管子被黑色壳包住 → 读成"粗黑管"，完全走形。
 * 判据用**构件自身的截面尺寸**，不能用包围球半径（细长杆件的包围球很大，
 * 但截面极小）。
 *
 * 直接在资产 build() 里、描边之前调用即可。
 */
export function tagThinMembers(root, o = {}) {
  const torusTubeMax = o.torusTubeMax ?? 0.42;
  const tubeRadiusMax = o.tubeRadiusMax ?? 0.30;
  const cylRadiusMax = o.cylRadiusMax ?? 0.34;
  let n = 0;
  root.traverse((m) => {
    if (!m.isMesh || m.userData.noOutline) return;
    const g = m.geometry;
    if (!g || !g.parameters) return;
    const p = g.parameters;
    let thin = false;
    switch (g.type) {
      case 'TorusGeometry':
        thin = (p.tube ?? 99) < torusTubeMax;
        break;
      case 'TubeGeometry':
        thin = (p.radius ?? 99) < tubeRadiusMax;
        break;
      case 'CylinderGeometry':
      case 'CapsuleGeometry':
        thin = Math.max(p.radiusTop ?? 0, p.radiusBottom ?? 0, p.radius ?? 0) < cylRadiusMax;
        break;
      case 'BoxGeometry':
        // 薄板/细条：最短边很小时也不描边
        thin = Math.min(p.width ?? 99, p.height ?? 99, p.depth ?? 99) < o.boxMinAxis ?? 0.26;
        break;
      default:
        thin = false;
    }
    if (thin) { m.userData.noOutline = true; n++; }
  });
  return n;
}

// ---------------------------------------------------------------------------
// 比例参照人形（1.75 m，头身比 1:6.2）—— 每个预览页必须放
// ---------------------------------------------------------------------------
export function refHuman(h = 1.75, o = {}) {
  const g = new THREE.Group();
  g.name = 'RefHuman_1.75m';
  const mat = o.mat || toon(o.color || '#8A8F98', { bands: [0.35, 0.7, 1.0], outlineWidth: 0.008 });
  const headR = h / 6.2 / 2;
  const bodyH = h - (h / 6.2) * 1.15;
  const legH = h * 0.46;
  const torsoH = bodyH - legH;

  mesh(g, sphereGeo(headR, 12), mat, [0, h - headR, 0]);
  mesh(g, cylGeo(torsoH * 0.16, torsoH * 0.2, torsoH, 8), mat, [0, legH + torsoH / 2, 0]);
  // 腿
  for (const sx of [-1, 1]) {
    mesh(g, cylGeo(h * 0.03, h * 0.035, legH, 6), mat, [sx * h * 0.045, legH / 2, 0]);
  }
  // 手臂
  for (const sx of [-1, 1]) {
    mesh(g, cylGeo(h * 0.025, h * 0.028, torsoH * 0.85, 6), mat, [sx * (torsoH * 0.2 + h * 0.03), legH + torsoH * 0.5, 0]);
  }
  g.userData.noMerge = true;
  return g;
}

export default {
  bevelBox, boxGeo, cylGeo, torusArcGeo, sphereGeo, coneGeo, mesh,
  edgeHighlight, rivets, rivetPanel, gearGeo, gear, gearPair, pipe,
  railing, truss, platedPanel, addOutline, outlineTree, mergeByMaterial, refHuman,
  strutBetween, updateStrut, unitStrut, bearingBlock, mountFlange, tagThinMembers, safeClone,
};
