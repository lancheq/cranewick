/**
 * stage.js — CRANEWICK 舞台（光照 / 雾 / 天空 / 后处理 / 相机）
 * 对应 docs/ART_BIBLE.md 第八章。
 *
 * 【铁律三】单体预览页与最终场景必须使用同一个 createStage()，
 * 保证「预览所见 = 最终所得」。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { C, X, TONE } from './palette.js';

// ---------------------------------------------------------------------------
// 天空（内翻球 + 三段渐变，不用 HDRI）
// ---------------------------------------------------------------------------
function makeSky() {
  const geo = new THREE.SphereGeometry(4000, 32, 24);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: C.skyZenith.clone() },
      uHi: { value: C.skyDuskHi.clone() },
      uLo: { value: C.skyDuskLo.clone() },
      uSunDir: { value: new THREE.Vector3(0, 0, 1) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main(){
        vDir = normalize( position );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: `
      uniform vec3 uZenith; uniform vec3 uHi; uniform vec3 uLo; uniform vec3 uSunDir;
      varying vec3 vDir;
      void main(){
        float h = clamp( vDir.y * 0.5 + 0.5, 0.0, 1.0 );
        vec3 col = mix( uLo, uHi, smoothstep( 0.44, 0.56, h ) );
        col = mix( col, uZenith, smoothstep( 0.56, 0.92, h ) );
        // 黄昏地平线增亮（太阳方位）
        float sun = pow( max( dot( normalize( vDir ), normalize( uSunDir ) ), 0.0 ), 4.0 );
        col += uLo * sun * 0.55;
        gl_FragColor = vec4( col, 1.0 );
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.name = 'Sky';
  sky.userData.noMerge = true;
  return sky;
}

// ---------------------------------------------------------------------------
// 统计快照 pass（只记录，不绘制）
// ---------------------------------------------------------------------------
class SnapshotPass extends Pass {
  constructor(target) {
    super();
    this.target = target;
    this.enabled = true;
    this.needsSwap = false;
  }
  render(renderer) {
    const r = renderer.info.render;
    this.target.calls = r.calls;
    this.target.triangles = r.triangles;
    this.target.programs = renderer.info.programs ? renderer.info.programs.length : 0;
  }
}

// ---------------------------------------------------------------------------
// 色彩分级 + 暗角
// ---------------------------------------------------------------------------
const GradeShader = {  uniforms: {
    tDiffuse: { value: null },
    uShadowTint: { value: new THREE.Vector3(0.90, 0.99, 1.10) }, // 暗部偏青
    uHighTint: { value: new THREE.Vector3(1.07, 1.00, 0.90) },   // 高光偏暖
    uVignette: { value: 0.25 },
    uContrast: { value: 1.06 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec3 uShadowTint; uniform vec3 uHighTint;
    uniform float uVignette; uniform float uContrast;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D( tDiffuse, vUv );
      float l = dot( c.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
      c.rgb *= mix( uShadowTint, uHighTint, smoothstep( 0.0, 0.62, l ) );
      c.rgb = ( c.rgb - 0.5 ) * uContrast + 0.5;
      vec2 d = vUv - 0.5;
      float v = 1.0 - uVignette * dot( d, d ) * 2.4;
      c.rgb *= clamp( v, 0.0, 1.0 );
      gl_FragColor = vec4( c.rgb, c.a );
    }`,
};

// ---------------------------------------------------------------------------
// 舞台
// ---------------------------------------------------------------------------
/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} o { fov, near, far, enableShadows, exposure, fogDensity, controls }
 */
