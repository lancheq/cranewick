/**
 * palette.js — CRANEWICK 调色板（全项目唯一取色来源）
 * 对应 docs/ART_BIBLE.md 第二章。
 *
 * 【铁律二】任何资产文件禁止写十六进制字面量，必须从此处 import。
 */
import * as THREE from 'three';

/** 原始 hex 表（kebab-case，与美术全书 1:1 对应） */
export const HEX = {
  // 黄铜金属族
  'brass-hi': '#F2CD84',
  'brass': '#C98F42',
  'brass-lo': '#8E672C',
  'bronze': '#A87440',
  'copper-ox': '#4E7A6B',

  // 结构材质族
  'iron': '#2E3138',
  'iron-lo': '#1B1D22',
  'stone': '#9A9287',
  'stone-lo': '#6B645C',
  'brick': '#7A4A3A',
  'wood': '#4A2F1E',
  'canvas-ivory': '#E6DECB',

  // 环境与光
  'sky-zenith': '#3E5A72',
  'sky-dusk-hi': '#A9B7C4',
  'sky-dusk-lo': '#D89A63',
  'fog': '#C7BBA6',
  'lamp-warm': '#FFC46A',
  'steam': '#EDE9E1',
  'water-deep': '#2C4A4E',
  'water-hi': '#6E9AA0',

  // 信号与强调
  'signal-red': '#C8433A',
  'signal-amber': '#E2913C',
  'signal-green': '#4E9A6A',
  'accent-verdigris': '#3FA38A',
  'rim-gold': '#F3C583',
  'steam-glow': '#FFF0D6',
  'hemp-rope': '#A89070',
};

/** 便捷别名（camelCase），值为 THREE.Color 实例 */
export const C = {};
/** 便捷别名对应的 hex 字符串 */
export const X = {};

for (const [k, v] of Object.entries(HEX)) {
  const camel = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  C[camel] = new THREE.Color(v);
  X[camel] = v;
}

/** 语义色阶（3 段 toon 的亮度台阶） */
export const BANDS = {
  /** 金属/石材：暗-中-亮 */
  hard: [0.28, 0.55, 1.0],
  /** 帆布/织物：双色阶，更软 */
  soft: [0.45, 1.0],
  /**
   * 墙面（贴图材质专用）：比 hard 平缓得多。
   * 硬色阶叠在贴图上会读成一块块死色，且暗部会被压到发黑 ——
   * 墙面的明暗应当由**贴图 + 光照**给，材质只做很轻的分层。
   */
  wall: [0.46, 0.72, 1.0],
  /** 车辆/小物件：4 段，细节更多 */
  detail: [0.22, 0.45, 0.72, 1.0],
  /**
   * 金属（黄铜/青铜/钢）：4 段，且最上面一段刻意留窄 —— 形成一道明确的**高光带**。
   * "璀璨黄铜"就是靠这道带子读出来的；用 hard 三段会让金属发闷。
   */
  metal: [0.28, 0.50, 0.76, 1.0],
};

/** 渲染基调常量 */
export const TONE = {
  /** 自发光 HDR 倍数（>1 才会被 Bloom 捕获） */
  lampGain: 1.7,
  /** Bloom 阈值：高于此亮度才泛光 */
  bloomThreshold: 0.9,
  bloomStrength: 0.62,
  bloomRadius: 0.5,
  /** 雾密度 */
  fogDensity: 0.0022,
  /** 主光方位（度） */
  sunAzimuth: 235,
  sunElevation: 26,
  /** 描边颜色（近黑，不用纯黑） */
  outline: '#15171A',
};

export default { HEX, C, X, BANDS, TONE };
