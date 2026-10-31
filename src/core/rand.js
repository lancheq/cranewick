/**
 * rand.js — 确定性伪随机
 * 【规范】造型相关的随机必须走这里。Math.random() 会导致每次刷新造型变化，无法拍板。
 */

/** mulberry32 PRNG */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 生成一个带便捷方法的随机源 */
export function rng(seed = 20260914) {
  const r = mulberry32(seed);
  return {
    next: r,
    /** [a,b) 浮点 */
    range: (a, b) => a + (b - a) * r(),
    /** [a,b] 整数 */
    int: (a, b) => Math.floor(a + (b - a + 1) * r()),
    /** ±a */
    sym: (a) => (r() * 2 - 1) * a,
    /** 概率 p */
    chance: (p) => r() < p,
    /** 从数组取一个 */
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    /** 高斯（Box-Muller） */
    gauss: (mu = 0, sigma = 1) => {
      const u = Math.max(1e-9, r());
      return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
    },
  };
}

export default { mulberry32, rng };
