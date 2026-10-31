// 机位侦查：12 个候选镜头 → 接触表
import { chromium } from '../tools/blender/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import os from 'node:os';

const EXE = `${os.homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const OUT = new URL('./scout2/', import.meta.url).pathname;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const SHOTS = [
  { id: 'M', t: 2,   tod: 'morning',  rain: false, pos: [-38, 9, 3],    tgt: [0, 4, 0],     fov: 40 },
  { id: 'N', t: 6,   tod: 'morning',  rain: false, pos: [-38, 17, 11],  tgt: [2, 3, 0],     fov: 45 },
  { id: 'O', t: 46,  tod: 'noon',     rain: false, pos: [38, 9, -4],    tgt: [0, 3, 0],     fov: 40 },
  { id: 'P', t: 40,  tod: 'noon',     rain: false, pos: [30, 6, 8],     tgt: [-6, 2.5, 0],  fov: 38 },
  { id: 'Q', t: 29.5,tod: 'dusk',     rain: false, pos: [-2, 3.0, -10.5],tgt: [-9, 2.2, 0], fov: 35 },
  { id: 'R', t: 14,  tod: 'dusk',     rain: false, pos: [0, 2.4, 9.8],  tgt: [5, 7.5, 0],   fov: 45 },
  { id: 'S', t: 36,  tod: 'dusk',     rain: false, pos: [5, 3.2, 8.5],  tgt: [5, 2.5, -6],  fov: 50 },
  { id: 'T', t: 22,  tod: 'noon',     rain: true,  pos: [-16, 1.6, 0],  tgt: [0, 1.5, 0],   fov: 50 },
  { id: 'U', t: 50,  tod: 'midnight', rain: true,  pos: [8, 1.6, 4],    tgt: [17, 2.0, 0],  fov: 35 },
  { id: 'V', t: 44,  tod: 'midnight', rain: true,  pos: [26, 20, 16],   tgt: [0, 3, 0],     fov: 42 },
  { id: 'W', t: 24,  tod: 'dusk',     rain: false, pos: [-34, 22, 22],  tgt: [0, 3, 0],     fov: 45 },
  { id: 'X', t: 50,  tod: 'midnight', rain: false, pos: [0, 28, 30],    tgt: [0, 2, 0],     fov: 45 },
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
