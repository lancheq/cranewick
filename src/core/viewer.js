/**
 * viewer.js — 单体预览外壳
 * 阶段 2 每个资产都用同一个外壳出预览页，保证「预览所见 = 最终所得」。
 *
 * 提供：全屏画布 / 三视图与透视切换 / 转台 / 线框 / 描边开关 / 比例人 / 参数面板 /
 *      动画时间轴 / 性能读数 / 交付清单（拍板用）
 */
import * as THREE from 'three';
import { createStage } from './stage.js';
import { STYLE, M } from './materials.js';
import { refHuman, outlineTree } from './primitives.js';

const CSS = `
:root{
  --bg:#10141a; --panel:rgba(18,22,29,.86); --line:rgba(217,178,106,.28);
  --brass:#D9B26A; --brass-dim:#8A6E3C; --ink:#E8E4DC; --ink-dim:#9AA3AD;
  --ok:#4E9A6A; --warn:#E2913C;
}
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;background:var(--bg);
  font:13px/1.55 "SF Mono",Menlo,Consolas,"PingFang SC",monospace;color:var(--ink)}
#cv{display:block;width:100vw;height:100vh}
.pane{position:fixed;background:var(--panel);border:1px solid var(--line);
  border-radius:8px;backdrop-filter:blur(10px);padding:12px 14px}
#head{top:14px;left:14px;max-width:340px}
#head h1{margin:0 0 2px;font-size:15px;letter-spacing:.06em;color:var(--brass);font-weight:600}
#head .sub{color:var(--ink-dim);font-size:11px;margin-bottom:8px;letter-spacing:.04em}
#head .band{height:3px;border-radius:2px;margin:8px 0 10px;
  background:linear-gradient(90deg,var(--brass) 0%,#B0803C 28%,#4E7A6B 52%,#2E3138 74%,#A8B4B8 100%)}
#specs{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:11.5px}
#specs b{color:var(--ink-dim);font-weight:400}
#specs span{color:var(--ink);text-align:right}
#ctrl{top:14px;right:14px;width:214px}
#ctrl h2{margin:0 0 8px;font-size:11px;color:var(--brass);letter-spacing:.12em;
  text-transform:uppercase;font-weight:600}
.row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
button{flex:1;min-width:0;padding:6px 8px;font:inherit;font-size:11px;cursor:pointer;
  background:rgba(217,178,106,.07);color:var(--ink);border:1px solid var(--line);
  border-radius:5px;transition:.14s}
button:hover{background:rgba(217,178,106,.18)}
button.on{background:var(--brass);color:#14181e;border-color:var(--brass);font-weight:600}
label.tg{display:flex;align-items:center;justify-content:space-between;
  padding:5px 0;font-size:11.5px;cursor:pointer;color:var(--ink-dim)}
label.tg input{accent-color:var(--brass);cursor:pointer}
#foot{bottom:14px;left:14px;right:14px;display:flex;gap:14px;align-items:center}
#foot .pane{position:static}
#stat{display:flex;gap:16px;font-size:11px;min-width:230px}
#stat i{font-style:normal;color:var(--ink-dim)}
#stat b{color:var(--brass);font-weight:600}
#tl{flex:1;display:flex;gap:10px;align-items:center}
#tl input[type=range]{flex:1;accent-color:var(--brass);height:18px}
#tl .t{font-size:11px;color:var(--ink-dim);min-width:74px;text-align:right}
#check{bottom:14px;right:14px;width:270px;max-height:42vh;overflow:auto}
#check h2{margin:0 0 8px;font-size:11px;color:var(--brass);letter-spacing:.12em;
  text-transform:uppercase;font-weight:600}
#check ul{margin:0;padding:0;list-style:none;font-size:11.5px}
#check li{padding:4px 0 4px 18px;position:relative;color:var(--ink-dim);border-bottom:1px dashed rgba(255,255,255,.06)}
#check li:before{content:"○";position:absolute;left:0;color:var(--brass-dim)}
#check li.key{color:var(--ink)}
#check li.key:before{content:"◆";color:var(--warn)}
#hint{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);font-size:11px;
  color:var(--ink-dim);pointer-events:none;opacity:.7}
`;

