/**
 * stamp.mjs — 生成构建台账 build-info.json，并**自动刷新所有 HTML 的缓存击穿标记**
 *
 * 两件事：
 *  ① 写 build-info.json（版本 / 生成时间 / 每个文件的 mtime 与体积，按最新改动排序）
 *     —— 启动台会显示它，供与 Finder 直接对照。
 *  ② 把每个 HTML 里 `from '../src/xxx.js?v=...'` 的版本号统一改成新的时间戳。
 *     —— 这是"改了代码但浏览器还跑旧 JS"的根治手段：只要重跑本脚本，
 *        浏览器就必然重新拉取模块，不会再出现"预览页报旧字段名"这种伪 bug。
 *
 * 用法：node tools/stamp.mjs
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SCAN = ['src', 'preview', 'docs', 'tools'];
const ROOT_FILES = ['index.html', 'README.md', 'serve.sh', 'start.command'];

/* ------------------------------------------------------------------ ① 台账 */
const now = new Date();
const p2 = (n) => String(n).padStart(2, '0');
const VERSION = `v10.2 · ${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;

function statOf(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  const st = fs.statSync(abs);
  return { path: rel, bytes: st.size, mtime: st.mtime.toISOString() };
}

const files = [];
for (const f of ROOT_FILES) { const s = statOf(f); if (s) files.push(s); }
for (const dir of SCAN) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { const s = statOf(path.relative(ROOT, p)); if (s) files.push(s); }
    }
  };
  walk(abs);
}
files.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));

/* --------------------------------------------------- ② 刷新 HTML 缓存击穿 */
/**
 * 关键设计：标记值 = 该页所依赖模块里**最新的 mtime**（分钟精度），而不是"当前时间"。
 * 这样：
 *   · 模块没动 ⇒ 标记值不变 ⇒ 不写文件 ⇒ 台账里的 mtime 保持真实（不会被自己顶新，
 *     不会再出现"文件修改时间对不上"的困惑）；
 *   · 模块改了 ⇒ 标记值自动变化 ⇒ 浏览器必然重新拉取。
 * 即：幂等 + 只在必要时破缓存。
 */
const htmls = [];
for (const dir of ['preview', '.']) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs)) {
    if (f.endsWith('.html')) htmls.push(path.join(dir, f));
  }
}
const p2n = (n) => String(n).padStart(2, '0');
function markerFor(rel) {
  const abs = path.join(ROOT, rel);
  const src = fs.readFileSync(abs, 'utf8');
  let max = 0;
  for (const m of src.matchAll(/from\s+'(?:\.\.?\/)(?:src|vendor)\/[^']+?\.js/g)) {
    const dep = path.join(ROOT, m[0].replace(/^from\s+'/, '').replace(/^(\.\.\/)+/, ''));
    if (fs.existsSync(dep)) max = Math.max(max, fs.statSync(dep).mtimeMs);
  }
  if (!max) return null;                      // 该页不依赖本项目模块
  const d = new Date(max);
  // 秒精度：同一分钟内连续改两次也不会漏刷新（分钟精度会有"标记不变 → 拿到旧 JS"的窗口）
  return `${d.getFullYear()}${p2n(d.getMonth() + 1)}${p2n(d.getDate())}${p2n(d.getHours())}${p2n(d.getMinutes())}${p2n(d.getSeconds())}`;
}
let touched = 0;
for (const rel of htmls) {
  const abs = path.join(ROOT, rel);
  const before = fs.readFileSync(abs, 'utf8');
  const mk = markerFor(rel);
  if (!mk) continue;
  const after = before.replace(/(from\s+'(?:\.\.?\/)(?:src|vendor)\/[^']+?\.js)(\?v=[^']*)?'/g,
    (m, p1) => `${p1}?v=${mk}'`);
  if (after !== before) { fs.writeFileSync(abs, after); touched++; }
}

// 上一步若真的改写了某些 HTML，它们的 mtime 已变 ⇒ 重新取一次，保证台账反映最终状态
//（否则表里会显示"改写前"的时间，又变成"对不上"）
for (const f of files) {
  if (f.path.endsWith('.html')) {
    const s = statOf(f.path);
    if (s) { f.bytes = s.bytes; f.mtime = s.mtime; }
  }
}
files.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));

const out = {
  version: VERSION,
  builtAt: now.toISOString(),
  fileCount: files.length,
  root: ROOT,
  cacheBusting: { htmlFiles: htmls.length, rewritten: touched, scheme: '标记值 = 依赖模块最新 mtime（分钟精度），幂等' },
  files,
  note: '启动台显示本表；任一条目的 mtime / bytes 应与 Finder 中同名文件一致。mtime 为 UTC，页面按本地时间显示。',
};
fs.writeFileSync(path.join(ROOT, 'build-info.json'), JSON.stringify(out, null, 2));

console.log(`台账已写入 build-info.json —— ${VERSION}，${files.length} 个文件`);
console.log(touched
  ? `缓存击穿：${touched}/${htmls.length} 个 HTML 的依赖模块有新改动，已刷新其 ?v= 标记`
  : `缓存击穿：${htmls.length} 个 HTML 的依赖模块均无变化，标记未动（幂等）`);
console.log('最近改动 8 项：');
for (const f of files.slice(0, 8)) {
  console.log(`  ${f.mtime.slice(0, 19).replace('T', ' ')}  ${String(f.bytes).padStart(7)} B  ${f.path}`);
}
