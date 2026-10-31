#!/usr/bin/env node
/* shot_preview.mjs — 取景预览：本地 three.js 场景按给定机位批量出静帧
 * 用法：node film/shot_preview.mjs spec.json
 * spec: [{ "out": "/tmp/a.png", "t": 32.5, "tod": "dusk", "rain": true,
 *          "pos": [x,y,z], "look": [x,y,z], "rel": true, "lens": 30 }]
 * rel=true 时 pos/look 相对飞艇根节点（three 世界系）。
 */
import { chromium } from '../tools/blender/node_modules/playwright-core/index.mjs';
import os from 'node:os';
import fs from 'node:fs';

const EXE = `${os.homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const W = 768, H = 432;

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--no-proxy-server', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--force-device-scale-factor=1'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:8817/canal_airship.html?t=5', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.CRANEWICK && window.CRANEWICK.ship, null, { timeout: 120000 });
await page.addStyleTag({ content: '#bar,#load,#err{display:none!important} body{background:#000}' });
await page.waitForTimeout(800);
await page.evaluate(() => {
  const C = window.CRANEWICK;
  C.renderer.setPixelRatio(1);
  C.renderer.setSize(innerWidth, innerHeight, false);
  C.setPaused(true);
});

for (const s of spec) {
  await page.evaluate(({ tod, rain }) => {
    const C = window.CRANEWICK;
    C.stage.tod = tod;
    C.stage.rain = !!rain;
  }, s);
  await page.waitForTimeout(1400);
  await page.evaluate(({ t }) => window.CRANEWICK.setTime(t), s);
  await page.waitForTimeout(140);
  await page.evaluate(({ pos, look, rel, relp, rell, lens }) => {
    const C = window.CRANEWICK, cam = C.camera;
    C.ship.root.updateMatrixWorld(true);
    const base = C.ship.root.position;
    const rp = relp !== undefined ? relp : rel;
    const rl = rell !== undefined ? rell : rel;
    const P = rp ? [base.x + pos[0], base.y + pos[1], base.z + pos[2]] : pos;
    const L = rl ? [base.x + look[0], base.y + look[1], base.z + look[2]] : look;
    const asp = innerWidth / innerHeight;
    cam.fov = 2 * Math.atan(18 / ((lens || 42) * asp)) * 180 / Math.PI;
    cam.aspect = asp;
    cam.updateProjectionMatrix();
    const dx = P[0] - L[0], dy = P[1] - L[1], dz = P[2] - L[2];
    const r = Math.hypot(dx, dy, dz);
    const phi = Math.acos(Math.max(-1, Math.min(1, dy / r)));
    const theta = Math.atan2(dx, dz);
    const o = C.orbit;
    o.target.set(L[0], L[1], L[2]);
    o.theta = o.tTheta = theta; o.phi = o.tPhi = phi; o.radius = o.tRadius = r;
  }, s);
  await page.waitForTimeout(180);
  await page.screenshot({ path: s.out });
  console.log('[shot]', s.out, s.t, s.tod, s.rain ? 'rain' : 'sun', s.lens || 42);
}
await browser.close();
