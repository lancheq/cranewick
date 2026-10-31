// 静帧检查：每镜中位帧（世界时间推进到该镜中点）+ 后处理
import { openScene, sampleShot } from './director.mjs';
import { SHOTS } from './shotlist.mjs';
import fs from 'node:fs';

const W = 1280, H = 536;
const OUT = new URL('./stills/', import.meta.url).pathname;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const { browser, page } = await openScene({ width: W, height: H, ss: 1.5, post: true });

const only = process.argv[2];
for (const shot of SHOTS.filter(s => !only || s.id === only)) {
  const u = 0.5;
  const tMid = shot.scene[0] + (shot.scene[1] - shot.scene[0]) * u;

  await page.evaluate(({ tod, rain, s0, tMid }) => {
    const F = window.__film, C = window.CRANEWICK;
    C.stage.tod = tod; C.stage.rain = rain;
    for (let i = 0; i < 140; i++) updateStage(1 / 6);   // 光照完全收敛
    F.seek(Math.max(0, s0 - 0.4));
    const n = Math.max(1, Math.round((tMid - Math.max(0, s0 - 0.4)) * 24));
    for (let i = 0; i < n; i++) F.step(Math.max(0, s0 - 0.4) + i / 24, 1 / 24, 1 / 24);
  }, { tod: shot.tod, rain: shot.rain, s0: shot.scene[0], tMid });

  const pose = sampleShot(shot, u, shot.dur * u);
  const dist = Math.hypot(pose.tgt[0] - pose.pos[0], pose.tgt[1] - pose.pos[1], pose.tgt[2] - pose.pos[2]);
  const focus = (shot.focus[0] + (shot.focus[1] - shot.focus[0]) * u) * 0.65 + dist * 0.35;
  await page.evaluate(({ pose, focus, aperture }) => {
    const F = window.__film;
    F.setLook({ focus, aperture });
    F.render(pose, { t: 1.0 });
  }, { pose, focus, aperture: shot.aperture });
  await page.screenshot({ path: `${OUT}${shot.id}_mid.png` });
  console.log('still', shot.id, 't=', tMid.toFixed(1), 'focus', focus.toFixed(1), 'dist', dist.toFixed(1));
}
await browser.close();
