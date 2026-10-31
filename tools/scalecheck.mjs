/**
 * scalecheck.mjs — 校验「scale.js 常量的字段引用」是否都真实存在
 *
 * 为什么需要它：本项目踩过一次极隐蔽的事故 ——
 * `CANAL.half` 在 scale.js 里**不存在**（canal.js 自己的 SPEC 里补了，但 scale.js 没补），
 * 于是 `streetX = … + CANAL.half + …` 变成 **NaN**，街道与两岸陆地全被摆到 NaN 坐标上。
 * 症状是「路面全没了、除了运河全是水」，而且**不报任何错**（NaN 坐标不会抛异常）。
 *
 * 这类问题静态可查，必须在自检里兜住：扫全项目对
 * CANAL./BRIDGE./STREET./AIRSHIP./CITY./H. 的字段读取，逐个比对 scale.js 的真实键。
 *
 * 用法：node tools/scalecheck.mjs    （退出码非 0 表示引用了不存在的字段）
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const scaleSrc = fs.readFileSync(path.join(ROOT, 'src/core/scale.js'), 'utf8');

/** 取 `export const NAME = { … }` 的键（支持 `key:` / `get key()` / 简写） */
function objKeys(src, name) {
  const i = src.indexOf('export const ' + name + ' = {');
  if (i < 0) return null;
  const open = src.indexOf('{', i);
  const keys = new Set();
  let depth = 0, seg = '';
  const flush = (x) => {
    let m = x.match(/(?:^|\n)\s*(?:get\s+)?([A-Za-z_$][\w$]*)\s*[:(]/);
    if (m) { keys.add(m[1]); return; }
    m = x.match(/(?:^|\n)\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/);
    if (m) keys.add(m[1]);
  };
  for (let k = open; k < src.length; k++) {
    const c = src[k];
    if (c === '{' || c === '[' || c === '(') { depth++; if (depth === 1) continue; }
    else if (c === '}' || c === ']' || c === ')') { depth--; if (depth === 0) break; }
    else if (c === ',' && depth === 1) { flush(seg); seg = ''; continue; }
    if (depth >= 1) seg += c;
  }
  flush(seg);
  return keys;
}

const TABLES = {
  CANAL: objKeys(scaleSrc, 'CANAL'),
  BRIDGE: objKeys(scaleSrc, 'BRIDGE'),
  STREET: objKeys(scaleSrc, 'STREET'),
  AIRSHIP: objKeys(scaleSrc, 'AIRSHIP'),
  CITY: objKeys(scaleSrc, 'CITY'),
  H: objKeys(scaleSrc, 'H'),
};
for (const [k, v] of Object.entries(TABLES)) {
  if (!v || !v.size) console.log('⚠️ 未能解析 scale.js 的表: ' + k + '（该表的引用将跳过检查）');
}

const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'vendor' || e.name === 'node_modules' || e.name === 'tools') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|mjs|html)$/.test(e.name)) files.push(p);
  }
};
walk(ROOT);

/**
 * 模板字符串里的范围（GLSL 着色器源码）。着色器里 `H` 是半程向量、`.xz` 是 swizzle，
 * 与 scale.js 的常量表无关；不排除会把 `normalize(H.xz + …)` 误报成无效字段。
 */
function shaderRanges(src) {
  const out = [];
  const re = /`/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index;
    let k = start + 1, depth = 0;
    while (k < src.length) {
      const c = src[k];
      if (c === '\\') { k += 2; continue; }
      if (c === '$' && src[k + 1] === '{') { depth++; k += 2; continue; }
      if (c === '}' && depth > 0) { depth--; k++; continue; }
      if (c === '`' && depth === 0) break;
      k++;
    }
    out.push([start, k]);
    re.lastIndex = k + 1;
  }
  return out;
}

let bad = 0, skipped = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const ranges = f.endsWith('.html') ? shaderRanges(src) : [];
  for (const [tbl, keys] of Object.entries(TABLES)) {
    if (!keys || !keys.size) continue;
    const re = new RegExp('\\b' + tbl + '\\.([A-Za-z_$][\\w$]*)', 'g');
    for (const m of src.matchAll(re)) {
      if (ranges.some(([a, b]) => m.index > a && m.index < b)) { skipped++; continue; }
      if (!keys.has(m[1])) {
        bad++;
        console.log('❌ ' + path.relative(ROOT, f) + '  ' + tbl + '.' + m[1]
          + '  ← scale.js 的 ' + tbl + ' 无此字段（得到 undefined ⇒ 常见后果是 NaN 坐标、整块内容消失且不报错）');
      }
    }
  }
}
if (skipped) console.log('（模板字符串内 ' + skipped + ' 处同名命中已跳过：着色器变量，不是常量表）');
console.log(bad
  ? '\n共 ' + bad + ' 处无效字段引用'
  : '✅ scale 常量字段引用全部有效（' + Object.keys(TABLES).join(' ') + '）');
process.exit(bad ? 1 : 0);
