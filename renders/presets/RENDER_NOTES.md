# Cranewick 四时段渲染 · 参数与要点（v3.12 定稿基线）

日期：2026-10-25 ｜ 全量参数见同目录 `cranewick_{morning,noon,dusk,night}_locked.json`

## 管线

```
canal_airship_fix.html（模型唯一权威来源）
  └─ tools/blender/export_server.py 8777（静态服务 + GLB 落盘）
  └─ tools/blender/export.mjs        （无头 Chromium 打开 ?t=30&freeze 导出）
       → renders/scene.glb
  └─ tools/blender/build_cranewick.py（Blender 全自动：导入→材质→灯光→渲染）
       Blender -b -P build_cranewick.py -- morning noon dusk night dumppreset saveblend
       （加 preview 参数 = 64 采样 35% 分辨率快速预览；正式 = 96 采样 100%）
```

## 模型导出要点（export.mjs）

- **t=30**：帆全张开、飞艇触水漂浮在 x=-9（t>33.4 会收帆挂帆卷）。
- `C.ship.root.name='SHIP_ROOT'`：GLB 无名节点在 Blender 里按导入顺序编号，
  不命名的话结构一变编号就漂（曾因 Node_432 消失崩溃）。
- 舷窗：HTML 的飞艇 fade 系统会把子树材质**全部 clone**（引用比较失效），
  按"MeshBasic + 构建原色 0xffc46a"识别克隆的舷窗材质（合并舷窗列/尾灯/
  探照灯透镜共 3 网格），替换为命名材质 `shipPorthole`。

## 渲染要点（build_cranewick.py）

- 气囊多层蒙皮按**导出原色指纹**（±0.045）调成奶油帆布系；Base Color 连着
  贴图时**必须先断链再设色**（否则被贴图覆盖，设了等于没设）。
- toon 描边壳（LIGHT_PATH+透明+深棕发光色 0.14/0.10/0.07）必须隐藏，否则
  在 Cycles 里罩住气囊成深棕壳；**同结构但发光色不同的玻璃/窗光/灯罩绝不能
  藏**（v3.11b 曾误藏导致窗户消失）。
- 飞艇探照灯：SEARCH spot（照物）+ CW_SearchBeam 发光锥（可见光束，
  轴向衰减×Fresnel 柔边，preset `beam` 控制白天隐藏）。
- 窗光 = 玻璃独立发光层（不受 Fresnel 稀释）× 逐窗噪声系数 0.42~1.35；
  morning 锁定为等效微光值。

## 时段设计决策（为什么）

| 时段 | 关键决策 |
|---|---|
| morning | 用户锁定基准：暖金晨光右侧顺光、Nishita 物理天空（太阳盘开启）。参数冻结于 JSON，重渲应与 2026-10-24 版一致（v3.6 后新增几何在 morning 下隐藏：店内陈设、探照灯锥、雨）。 |
| noon | 太阳 62° 偏西南（用户要求偏上方）；Nishita **太阳盘关闭**，方向光只由 CW_Sun 承担（此前天空太阳与 CW_Sun 方位打架、影子方向混乱）；水面靠镜面参数+天光反弹+专用 sheen 盘呈亮带。 |
| dusk | 真实日落：太阳 ~6° 西南偏西斜照（一侧金亮一侧冷暗，用户要求方向性）；**world 渐变暖色带必须压窄**（top_pos 0.10，过宽会把暗部全部染红）。 |
| night | 亮度层次：路灯 > 店铺橱窗（实体陈设+射灯）> 窗光；月光 37° 冷蓝单向轮廓；雨丝靠自发光 0.32+透明度 0.40 可见。 |

## 踩过的坑（回归检查表）

1. **BrightContrast 的 contrast>0 是平方运算**——暖色输入 G/B 被平方压碎成
   "红滤镜"。dusk/night 的 contrast 必须用 3.0 以下；morning/noon 输入中性
   不敏感。
2. **天空 glow 瓣**：dot^12 偶次幂让反太阳侧也亮瓣；world 的 Incoming 指向
   相机，方向要取 -gd 再 max(0,·)。
3. GLB 无名材质（`mat.xxx`）的 Blender 编号**每次导出都会漂移**——一切按名
   操作的材质表都是雷（BAND_TUNE 教训），改按色值指纹。
4. 飞艇 fade 克隆材质：`=== C.MAT.x` 永远不命中，按色匹配。
5. 店铺大玻璃是 `glass`/`glassDark`（rebuild 为 Fresnel 透明混合），隐藏
   描边壳时别误伤。
6. firefly：非 morning 模式 `sample_clamp_indirect=10`；preview 64 采样已够
   验证，1080p 96 采样。
