// 机位试拍台：一次渲染多个候选构图
import { openScene } from './director.mjs';
import fs from 'node:fs';

const W = 960, H = 402;
const OUT = new URL('./try/', import.meta.url).pathname;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// 每个候选：时刻、天气、机位、目标、焦距、对焦、光圈
const TRY = JSON.parse(fs.readFileSync(new URL('./try_list.json', import.meta.url), 'utf8'));

const { browser, page } = await openScene({ width: W, height: H, ss: 1.25, post: true });

let lastKey = '';
for (const c of TRY) {
  const key = `${c.tod}|${c.rain}`;
  if (key !== lastKey) {
    await page.evaluate(({ tod, rain }) => {
      const C = window.CRANEWICK;
      C.stage.tod = tod; C.stage.rain = rain;
      for (let i = 0; i < 140; i++) updateStage(1 / 6);
    }, c);
    lastKey = key;
  }
  await page.evaluate(({ t }) => {
    const F = window.__film;
    F.seek(Math.max(0, t - 0.5));
    for (let i = 0; i < 12; i++) F.step(Math.max(0, t - 0.5) + i / 24, 1 / 24, 1 / 24);
  }, c);
  const pose = { pos: c.pos, tgt: c.tgt, fov: c.fov, roll: 0 };
  await page.evaluate(({ pose, focus, aperture, grade }) => {
    const F = window.__film;
    F.setLook({ focus, aperture });
    if (grade) F.setLook(grade);
    F.render(pose, { t: 1 });
  }, { pose, focus: c.focus, aperture: c.aperture ?? 0.55, grade: c.grade || null });
  await page.screenshot({ path: `${OUT}${c.id}.png` });
  console.log('try', c.id, c.t ?? '');
}
await browser.close();
