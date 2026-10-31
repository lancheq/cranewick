/**
 * assemble.js — 阶段 3 全场景装配（v9 · 新尺度）
 * 见 docs/STYLE_PROMPT.md §4：基准锚点 = 悬浮车 4.5 m；飞艇世界 7.7 m。
 *
 * 世界坐标（1 unit = 1 m）
 *   运河中心线 = x 0；水面 y = 0；堤墙内表面 x = ±9；堤顶 y = 2.2；沿河步道顶 y = 2.5
 *   桥轴 = z 0；桥面顶 y = 2.8；铰点 x = ±9
 *   街道沿 Z 布置，街心 x = ±19.5（人行道外缘紧邻步道）
 *   飞艇在运河内，**实例缩放 1 : 11.2** ⇒ 世界全长 7.7 m、吃水 0.25 m
 *
 * 时间线（秒）——对应 docs/SHOT_SCRIPT.md，压缩演示
 *   0–7    常态（桥合、栏杆抬、悬浮车通行）
 *   7–14   预告（警钟 + 警示牌红灯 1.0 Hz + 栏杆落定 4.0 s）
 *   14–19  清空桥面
 *   19–23  净空确认
 *   23–27  解锁（齿轮启动 + 指示灯转琥珀 + 液压蓄能器起压）
 *   27–39.5 开桥 70°（5.6 °/s × 12.5 s）+ 配重随动
 *   39.5–44 绿灯常亮
 *   44–51  飞艇下降（缩放后的世界高度）
 *   51     触水：船首下沉 + 方向性溅射 + 桨轮/桅帆收起
 *   51–58  阻尼浮沉 + 弹簧回正 + 桨轮展开
 *   58–64  稳定；桥叶回落
 */
import * as THREE from 'three';
import { createWater, createBuoyancy, createBowSplash, createPitchResponse, createSpringResponse, createBubbleTrail } from './water.js';
import { safeClone, mergeByMaterial } from '../core/primitives.js';
import { M, toon } from '../core/materials.js';
import { applyWall } from '../core/textures.js';
import { AIRSHIP, BRIDGE, CANAL, STREET } from '../core/scale.js';
import { SPEC as CANAL_SPEC } from '../assets/canal.js';
import { populate as populateCity, landRects } from './cityplan.js';
// 车辆/行人不从预览主板 clone（safeClone 会剥掉 userData.parts，主板那边只能靠
// 「geometry 是不是透明圆锥」这类启发式猜可动件 —— 新车的活塞根本猜不出来，会僵住。
// 改为直接调工厂，拿到**完整的 parts**（曲柄/活塞/喷口全都真的在动）。
import { buildCarriage, buildMotorCar, buildOmnibus, buildPedestrian, makeMaterials as makeVehicleMaterials } from '../assets/vehicles.js';

/**
 * 时间线（v9.6 重排 —— 用户：飞艇一开始不是悬停，是**从远方来**，下降着陆，
 * 然后**滑行穿过桥**，之后桥再恢复原样）
 *
 *   0–34    常态 + 飞艇自远方沿河道驶来（高空，雾里先是个剪影）
 *   8–15    预告·落杆      15–21 清空桥面      21–25 净空确认      25–29 解锁
 *   29–41.5 开桥 70°（12.5 s）
 *   34–48   飞艇滑翔下降（27 m 落程 / 54 m 前进 ⇒ 约 27° 下滑角）
 *   48      触水：船首下沉 + 方向性溅射 + 桨轮展开
 *   48–62   桨轮驱动，**沿河道滑行穿过桥**（z +20 → −42，穿过 z=0）
 *   62–68   飞艇已过桥 ⇒ **桥回落恢复原样**
 */
export const TIMELINE = {
  dur: 68,
  normal: 0, warn: 8, clear: 15, confirm: 21, unlock: 25,
  open: 29, openEnd: 29 + BRIDGE.openDeg / BRIDGE.openRate,
  green: 29 + BRIDGE.openDeg / BRIDGE.openRate, hold: 44,
  airDescend: 34, airTouch: 48, airSettle: 54, airTaxiEnd: 62, closeStart: 62,
};

