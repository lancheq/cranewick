// 导演层：逐帧驱动原场景 + 电影级后处理 + 相机样条
// 不修改 canal_airship.html，全部在运行时注入
import { chromium } from '../tools/blender/node_modules/playwright-core/index.mjs';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const EXE = `${os.homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

export async function openScene({ width = 1920, height = 804, ss = 1.5, post = true } = {}) {
  const browser = await chromium.launch({
    executablePath: EXE,
    headless: true,
    args: ['--no-proxy-server', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--force-device-scale-factor=1'],
  });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto('http://127.0.0.1:8817/canal_airship.html', { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.CRANEWICK && window.CRANEWICK.ship, null, { timeout: 120000 });
  await page.addStyleTag({ content: '#bar,#load,#err{display:none!important} body{background:#000}' });
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
  await page.waitForTimeout(150);

  await page.evaluate(({ w, h, ssaa, postOn }) => {
    const C = window.CRANEWICK, THREE = window.THREE;
    const renderer = C.renderer, scene = C.scene, camera = C.camera;
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    // ---------- 后处理 ----------
    let rt = null, postScene = null, postCam = null, postMat = null;
    if (postOn) {
      const RW = Math.round(w * ssaa), RH = Math.round(h * ssaa);
      const depth = new THREE.DepthTexture(RW, RH);
      depth.type = THREE.UnsignedIntType;
      rt = new THREE.WebGLRenderTarget(RW, RH, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
        depthBuffer: true, depthTexture: depth, stencilBuffer: false,
      });
      postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      postScene = new THREE.Scene();
      postMat = new THREE.ShaderMaterial({
        depthTest: false, depthWrite: false,
        uniforms: {
          tColor: { value: rt.texture }, tDepth: { value: depth },
          uRes: { value: new THREE.Vector2(w, h) },
          uNear: { value: camera.near }, uFar: { value: camera.far },
          uFocus: { value: 20 }, uAperture: { value: 0.6 }, uMaxBlur: { value: 16 },
          uTime: { value: 0 }, uGrain: { value: 0.026 }, uVignette: { value: 0.42 },
          uSat: { value: 1.06 }, uContrast: { value: 1.06 },
          uLift: { value: new THREE.Vector3(0.004, 0.004, 0.008) },
          uGain: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
          uBloom: { value: 0.22 }, uCA: { value: 0.7 }, uSS: { value: ssaa },
        },
        vertexShader: `
          varying vec2 vUv;
          void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
        `,
        fragmentShader: `
          precision highp float;
          varying vec2 vUv;
          uniform sampler2D tColor, tDepth;
          uniform vec2 uRes;
          uniform float uNear, uFar, uFocus, uAperture, uMaxBlur, uTime;
          uniform float uGrain, uVignette, uSat, uContrast, uBloom, uCA, uSS;
          uniform vec3 uLift, uGain;

          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

          void main(){
            vec2 uv = vUv;
            vec3 col = texture2D(tColor, uv).rgb;

            // 线性深度
            float d = texture2D(tDepth, uv).x;
            float z = (uNear * uFar) / max(uFar - d * (uFar - uNear), 1e-4);

            // 弥散圆
            float coc = clamp(abs(z - uFocus) / max(uFocus, 0.6) * uAperture, 0.0, 1.0);
            coc = pow(coc, 1.3);
            float radius = coc * uMaxBlur * uSS;

            if (radius > 0.6) {
              vec3 acc = col; float wsum = 1.0;
              for (int i = 0; i < 18; i++) {
                float fi = float(i);
                float ang = fi * 2.39996323;
                float rr = sqrt((fi + 0.5) / 18.0) * radius;
                vec2 off = vec2(cos(ang), sin(ang)) * rr / (uRes * uSS);
                vec3 s = texture2D(tColor, uv + off).rgb;
                float lum = dot(s, vec3(0.299, 0.587, 0.114));
                float wgt = 1.0 + 2.2 * smoothstep(0.65, 1.5, lum);
                acc += s * wgt; wsum += wgt;
              }
              col = acc / wsum;
            }

            // 廉价辉光：只取亮部
            vec3 glow = vec3(0.0);
            for (int i = 0; i < 8; i++) {
              float fi = float(i);
              float ang = fi * 0.785398 + 0.3;
              vec2 off = vec2(cos(ang), sin(ang)) * 0.008;
              vec3 s = texture2D(tColor, uv + off).rgb;
              glow += max(s - 0.78, 0.0);
            }
            col += (glow / 8.0) * uBloom;

            // 色差
            float r2 = dot(uv - 0.5, uv - 0.5);
            vec2 ca = (uv - 0.5) * r2 * 0.0022 * uCA;
            col.r = mix(col.r, texture2D(tColor, uv + ca).r, 0.55);
            col.b = mix(col.b, texture2D(tColor, uv - ca).b, 0.55);

            // 调色
            float lum = dot(col, vec3(0.299, 0.587, 0.114));
            col = mix(vec3(lum), col, uSat);
            col = (col - 0.5) * uContrast + 0.5;
            col = col * uGain + uLift;

            // 暗角
            float vig = smoothstep(0.95, 0.28, length(uv - 0.5) * 1.32);
            col *= mix(1.0, vig, uVignette);

            // 胶片颗粒
            float g = hash(uv * uRes + fract(uTime) * 91.7) - 0.5;
            col += g * uGrain;

            // 线性 → sRGB
            col = pow(max(col, 0.0), vec3(1.0 / 2.2));
            col += (hash(uv * uRes + 3.1) - 0.5) / 255.0;
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      });
      const quad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), postMat);
      quad.frustumCulled = false;
      postScene.add(quad);
    }

    window.__film = {
      camera, scene, renderer, rt, postScene, postCam, postMat,
      w, h, ss: ssaa,
      setLook(o) {
        if (!postMat) return;
        const u = postMat.uniforms;
        if (o.focus !== undefined) u.uFocus.value = o.focus;
        if (o.aperture !== undefined) u.uAperture.value = o.aperture;
        if (o.maxBlur !== undefined) u.uMaxBlur.value = o.maxBlur;
        if (o.vignette !== undefined) u.uVignette.value = o.vignette;
        if (o.grain !== undefined) u.uGrain.value = o.grain;
        if (o.sat !== undefined) u.uSat.value = o.sat;
        if (o.contrast !== undefined) u.uContrast.value = o.contrast;
        if (o.bloom !== undefined) u.uBloom.value = o.bloom;
        if (o.ca !== undefined) u.uCA.value = o.ca;
        if (o.exposure !== undefined) C.renderer.toneMappingExposure = o.exposure;
        if (o.lift) u.uLift.value.set(o.lift[0], o.lift[1], o.lift[2]);
        if (o.gain) u.uGain.value.set(o.gain[0], o.gain[1], o.gain[2]);
      },
      render(pose, opts) {
        // pose: { pos, tgt, fov, roll, time }
        const cam = camera;
        cam.fov = pose.fov; cam.updateProjectionMatrix();
        cam.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
        const fwd = new THREE.Vector3(pose.tgt[0] - pose.pos[0], pose.tgt[1] - pose.pos[1], pose.tgt[2] - pose.pos[2]).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        if (pose.roll) {
          const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
          up.applyAxisAngle(fwd, pose.roll);
          // up 需与 fwd 正交
          up.addScaledVector(fwd, -up.dot(fwd)).normalize();
          up.applyAxisAngle(fwd, 0);
          cam.up.copy(up);
        } else {
          cam.up.set(0, 1, 0);
        }
        cam.lookAt(pose.tgt[0], pose.tgt[1], pose.tgt[2]);

        if (rt) {
          if (postMat) postMat.uniforms.uTime.value = opts.t || 0;
          renderer.setRenderTarget(rt);
          renderer.render(scene, cam);
          renderer.setRenderTarget(null);
          renderer.render(postScene, postCam);
        } else {
          renderer.render(scene, cam);
        }
      },
      step(t, dt, dtStage) {
        // 手动推进世界
        wallTime += dt;
        updateStage(dtStage);
        updateWorld(t, dt);
        updateRain(dt, t);
      },
      seek(t) { seekTime(t); },
      stats() { return C.stats(); },
    };
  }, { w: width, h: height, ssaa: ss, postOn: post });

  return { browser, page };
}

