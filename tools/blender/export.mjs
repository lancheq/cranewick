import { chromium } from 'playwright-core';
import os from 'node:os';
import path from 'node:path';

const exe = `${os.homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const exporterPath = path.resolve('GLTFExporter.js');

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('console', m => {
  const txt = m.text();
  if (!txt.includes('GPU stall')) console.log('[console]', m.type(), txt);
});
page.on('pageerror', e => console.log('[pageerror]', e.message));

const pageUrl = process.env.PAGE_URL || 'http://127.0.0.1:8777/canal_airship_fix.html?t=30&freeze';
await page.goto(pageUrl, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.CRANEWICK && window.CRANEWICK.ship, null, { timeout: 120000 });
await page.waitForTimeout(3000);
// v3.27: 时间线里"明轮入水"和"风帆张开"从不同时出现（放轮时段帆在收）。
// 劫持 ship.update 强制状态组合：帆全开 + 明轮全放（下部入水），等动画收敛。
await page.evaluate(() => {
  const C = window.CRANEWICK;
  const orig = C.ship.update;
  C.ship.update = function (st, dt) {
    st.sailDeploy = 1; st.sailFurl = 1;
    st.paddleDeploy = 1; st.paddle = 1;
    return orig.call(this, st, dt);
  };
});
await page.waitForTimeout(5000);
await page.addScriptTag({ path: exporterPath });
await page.evaluate(() => {
  window.CRANEWICK.stage.tod = 'morning';
  window.CRANEWICK.stage.rain = false;
});
await page.waitForTimeout(2200);

const result = await page.evaluate(async () => {
  const C = window.CRANEWICK;
  const THREE = window.THREE;
  const scene = C.scene;

  // 节点稳定命名：GLB 无名节点在 Blender 里按导入顺序编号（Node_###），
  // 场景结构一变编号就漂移；给飞艇 root 固定名字供渲染脚本引用。
  if (C.ship && C.ship.root) C.ship.root.name = 'SHIP_ROOT';

  const matKey = new Map();
  for (const [k, m] of Object.entries(C.MAT)) {
    if (m && typeof m === 'object') {
      if (!matKey.has(m)) matKey.set(m, k);
      m.name = k;
    }
  }

  const standardCache = new Map();
  const metalKeys = new Set(['brass', 'brassHi', 'brassLo', 'bronze', 'copper', 'steel', 'iron', 'ironDark', 'metal', 'ironPlate']);
  function pbr(mat) {
    if (standardCache.has(mat)) return standardCache.get(mat);
    const key = matKey.get(mat) || mat.name || 'mat';
    const std = new THREE.MeshStandardMaterial({
      name: key,
      color: mat.color ? mat.color.clone() : new THREE.Color(0xcccccc),
      map: mat.map || null,
      side: mat.side,
      transparent: mat.transparent,
      opacity: mat.opacity,
      alphaTest: mat.alphaTest || 0,
      metalness: metalKeys.has(key) ? 0.92 : 0.05,
      roughness: metalKeys.has(key) ? (key === 'iron' || key === 'ironDark' ? 0.48 : 0.28) : 0.82
    });
    standardCache.set(mat, std);
    return std;
  }

  // 飞艇 fade 系统在构建后把子树材质全部 clone（做透明淡入淡出），
  // 引用比较 ===C.MAT.warm 永远不命中；且 MAT.warm.color 会被运行时改色。
  // 按构建原色 0xffc46a + MeshBasic 类型识别克隆的舷窗材质（合并舷窗列/
  // 尾灯/探照灯透镜共 3 个 mesh），换成命名 PBR。
  const portStd = new THREE.MeshStandardMaterial({ name: 'shipPorthole', color: 0xffc46a, roughness: 0.45, metalness: 0.05 });
  let portHits = 0;
  scene.traverse(o => {
    if (!o.isMesh || !o.material || !o.material.isMeshBasicMaterial) return;
    const c = o.material.color;
    if (Math.abs(c.r - 1.0) < 0.03 && Math.abs(c.g - 0.769) < 0.04 && Math.abs(c.b - 0.416) < 0.04) {
      o.material = portStd;
      portHits++;
    }
  });
  console.log('[export] porthole meshes replaced:', portHits);

  const hidden = [];
  const keep = [];
  scene.traverse(o => {
    if (o === C.scene || o === C.scene.children.find(c => c.type === 'Group')) {}
    if (o.isLight || o.isSprite || o.isPoints || o.isLine) {
      if (o.visible) { o.visible = false; hidden.push(o); }
      return;
    }
    if (!o.isMesh) return;
    const mat = o.material;
    if (!mat) return;
    if (mat.isShaderMaterial) {
      if (o.visible) { o.visible = false; hidden.push(o); }
      return;
    }
    if (o.name === 'shipShadow' || o.userData?.isWater) {
      if (o.visible) { o.visible = false; hidden.push(o); }
      return;
    }
    if (mat.isMeshToonMaterial) {
      o.material = pbr(mat);
    } else {
      const key = matKey.get(mat) || mat.name;
      if (key) o.material.name = key;
    }
    keep.push(o);
  });

  // The export sink needs a stable snapshot; onlyVisible keeps the diorama + airship.
  const exporter = new THREE.GLTFExporter();
  const glb = await new Promise(resolve => {
    exporter.parse(scene, resolve, { binary: true, onlyVisible: true, truncateDrawRange: false, embedImages: true });
  });
  const res = await fetch('/__upload/scene.glb', { method: 'POST', body: glb });
  return {
    meshes: keep.length,
    hidden: hidden.length,
    bytes: glb.byteLength ?? glb.size ?? 0,
    upload: res.status,
    stats: C.stats(),
    time: C.getTime(),
    shipPos: C.ship.root.position.toArray()
  };
});
console.log(JSON.stringify(result, null, 2));
await page.screenshot({ path: 'renders/ref_morning.png' });
await browser.close();
