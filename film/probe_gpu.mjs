// 探针：验证 GPU 渲染路径 + 逐帧可控性 + 单帧截取耗时
import { chromium } from '../tools/blender/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import os from 'node:os';

const OUT = new URL('./probe/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const EXE = `${os.homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: [
    '--no-proxy-server',
    '--use-angle=metal',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-zero-copy',
    '--disable-frame-rate-limit',
  ],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text()); });

const t0 = Date.now();
await page.goto('http://127.0.0.1:8817/canal_airship.html', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.CRANEWICK && window.CRANEWICK.ship, null, { timeout: 120000 });
console.log('load ms', Date.now() - t0);

const info = await page.evaluate(() => {
  const C = window.CRANEWICK;
  const gl = C.renderer.getContext();
  return {
    glVersion: gl.getParameter(gl.VERSION),
    glRenderer: gl.getParameter(gl.RENDERER),
    hasGlobals: {
      updateWorld: typeof window.updateWorld,
      updateStage: typeof window.updateStage,
      updateCamera: typeof window.updateCamera,
      updateRain: typeof window.updateRain,
      seekTime: typeof window.seekTime,
    },
    stats: C.stats(),
    stage: C.stage,
    phases: typeof PHASES !== 'undefined' ? PHASES : null,
  };
});
console.log(JSON.stringify(info, null, 2));

// 停掉内部 rAF 循环，接管逐帧
await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
await page.waitForTimeout(300);

// 安装手动步进器
const installOk = await page.evaluate(() => {
  const C = window.CRANEWICK;
  window.__frame = (t, dt, theta, phi, radius, tx, ty, tz) => {
    if (typeof updateWorld !== 'function') return 'no-updateWorld';
    // 模拟时间推进（不改 elapsed，避免 seekTime 重置瞬态）
    updateStage(dt);
    updateWorld(t, dt);
    if (typeof updateRain === 'function') updateRain(dt, t);
    const sp = Math.sin(phi), cp = Math.cos(phi);
    C.camera.position.set(tx + radius * sp * Math.sin(theta), ty + radius * cp, tz + radius * sp * Math.cos(theta));
    C.camera.lookAt(tx, ty, tz);
    C.renderer.render(C.scene, C.camera);
    return 'ok';
  };
  return 'ok';
});
console.log('install', installOk);

const variants = [
  { name: 'dusk_orbit', tod: 'dusk', rain: false, theta: 1.47, phi: 1.43, radius: 30, target: [-4, 3.6, 0] },
  { name: 'midnight_rain_low', tod: 'midnight', rain: true, theta: 0.9, phi: 1.2, radius: 14, target: [-8, 2.2, 0] },
  { name: 'morning_high', tod: 'morning', rain: false, theta: 2.4, phi: 0.75, radius: 46, target: [0, 4, 0] },
];

for (const v of variants) {
  await page.evaluate(({ tod, rain }) => {
    window.CRANEWICK.stage.tod = tod;
    window.CRANEWICK.stage.rain = rain;
  }, v);
  // 让舞台过渡收敛
  for (let i = 0; i < 90; i++) {
    await page.evaluate(([t, dt, th, ph, r, x, y, z]) => window.__frame(t, dt, th, ph, r, x, y, z),
      [20, 1 / 24, v.theta, v.phi, v.radius, ...v.target]);
  }
  const p = OUT + v.name + '.png';
  const s0 = Date.now();
  await page.screenshot({ path: p, type: 'png' });
  console.log(v.name, 'shot ms', Date.now() - s0, 'bytes', fs.statSync(p).size);
}

// 测连续截图吞吐（jpg）
const seq0 = Date.now();
for (let i = 0; i < 10; i++) {
  await page.evaluate(([t, dt]) => window.__frame(t, dt, 1.4, 1.3, 28, -4, 3.6, 0), [22 + i / 24, 1 / 24]);
  await page.screenshot({ type: 'jpeg', quality: 92 });
}
console.log('10 frames jpg total ms', Date.now() - seq0, '=> per frame', (Date.now() - seq0) / 10);

await browser.close();
