/**
 * textures.js — 程序化墙面/铺装贴图库（共享）
 *
 * 为什么必须程序化：项目约束"零外部资源、离线可跑"，且需要**多种砖墙变体**
 * 而不是纯色块（纯色块会让整条街读成"上色模型"而不是"有材料的建筑"）。
 *
 * 【关键约定】needsMap=false 时才可以用 color 上色；一旦 setMap，
 * 材质 color 必须为白 —— `color × map` 是相乘关系，颜色写两遍会二次压黑（见 DECISIONS B-06）。
 *
 * 全部贴图：sRGB 色彩空间 + RepeatWrapping + 各向异性 8。
 */
import * as THREE from 'three';

/**
 * 两级缓存（v9.4 修）：
 *   canvasCache —— 按**贴图名**缓存画布（同一张图不重复绘制）
 *   cache       —— 按**贴图名 + repeat** 缓存 Texture 对象
 *
 * 为什么必须带上 repeat：原来只按名字缓存，第二次用不同 repeat 调用会**静默返回同一个
 * Texture 实例**（第一个 repeat 生效）。症状是"两种材质看起来完全一样"——
 * 本轮的"码头河堤与街道路面没区别"就是这个 bug（河堤步道 [2.6,22] 与街道路面 [2.4,22]
 * 实际共用了一个 Texture，repeat 停在 2.4/22）。
 */
const canvasCache = new Map();
const cache = new Map();

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { canvas: c, ctx: c.getContext('2d'), w, h };
}
function finish(key, canvas, repeat) {
  canvasCache.set(key, canvas);                        // 画布按名字复用
  const tk = key + '|' + repeat[0] + 'x' + repeat[1];  // Texture 按 名字+repeat 缓存
  const hit = cache.get(tk);
  if (hit) return hit;
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  cache.set(tk, t);
  return t;
}
/** 若同一张画布已画过，直接按新 repeat 生成/取回 Texture（不再重绘） */
function reuse(key, repeat) {
  const cv = canvasCache.get(key);
  return cv ? finish(key, cv, repeat) : null;
}
const rnd = (a, b, s) => a + (b - a) * (0.5 + 0.5 * Math.sin(s * 12.9898) * Math.cos(s * 4.1414));

