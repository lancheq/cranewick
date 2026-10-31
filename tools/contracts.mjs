/**
 * contracts.mjs — 校验 HTML 页面引用资产接口的字段是否真实存在
 *
 * 为什么需要它：这个 bug 已经复发三次 ——
 *   ① 预览页读 `SP.leafOpenDeg`（新桥叫 `openDeg`）
 *   ② 预览页读 `V.carriage`（新车辆叫 `hoverCar`）
 *   ③ index 状态面板读 `s.draft` / `s.airshipAltitude` / `s.railRetract`
 *      （snapshot 真名是 draftWorld / airshipAltitudeWorld，railRetract 已废除）
 * 每回都是"资产接口改了、页面没跟上"，一进去就抛错、整条时间轴崩掉。
 * 这类问题静态可查 ⇒ 用工具兜住，不靠人肉记。
 *
 * 查三类契约：
 *   A) 预览页 `<别名>.字段`，别名来自 `const 别名 = <模块>.SPEC`   → 必须 ∈ 该模块 SPEC 键
 *   B) 预览页 `<别名>.字段`，别名来自 `... .userData.parts`        → 必须 ∈ 该模块 parts 键
 *   C) index 里 `s.字段`（s = scene.snapshot()）                  → 必须 ∈ assemble 快照键
 *
 * 用法：node tools/contracts.mjs    （退出码非 0 表示有契约不符）
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

/** 取对象字面量的顶层键（支持一行多个键 / 简写 / 带默认值的形参） */
function keysOfObjectLiteral(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  if (open < 0) return [];
  const keys = new Set();
  let depth = 0, seg = '';
  const flush = (s) => {
    // 段里可能带 `return ` 前缀或注释行 ⇒ 只认「行首 键:」；再退回「行首 裸键」（简写）
    const m = s.match(/(?:^|\n)\s*([A-Za-z_$][\w$]*)\s*:/);
    if (m) { keys.add(m[1]); return; }
    const m2 = s.match(/(?:^|\n)\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/);
    if (m2) keys.add(m2[1]);
  };
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{' || c === '[' || c === '(') { depth++; if (depth === 1) continue; }
    else if (c === '}' || c === ']' || c === ')') { depth--; if (depth === 0) { flush(seg); break; } }
    else if (c === ',' && depth === 1) { flush(seg); seg = ''; continue; }
    if (depth >= 1) seg += c;
  }
  return [...keys];
}

function moduleContract(file) {
  const s = fs.readFileSync(file, 'utf8');
  const spec = new Set(), parts = new Set(), exports = new Set();
  const idx = s.indexOf('export const SPEC');
  if (idx >= 0) keysOfObjectLiteral(s, idx).forEach((k) => spec.add(k));
  for (const m of s.matchAll(/userData\.parts\s*=\s*\{/g)) {
    keysOfObjectLiteral(s, m.index).forEach((k) => parts.add(k));
  }
  for (const m of s.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) exports.add(m[1]);
  for (const m of s.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const t of m[1].split(',')) { const n = t.trim().split(/\s+as\s+/).pop().trim(); if (n) exports.add(n); }
  }
  return { spec, parts, exports };
}

function snapshotKeys(file) {
  const s = fs.readFileSync(file, 'utf8');
  const i = s.indexOf('snapshot()');
  if (i < 0) return new Set();
  // 注意：`snapshot() {` 后的第一个 `{` 是**函数体**，返回对象在其内一层。
  // 必须定位 `return {`，否则逗号落在相对深度 2 上，一个键都取不到。
  const ret = s.indexOf('return {', i);
  const anchor = ret >= 0 ? ret : i;
  return new Set(keysOfObjectLiteral(s, anchor));
}

const modules = {};
for (const rel of ['bridge', 'street', 'vehicles', 'canal', 'airship', 'citykit']) {
  const f = path.join(ROOT, 'src', 'assets', rel + '.js');
  if (fs.existsSync(f)) modules[rel] = moduleContract(f);
}
const snapKeys = snapshotKeys(path.join(ROOT, 'src', 'scene', 'assemble.js'));

const htmls = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) htmls.push(p);
  }
};
walk(ROOT);

let bad = 0;
const report = (file, kind, alias, field, where) => {
  bad++;
  console.log('❌ ' + path.relative(ROOT, file) + '  ' + kind + '  ' + alias + '.' + field + '  (' + where + ')');
};

// 局部变量名不是快照时排除（scrub 的 s、按钮的 b 等）
const SNAP_SKIP = new Set(['toFixed', 'toString', 'length', 'map', 'filter', 'value', 'dispatchEvent', 'style', 'dataset']);

for (const hf of htmls) {
  const h = fs.readFileSync(hf, 'utf8');

  const aliasMap = {};
  for (const m of h.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g)) {
    aliasMap['@' + m[1]] = m[2].split('/').pop().replace(/\.js.*$/, '');
  }
  const specAliases = {};
  for (const m of h.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\.(SPEC|userData\.parts)/g)) {
    const ns = m[2], kind = m[3] === 'SPEC' ? 'spec' : 'parts';
    const mod = aliasMap['@' + ns];
    if (mod && modules[mod]) specAliases[m[1]] = { mod, kind };
  }
  for (const [alias, info] of Object.entries(specAliases)) {
    const keys = info.kind === 'spec' ? modules[info.mod].spec : modules[info.mod].parts;
    if (!keys || keys.size === 0) continue;
    for (const m of h.matchAll(new RegExp('\\b' + alias + '\\.([A-Za-z_$][\\w$]*)', 'g'))) {
      if (!keys.has(m[1])) report(hf, '字段不存在（' + info.kind + '）', alias, m[1], info.mod + '.js');
    }
  }

  // C) 状态面板：把检查窗口限制在 `const s = scene.snapshot()` 之后的一段内
  const si = h.indexOf('scene.snapshot()');
  if (si >= 0 && snapKeys.size) {
    const win = h.slice(si, si + 1400);
    for (const m of win.matchAll(/\bs\.([A-Za-z_$][\w$]*)/g)) {
      if (SNAP_SKIP.has(m[1])) continue;
      if (!snapKeys.has(m[1])) report(hf, '快照无此字段', 's', m[1], 'assemble.snapshot()');
    }
  }
}

if (!bad) {
  console.log('✅ 契约全部一致（' + htmls.length + ' 个 HTML × ' + Object.keys(modules).length + ' 个资产模块）');
  console.log('   SPEC 键数：' + Object.entries(modules).map(([k, v]) => k + '=' + v.spec.size).join('  '));
  console.log('   快照字段数：' + snapKeys.size + '（' + [...snapKeys].join(' ') + '）');
}
process.exit(bad ? 1 : 0);