function injectCSS() {
  if (document.getElementById('cw-style')) return;
  const s = document.createElement('style');
  s.id = 'cw-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/**
 * @param {object} cfg
 * @param {string} cfg.title
 * @param {string} cfg.subtitle
 * @param {[string,string][]} cfg.specs       尺寸表 [标签, 值]
 * @param {string[]} cfg.checklist            拍板清单
 * @param {(ctx:any)=>THREE.Object3D} cfg.build
 * @param {{duration:number, labels:string[], tick:(t:number, ctx:any)=>void}} [cfg.animation]
 * @param {object} [cfg.camera]  {pos, target, fov}
 * @param {object} [cfg.options] {pedestal, human, humanPos, outline, ground}
 */
export function createViewer(cfg) {
  injectCSS();

  const canvas = document.createElement('canvas');
  canvas.id = 'cv';
  document.body.appendChild(canvas);

  // stageOpts 可透传太阳高度/方位等舞台参数：单体拍板需要**受光面**才看得清造型
  const stage = createStage(canvas, {
    ...(cfg.options?.stageOpts || {}),
    fov: cfg.camera?.fov ?? 40,
    shadowCamera: cfg.camera?.shadowCamera ?? 180,
    enableShadows: cfg.options?.shadows !== false,
  });

  if (cfg.camera?.pos) stage.camera.position.fromArray(cfg.camera.pos);
  if (cfg.camera?.target && stage.controls) {
    stage.controls.target.fromArray(cfg.camera.target);
    stage.controls.update();
  }
  const cameraOverride = !!(cfg.camera?.pos || cfg.camera?.target);

  // --- 底座 ---
  const extras = new THREE.Group();
  extras.name = 'PreviewExtras';
  stage.scene.add(extras);

  if (cfg.options?.pedestal !== false) {
    const R = cfg.options?.pedestalRadius ?? 90;
    const ped = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R * 1.02, 2.2, 64),
      M.stone({ bands: [0.24, 0.5, 0.86] })
    );
    ped.position.y = -1.1;
    ped.receiveShadow = true;
    ped.name = 'Pedestal';
    extras.add(ped);
    const ringMat = M.brass({ bands: [0.3, 0.6, 1.0] });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.985, 0.28, 6, 96), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    extras.add(ring);
    // 刻度
    for (let a = 0; a < 360; a += 15) {
      const long = a % 90 === 0;
      const tick = new THREE.Mesh(
        new THREE.BoxGeometry(long ? 4 : 2, 0.06, 0.16),
        ringMat
      );
      const rad = THREE.MathUtils.degToRad(a);
      tick.position.set(Math.cos(rad) * R * 0.9, 0.06, Math.sin(rad) * R * 0.9);
      tick.rotation.y = -rad;
      extras.add(tick);
    }
  }

  // --- 比例人 ---
  let human = null;
  if (cfg.options?.human !== false) {
    human = refHuman(1.75);
    human.position.fromArray(cfg.options?.humanPos ?? [0, 0, 0]);
    human.visible = true;
    extras.add(human);
  }

  // --- 资产 ---
  const asset = cfg.build({ stage, THREE, extras });
  asset.name = cfg.title;
  stage.scene.add(asset);

  // --- 描边 ---
  const outlined = cfg.options?.outline === false ? 0 : outlineTree(asset);

  // --- 自动包围盒 → 适配相机 ---
  const bbox = new THREE.Box3().setFromObject(asset);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bbox.getSize(size);
  bbox.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z);

  const views = {
    透视: {
      pos: [center.x + maxDim * 1.05, center.y + maxDim * 0.42, center.z + maxDim * 1.35],
      tgt: [center.x, center.y, center.z],
    },
    正面: { pos: [center.x, center.y + maxDim * 0.06, center.z + maxDim * 1.85], tgt: [center.x, center.y, center.z] },
    侧面: { pos: [center.x + maxDim * 1.85, center.y + maxDim * 0.06, center.z], tgt: [center.x, center.y, center.z] },
    俯视: { pos: [center.x + 0.01, center.y + maxDim * 1.85, center.z + 0.01], tgt: [center.x, center.y, center.z] },
    仰视: { pos: [center.x + maxDim * 0.5, center.y - maxDim * 0.55, center.z + maxDim * 1.1], tgt: [center.x, center.y, center.z] },
  };

  function applyView(name) {
    const v = views[name];
    if (!v) return;
    stage.camera.position.fromArray(v.pos);
    if (stage.controls) {
      stage.controls.target.fromArray(v.tgt);
      stage.controls.update();
    }
  }
  // 显式指定的相机优先作为「透视」预设（用于需要框住动画行程的场景）
  if (cameraOverride) {
    if (cfg.camera.pos) views['透视'].pos = cfg.camera.pos;
    if (cfg.camera.target) views['透视'].tgt = cfg.camera.target;
  }
  applyView('透视');

  // --- 光照标定（按包围盒调整阴影相机与主光对准）---
  stage.sun.target.position.copy(center);
  stage.sun.target.updateMatrixWorld();
  const sc = Math.max(maxDim * 0.95, 60);
  const cam = stage.sun.shadow.camera;
  cam.left = -sc; cam.right = sc; cam.top = sc; cam.bottom = -sc;
  cam.updateProjectionMatrix();

  // =========================================================================
  // UI
  // =========================================================================
  const head = document.createElement('div');
  head.className = 'pane';
  head.id = 'head';
  head.innerHTML = `
    <h1>${cfg.title}</h1>
    <div class="sub">${cfg.subtitle || 'CRANEWICK · 蒸汽朋克英伦城'}</div>
    <div class="band"></div>
    <div id="specs">${(cfg.specs || []).map(([k, v]) => `<b>${k}</b><span>${v}</span>`).join('')}</div>`;
  document.body.appendChild(head);

  const ctrl = document.createElement('div');
  ctrl.className = 'pane';
  ctrl.id = 'ctrl';
  ctrl.innerHTML = `
    <h2>视角</h2>
    <div class="row" id="views">${Object.keys(views).map((n, i) => `<button data-v="${n}"${i === 0 ? ' class="on"' : ''}>${n}</button>`).join('')}</div>
    <h2>显示</h2>
    <label class="tg">转台自动旋转<input type="checkbox" id="tt"></label>
    <label class="tg">反向外壳描边<input type="checkbox" id="ol"${outlined ? ' checked' : ''}></label>
    <label class="tg">线框<input type="checkbox" id="wf"></label>
    <label class="tg">比例人 1.75m<input type="checkbox" id="hm"${human ? ' checked' : ''}></label>
    <label class="tg">底座<input type="checkbox" id="pd" checked></label>
    <label class="tg">阴影<input type="checkbox" id="sh" checked></label>
    <h2 style="margin-top:10px">风格标定</h2>
    <div class="row" style="align-items:center;gap:8px">
      <span style="font-size:10.5px;color:var(--ink-dim);width:52px">边缘光</span>
      <input type="range" id="rim" min="0" max="1.4" step="0.02" value="${STYLE.rimStrength}" style="flex:1;accent-color:var(--brass)">
    </div>
    <div class="row" style="align-items:center;gap:8px">
      <span style="font-size:10.5px;color:var(--ink-dim);width:52px">描边</span>
      <input type="range" id="ow" min="0" max="0.04" step="0.002" value="${STYLE.outlineWidth}" style="flex:1;accent-color:var(--brass)">
    </div>
    <div class="row" style="align-items:center;gap:8px">
      <span style="font-size:10.5px;color:var(--ink-dim);width:52px">泛光</span>
      <input type="range" id="bl" min="0" max="1.6" step="0.05" value="${stage.bloom.strength}" style="flex:1;accent-color:var(--brass)">
    </div>
    <div class="row" style="align-items:center;gap:8px">
      <span style="font-size:10.5px;color:var(--ink-dim);width:52px">雾</span>
      <input type="range" id="fg" min="0" max="0.006" step="0.0002" value="${stage.scene.fog.density}" style="flex:1;accent-color:var(--brass)">
    </div>`;
  document.body.appendChild(ctrl);

  ctrl.querySelectorAll('#views button').forEach((b) => {
    b.onclick = () => {
      ctrl.querySelectorAll('#views button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      applyView(b.dataset.v);
    };
  });

  let turntable = false;
  let turntableSpeed = 0.12;
  const originalBuild = cfg.build;

  ctrl.querySelector('#tt').onchange = (e) => { turntable = e.target.checked; };
  ctrl.querySelector('#ol').onchange = (e) => {
    STYLE.outlineEnabled = e.target.checked;
    asset.traverse((o) => {
      if (o.name.endsWith('_outline')) o.visible = e.target.checked;
    });
  };
  ctrl.querySelector('#wf').onchange = (e) => {
    asset.traverse((o) => { if (o.isMesh && o.material) o.material.wireframe = e.target.checked; });
  };
  ctrl.querySelector('#hm').onchange = (e) => { if (human) human.visible = e.target.checked; };
  ctrl.querySelector('#pd').onchange = (e) => {
    extras.children.forEach((c) => { if (c.name === 'Pedestal' || c.type === 'Mesh' && c.geometry.type === 'TorusGeometry') c.visible = e.target.checked; });
    extras.traverse((c) => { if (c.parent === extras && c !== human) c.visible = e.target.checked; });
  };
  ctrl.querySelector('#sh').onchange = (e) => {
    stage.renderer.shadowMap.enabled = e.target.checked;
    stage.sun.castShadow = e.target.checked;
    stage.scene.traverse((o) => { if (o.isMesh) o.material.needsUpdate = true; });
  };
  ctrl.querySelector('#rim').oninput = (e) => { STYLE.rimStrength = parseFloat(e.target.value); };
  ctrl.querySelector('#ow').oninput = (e) => {
    STYLE.outlineWidth = parseFloat(e.target.value);
    asset.traverse((o) => {
      if (o.name.endsWith('_outline')) o.material.uniforms.uWidth.value = STYLE.outlineWidth;
    });
  };
  ctrl.querySelector('#bl').oninput = (e) => { stage.bloom.strength = parseFloat(e.target.value); };
  ctrl.querySelector('#fg').oninput = (e) => { stage.scene.fog.density = parseFloat(e.target.value); };

  // 拍板清单
  const check = document.createElement('div');
  check.className = 'pane';
  check.id = 'check';
  check.innerHTML = `<h2>待拍板</h2><ul>${(cfg.checklist || []).map((t) => `<li class="key">${t}</li>`).join('')}</ul>`;
  document.body.appendChild(check);

  // 底栏
  const foot = document.createElement('div');
  foot.id = 'foot';
  foot.style.cssText = 'position:fixed;bottom:14px;left:14px;display:flex;gap:12px;align-items:flex-end;z-index:5';
  foot.innerHTML = `
    <div class="pane" id="stat">
      <span><i>FPS</i> <b id="fps">–</b></span>
      <span><i>DRAW</i> <b id="draw">–</b></span>
      <span><i>TRI</i> <b id="tri">–</b></span>
    </div>`;
  document.body.appendChild(foot);

  let tl = null;
  if (cfg.animation) {
    const tlBox = document.createElement('div');
    tlBox.className = 'pane';
    tlBox.id = 'tl';
    tlBox.style.cssText = 'position:fixed;bottom:14px;left:340px;right:14px;z-index:5;display:flex;gap:10px;align-items:center';
    tlBox.innerHTML = `
      <button id="play" style="flex:0 0 74px">▶ 播放</button>
      <input type="range" id="scrub" min="0" max="${cfg.animation.duration}" step="0.01" value="0">
      <span class="t" id="tlabel">0.00 / ${cfg.animation.duration.toFixed(2)}s</span>`;
    document.body.appendChild(tlBox);

    const scrub = tlBox.querySelector('#scrub');
    const tlabel = tlBox.querySelector('#tlabel');
    const playBtn = tlBox.querySelector('#play');
    let playing = false;
    let t = 0;

    playBtn.onclick = () => {
      playing = !playing;
      playBtn.textContent = playing ? '❚❚ 暂停' : '▶ 播放';
      playBtn.classList.toggle('on', playing);
    };
    scrub.oninput = () => { t = parseFloat(scrub.value); cfg.animation.tick(t, { stage, asset, THREE }); tlabel.textContent = `${t.toFixed(2)} / ${cfg.animation.duration.toFixed(2)}s`; };

    if (cfg.animation.labels) {
      const marks = document.createElement('div');
      marks.style.cssText = 'position:fixed;bottom:52px;left:430px;right:14px;display:flex;font-size:10px;color:var(--ink-dim);pointer-events:none;z-index:4';
      cfg.animation.labels.forEach((lb, i) => {
        const d = document.createElement('div');
        d.style.cssText = `flex:1;border-left:1px solid rgba(217,178,106,.25);padding-left:5px;${i ? '' : ''}`;
        d.textContent = lb;
        marks.appendChild(d);
      });
      document.body.appendChild(marks);
    }

    tl = {
      tick(dt) {
        if (!playing) return;
        t += dt;
        if (t > cfg.animation.duration) t = 0;
        scrub.value = t;
        tlabel.textContent = `${t.toFixed(2)} / ${cfg.animation.duration.toFixed(2)}s`;
        cfg.animation.tick(t, { stage, asset, THREE });
      },
      get t() { return t; },
      set(tv) { t = tv; scrub.value = tv; cfg.animation.tick(tv, { stage, asset, THREE }); },
    };
    cfg.animation.tick(0, { stage, asset, THREE });
  }

  const hint = document.createElement('div');
  hint.id = 'hint';
  hint.textContent = '拖拽旋转 · 滚轮缩放 · 右键平移';
  document.body.appendChild(hint);

  // 主循环钩子
  stage.onTick((dt) => {
    if (turntable) asset.rotation.y += dt * turntableSpeed;
    if (tl) tl.tick(dt);
    const f = document.getElementById('fps');
    if (f) {
      f.textContent = stage.fps.toFixed(0);
      document.getElementById('draw').textContent = stage.stats.calls;
      document.getElementById('tri').textContent = (stage.stats.triangles / 1000).toFixed(0) + 'k';
    }
  });

  return {
    stage, asset, extras, human, applyView, views, bbox, size, center, maxDim,
    /** 动画配置（供 __trace 之类的核验工具重跑时间轴） */
    __anim: cfg.animation || null,
    get turntable() { return turntable; },
  };
}

export default { createViewer };