/** 通用砖墙：按 palette 里的一组近似色逐块取色，再叠灰缝 / 颗粒 / 缺角 / 熏黑 */
function brickBase(ctx, w, h, o) {
  const { palette, mortar, rows, cols, outlier, soot, weather } = o;
  const mv = () => mortar[Math.floor(Math.random() * mortar.length)];
  ctx.fillStyle = mortar[0];
  ctx.fillRect(0, 0, w, h);
  const bw = w / cols, bh = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ox = (r % 2) * bw * 0.5;
      const x = c * bw + ox - bw, y = r * bh;
      // 确定性伪随机（同一张贴图每次构建完全一致）
      const s = r * 91.17 + c * 47.31;
      const pick = Math.abs(Math.sin(s * 12.9898) * 43758.5453) % 1;
      const pure = Math.abs(Math.sin(s * 78.233) * 12345.6789) % 1;
      let col;
      if (pure < (outlier ?? 0.09)) {
        // 少量"过火砖/浅砖"——真实砖墙一定有 10% 左右的异色砖
        col = pure < (outlier ?? 0.09) * 0.45 ? palette.burnt : palette.light;
      } else {
        col = palette.main[Math.floor(pick * palette.main.length)];
      }
      ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      ctx.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
      // 砖面颗粒（很轻，避免读成噪点）
      ctx.fillStyle = 'rgba(0,0,0,0.045)';
      for (let k = 0; k < 3; k++) {
        const gx = x + 3 + (Math.abs(Math.sin(s + k * 7) * 999) % 1) * (bw - 8);
        const gy = y + 3 + (Math.abs(Math.sin(s + k * 13) * 777) % 1) * (bh - 8);
        ctx.fillRect(gx, gy, 1 + (k % 2), 1);
      }
      // 缺角
      if ((r * 7 + c * 3) % 9 === 0) {
        ctx.fillStyle = mv();
        ctx.fillRect(x + bw - 6, y + bh - 6, 5, 4);
      }
    }
  }
  // 灰缝深浅不一（叠一层极淡的横向灰带）
  for (let r = 0; r <= rows; r++) {
    ctx.fillStyle = `rgba(60,56,50,${0.05 + (r % 3) * 0.02})`;
    ctx.fillRect(0, r * bh - 1, w, 2);
  }
  // 潮气白霜（工业感）
  if (weather) {
    ctx.fillStyle = 'rgba(212,206,196,0.085)';
    for (let i = 0; i < 36; i++) {
      const s = i * 3.7;
      const rx = (Math.abs(Math.sin(s) * 9999) % 1) * w;
      const ry = (Math.abs(Math.cos(s * 1.7) * 9999) % 1) * h * 0.7;
      ctx.fillRect(rx, ry, 4 + (i % 5) * 5, 2 + (i % 3));
    }
  }
  // 熏黑（顶部积灰，工厂区常用）
  if (soot) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `rgba(20,18,16,${soot})`);
    g.addColorStop(0.55, `rgba(20,18,16,${soot * 0.32})`);
    g.addColorStop(1, 'rgba(20,18,16,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

// —— 四组砖色：每组 6–8 个近似色 + 过火砖 + 浅砖（全部去饱和一档）——
const BRICK_SETS = {
  red: {
    main: [[150, 104, 90], [138, 95, 83], [160, 116, 100], [127, 88, 78], [168, 124, 108], [118, 82, 74], [146, 100, 86]],
    burnt: [96, 66, 58], light: [176, 140, 124],
  },
  buff: {
    main: [[176, 146, 114], [164, 134, 104], [188, 158, 126], [152, 124, 96], [194, 166, 134], [142, 114, 90], [170, 140, 110]],
    burnt: [122, 98, 78], light: [204, 178, 148],
  },
  sooty: {
    main: [[112, 88, 76], [100, 78, 68], [124, 98, 86], [88, 70, 62], [132, 106, 92], [78, 62, 56]],
    burnt: [60, 50, 46], light: [148, 124, 108],
  },
  blue: {
    main: [[112, 116, 124], [102, 106, 116], [124, 128, 136], [92, 98, 108], [134, 138, 146], [86, 92, 102]],
    burnt: [70, 74, 82], light: [150, 154, 162],
  },
};

/** ① 红砖（最常见） */
export function brickRed(repeat = [3, 3]) {
  { const r = reuse('brickRed', repeat); if (r) return r; }
  const { canvas, ctx, w, h } = mkCanvas(512, 512);
  brickBase(ctx, w, h, { palette: BRICK_SETS.red, mortar: [124, 118, 108, 132, 126, 116], rows: 24, cols: 8, weather: true });
  return finish('brickRed', canvas, repeat);
}
/** ② 黄褐砖（更浅更暖，居民区用） */
export function brickBuff(repeat = [3, 3]) {
  { const r = reuse('brickBuff', repeat); if (r) return r; }
  const { canvas, ctx, w, h } = mkCanvas(512, 512);
  brickBase(ctx, w, h, { palette: BRICK_SETS.buff, mortar: [138, 130, 118, 146, 138, 126], rows: 24, cols: 8, weather: true });
  return finish('brickBuff', canvas, repeat);
}
/** ③ 熏黑砖（厂房/仓库，顶部积灰） */
export function brickSooty(repeat = [3, 3]) {
  { const r = reuse('brickSooty', repeat); if (r) return r; }
  const { canvas, ctx, w, h } = mkCanvas(512, 512);
  brickBase(ctx, w, h, { palette: BRICK_SETS.sooty, mortar: [76, 70, 64, 84, 78, 72], rows: 24, cols: 8, soot: 0.4 });
  return finish('brickSooty', canvas, repeat);
}
/** ④ 蓝灰工程砖（堤岸/桥墩用） */
export function brickBlue(repeat = [3, 3]) {
  { const r = reuse('brickBlue', repeat); if (r) return r; }
  const { canvas, ctx, w, h } = mkCanvas(512, 512);
  brickBase(ctx, w, h, { palette: BRICK_SETS.blue, mortar: [92, 94, 98, 100, 102, 106], rows: 20, cols: 6, weather: true });
  return finish('brickBlue', canvas, repeat);
}

/** ⑤ 大块方石（石基/堤岸/广场） */
export function stoneBlock(repeat = [2, 2]) {
  { const r = reuse('stoneBlock', repeat); if (r) return r; }
  const { canvas, ctx, w, h } = mkCanvas(512, 512);
  ctx.fillStyle = '#4E4A44';
  ctx.fillRect(0, 0, w, h);
  const rows = 5, cols = 3, cw = w / cols, ch = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ox = (r % 2) * cw * 0.34;
      const x = c * cw + ox - cw, y = r * ch;
      const s = r * 31.7 + c * 11.3;
      const v = 1 + rnd(-0.12, 0.12, s);
      const g = 128 * v;
      ctx.fillStyle = `rgb(${g | 0},${(g * 0.97) | 0},${(g * 0.9) | 0})`;
      ctx.fillRect(x + 3, y + 3, cw - 6, ch - 6);
      // 錾痕
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      for (let k = 0; k < 5; k++) {
        const yy = y + 8 + k * ((ch - 16) / 5);
        ctx.beginPath(); ctx.moveTo(x + 6, yy); ctx.lineTo(x + cw - 8, yy + 2); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(24,22,20,0.55)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 3, y + 3, cw - 6, ch - 6);
    }
  }
  return finish('stoneBlock', canvas, repeat);
}
/** ⑥ 抹灰墙（带剥落，居民楼背街面） */
export function plaster(repeat = [3, 3]) {
  { const r = reuse('plaster', repeat); if (r) return r; }
  const { canvas, ctx, w, h } = mkCanvas(512, 512);
  ctx.fillStyle = '#B8AC94';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 220; i++) {
    const s = i * 2.13;
    ctx.fillStyle = `rgba(${rnd(150, 190, s) | 0},${rnd(140, 178, s + 1) | 0},${rnd(118, 150, s + 2) | 0},0.5)`;
    ctx.fillRect(rnd(0, w, s), rnd(0, h, s + 3), rnd(6, 40, s + 5), rnd(6, 34, s + 7));
  }
  // 剥落露砖
  for (let i = 0; i < 9; i++) {
    const s = i * 17.3;
    const px = rnd(0, w - 60, s), py = rnd(0, h - 50, s + 1);
    const pw = rnd(20, 58, s + 2), ph = rnd(16, 46, s + 3);
    ctx.fillStyle = 'rgba(122,70,56,0.75)';
    ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = 'rgba(150,146,136,0.6)';
    ctx.fillRect(px - 3, py - 3, pw + 6, 3);
  }
  // 污渍竖向流痕
  for (let i = 0; i < 14; i++) {
    const s = i * 5.1;
    const px = rnd(0, w, s);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(60,54,46,0.22)');
    g.addColorStop(1, 'rgba(60,54,46,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px, 0, rnd(3, 12, s + 2), h);
  }
  return finish('plaster', canvas, repeat);
}