const smooth = (u) => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };
const seg = (t, a, b) => smooth((t - a) / (b - a));
const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function createScene(assets, o = {}) {
  const T = TIMELINE;
  const root = new THREE.Group();
  root.name = 'FullScene';
  const { bridge, airship, street, canal } = assets;   // vehicles 不再需要：由工厂直接建
  let cityStat = null;   // 城市肌理统计（必须在使用点之前声明：let/const 有 TDZ）

  // -------------------------------------------------------------------------
  // 1) 陆地（运河两侧，顶面与步道齐平；把水面限制在河道内）
  // -------------------------------------------------------------------------
  // 陆地加一张铺装贴图：不加就是一大片无纹理的平面，侧光下会读成「没做完」
  let landCount = 0;
  const landMat = applyWall(M.stone({ bands: [0.3, 0.6, 0.98], outline: false }), 'quayFlag', [26, 60]);
  const landTopY = CANAL.quayY + 0.3;
  // 陆地 = 「整块陆地 − 所有运河带」的矩形集合（含同心运河环，见 cityplan 的 CANAL_RINGS）。
  // 为什么不用一整块大板 + 挖洞：box 挖不了洞；而按固定网格切又会在没有运河的地方留下假缝。
  // 这里用**矩形减法**（subtractRects）得到精确的陆地矩形，再逐块铺 —— 运河缺口自然成为水面。
  const LAND_OUT = 310, LAND_Z = 310;
  for (const r of landRects(CANAL.half + CANAL.wallT, LAND_OUT, LAND_Z)) {
    const w = r.x1 - r.x0, d = r.z1 - r.z0;
    const geo = new THREE.BoxGeometry(w, 1.0, d);
    // UV 按世界尺度归一：各块尺寸不同，若不归一，石板会在窄块上被拉伸
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 300), uv.getY(i) * (d / 620));
    const land = new THREE.Mesh(geo, landMat);
    land.name = 'Land';
    land.position.set((r.x0 + r.x1) / 2, landTopY - 0.5, (r.z0 + r.z1) / 2);
    land.receiveShadow = true;
    land.userData.noOutline = true;
    root.add(land);
    landCount++;
  }

  // -------------------------------------------------------------------------
  // 2) 水域（运河）：不跟随相机，极坐标网格被两侧陆地夹住
  // -------------------------------------------------------------------------
  const water = createWater({ rings: 110, sectors: 170, rMin: 0.5, rMax: 1600, followCamera: false });
  root.add(water.mesh);
  // 河床
  const bed = new THREE.Mesh(
    new THREE.BoxGeometry(CANAL.width + 2.4, 0.6, CANAL_SPEC.len + 120),
    toon(new THREE.Color('#1B2C30'), { bands: [0.6, 1.0], outline: false }));
  bed.position.set(0, CANAL.bedY, 0);
  bed.userData.noOutline = true;
  root.add(bed);

  // -------------------------------------------------------------------------
  // 3) 运河 + 堤岸（含出水口、石阶、小桥、沿河灯）
  // -------------------------------------------------------------------------
  canal.position.set(0, 0, 0);
  mergeByMaterial(canal, { filter: () => true });
  root.add(canal);

  // -------------------------------------------------------------------------
  // 4) 开启桥（跨运河，桥轴 = z 0）
  // -------------------------------------------------------------------------
  bridge.position.set(0, 0, 0);
  root.add(bridge);

  // -------------------------------------------------------------------------
  // 5) 街道：沿 Z 布置（旋转 90°），街心 x = ±19.5；每侧 2 段覆盖 z ±64
  // -------------------------------------------------------------------------
  // 街道路网改由 cityplan 统一排布（见 5b）—— 那里要处理"主路通桥 / 折弯 / 重点集中"，
  // 放在本文件会把 5b 之前的顺序搅乱（街段要先于城市肌理建）。
  // 沿河街的街心位置。
  // ★ 关键：原来 19.5 ⇒ 街两侧的临街楼落在 x = 14.0 ~ 25.0，**离堤沿(13.4)只有 0.6 m**，
  //   等于把整条河堤+步道墙死（用户："房子把河堤挡住了"）。
  //   现在把街心推到 25.2 ⇒ 临街楼退到 19.7 起，河堤留下 **6.3 m 开阔带**（步道+系船柱+栏杆都露出来）。
  const streetX = 13.4 + 6.3 + STREET.total / 2;   // = 25.2

  // -------------------------------------------------------------------------
  // 5b) 城市肌理：按**真实城市（布鲁日）的建筑关系**用现有资源填充
  //     见 src/scene/cityplan.js 头部：广场连续围合 / 运河紧贴广场 / 街巷放射 /
  //     靠运河的巷道更窄 / 天际线用烟囱与发电塔。
  // -------------------------------------------------------------------------
  cityStat = populateCity(root, { street }, { outline: false });

  // -------------------------------------------------------------------------
  // 6) 悬浮车与行人（引道等待 + 桥面通行 + 街面）
  // -------------------------------------------------------------------------
  const VMT = makeVehicleMaterials();
  const deckY = BRIDGE.deckY;
  // v8 原版三型（**有轮**）：蒸汽机动车 / 蒸汽马车 / 双层公共马车
  const KINDS = [(o) => buildMotorCar(o), (o) => buildCarriage(o), (o) => buildOmnibus(o)];
  // 车轮滚动量由"行驶距离"推进；车体原点 = 轮胎触地面 ⇒ y 直接给路面标高
  const rollWheels = (c, dist) => {
    const p = c.userData.parts;
    if (!p || !p.wheels) return;
    for (const w of p.wheels) {
      const r = w.userData.parts?.r ?? 0.9;
      w.rotation.z = -dist / r;
    }
    if (p.flywheel) p.flywheel.rotation.z = -dist * 1.7;
  };
  /**
   * 交通体：车沿**路径**走（不是原地摆件）。
   *   axis 'x' —— 主路（沿 x，穿过桥）；axis 'z' —— 沿河街（沿 z，不过桥）
   *   s = 沿路径的里程；v = 当前速度；v0 = 巡航速度；lane = 横向车道位置
   * 桥的规则见 drive()：栏杆落下后**没上桥的停在停止线等、已在桥上的加速驶离**。
   */
  const traffic = [];
  // ★ 三个阈值必须分开，且满足 SPAN < STOP：
  //   SPAN_X —— 桥跨范围（桥面 x ±9 + 引道，取 13）：|s| < SPAN_X 视为"在桥上"
  //   STOP_X —— 停车线（取 21）：车必须停在 |s| ≥ STOP_X，**绝不能停在桥跨里**
  //   余量  —— 减速刹不住的滑行量（约 1.5 m），所以 STOP_X 要比 SPAN_X 大得多
  //   历史 bug：两个阈值都用 15 ⇒ "停在停止线外 3 m" = |s|=12 < 15 ⇒ 车浮在河上
  const SPAN_X = 13.0;
  const STOP_X = 21.0;
  const mk = (i, axis, dir, lane, s0, v0, y) => {
    const g = KINDS[i % KINDS.length]({ materials: VMT, outline: true });
    g.rotation.y = axis === 'x'
      ? (dir > 0 ? 0 : Math.PI)
      : (dir > 0 ? -Math.PI / 2 : Math.PI / 2);
    g.position.set(axis === 'x' ? s0 : lane, y, axis === 'x' ? lane : s0);
    root.add(g);
    const t0 = { g, axis, dir, lane, s: s0, s0, v: 0, v0, dist: 0 };
    traffic.push(t0);
    return t0;
  };
  // 主路双向各 4 辆（沿 x 穿桥）
  for (let i = 0; i < 3; i++) {                    // 主路双向各 3 辆（够读出"排队"，又不吃性能）
    mk(i, 'x', 1, 1.7, -140 + i * 92, 5.0 + (i % 3) * 0.9, deckY);
    mk(i + 1, 'x', -1, -1.7, 140 - i * 88, 5.4 + (i % 3) * 0.8, deckY);
  }
  // 沿河街（东侧）双向各 3 辆，沿 z；不过桥，所以不受栏杆影响
  for (let i = 0; i < 2; i++) {                    // 沿河街双向各 2 辆
    mk(i, 'z', 1, streetX + 1.7, -120 + i * 110, 4.6 + (i % 2) * 0.9, landTopY);
    mk(i + 1, 'z', -1, streetX - 1.7, 120 - i * 104, 4.9 + (i % 2) * 0.9, landTopY);
  }
  const cars = traffic.map((t0) => t0.g);
  const onBridge = [];                       // 兼容下游引用（现在由规则驱动，不用手推）

  // 行人：**有路径会走**（原来只原地踱步），过桥的人要能在栏杆落下后让开桥面
  const STYLES = [0, 1, 2];
  const people = [];
  const mkPed = (i, axis, lane, s0, dir, lo, hi) => {
    const p = buildPedestrian({ style: STYLES[i % 3], materials: VMT, outline: true });
    p.rotation.y = axis === 'x'
      ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2)
      : (dir > 0 ? 0 : Math.PI);
    p.position.set(axis === 'x' ? s0 : lane, axis === 'x' ? deckY : landTopY, axis === 'x' ? lane : s0);
    root.add(p);
    const q = { g: p, axis, lane, s: s0, s0, dir, dir0: dir, lo, hi, v: 0, v0: 0.95 + (i % 4) * 0.12, ph: i * 0.9 };
    people.push(q);
    return q;
  };
  // 桥面人行道 4 名（沿 x 来回；栏杆落下后必须让开桥面）
  // 桥面行人：活动范围收窄到 ±22（原来 ±32，走到端点再折返，让开桥面要 30 s 以上，
  // 而"预告落杆 → 开桥"只有 23 s ⇒ 来不及清空）
  for (let i = 0; i < 3; i++) {
    mkPed(i, 'x', i % 2 ? -4.1 : 4.1, -14 + i * 14, i % 2 ? -1 : 1, -22, 22);
  }
  // 两岸步道 14 名（沿 z 来回；距运河中心 11.8 —— 正是步道位置）
  for (let i = 0; i < 10; i++) {
    const sgn = i % 2 ? 1 : -1;
    mkPed(i, 'z', sgn * (CANAL.half + CANAL.wallT + 1.6), -66 + (i % 5) * 30, i % 3 === 0 ? -1 : 1, -104, 104);
  }

  // -------------------------------------------------------------------------
  // 7) 飞艇：运河内，**实例缩放 1:4.78（世界全长 18 m = 桥净跨）**
  //    用户 2026-09-15：① 放大到与桥同尺度 ② 下降时**是滑翔姿态**、
  //    并**同步沿河道方向前进** ③ 水花方向与前进方向对应
  // -------------------------------------------------------------------------
  const SC = AIRSHIP.instanceScale;                 // ≈ 0.2093
  const AIR_X = -1.6;                               // 运河内（横向位置不变）
  // 【航程四段】全部沿河道 z，方向为 **−z**（自远方驶向默认机位，观众能看着它一路靠近）
  const AIR_Z_FAR = 170;                            // 起始：雾里的远处剪影（在陆地上方飞）
  const AIR_Z_GLIDE = 80;                           // 进入下滑
  const AIR_Z_TOUCH = 20;                           // 触水点（在桥的 +z 侧，留出滑行穿桥的距离）
  const AIR_Z_END = -42;                            // 滑行终点（正好停在默认机位前方）
  // 艇身与河道同向：模型长轴是 +x，绕 y 转 +90° 后机头朝 **−z**
  const AIR_YAW = Math.PI / 2;
  const airWrap = new THREE.Group();                // 包装层：只做缩放，位置由艇自己管
  airWrap.name = 'AirshipWrap';
  airWrap.scale.setScalar(SC);
  airWrap.position.set(AIR_X, 0, AIR_Z_FAR);
  airWrap.add(airship);
  root.add(airWrap);
  airship.position.set(0, AIRSHIP.modelLen * 0.5, 0);
  airship.rotation.y = AIR_YAW;

  const splash = createBowSplash();
  splash.group.scale.setScalar(SC);
  splash.group.position.set(AIR_X, 0, AIR_Z_TOUCH);
  // 船首波/水幕的"前方"在局部是 +x ⇒ 绕 −90° 后指向 +z，与前进方向一致
  splash.group.rotation.y = AIR_YAW;
  root.add(splash.group);
  const bubbles = createBubbleTrail({ count: 200, spread: 6 });
  bubbles.points.scale.setScalar(SC);
  bubbles.points.position.set(AIR_X, 0, AIR_Z_TOUCH);
  root.add(bubbles.points);

  /**
   * 滑翔姿态（相对时间 u ∈ [0,1]）：
   *   0 → 0.15   进入下滑，机头压到 −8°
   *   0.15 → 0.78 稳定下滑（−8° → −9.2°）
   *   0.78 → 1    拉平 flare（−9.2° → +5.8°，机头扬起）
   * 这才是"滑翔"，不是平着往下掉。
   */
  const glidePitch = (u) => {
    if (u < 0.15) return -1.5 - 6.5 * smooth(u / 0.15);
    if (u < 0.78) return -8.0 - 1.2 * smooth((u - 0.15) / 0.63);
    return -9.2 + 15.0 * smooth((u - 0.78) / 0.22);
  };

  // 物理（都在飞艇内部单位里算，最后乘 SC 换到世界）
  const buoy = createBuoyancy({ mass: AIRSHIP_MODEL_MASS, waterplaneArea: AIRSHIP_MODEL_AWP, zeta: 0.22 });
  buoy.reset();
  const pitchSpring = createPitchResponse({ theta0: 2.4, v0: -11, omega: 1.75, zeta: 0.22, delay: 0 });
  const rollSpring = createSpringResponse({ theta0: 0.9, v0: -3.2, omega: 1.75, zeta: 0.26, delay: 0 });
  const WAVE_TAU = 1.2, WAVE_FOLLOW = 0.12, POSE_TAU = 0.05;
  const FLOAT_MODEL_Y = 22.5;                        // 模型内部漂浮高度（＝scale.js 推得）
  const DROP_MODEL = 130;                            // 模型内部下降行程（世界 ≈ 27.2 m，随 1:4.78 缩放）
                                                     // 巡航高度 = FLOAT + 130 ⇒ 世界 27 m，能飞过 5 层楼(≈19 m)
  // 下降段运动学常量：**必须在 airZ() 之上**（airZ 要用 TD 来算沿河道前进的进度；
  // 原先写在 drive() 内部，airZ 引用它会抛 ReferenceError，而 drive 每帧被吞掉 ⇒ 整个下降段失效）
  // ★ V0 由积分式反解，保证 h 恰好在触水时刻收到 0（= 漂浮高度）:
  //   DROP = V0·TD − ½AD·TD²，AD = (V0−V1)/TD  ⇒  V0 = 2·DROP/TD − V1
  //   原来 V0=8 时 7 s 只落 32 单位（远小于 DROP=74），触水瞬间会"跳"下 8 m ——
  //   在 1:11.2 缩放下这个跳变只有 3.7 m 还能忍，放大到 1:4.78 后刺眼。
  const DROP_MODEL_V = 130, TD_V = 14.0, V1_V = 1.2;
  const V0 = 2 * DROP_MODEL_V / TD_V - V1_V;    // ≈ 19.94
  const V1 = V1_V, TD = TD_V;
  const AD = (V0 - V1) / TD;

  /**
   * 飞艇的河道向位置（**−z 为前进方向**）：四段
   *   ① 巡航  0 → airDescend ：自 AIR_Z_FAR 匀速驶到 AIR_Z_GLIDE（远处剪影 → 逐步靠近）
   *   ② 滑翔  airDescend → airTouch：与下降同步推进（起步慢、中段快）
   *   ③ 滑行  airTouch → airTaxiEnd：桨轮驱动，**穿过桥**
   *   ④ 停稳 之后：留在 AIR_Z_END
   */
  function airZ(t) {
    if (t < T.airDescend) {
      const u = T.airDescend > 0 ? t / T.airDescend : 1;
      return AIR_Z_FAR + (AIR_Z_GLIDE - AIR_Z_FAR) * u;
    }
    if (t < T.airTouch) {
      const u = (t - T.airDescend) / TD;
      return AIR_Z_GLIDE + (AIR_Z_TOUCH - AIR_Z_GLIDE) * smooth(Math.min(1, u * 1.06));
    }
    if (t < T.airTaxiEnd) {
      const u = (t - T.airTouch) / (T.airTaxiEnd - T.airTouch);
      return AIR_Z_TOUCH + (AIR_Z_END - AIR_Z_TOUCH) * smooth(u);
    }
    return AIR_Z_END;
  }

  const st = {
    landed: false, deploy: 0, sailStow: 0, hPrev: 0, hVel: 0,
    sm: { h: 0, pitch: 0, roll: 0, init: false }, waveSmooth: 0,
    leaf: 0, cwT: 0, gateT: 0, signal: 'red', mechRpm: 0,
  };
  const parts = bridge.userData.parts;
  const airParts = airship.userData.parts;
  let prevT = -1;

  // -------------------------------------------------------------------------
  function drive(t, dtOverride) {
    const t0 = prevT < 0 ? t : prevT;
    const frameDt = dtOverride ?? Math.min(Math.max(t - t0, 0), 0.25);
    prevT = t;
    water.update(t);

    // ---- 飞艇的航道向位置：三件跟随物一起搬 ----
    const az = airZ(t);
    airWrap.position.z = az;
    splash.group.position.z = az;
    bubbles.points.position.z = az;

    // ---- 桥 ----
    const gateT = t < T.warn + 0.4 ? 0 : seg(t, T.warn + 0.4, T.warn + 0.4 + BRIDGE.gateDrop);
    let leaf;
    if (t < T.open) leaf = 0;
    else if (t < T.openEnd) leaf = BRIDGE.openDeg * ((t - T.open) / (T.openEnd - T.open));
    else if (t < T.closeStart) leaf = BRIDGE.openDeg;
    else leaf = BRIDGE.openDeg * (1 - (t - T.closeStart) / (T.dur - T.closeStart));
    let sig = 'red';
    if (t >= T.warn && t < T.warn + 6) sig = 'red-blink';
    else if (t >= T.unlock && t < T.green) sig = 'amber-blink';
    else if (t >= T.green && t < T.closeStart) sig = 'green';
    else if (t >= T.closeStart) sig = 'amber-blink';
    st.mechRpm = t >= T.unlock && t <= T.closeStart + 1 ? 30 : 0;
    const bellSwing = t >= T.warn - 0.3 && t < T.open ? 20 : 0;
    parts.drive(t, { leafDeg: leaf, gateT, signal: sig, mechRpm: st.mechRpm, bellSwing });
    st.leaf = leaf; st.gateT = gateT; st.signal = sig;
    // 配重随桥叶联动；真值在桥自己的 state 里（装配层原来漏了同步 ⇒ 面板恒显示 0%）
    st.cwT = parts.state ? parts.state.cwT : leaf / 70;

    // ---- 飞艇 ----
    const landed = t >= T.airTouch;
    if (landed && !st.landed) {
      st.landed = true;
      buoy.impact(1.2);
      splash.trigger({ scale: 1 });
      pitchSpring.trigger(); rollSpring.trigger();
    }
    let rem = landed ? Math.max(0, t - Math.max(t0, T.airTouch)) : 0;
    while (rem > 1e-5) {
      const sub = Math.min(rem, 1 / 60);
      if (landed) { buoy.update(sub); pitchSpring.update(sub); rollSpring.update(sub); }
      splash.update(sub);
      bubbles.update(sub, landed);
      st.waveSmooth += (water.heightAt(AIR_X / SC, airZ(t) / SC, t) - st.waveSmooth) * (1 - Math.exp(-sub / WAVE_TAU));
      rem -= sub;
    }

    let h, rpm, aftRev = false, deploy = 0, sailStow = 0, paddleRpm = 0;
    let pitchDeg = 1.5, rollDeg = 0, elevator = -4;
    if (t < T.airDescend) {
      // 巡航：**不是悬停** —— 一边驶来一边缓慢下沉（30 模型单位 ≈ 6.3 m），
      // 在 t=airDescend 处与滑翔段连续（此时恰好降到 DROP_MODEL）
      const uc = t / T.airDescend;
      h = DROP_MODEL + 30 * (1 - uc);
      rpm = 300 + Math.sin(t * 2.4) * 16;
      pitchDeg = -1.2 - 1.6 * uc;                 // 巡航末段已开始微微低头，衔接滑翔
      rollDeg = Math.sin(t * 0.7) * 0.3;
    } else if (t < T.airTouch) {
      const s0 = t - T.airDescend, u = s0 / TD;
      h = DROP_MODEL - (V0 * s0 - 0.5 * AD * s0 * s0);
      rpm = 300 - 210 * u;
      aftRev = u > 0.72;
      pitchDeg = glidePitch(u);                       // 滑翔：明显下压 → 拉平
      // 滑翔中带一点侧倾（气流修正），越接近触水越平
      rollDeg = Math.sin(t * 1.5) * 0.7 * (1 - u) + 0.6 * u;
      // 升降舵：下滑时轻压、拉平时大幅上偏 —— 与俯仰一致才读得出"在操纵"
      elevator = -6 - pitchDeg * 1.2;
      sailStow = sailSeat(t);
    } else {
      h = -(buoy.y - buoy.draft) + st.waveSmooth * WAVE_FOLLOW;
      rpm = 90 - 50 * clamp01((t - T.airTouch) / 3);
      pitchDeg = pitchSpring.value;
      rollDeg = rollSpring.value;
      elevator = -7.9 + 11.9 * clamp01((t - T.airTouch) / 3);
      deploy = smooth((t - (T.airTouch + 0.4)) / 2.6);
      sailStow = clamp01(sailSeat(t));
      splash.pulse(clamp01(Math.max(0, buoy.v) / 1.2));
      // 滑行段：桨轮持续转（正在"划水"把艇推过桥），并保持艏波脉冲 ⇒ 读得出一条尾迹
      if (t < T.airTaxiEnd) {
        paddleRpm = 20;
        splash.pulse(0.42 + 0.12 * Math.sin(t * 5.2));
      }
    }
    st.deploy = deploy; st.sailStow = sailStow;

    if (!st.sm.init) { st.sm.h = h; st.sm.pitch = pitchDeg; st.sm.roll = rollDeg; st.sm.init = true; }
    const k = frameDt > 1e-6 ? 1 - Math.exp(-frameDt / POSE_TAU) : 0;
    st.sm.h += (h - st.sm.h) * k;
    st.sm.pitch += (pitchDeg - st.sm.pitch) * k;
    st.sm.roll += (rollDeg - st.sm.roll) * k;
    st.hVel = frameDt > 1e-6 ? (st.sm.h - st.hPrev) / frameDt : st.hVel;
    st.hPrev = st.sm.h;

    airParts.drive(t, {
      altitude: FLOAT_MODEL_Y + st.sm.h,     // 模型内部单位（包装层会缩到世界）
      pitch: st.sm.pitch, roll: st.sm.roll,
      propRpm: rpm, propAftReverse: aftRev, elevator,
      rudder: t < T.airDescend ? Math.sin(t * 0.7) * 2.5
        : t < T.airTouch ? -16 * Math.exp(-1.7 * ((t - T.airDescend) / TD)) * Math.cos(2.6 * ((t - T.airDescend) / TD)) + 1.6 * Math.sin(t * 2.3)
          : Math.sin(t * 1.1) * 1.4 * Math.exp(-(t - T.airTouch) * 0.5),
      paddleDeploy: deploy, paddleRpm,
      sailStow, auxRpm: Math.max(24, rpm * 0.5),
    });

    // ---- 硬保证：桥一旦开始升起，桥跨上不允许有任何交通体 ----
    // 为什么需要这条：用户明确"桥开启的时候不要有车悬空飞过去"。
    // 时序上（预告落杆提前 2 s → 开桥共 23 s，清空只需 4~6 s）本来就必然清空；
    // 但时序一旦被改动（改时间轴、改车速）就可能漏，这里做一道与时长无关的兜底。
    if (st.leaf > 0.5) {
      for (const c of traffic) {
        if (c.axis !== 'x' || Math.abs(c.s) >= SPAN_X) continue;
        c.s = c.dir > 0 ? -STOP_X : STOP_X;
        c.v = 0; c.dist = 0;
        if (c.g) { if (c.axis === 'x') c.g.position.x = c.s; }
      }
      for (const q of people) {
        if (q.axis !== 'x' || Math.abs(q.s) >= SPAN_X) continue;
        q.s = q.dir > 0 ? -STOP_X : STOP_X;
        q.v = 0;
        if (q.g) q.g.position.x = q.s;
      }
    }

    // ---- 悬浮车与行人 ----
    let spd = 0;
    if (t >= T.clear && t < T.confirm + 2) spd = 3.2 * smooth((t - T.clear) / 4);
    else if (t >= T.green) spd = 2.4;
    // ---- 交通：正常行驶；桥栏杆落下后，**没上桥的停在停止线等、已在桥上的加速驶离** ----
    // "桥不可通行"的窗口：从预告落杆前一点，一直到桥重新合拢（留下 5.5 s 让最后的车走完）
    // 栏杆放下的窗口：从预告落杆提前 2 s 起，到桥重新合拢后 5.5 s（给最后的车走完的时间）
    const bridgeBlocked = t >= T.warn - 2.0 && t <= T.closeStart + 5.5;
    for (const c of traffic) {
      let vT = c.v0;
      if (bridgeBlocked && c.axis === 'x') {
        // 用户口径（v10.0 修正）：
        //   · 已经在桥跨上的车 **保持常速走完** —— 不再"突然加速"
        //   · 还没到停车线的车 **在停车线外等**，绝不驶入桥跨
        //   · 已经过桥的车照常行驶
        // 关键不变量：**开桥期间桥跨上不能有车**（否则就是"从河上飞过去"）。
        // 窗口自预告落杆提前 2 s 起（t=6），到 29 s 开桥共 ~23 s；
        // 一辆车走完整个桥跨（2×SPAN_X ≈ 26 m）只要 4~6 s ⇒ 必然清空。
        const onSpan = Math.abs(c.s) < SPAN_X;
        // ★ 停车线必须在**自己这一侧**：+x 车停在 x = -STOP_X，-x 车停在 x = +STOP_X。
        //   曾经写成"两边都算到 +STOP_X" ⇒ 车为了去那条停车线反而**先开过了桥**，
        //   这正是「开桥时有车从河上飞过去」的真正根因。
        const near = c.dir > 0 ? -STOP_X : STOP_X;
        const approaching = c.dir > 0 ? (c.s < -SPAN_X) : (c.s > SPAN_X);
        if (onSpan) vT = c.v0;
        else if (approaching) {
          const d = c.dir > 0 ? (near - c.s) : (c.s - near);   // 到本侧停车线的距离
          vT = Math.max(0, Math.min(c.v0, d));
        }
      }
      c.v += (vT - c.v) * Math.min(1, frameDt / 0.55);
      c.s += c.dir * c.v * frameDt;
      const LIM = 152;
      if (c.s > LIM) c.s = -LIM;                                           // 环路循环，不会开丢
      if (c.s < -LIM) c.s = LIM;
      const g = c.g;
      if (c.axis === 'x') g.position.x = c.s; else g.position.z = c.s;
      c.dist += Math.abs(c.v) * frameDt;
      rollWheels(g, c.dist);                                               // 轮子按真实里程滚
    }
    // 行人：正常行走；栏杆落下时，桥上的人快速让开、还没上桥的人停下等
    for (const q of people) {
      let vT = q.v0;
      if (bridgeBlocked && q.axis === 'x') {
        // 行人：桥上的人快步让开（人听到铃声会小跑，这不算"飞"），
        //       桥头前的停下等，已过桥的照常走。阈值同样分两档。
        const onSpan = Math.abs(q.s) < SPAN_X;
        const approaching = q.dir > 0 ? (q.s < STOP_X) : (q.s > -STOP_X);
        vT = onSpan ? q.v0 * 2.4 : (approaching ? 0 : q.v0);
      }
      q.v += (vT - q.v) * Math.min(1, frameDt / 0.5);
      q.s += q.dir * q.v * frameDt;
      if (q.s > q.hi) { q.s = q.hi; q.dir = -1; }                          // 行人到端点折返（不穿模）
      if (q.s < q.lo) { q.s = q.lo; q.dir = 1; }
      const g = q.g;
      if (q.axis === 'x') { g.position.x = q.s; g.rotation.y = q.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
      else { g.position.z = q.s; g.rotation.y = q.dir > 0 ? 0 : Math.PI; }
      // 腿脚频率随速度（走得快步子就快）
      g.userData.parts.shuffle(t * (0.55 + q.v * 0.75) + q.ph);
    }

    return { t, leaf, gateT, signal: sig, h: st.sm.h, sailStow, deploy, spd };
  }

  function sailSeat(t) {
    const a = T.airTouch - 2.0, b = T.airTouch + 3.0;
    return Math.min(1, Math.max(0, (t - a) / (b - a)));
  }

  // -------------------------------------------------------------------------
  // 8) 性能收尾：描边外壳会让网格数翻倍。全场景里只保留英雄剪影的描边，
  //    小物件（螺栓/栏杆柱/小装饰）的外壳一律剥掉 —— 视觉几乎无差别，开销直接砍掉一大块。
  // -------------------------------------------------------------------------
  pruneSmallOutlines(root, 2.4);

  return {
    root, water, splash, bubbles, drive, traffic, people, state: st,
    snapshot() {
      return {
        t: prevT, leafDeg: st.leaf, cwT: st.cwT, gateT: st.gateT, signal: st.signal,
        airshipWorldLen: AIRSHIP.worldLen,
        airshipAltitudeWorld: +((FLOAT_MODEL_Y + st.sm.h) * SC).toFixed(3),
        h: st.sm.h, hVel: st.hVel, pitch: st.sm.pitch, roll: st.sm.roll,
        paddleDeploy: st.deploy, sailStow: st.sailStow,
        draftWorld: +(buoy.y * SC).toFixed(3), splashActive: splash.active,
        cityBuildings: cityStat ? cityStat.buildings : 0,
        cityMeshes: cityStat ? cityStat.merged : 0,
        citySkippedRoad: cityStat ? (cityStat.skippedRoad || 0) : 0,
        cityPrunedQuay: cityStat ? (cityStat.prunedQuay || 0) : 0,
        cityPrunedBridge: cityStat ? (cityStat.prunedBridge || 0) : 0,
        cityPrunedCross: cityStat ? (cityStat.prunedCross || 0) : 0,
        cityBackdrop: cityStat ? (cityStat.backdrop || 0) : 0,
        carLen: 5.6, streetTotal: STREET.total, canalWidth: CANAL.width,   // v9.5：车辆恢复 v8 原版，基准改为蒸汽机动车 5.6 m
      };
    },
    reset() {
      prevT = -1; st.landed = false; st.sm.init = false; st.waveSmooth = 0;
      st.hPrev = 0; st.hVel = 0; st.deploy = 0; st.sailStow = 0;
      buoy.reset(); pitchSpring.reset(); rollSpring.reset(); splash.reset();
      bubbles.update(0, false);
      airParts.setPaddleDeploy(0); airParts.setSailStow(0);
      parts.setLeafDeg(0); parts.setGateT(0); parts.setSignal('red');
      // 交通复位：车与行人回到初始里程与静止状态（原来这里引用的是已弃用的 onBridge 数组）
      for (const c of traffic) { c.s = c.s0; c.v = 0; c.dist = 0; rollWheels(c.g, 0); }
      for (const q of people) { q.s = q.s0; q.v = 0; q.dir = q.dir0; }
    airWrap.position.z = AIR_Z_FAR; splash.group.position.z = AIR_Z_TOUCH; bubbles.points.position.z = AIR_Z_TOUCH;
    },
    trace(tA, tB, step = 0.05) {
      this.reset();
      const out = [];
      for (let t = tA; t <= tB + 1e-9; t += step) {
        drive(t, step);
        out.push([+t.toFixed(3), +((FLOAT_MODEL_Y + st.sm.h) * SC).toFixed(4), +st.hVel.toFixed(4), +st.leaf.toFixed(2)]);
      }
      let maxJump = 0, at = 0, maxAcc = 0;
      for (let i = 4; i < out.length; i++) {
        const dy = Math.abs(out[i][1] - out[i - 1][1]);
        if (dy > maxJump) { maxJump = dy; at = out[i][0]; }
        maxAcc = Math.max(maxAcc, Math.abs(out[i][2] - out[i - 1][2]) / step);
      }
      return { step, n: out.length, maxFrameJump_m: +maxJump.toFixed(4), at, maxAccel: +maxAcc.toFixed(2) };
    },
  };
}

/** 剥掉小物件的描边外壳（保留英雄剪影） */
function pruneSmallOutlines(root, minRadius = 2.4) {
  const doomed = [];
  root.traverse((o) => {
    if (!o.isMesh || !(o.name || '').endsWith('_outline')) return;
    const p = o.parent;
    if (!p || !p.geometry) return;
    if (!p.geometry.boundingSphere) p.geometry.computeBoundingSphere();
    const r = (p.geometry.boundingSphere?.radius ?? 0);
    if (r < minRadius) doomed.push(o);
  });
  for (const d of doomed) d.parent.remove(d);
  root.userData.prunedOutlines = doomed.length;
  return doomed.length;
}

/** 飞艇内部单位下的浮力参数（与 assets/airship.js 的 SPEC 一致；此处避免循环依赖用字面量） */
const AIRSHIP_MODEL_MASS = 430;
const AIRSHIP_MODEL_AWP = 150;

export default { createScene, TIMELINE };
