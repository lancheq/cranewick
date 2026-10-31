// 渲染入口：node film/render.mjs --w 960 --h 402 --ss 1 --out film/out/previs.mp4
import { openScene, renderFrames } from './director.mjs';
import { SHOTS, FPS } from './shotlist.mjs';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const W = +arg('w', 1920), H = +arg('h', 804);
const SS = +arg('ss', 1.5);
const OUT = arg('out', 'film/out/film.mp4');
const QUALITY = +arg('q', 95);
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const total = SHOTS.reduce((a, s) => a + Math.round(s.dur * FPS), 0);
console.log(`[render] ${W}x${H} ss=${SS} shots=${SHOTS.length} frames=${total}`);

const t0 = Date.now();
const { browser, page } = await openScene({ width: W, height: H, ss: SS, post: true });
await renderFrames({
  page, shots: SHOTS, width: W, height: H, outFile: OUT, quality: QUALITY,
  onProgress: (i, n, id) => {
    const el = (Date.now() - t0) / 1000;
    const eta = el / i * (n - i);
    process.stdout.write(`\r[${id}] ${i}/${n}  ${(i / el).toFixed(1)} fps  eta ${eta.toFixed(0)}s   `);
  },
});
await browser.close();
console.log(`\n[done] ${OUT}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