/** 砖墙种类注册表（供资产按 key 取用；同一 key 全局复用同一张贴图） */
export const WALLS = {
  brickRed, brickBuff, brickSooty, brickBlue, stoneBlock, plaster,
  // 铺装（v9.4）：街道车行道 / 码头旧石板 / 河堤长条石 —— 三者必须互相区分
  settFan, quayFlag, quayCurb,
};

/**
 * 把贴图挂到材质上。
 * 【必须】同时把 color 设为白 —— 否则 color × map 相乘会二次压暗（DECISIONS B-06）。
 * @param {THREE.Material} mat
 * @param {string|THREE.Texture} kind  WALLS 的 key 或已构建的贴图
 * @param {[number,number]} repeat
 */
/**
 * 街道车行道：**扇形小方石（sett paving）+ 两道车辙磨光带**
 * 与河堤的旧石板**明确区分**：规则的弧线行 + 小尺度方石 + 沿车辙方向被磨亮的窄带。
 */
export function settFan(repeat = [2.2, 24]) {
  { const r = reuse('settFan', repeat); if (r) return r; }
  const { canvas, ctx, w, h } = mkCanvas(512, 512);
  ctx.fillStyle = '#38342F';
  ctx.fillRect(0, 0, w, h);
  const cell = 30;
  const rowPx = cell * 0.86;
  const rows = Math.ceil(h / rowPx) + 2;
  const cols = Math.ceil(w / cell) + 2;
  for (let r = 0; r < rows; r++) {
    const t = r / rows;
    const arc = Math.sin(t * Math.PI) * 30;          // 行中心随弧线起伏 → 扇形观感
    for (let c = -1; c <= cols; c++) {
      const s0 = r * 71.3 + c * 19.7;
      const x = c * cell + (r % 2) * cell * 0.5;
      const y = r * rowPx + arc;
      if (x > w + cell) break;
      const track = Math.min(Math.abs(x - w * 0.30), Math.abs(x - w * 0.70));
      const polished = track < w * 0.085;              // 车辙带：更亮、缝更浅
      const v = 1 + rnd(-0.09, 0.09, s0);
      const g = (polished ? 172 : 128) * v;
      ctx.save();
      ctx.translate(x + cell / 2, y + cell / 2);
      ctx.rotate(((x - w / 2) / w) * 0.42);
      ctx.fillStyle = `rgb(${g | 0},${(g * 0.965) | 0},${(g * 0.9) | 0})`;
      ctx.fillRect(-cell * 0.44, -cell * 0.41, cell * 0.88, cell * 0.82);
      ctx.strokeStyle = polished ? 'rgba(30,28,26,0.26)' : 'rgba(26,24,22,0.62)';
      ctx.lineWidth = polished ? 1.4 : 2.6;
      ctx.strokeRect(-cell * 0.44, -cell * 0.41, cell * 0.88, cell * 0.82);
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      ctx.fillRect(-cell * 0.3, -cell * 0.28, cell * 0.24, cell * 0.18);
      ctx.restore();
    }
  }
  // 车辙磨光叠加（很淡的浅色竖向带）
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0.22, 'rgba(255,246,226,0)');
  grad.addColorStop(0.30, 'rgba(255,246,226,0.10)');
  grad.addColorStop(0.38, 'rgba(255,246,226,0)');
  grad.addColorStop(0.62, 'rgba(255,246,226,0)');
  grad.addColorStop(0.70, 'rgba(255,246,226,0.10)');
  grad.addColorStop(0.78, 'rgba(255,246,226,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  return finish('settFan', canvas, repeat);
}

