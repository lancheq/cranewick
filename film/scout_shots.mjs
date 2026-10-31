// 机位侦查：12 个候选镜头 → 接触表
import { chromium } from '../tools/blender/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import os from 'node:os';

const EXE = `${os.homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const OUT = new URL('./scout/', import.meta.url).pathname;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const SHOTS = [
  { id: 'A', t: 2,   tod: 'morning',  rain: false, pos: [-34, 18, 40], tgt: [2, 4, 0],     fov: 32 },
  { id: 'B', t: 8,   tod: 'dusk',     rain: false, pos: [-30, 12, 30], tgt: [5, 6, 0],     fov: 38 },
  { id: 'C', t: 6,   tod: 'morning',  rain: false, pos: [-6, 3.2, 18], tgt: [-2, 4.6, 13], fov: 30 },
  { id: 'D', t: 14,  tod: 'noon',     rain: false, pos: [5, 6.5, -9],  tgt: [5, 9.5, 0],   fov: 42 },
  { id: 'E', t: 12,  tod: 'noon',     rain: false, pos: [5, 2.0, 0],   tgt: [30, 3, 0],    fov: 50 },
  { id: 'F', t: 22,  tod: 'noon',     rain: true,  pos: [-14, 1.4, 6], tgt: [-2, 0.6, 0],  fov: 45 },
  { id: 'G', t: 24,  tod: 'dusk',     rain: false, pos: [-24, 7, -16], tgt: [-14, 5, 0],   fov: 40 },
  { id: 'H', t: 29.5,tod: 'dusk',     rain: false, pos: [-14.5, 2.0, -9], tgt: [-9, 1.4, 0], fov: 38 },
  { id: 'I', t: 30,  tod: 'dusk',     rain: true,  pos: [-11, 1.6, -5], tgt: [-9, 1.2, 0], fov: 45 },
  { id: 'J', t: 40,  tod: 'midnight', rain: true,  pos: [5, 2.0, 7],   tgt: [14, 2.2, 0],  fov: 45 },
  { id: 'K', t: 50,  tod: 'midnight', rain: true,  pos: [6, 3.5, 12],  tgt: [17, 2.2, 0],  fov: 35 },
  { id: 'L', t: 51,  tod: 'midnight', rain: false, pos: [-2, 16, 32],  tgt: [2, 2, 0],     fov: 40 },
];

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-proxy-server', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', e => console.log('[err]', e.message));
await page.goto('http://127.0.0.1:8817/canal_airship.html', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.CRANEWICK && window.CRANEWICK.ship, null, { timeout: 120000 });
await page.addStyleTag({ content: '#bar,#load,#err{display:none!important}' });
await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
await page.waitForTimeout(200);

for (const s of SHOTS) {
  await page.evaluate(cfg => {
    const C = window.CRANEWICK;
    C.stage.tod = cfg.tod;
    C.stage.rain = cfg.rain;
    // 快速收敛光照
    for (let i = 0; i < 120; i++) updateStage(1 / 8);
    seekTime(cfg.t);
    for (let i = 0; i < 4; i++) updateWorld(cfg.t + i / 24, 1 / 24);
    C.camera.fov = cfg.fov;
    C.camera.updateProjectionMatrix();
    C.camera.position.set(...cfg.pos);
    C.camera.up.set(0, 1, 0);
    C.camera.lookAt(...cfg.tgt);
    C.renderer.render(C.scene, C.camera);
  }, s);
  await page.screenshot({ path: `${OUT}${s.id}.png` });
  console.log('shot', s.id);
}
await browser.close();
