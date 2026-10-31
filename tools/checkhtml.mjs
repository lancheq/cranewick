/**
 * checkhtml.mjs — 校验所有 HTML 页面的 <script type="module"> 语法
 *
 * 为什么需要它：HTML 里的模块脚本若语法错误，浏览器会**静默失败** ——
 * 页面停在遮罩，console 里的报错又常被自装的错误处理器漏掉。
 * 本轮"全场景打不开"的真因就是 index.html 主脚本里残留了一段悬空字符串
 * （早前批量替换 specs/checklist 时没删干净，留下孤立字符串 + 多余 `]`）。
 * `node --check` 只能查 .js 文件，查不到 HTML 内联脚本 ⇒ 必须有这个工具。
 *
 * 用法：node tools/checkhtml.mjs      （退出码非 0 表示有页面不合格）
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const NODE = process.execPath;

const targets = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) targets.push(p);
  }
};
walk(ROOT);

const tmpDir = path.join(ROOT, '.workbuddy');
fs.mkdirSync(tmpDir, { recursive: true });
const tmp = path.join(tmpDir, 'tmp-check.mjs');

let bad = 0, checked = 0;
for (const f of targets) {
  const html = fs.readFileSync(f, 'utf8');
  const mods = [...html.matchAll(/<script\s+type=["']module["']\s*>([\s\S]*?)<\/script>/g)];
  for (let i = 0; i < mods.length; i++) {
    fs.writeFileSync(tmp, mods[i][1]);
    try {
      execFileSync(NODE, ['--check', tmp], { stdio: 'pipe' });
      checked++;
    } catch (err) {
      bad++;
      const msg = String(err.stderr || err.message)
        .split('\n').filter(Boolean).slice(0, 3).join(' / ');
      console.log('❌ ' + path.relative(ROOT, f) + ' [script #' + (i + 1) + ']  ' + msg);
    }
  }
}
fs.rmSync(tmp, { force: true });
console.log(bad
  ? '\n共 ' + bad + ' 处语法错误（已检查 ' + checked + ' 个模块脚本）'
  : '✅ 全部 ' + checked + ' 个内联模块脚本语法通过（扫描 ' + targets.length + ' 个 HTML）');
process.exit(bad ? 1 : 0);