/**
 * 码头河堤步道：**不规则旧石板**
 * 行高 46–106 px 不等、石块 60–190 px 不等、轻微歪斜、带湿痕与污渍、
 * 还有 2 处"用小方石补过的洞"—— 读起来是"用了几十年的码头"，不是新铺的规则方石。
 */
export function quayFlag(repeat = [1.5, 26]) {
  { const r = reuse('quayFlag', repeat); if (r) return r; }
  const { canvas, ctx, w, h } = mkCanvas(512, 512);
  ctx.fillStyle = '#26241F';                          // 深缝
  ctx.fillRect(0, 0, w, h);
  let y = -20, r0 = 0;
  while (y < h) {
    const rh = 46 + (Math.abs(Math.sin(r0 * 3.77) * 997) % 1) * 60;
    let x = -40 + (Math.abs(Math.sin(r0 * 5.13) * 773) % 1) * 34;
    let c = 0;
    while (x < w) {
      const cw = 60 + (Math.abs(Math.sin(r0 * 9.7 + c * 4.3) * 557) % 1) * 130;
      const s0 = r0 * 57.1 + c * 23.9;
      const v = 1 + rnd(-0.15, 0.15, s0);
      const g = 122 * v;
      const rot = ((Math.abs(Math.sin(s0 * 1.7) * 99) % 1) - 0.5) * 0.04;
      ctx.save();
      ctx.translate(x + cw / 2, y + rh / 2);
      ctx.rotate(rot);
      ctx.fillStyle = `rgb(${g | 0},${(g * 0.975) | 0},${(g * 0.9) | 0})`;
      ctx.fillRect(-cw / 2 + 2.5, -rh / 2 + 2.5, cw - 5, rh - 5);
      // 湿痕 / 污渍（沿海码头一定有）
      if ((Math.abs(Math.sin(s0 * 2.9) * 313) % 1) < 0.36) {
        ctx.fillStyle = 'rgba(24,26,25,0.22)';
        ctx.beginPath();
        ctx.ellipse(rnd(-cw * 0.18, cw * 0.18, s0), rnd(-rh * 0.18, rh * 0.18, s0 * 1.3),
          cw * 0.30, rh * 0.26, rot, 0, Math.PI * 2);
        ctx.fill();
      }
      // 錾痕
      ctx.strokeStyle = 'rgba(255,255,255,0.045)';
      ctx.lineWidth = 1;
      for (let k = 1; k <= 4; k++) {
        const yy = -rh / 2 + (rh * k) / 5;
        ctx.beginPath(); ctx.moveTo(-cw / 2 + 6, yy); ctx.lineTo(cw / 2 - 9, yy + 2); ctx.stroke();
      }
      // 缺角（把一小块画回缝色）
      if ((Math.abs(Math.sin(s0 * 6.1) * 811) % 1) < 0.28) {
        ctx.fillStyle = 'rgba(30,28,24,0.85)';
        const cxx = (Math.abs(Math.sin(s0 * 3.3) * 55) % 1) < 0.5 ? -cw / 2 + 2.5 : cw / 2 - 10;
        ctx.fillRect(cxx, (Math.abs(Math.sin(s0 * 8.8) * 44) % 1) < 0.5 ? -rh / 2 + 2.5 : rh / 2 - 12, 8, 9);
      }
      ctx.restore();
      x += cw; c++;
    }
    y += rh; r0++;
  }
  // 两处"补过的洞"：用小方石填
  for (const [px, py, pw, ph] of [[70, 120, 96, 74], [320, 336, 118, 82]]) {
    ctx.fillStyle = '#2A2823';
    ctx.fillRect(px, py, pw, ph);
    for (let yy = 0; yy < ph; yy += 26) {
      for (let xx = 0; xx < pw; xx += 26) {
        const s0 = px + xx + yy * 3.1;
        const v = 1 + rnd(-0.12, 0.12, s0);
        const g = 108 * v;
        ctx.fillStyle = `rgb(${g | 0},${(g * 0.97) | 0},${(g * 0.92) | 0})`;
        ctx.fillRect(px + xx + 2, py + yy + 2, Math.min(22, pw - xx) - 4, Math.min(22, ph - yy) - 4);
      }
    }
  }
  // 靠缝苔藓 / 积垢（很淡，只在缝上）
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = '#3C4230';
  ctx.lineWidth = 2.2;
  for (let k = 0; k < 26; k++) {
    const yy = (Math.abs(Math.sin(k * 9.1) * 977) % 1) * h;
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy + rnd(-4, 4, k * 3.7)); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return finish('quayFlag', canvas, repeat);
}

