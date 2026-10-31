/**
 * materials.mjs — 校验「材质表里被引用的键是否真的存在」
 *
 * 为什么需要它：`new THREE.Mesh(geo, undefined)` **不会报错**，
 * 它会退化成默认 `MeshBasicMaterial` —— 不受光照、恒亮。表现就是零件"在发光"。
 * 本项目实测到 11 处这种键：行人手脚、发电塔顶的蒸汽柱、飞艇烟囱箍、桥管廊绝缘子…
 * 全靠肉眼看画面根本定位不到，静态可查 ⇒ 工具化。
 *
 * 同时校验 `M.xxx(...)` 工厂方法名是否存在（写错工厂名同样会抛/静默不对）。
 *
 * 用法：node tools/materials.mjs     （退出码非 0 表示有缺失键）
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

/** 去掉行注释（避免注释里提到旧键名被误报） */
function stripComments(src) {
  return src
    .split('\n')
    .map((l) => {
      const i = l.indexOf('//');
      if (i < 0) return l;
      // 简单保护：URL 里的 // 不当作注释
      if (/https?:\/\//.test(l.slice(Math.max(0, i - 8), i + 2))) return l;
      return l.slice(0, i);
    })
    .join('\n');
}

/** 取对象字面量的顶层键 */
function objKeys(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  if (open < 0) return [];
  const keys = new Set();
  let depth = 0, seg = '';
  const flush = (s) => {
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

const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
};
walk(path.join(ROOT, 'src'));

// M 工厂可用方法名
const matSrc = fs.readFileSync(path.join(ROOT, 'src/core/materials.js'), 'utf8');
const M_KEYS = new Set([...matSrc.matchAll(/^  ([A-Za-z_$][\w$]*)\s*:\s*\(/gm)].map((m) => m[1]));

let bad = 0;
for (const f of files) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  const tables = [];
  for (const m of src.matchAll(/function\s+(make\w*Mat\w*)\s*\([^)]*\)\s*\{/g)) {
    const r = src.indexOf('return {', m.index);
    if (r < 0 || r - m.index > 1600) continue;
    tables.push({ name: m[1], keys: new Set(objKeys(src, r)) });
  }
  if (!tables.length) continue;
  const all = new Set();
  tables.forEach((t) => t.keys.forEach((k) => all.add(k)));

  // 引用：**只认材质表别名**（MT / MT2 …）——不能收 `mat.` / `material.` / `o.materials`
  // 这类通用局部变量，否则会满屏假报。
  const refs = new Map();
  for (const m of src.matchAll(/\b(MT\d*)\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
    if (!refs.has(m[1])) refs.set(m[1], new Set());
    refs.get(m[1]).add(m[2]);
  }
  for (const [alias, set] of refs) {
    for (const k of set) {
      // 排除方法调用（后面紧跟 '(' 视为函数而非材质键）
      if (new RegExp('\\b' + alias + '\\s*\\.\\s*' + k + '\\s*\\(').test(src)) continue;
      if (!all.has(k)) {
        bad++;
        console.log('❌ ' + path.relative(ROOT, f) + '  ' + alias + '.' + k
          + '  ← 材质表无此键（会退化成默认 MeshBasicMaterial ⇒ 零件「发光」）');
      }
    }
  }

  // 工厂方法名
  for (const m of src.matchAll(/\bM\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (!M_KEYS.has(m[1])) { bad++; console.log('❌ ' + path.relative(ROOT, f) + '  M.' + m[1] + '()  ← materials.js 无此工厂方法'); }
  }
  console.log('   ' + path.relative(ROOT, f) + '  材质表(' + tables.map((t) => t.name + '=' + t.keys.size).join(',') + ')');
}

console.log(bad ? '\n共 ' + bad + ' 处问题' : '✅ 材质键与工厂方法全部有效');
process.exit(bad ? 1 : 0);
