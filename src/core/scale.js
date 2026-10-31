/**
 * scale.js — 世界尺度的**唯一来源**（见 docs/DECISIONS.md F-03）
 *
 * 铁律：资产文件内**不得出现尺寸字面量**，一律从这里取。
 * 改这张表 = 改整个世界。改动后必须回查与"低空悬浮车 4.5 m"基准的比例关系。
 *
 * 2026-09-15 重新定调要点：
 *   ① 风格由"维多利亚阴郁哥特"改为"蒸汽朋克近未来"
 *   ② 飞艇模型内部不变（86 m），但**实例缩放 1:11.2** ⇒ 世界里只有 7.7 m，比车大一圈
 *   ③ 河道由 110 m 宽大河改为 18 m 宽威尼斯式运河
 *   ④ 桥由城堡式仰开桥改为 18 m 净跨的通车路桥
 */

/** 建筑与街道层高（一切高度的基准） */
export const H = {
  human: 1.75,          // m 行人
  car: 1.80,            // m 低空悬浮车高
  floor: 3.20,          // m 层高
  kerb: 0.14,           // m 路缘石高
  door: 2.10,           // m 门高
  railH: 1.05,          // m 栏杆高
};

/** 街道（威尼斯式窄街） */
export const STREET = {
  lane: 3.30,           // m 单车道
  lanes: 2,
  road: 3.30 * 2,       // 6.6 m 车行道
  walk: 2.20,           // m 人行道（单侧）
  kerb: H.kerb,
  total: 3.30 * 2 + 2.20 * 2,   // 11.0 m 总宽（含两侧人行道）
  lampH: 3.60,          // m 煤气/蒸汽街灯高
  lampStep: 14,         // m 灯间距
  slab: 0.70,           // m 石板路单块尺寸（车行区改石板路）
};

/** 运河（威尼斯口径） */
export const CANAL = {
  width: 18,            // m 基准宽（14–22）
  /**
   * m 堤墙内表面（= width / 2）。
   * ⚠️ 这一条曾经**缺失**：canal.js 在自己的 SPEC 里补了 half，但 scale.js 的 CANAL 没有，
   * 于是所有读 CANAL.half 的地方都拿到 undefined ⇒ streetX = NaN、陆地 x0 = NaN
   * ⇒ **整条街与两岸陆地都被放到 NaN 坐标上**，表现为「路面全没了、除了运河全是水」，
   * 而且不抛任何异常。用 getter 保证只有一个来源（width），别再写死第二个 9。
   */
  get half() { return this.width / 2; },
  depth: 3.0,           // m 水深
  quayY: 2.20,          // m 河堤（石砌压顶）顶标高
  wallT: 1.20,          // m 石砌堤墙厚
  walk: 3.20,           // m 沿河步道宽
  stepW: 2.60,          // m 入水石阶宽
  outfallW: 2.60,       // m 下水道出水口拱宽
  bedY: -3.4,           // m 河床标高（canal.js 的 SPEC.bedY 由它派生）
  bollardStep: 10,      // m 系船柱间距
};

/** 开启桥（通车路桥） */
export const BRIDGE = {
  clearSpan: 18,        // m 通航净跨（两铰点间距）
  leafLen: 9,           // m 单叶长
  openDeg: 70,          // ° 全开角
  openRate: 5.6,        // °/s ⇒ 12.5 s 开满（有序节奏）
  deckW: 9.36,          // m 桥面宽（车行 6.6 + 人行 1.4×2）
  deckT: 0.90,          // m 桥面结构厚
  // v9：桥面降到与堤顶接近（低矮运河桥），净空靠开桥解决
  deckY: CANAL.quayY + 0.60,  // 2.8 m 桥面顶标高
  towerH: 6.4,          // m 机械塔架高（自桥面起）—— 不是城堡塔，是机械桁架
  towerPlan: 4.6,       // m 塔平面边长
  counterweightT: 26,   // t
  cwTravel: 4.4,        // m
  gateDrop: 4.0,        // s 落杆用时
};

/**
 * 飞艇：模型内部 86 m 不变，只改实例缩放。
 *
 * v9.5（用户 2026-09-15）：「飞艇比例尺太小了，需要放大到和当前旧桥相同大小」
 *   ⇒ worldLen 由 7.7 m 提到 **18 m = 开启桥通航净跨**（同一把尺子，一眼可比）。
 *   实例缩放 1 : 4.78（0.2093），气囊直径 ≈ 5.02 m，仍能落进 18 m 宽的运河。
 */
const AIR_MODEL_LEN = 86;    // m 模型内部全长（**永不修改**）
const AIR_WORLD_LEN = 18;    // m 世界目标全长 = 桥净跨
export const AIRSHIP = {
  modelLen: AIR_MODEL_LEN,
  worldLen: AIR_WORLD_LEN,
  get instanceScale() { return AIR_WORLD_LEN / AIR_MODEL_LEN; },   // ≈ 0.2093
  get worldBeam() { return 24 * this.instanceScale; },             // ≈ 5.02 m 气囊直径
  /** 模型内部的派生量换算到世界尺度（**必须跟着 worldLen 走** —— 原来硬编码 7.7/86，
   *  一改 worldLen 就静默算错，是一颗定时炸弹） */
  toWorld: (v) => v * (AIR_WORLD_LEN / AIR_MODEL_LEN),
};

/** 城市建筑套件 */
export const CITY = {
  residential: { w: 12, d: 10, floors: 3, bays: 3 },
  villa: { w: 9, d: 8, floors: 2 },
  factory: { w: 26, d: 16, h: 9, stackH: 26 },
  park: { w: 30, d: 24 },
  plaza: { w: 26, d: 26 },
};

/** 汇总（便于一次性打印做自检） */
export const WORLD = {
  H, STREET, CANAL, BRIDGE, AIRSHIP, CITY,
  /** 自检：世界里的关键对象与"车 4.5 m"的比例 */
  ratios: () => {
    // v9.5：车辆已恢复 v8 原版三型（有轮），基准锚点改用**蒸汽机动车 5.6 m**
    const CAR = 5.6;
    return {
      车_蒸汽机动车: CAR,
      飞艇: AIRSHIP.worldLen,
      飞艇_比车: +(AIRSHIP.worldLen / CAR).toFixed(2),
      飞艇_比桥净跨: +(AIRSHIP.worldLen / BRIDGE.clearSpan).toFixed(2),
      运河宽_比车: +(CANAL.width / CAR).toFixed(2),
      桥净跨_比车: +(BRIDGE.clearSpan / CAR).toFixed(2),
      桥面宽: BRIDGE.deckW,
      街道总宽: STREET.total,
    };
  },
};

export default WORLD;