/**
 * 河堤压顶 / 沿水长条石：一列长石，缝少而深
 */
export function quayCurb(repeat = [1, 34]) {
  { const r = reuse('quayCurb', repeat); if (r) return r; }
  const { canvas, ctx, w, h } = mkCanvas(512, 256);
  ctx.fillStyle = '#2A2723';
  ctx.fillRect(0, 0, w, h);
  let x = -60;
  let i = 0;
  while (x < w) {
    const sw = 150 + (Math.abs(Math.sin(i * 4.7) * 911) % 1) * 90;   // 长条石 150–240 px
    const s0 = i * 37.3;
    const v = 1 + rnd(-0.12, 0.12, s0);
    const g = 132 * v;
    ctx.fillStyle = `rgb(${g | 0},${(g * 0.975) | 0},${(g * 0.915) | 0})`;
    ctx.fillRect(x + 3, 6, sw - 6, h - 12);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1.4;
    for (let k = 1; k <= 3; k++) {
      ctx.beginPath(); ctx.moveTo(x + 10, 6 + (h - 12) * (k / 4)); ctx.lineTo(x + sw - 12, 6 + (h - 12) * (k / 4) + 3); ctx.stroke();
    }
    // 边缘凿毛
    ctx.fillStyle = 'rgba(28,26,22,0.5)';
    for (let k = 0; k < 10; k++) {
      const bx = x + 3 + (Math.abs(Math.sin(s0 + k * 5.5) * 811) % 1) * (sw - 10);
      ctx.fillRect(bx, k % 2 ? 6 : h - 10, 5, 4);
    }
    x += sw; i++;
  }
  return finish('quayCurb', canvas, repeat);
}

export function applyWall(mat, kind, repeat) {
  const tex = typeof kind === 'string' ? (WALLS[kind] ? WALLS[kind](repeat) : null) : kind;
  if (!tex) return mat;
  mat.map = tex;
  mat.color.setRGB(1, 1, 1);      // 颜色交给贴图
  mat.needsUpdate = true;
  return mat;
}

export default { WALLS, applyWall, brickRed, brickBuff, brickSooty, brickBlue, stoneBlock, plaster };