// Catmull-Rom 采样（位置与目标各自一条曲线）
function makeCurve(pts) {
  return new THREE_VectorCurve(pts);
}
class THREE_VectorCurve {
  constructor(pts) { this.pts = pts; }
  at(u) {
    const n = this.pts.length;
    if (n === 1) return this.pts[0].slice();
    const x = Math.min(Math.max(u, 0), 1) * (n - 1);
    const i = Math.min(Math.floor(x), n - 2);
    const f = x - i;
    const p0 = this.pts[Math.max(i - 1, 0)], p1 = this.pts[i], p2 = this.pts[i + 1], p3 = this.pts[Math.min(i + 2, n - 1)];
    const t2 = f * f, t3 = t2 * f;
    return [0, 1, 2].map(k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * f + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
  }
}

export function sampleShot(shot, u, tFilm) {
  const posCurve = makeCurve(shot.keys.map(k => k.pos));
  const tgtCurve = makeCurve(shot.keys.map(k => k.tgt));
  // 缓入缓出 + 线性各半，避免首尾"急停"
  const e = 0.45 * u + 0.55 * (u * u * (3 - 2 * u));
  const pos = posCurve.at(e);
  const tgt = tgtCurve.at(e);
  const k0 = shot.keys[0], k1 = shot.keys[shot.keys.length - 1];
  const fov = k0.fov + (k1.fov - k0.fov) * e;

  // 手持微动
  const amp = shot.handheld || 0;
  if (amp > 0) {
    const t = tFilm;
    pos[0] += (Math.sin(t * 0.63 + 1.7) * 0.55 + Math.sin(t * 1.71 + 0.4) * 0.3) * amp;
    pos[1] += (Math.sin(t * 0.81 + 3.1) * 0.5 + Math.sin(t * 1.33 + 2.2) * 0.28) * amp;
    pos[2] += (Math.sin(t * 0.57 + 5.2) * 0.5 + Math.sin(t * 1.19 + 4.7) * 0.3) * amp;
    tgt[0] += Math.sin(t * 0.44 + 2.0) * amp * 0.7;
    tgt[1] += Math.sin(t * 0.38 + 0.9) * amp * 0.6;
  }
  const roll = shot.roll ? shot.roll(u) : 0;
  return { pos, tgt, fov, roll };
}

export async function renderFrames({ page, shots, width, height, outFile, quality = 95, onProgress }) {
  const frames = [];
  for (const shot of shots) {
    const n = Math.max(2, Math.round(shot.dur * 24));
    frames.push({ shot, n });
  }
  const total = frames.reduce((a, b) => a + b.n, 0);
  const ff = spawn('ffmpeg', [
    '-y', '-f', 'image2pipe', '-framerate', '24', '-vcodec', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', outFile,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  ff.stderr.on('data', () => {});
  const done = new Promise(res => ff.on('close', res));

  let idx = 0;
  for (const { shot, n } of frames) {
    // 切镜：重建瞬态并预热
    const s0 = shot.scene[0], s1 = shot.scene[1];
    await page.evaluate(({ s0, tod, rain, focus, aperture, grade }) => {
      const F = window.__film, C = window.CRANEWICK;
      C.stage.tod = tod; C.stage.rain = rain;
      F.seek(Math.max(0, s0 - 0.3));
      const dt = 0.3 / 9;
      for (let i = 0; i < 9; i++) F.step(Math.max(0, s0 - 0.3) + dt * (i + 1), dt, dt);
      const f = focus ? focus[0] : 20;
      F.setLook({ focus: f, aperture: aperture === undefined ? 0.6 : aperture });
      if (grade) F.setLook(grade);
    }, { s0, tod: shot.tod, rain: shot.rain, focus: shot.focus, aperture: shot.aperture, grade: shot.grade || null });

    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const tScene = s0 + (s1 - s0) * u;
      const dtWorld = (s1 - s0) / (n - 1);
      const dtFilm = 1 / 24;
      // 时间/天气过渡：让 updateStage 在 trans 秒内收敛
      const dtStage = shot.trans > 0 ? dtFilm * (4.6 / shot.trans) : dtFilm;
      const pose = sampleShot(shot, u, i * dtFilm);
      let focus = shot.focus ? shot.focus[0] + (shot.focus[1] - shot.focus[0]) * u : 20;
      // 对焦允许跟随主体：以相机到目标距离为基准做轻微修正
      const dist = Math.hypot(pose.tgt[0] - pose.pos[0], pose.tgt[1] - pose.pos[1], pose.tgt[2] - pose.pos[2]);
      focus = focus * 0.65 + dist * 0.35;

      await page.evaluate(({ pose, tScene, dtWorld, dtStage, focus, aperture, tFilm }) => {
        const F = window.__film;
        F.step(tScene, dtWorld, dtStage);
        F.setLook({ focus, aperture });
        F.render(pose, { t: tFilm });
      }, { pose, tScene, dtWorld, dtStage, focus, aperture: shot.aperture, tFilm: i * dtFilm });

      const buf = await page.screenshot({ type: 'jpeg', quality, clip: { x: 0, y: 0, width, height } });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      idx++;
      if (onProgress && idx % 24 === 0) onProgress(idx, total, shot.id);
    }
    console.log(`[shot] ${shot.id} ${shot.title} done (${n}f)`);
  }
  ff.stdin.end();
  await done;
  return total;
}
