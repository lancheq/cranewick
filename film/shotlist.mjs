// 分镜表 v3
// 关键约束（实测）：飞艇全长约 31 m、高 14 m；运河净宽仅 18 m，两岸建筑立面 z=±13.2。
// ⇒ 能装下整条船的机位只有「沿运河轴向」与「高位 3/4」，侧向只适合做局部特写。
// 飞艇 t<19 整体不可见，19 起从云中出现；35..48 沿 +X 穿桥，48 后停靠 x=17。

export const FPS = 24;

export const SHOTS = [
  {
    id: 'S1', title: '晨光 · 小镇苏醒',
    scene: [0.0, 3.0], dur: 7.0,
    tod: 'morning', rain: false, trans: 0,
    focus: [34, 28], aperture: 0.5,
    keys: [
      { pos: [-41, 21, 28], tgt: [2, 12.0, 0], fov: 42 },
      { pos: [-38, 15.0, 22], tgt: [-2, 4.2, 0], fov: 40 },
    ],
    handheld: 0.05,
  },
  {
    id: 'S2', title: '晨光 · 升桥',
    scene: [5.0, 14.0], dur: 8.0,
    tod: 'morning', rain: false, trans: 0,
    focus: [26, 22], aperture: 0.45,
    keys: [
      { pos: [31, 7.0, -6.5], tgt: [5, 5.6, 0], fov: 46 },
      { pos: [26, 8.2, -5.2], tgt: [5, 9.8, 0], fov: 44 },
    ],
    handheld: 0.045,
    grade: { exposure: 0.95, contrast: 1.08, bloom: 0.18 },
  },
  {
    id: 'S3', title: '晨光 · 模型全景',
    scene: [15.0, 18.6], dur: 4.5,
    tod: 'morning', rain: false, trans: 0,
    focus: [58, 56], aperture: 0.32,
    keys: [
      { pos: [0.0, 36.0, 48.0], tgt: [0, 3.0, 0], fov: 42 },
      { pos: [-30.0, 32.0, 44.0], tgt: [0, 3.0, 0], fov: 42 },
    ],
    handheld: 0.02,
  },
  {
    id: 'S4', title: '正午 · 云中降临',
    scene: [19.6, 27.6], dur: 11.0,
    tod: 'noon', rain: true, trans: 7.0,
    focus: [22, 22], aperture: 0.5,
    keys: [
      { pos: [-36.5, 5.4, 4.2], tgt: [-21, 8.6, 0], fov: 54 },
      { pos: [-31.0, 6.6, 2.6], tgt: [-11, 3.2, 0], fov: 54 },
    ],
    handheld: 0.06,
    grade: { exposure: 0.88, contrast: 1.12, sat: 1.04, bloom: 0.18 },
  },
  {
    id: 'S5', title: '正午 · 触水',
    scene: [27.6, 31.0], dur: 7.0,
    tod: 'noon', rain: true, trans: 0,
    focus: [8.0, 7.0], aperture: 0.75,
    keys: [
      { pos: [-16.2, 3.8, -7.6], tgt: [-9.6, 2.4, 0], fov: 46 },
      { pos: [-14.4, 3.2, -6.9], tgt: [-9.0, 1.5, 0], fov: 42 },
    ],
    handheld: 0.05,
    grade: { exposure: 0.90, contrast: 1.10, sat: 1.03, bloom: 0.18 },
  },
  {
    id: 'S6', title: '黄昏 · 起航',
    scene: [31.0, 39.0], dur: 8.5,
    tod: 'dusk', rain: false, trans: 8.0,
    focus: [30, 20], aperture: 0.45,
    keys: [
      { pos: [-30, 6.5, 5.0], tgt: [-4, 3.6, 0], fov: 46 },
      { pos: [-26, 5.5, 4.0], tgt: [4, 3.2, 0], fov: 46 },
    ],
    handheld: 0.05,
    grade: { gain: [1.05, 1.0, 0.94], sat: 1.06, contrast: 1.04 },
  },
  {
    id: 'S7', title: '黄昏 · 穿桥',
    scene: [39.0, 44.4], dur: 7.5,
    tod: 'dusk', rain: false, trans: 0,
    focus: [12, 12], aperture: 0.55,
    keys: [
      { pos: [19.5, 3.6, 8.6], tgt: [5, 3.8, 0], fov: 48 },
      { pos: [25.0, 4.0, 8.0], tgt: [13, 3.2, 0], fov: 50 },
    ],
    handheld: 0.05,
  },
  {
    id: 'S8', title: '午夜 · 停航',
    scene: [45.5, 50.2], dur: 11.0,
    tod: 'midnight', rain: false, trans: 9.0,
    focus: [22, 20], aperture: 0.42,
    keys: [
      { pos: [-6.0, 4.0, -6.5], tgt: [16.0, 3.0, 0], fov: 44 },
      { pos: [-3.0, 4.6, -4.6], tgt: [16.5, 3.0, 0], fov: 42 },
    ],
    handheld: 0.03,
    grade: { gain: [0.94, 0.98, 1.10], lift: [-0.004, 0.0, 0.010], sat: 1.10, contrast: 1.08, bloom: 0.26 },
  },
];
