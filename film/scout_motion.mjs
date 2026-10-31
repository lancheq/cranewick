// 侦查：飞船/桥/场景包围盒随时间的位置变化
import { chromium } from '../tools/blender/node_modules/playwright-core/index.mjs';
import os from 'node:os';

const EXE = `${os.homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-proxy-server', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', e => console.log('[err]', e.message));
await page.goto('http://127.0.0.1:8817/canal_airship.html', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.CRANEWICK && window.CRANEWICK.ship, null, { timeout: 120000 });
await page.addStyleTag({ content: '#bar,#load{display:none!important}' });
await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
await page.waitForTimeout(200);

const out = await page.evaluate(() => {
  const C = window.CRANEWICK;
  const THREE = window.THREE;
  const rows = [];
  const box = new THREE.Box3();
  for (const t of [0, 5, 12, 20, 24, 28, 29, 30, 31, 33, 35, 40, 44, 48, 52, 56, 59.5]) {
    seekTime(t);
    for (let i = 0; i < 3; i++) { updateStage(1 / 24); updateWorld(t + i / 24, 1 / 24); }
    C.ship.root.updateWorldMatrix(true, true);
    box.setFromObject(C.ship.root);
    rows.push({
      t,
      ship: C.ship.root.position.toArray().map(v => +v.toFixed(2)),
      shipBox: { min: box.min.toArray().map(v => +v.toFixed(2)), max: box.max.toArray().map(v => +v.toFixed(2)) },
      bridge: C.bridge ? (C.bridge.root ? C.bridge.root.position.toArray().map(v => +v.toFixed(2)) : C.bridge.position.toArray().map(v => +v.toFixed(2))) : null,
      stageLamp: +C.stageCur.lamp.toFixed(2),
    });
  }
  return rows;
});
console.log(JSON.stringify(out, null, 1));

// 场景整体包围盒
const sceneBox = await page.evaluate(() => {
  const THREE = window.THREE, C = window.CRANEWICK;
  const b = new THREE.Box3().setFromObject(C.scene);
  return { min: b.min.toArray().map(v => +v.toFixed(1)), max: b.max.toArray().map(v => +v.toFixed(1)) };
});
console.log('sceneBox', JSON.stringify(sceneBox));
await browser.close();
