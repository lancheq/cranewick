/**
 * verify.mjs — 一键自检（改完代码跑这一条）
 *
 * 串起四道闸：
 *   ① 语法   —— 所有 .js 与所有 HTML 内联模块脚本（node --check）
 *   ② 契约   —— 页面引用的资产字段是否真实存在（contracts.mjs）
 *   ③ 材质   —— 材质表被引用的键 / M 工厂方法是否存在（materials.mjs）
 *   ④ 资源   —— 每个模块的相对 import 路径是否都能命中真实文件
 *   ⑤ 台账   —— 刷新 build-info.json + 各页 ?v= 缓存击穿标记（stamp.mjs）
 *
 * 为什么要一键：本项目已三次出现"资产接口改了、页面没跟上"导致页面白屏/报错，
 * 以及一次 HTML 内联脚本语法错误导致整个模块图静默失败。
 * 这些都能静态查出来 —— 但前提是**每次都查**。
 *
 * 用法：node tools/verify.mjs
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const NODE = process.execPath;
const run = (args) => {
  try {
    const out = execFileSync(NODE, args, { stdio: 'pipe' }).toString();
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: (e.stdout || '').toString() + (e.stderr || '').toString() };
  }
};

const banner = (n, title) => console.log('\n── ' + n + ') ' + title + ' ' + '─'.repeat(Math.max(0, 46 - title.length)));

let failed = 0;

// ① 所有 .js 语法
banner(1, 'JS 语法');
const jsFiles = [];
const walkAll = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walkAll(p);
    else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) jsFiles.push(p);
  }
};
for (const d of ['src', 'preview', 'tools']) {
  const abs = path.join(ROOT, d);
  if (fs.existsSync(abs)) walkAll(abs);
}
let jsBad = 0;
for (const f of jsFiles) {
  const r = run(['--check', f]);
  if (!r.ok) { jsBad++; console.log('❌ ' + path.relative(ROOT, f)); console.log('   ' + r.out.split('\n').slice(0, 3).join('\n   ')); }
}
console.log(jsBad ? jsBad + ' 个文件语法错误' : '✅ ' + jsFiles.length + ' 个 JS 文件语法通过');
failed += jsBad;

// ② HTML 内联脚本语法
banner(2, 'HTML 内联模块脚本');
const r2 = run([path.join(ROOT, 'tools', 'checkhtml.mjs')]);
console.log(r2.out.trim());
if (!r2.ok) failed++;

// ③ 契约
banner(3, '页面 ↔ 资产接口契约');
const r3 = run([path.join(ROOT, 'tools', 'contracts.mjs')]);
console.log(r3.out.trim());
if (!r3.ok) failed++;

// ④ import 路径可达性
//   注意两点易错：① 只认真正的 import 语句（源码里的占位串/注释不算）；
//   ② HTML 里的 '../src/x' 走的是**浏览器 URL 语义**（从站点根起，'..' 会被夹到根），
//      不是文件系统语义 —— 按文件系统算会得到模型目录之外，全部假报。
banner(4, '模块 import 路径');
const bad = [];
const RE_IMPORT = /import\s+(?:[^'"();]+?\s+from\s+)?['"](\.[^'"]+)['"]/g;
const checkFile = (f, isHtml) => {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(RE_IMPORT)) {
    const spec = m[1].split('?')[0];
    const abs = isHtml
      ? path.join(ROOT, spec.replace(/^(\.\.\/)+/, ''))
      : path.resolve(path.dirname(f), spec);
    if (!fs.existsSync(abs)) bad.push(path.relative(ROOT, f) + ' → ' + m[1]);
  }
};
for (const f of jsFiles) checkFile(f, false);
for (const f of fs.readdirSync(ROOT).filter((n) => n.endsWith('.html'))) checkFile(path.join(ROOT, f), true);
const hd = path.join(ROOT, 'preview');
if (fs.existsSync(hd)) for (const f of fs.readdirSync(hd).filter((n) => n.endsWith('.html'))) checkFile(path.join(hd, f), true);
if (bad.length) { for (const b of bad) console.log('❌ ' + b); failed += bad.length; }
else console.log('✅ 全部相对 import 路径可达');

// ⑤ 材质键（缺键 ⇒ 默认 MeshBasicMaterial ⇒ 零件恒亮"发光"）
banner(5, '材质表键 / 工厂方法');
const r5m = run([path.join(ROOT, 'tools', 'materials.mjs')]);
console.log(r5m.out.trim().split('\n').filter((l) => !/^   /.test(l)).join('\n'));
if (!r5m.ok) failed++;

// ⑥ scale 常量字段引用（undefined ⇒ NaN 坐标 ⇒ 整块内容消失且不报错）
banner(6, 'scale 常量字段引用');
const r6s = run([path.join(ROOT, 'tools', 'scalecheck.mjs')]);
console.log(r6s.out.trim().split('\n').filter((l) => !/^⚠️/.test(l)).join('\n'));
if (!r6s.ok) failed++;

// ⑦ 台账 + 缓存击穿
banner(7, '构建台账 / 缓存击穿');
const r5 = run([path.join(ROOT, 'tools', 'stamp.mjs')]);
console.log(r5.out.trim().split('\n').slice(0, 6).join('\n'));

console.log('\n' + (failed ? '⛔ 有 ' + failed + ' 处问题，先修再继续' : '✅ 全部通过 —— 可以交付'));
process.exit(failed ? 1 : 0);