export function createStage(canvas, o = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, o.maxPixelRatio ?? 2));
  renderer.setClearColor(C.fog, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // v9.4：改用 NeutralToneMapping。原来 NoToneMapping ⇒ 任何 >1 的亮度被**硬切成纯白**。
  // 黄铜那道窄高光带 + 暖金边缘光 0.46 + 主光 2.18 叠起来必然超过 1，「璀璨」直接糊成一片白。
  // 选 Neutral（Khronos PBR Neutral）而不是 ACES：它只压高光、几乎不动中间调的饱和度，
  // 最贴合本项目「璀璨黄铜」的诉求；ACES 会把黄铜压灰、整体变暗（与之前的"阴郁"反馈冲突）。
  renderer.toneMapping = o.toneMapping ?? THREE.NeutralToneMapping;
  renderer.toneMappingExposure = o.exposure ?? 1.16;   // 压高光后略提曝光，保持暖调亮度
  renderer.shadowMap.enabled = o.enableShadows !== false;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(C.fog.clone(), o.fogDensity ?? TONE.fogDensity);

  const camera = new THREE.PerspectiveCamera(o.fov ?? 42, 1, o.near ?? 0.3, o.far ?? 6000);
  camera.position.set(120, 70, 160);

  // --- 天空 ---
  const sky = makeSky();
  scene.add(sky);

  // --- 光照（ART_BIBLE 8.1）---
  const az = THREE.MathUtils.degToRad(o.sunAzimuth ?? TONE.sunAzimuth);
  const el = THREE.MathUtils.degToRad(o.sunElevation ?? TONE.sunElevation);
  const sunDir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el)
  ).normalize();

  // v8.1：主光增亮偏暖（原来 2.1 太闷）
  const sun = new THREE.DirectionalLight(new THREE.Color('#FFDCA8'), 2.18);
  sun.position.copy(sunDir).multiplyScalar(400);
  sun.castShadow = renderer.shadowMap.enabled;
  const smap = o.shadowMapSize ?? 4096;   // 大平滑曲面（气囊/船体）面积大，2048 会出明显痤疮
  sun.shadow.mapSize.set(smap, smap);
  const sc = o.shadowCamera ?? 260;
  sun.shadow.camera.left = -sc;
  sun.shadow.camera.right = sc;
  sun.shadow.camera.top = sc;
  sun.shadow.camera.bottom = -sc;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 1200;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = o.shadowNormalBias ?? 0.08;
  scene.add(sun);
  scene.add(sun.target);

  // v8.1：半球光的**地面反弹色**由冷灰改为暖赭 —— 金属靠地面反弹光才「活」
  const hemi = new THREE.HemisphereLight(C.skyDuskHi, new THREE.Color('#6E5B42'), 0.62);
  scene.add(hemi);

  // v8.1：轮廓补光由冷蓝改为暖金（与材质的暖金边缘光呼应）
  const rim = new THREE.DirectionalLight(new THREE.Color('#F0C089'), 0.46);
  rim.position.copy(sunDir).multiplyScalar(-350).add(new THREE.Vector3(0, 120, 0));
  scene.add(rim);

  // 点光群（跟随指示灯，由外部注册）
  const pointPool = [];
  for (let i = 0; i < 4; i++) {
    const pl = new THREE.PointLight(C.lampWarm.clone(), 0, 22, 2);
    pl.visible = false;
    scene.add(pl);
    pointPool.push(pl);
  }
  let poolIdx = 0;
  function attachPointLight(parent, offset) {
    const pl = pointPool[poolIdx++ % pointPool.length];
    pl.visible = true;
    pl.intensity = o.pointIntensity ?? 12;
    pl.position.fromArray(offset || [0, 0, 0]);
    parent.add(pl);
    return pl;
  }

  // 天空需要跟随相机，避免出界
  sky.onBeforeRender = () => { sky.position.copy(camera.position); };

  // --- 后处理 ---
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  // 统计快照：紧跟 RenderPass，记录"场景本身"的绘制开销
  // （否则会被后续全屏 pass 的 1 draw call 覆盖）
  const sceneStats = { calls: 0, triangles: 0, programs: 0 };
  composer.addPass(new SnapshotPass(sceneStats));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(1, 1),
    o.bloomStrength ?? TONE.bloomStrength,
    o.bloomRadius ?? TONE.bloomRadius,
    o.bloomThreshold ?? TONE.bloomThreshold
  );
  composer.addPass(bloom);

  const grade = new ShaderPass(GradeShader);
  grade.uniforms.uVignette.value = o.vignette ?? 0.25;
  composer.addPass(grade);

  composer.addPass(new OutputPass());

  // --- 控制器 ---
  let controls = null;
  if (o.controls !== false) {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = o.minDistance ?? 1;
    controls.maxDistance = o.maxDistance ?? 1600;
    controls.target.set(0, o.targetHeight ?? 6, 0);
  }

  // --- 尺寸 ---
  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  // --- 渲染循环 ---
  const timer = new THREE.Timer();
  const listeners = [];
  let running = true;
  let elapsed = 0;
  let fps = 60, frames = 0, acc = 0;

  function onTick(fn) { listeners.push(fn); }

  function loop() {
    if (!running) return;
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    elapsed += dt;
    acc += dt; frames++;
    if (acc > 0.5) { fps = frames / acc; acc = 0; frames = 0; }
    if (controls) controls.update();
    for (const fn of listeners) fn(dt, elapsed);
    composer.render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return {
    renderer, scene, camera, controls, composer, bloom, grade, sun, hemi, rim, sky,
    stats: sceneStats,
    onTick,
    get elapsed() { return elapsed; },
    get fps() { return fps; },
    setTime(t) { elapsed = t; },
    pause() { running = false; },
    resume() { if (!running) { running = true; timer.update(); requestAnimationFrame(loop); } },
    resize,
    attachPointLight,
    dispose() { running = false; ro.disconnect(); renderer.dispose(); },
  };
}

export default { createStage };
