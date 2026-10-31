import bpy, bmesh, math, os, sys, time, random
import numpy as np
from mathutils import Vector, Matrix

ROOT = os.environ.get('CRANEWICK_ROOT') or os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'renders')
TEXDIR = os.path.join(OUT, 'textures')
os.makedirs(TEXDIR, exist_ok=True)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
MODES = [a for a in argv if a in ('morning', 'noon', 'dusk', 'night')] or ['morning']
PREVIEW = 'preview' in argv
NOGLOWSHELL = 'noglowshell' in argv
SAVE_BLEND = 'saveblend' in argv

random.seed(7)
np.random.seed(7)

def srgb(hexstr):
    h = hexstr.lstrip('#')
    v = [int(h[i:i+2], 16) / 255.0 for i in (0, 2, 4)]
    def f(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(f(c) for c in v)

# ------------------------------------------------------------------ scene
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, 'scene.glb'))
scene = bpy.context.scene
view_layer = bpy.context.view_layer

ship_root = bpy.data.objects.get('SHIP_ROOT') or bpy.data.objects.get('Node_432')
bridge_root = bpy.data.objects.get('Node_108')
world_root = bpy.data.objects.get('Node_505')

# hide toon outline shell and the leftover water slice
hidden_meshes = []
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    matnames = [ms.material.name for ms in o.material_slots if ms.material]
    if 'outline' in matnames or 'waterSlice' in matnames:
        o.hide_render = True
        o.hide_viewport = True
        hidden_meshes.append(o.name)
for o in bpy.data.objects:
    if o.type == 'MESH' and any(ms.material and ms.material.name == 'Material_39' for ms in o.material_slots):
        o.hide_render = True; o.hide_viewport = True; hidden_meshes.append(o.name)
for oname in ('Mesh_404',):
    o = bpy.data.objects.get(oname)
    if o:
        o.hide_render = True; o.hide_viewport = True; hidden_meshes.append(oname)
# v3.11b: 飞艇的 toon 描边壳（bakeToGroup 外扩 3cm 的深棕轮廓壳，靠背面
# 剔除只显轮廓线）在 GLB 里是无名材质（LIGHT_PATH+透明+发光混合），逃过了
# 上面的 'outline' 名字过滤；在 Cycles 里它罩住整个气囊成一层深棕壳——
# 四个时段飞艇都发深棕的根因。按节点指纹找出全部这类壳并隐藏。
for _o in bpy.data.objects:
    if _o.type != 'MESH':
        continue
    _hide = False
    for _ms in _o.material_slots:
        _m = _ms.material
        if not _m or not _m.use_nodes:
            continue
        _types = {_n.type for _n in _m.node_tree.nodes}
        if 'LIGHT_PATH' in _types and 'BSDF_TRANSPARENT' in _types:
            # 只有深棕描边色的是 toon 外壳；玻璃/窗光/灯罩等透明发光材质
            # 也用 LIGHT_PATH 结构，不能一并隐藏（v3.11b 曾误藏玻璃与窗光）。
            _em = next((_n for _n in _m.node_tree.nodes if _n.type == 'EMISSION'), None)
            if _em is not None:
                _ec = _em.inputs['Color'].default_value[:3]
                if (abs(_ec[0] - 0.14) < 0.06 and abs(_ec[1] - 0.10) < 0.06
                        and abs(_ec[2] - 0.07) < 0.06):
                    _hide = True
                    break
    if _hide:
        _o.hide_render = True
        _o.hide_viewport = True
        hidden_meshes.append(_o.name)
print('[scene] hidden outline/water meshes:', len(hidden_meshes))

# ------------------------------------------------------------------ collections
def make_coll(name):
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    return c

C_WATER = make_coll('CANAL_WATER')
C_PUDDLE = make_coll('PUDDLES')
C_RAIN = make_coll('RAIN')
C_DETAIL = make_coll('RAIN_DETAILS')
C_GLOW = make_coll('WATER_GLOW')
C_FX = make_coll('FX')
C_LIGHT = make_coll('LIGHTS')

def link_obj(obj, coll):
    coll.objects.link(obj)
    return obj

# ------------------------------------------------------------------ helpers
def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes.clear()
    out = m.node_tree.nodes.new('ShaderNodeOutputMaterial')
    bsdf = m.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
    m.node_tree.links.new(bsdf.outputs[0], out.inputs[0])
    return m, bsdf, out

def set_in(node, name, val):
    s = node.inputs.get(name)
    if s is not None:
        s.default_value = val

def set_color(node, name, val):
    for sock in node.inputs:
        if sock.name == name and sock.bl_idname == 'NodeSocketColor':
            sock.default_value = val
            return
    print('[warn] color socket missing', name)

def add_noise_bump(nt, bsdf, scale=20.0, detail=4.0, strength=0.15, rough_variation=0.0):
    tex = nt.nodes.new('ShaderNodeTexNoise')
    set_in(tex, 'Scale', scale)
    set_in(tex, 'Detail', detail)
    tex.inputs['Roughness'].default_value = 0.55
    bump = nt.nodes.new('ShaderNodeBump')
    set_in(bump, 'Strength', strength)
    set_in(bump, 'Distance', 0.08)
    nt.links.new(tex.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    if rough_variation > 0:
        mr = nt.nodes.new('ShaderNodeMapRange')
        mr.inputs['From Min'].default_value = 0.25
        mr.inputs['From Max'].default_value = 0.75
        mr.inputs['To Min'].default_value = max(0.0, bsdf.inputs['Roughness'].default_value - rough_variation)
        mr.inputs['To Max'].default_value = bsdf.inputs['Roughness'].default_value + rough_variation
        nt.links.new(tex.outputs['Fac'], mr.inputs['Value'])
        nt.links.new(mr.outputs['Result'], bsdf.inputs['Roughness'])

def image_bump(nt, bsdf, image, strength=0.32, distance=0.03):
    if image is None:
        return
    tex = nt.nodes.new('ShaderNodeTexImage')
    bi = image.copy()
    bi.colorspace_settings.name = 'Non-Color'
    tex.image = bi
    tex.interpolation = 'Linear'
    bump = nt.nodes.new('ShaderNodeBump')
    set_in(bump, 'Strength', strength)
    set_in(bump, 'Distance', distance)
    nt.links.new(tex.outputs['Color'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])

# ------------------------------------------------------------------ material pass
METAL_TARGETS = {
    'brass': (0.73, 0.48, 0.16),
    'brassHi': (0.95, 0.76, 0.42),
    'brassLo': (0.43, 0.29, 0.11),
    'bronze': (0.49, 0.29, 0.13),
    'copper': (0.64, 0.31, 0.18),
    'steel': (0.29, 0.31, 0.33),
    'iron': (0.24, 0.24, 0.27),
    'ironDark': (0.15, 0.15, 0.16),
}
METAL_KEYS = set(METAL_TARGETS)
FABRIC_KEYS = {'sail', 'sailCloth', 'canvasMat', 'envelope', 'felt', 'awningA', 'awningB', 'awningC', 'paper'}
STONE_KEYS = {'brickA', 'brickB', 'brickC', 'brickD', 'stone', 'slab', 'cobble', 'slate', 'terracotta', 'gravel'}
WOOD_KEYS = {'wood', 'woodDark', 'leather'}
GLASS_KEYS = {'glass', 'glassDark'}

metal_mats = []
fabric_mats = []
stone_mats = []
wood_mats = []
glass_mats = []
unlit_mats = []
emission_mats = []

for m in bpy.data.materials:
    if not m.use_nodes:
        m.use_nodes = True
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    key = m.name
    # duplicate names like mat.003 -> inspect base colour
    if bsdf is None:
        unlit_mats.append(m)
        continue
    bc = bsdf.inputs['Base Color'].default_value if 'Base Color' in bsdf.inputs else None
    c = tuple(bc[:3]) if bc else (0.5, 0.5, 0.5)
    is_metal = key in METAL_KEYS
    if not is_metal:
        for mk, mc in METAL_TARGETS.items():
            if sum((c[i] - mc[i]) ** 2 for i in range(3)) < 0.006:
                is_metal = True
                key = mk
                break
    # image bump for textured surfaces
    img = None
    for l in bsdf.inputs['Base Color'].links:
        if l.from_node.type == 'TEX_IMAGE':
            img = l.from_node.image
            break
    if is_metal:
        set_in(bsdf, 'Metallic', 1.0)
        set_in(bsdf, 'Roughness', 0.30)
        if img is None:
            add_noise_bump(nt, bsdf, scale=34, detail=3, strength=0.10, rough_variation=0.10)
        metal_mats.append(m)
    elif key in FABRIC_KEYS:
        set_in(bsdf, 'Roughness', 0.88)
        set_in(bsdf, 'Metallic', 0.0)
        if 'Sheen Weight' in bsdf.inputs:
            bsdf.inputs['Sheen Weight'].default_value = 0.35
            bsdf.inputs['Sheen Roughness'].default_value = 0.45
        if img is not None:
            image_bump(nt, bsdf, img, 0.22, 0.02)
        fabric_mats.append(m)
    elif key in STONE_KEYS:
        set_in(bsdf, 'Roughness', 0.78)
        set_in(bsdf, 'Metallic', 0.0)
        if img is not None:
            image_bump(nt, bsdf, img, 0.30, 0.025)
        add_noise_bump(nt, bsdf, scale=9, detail=3, strength=0.10)
        stone_mats.append(m)
    elif key in WOOD_KEYS or 'wood' in key:
        set_in(bsdf, 'Roughness', 0.62)
        if img is not None:
            image_bump(nt, bsdf, img, 0.20, 0.02)
        wood_mats.append(m)
    elif key in GLASS_KEYS:
        glass_mats.append(m)
    else:
        set_in(bsdf, 'Roughness', max(0.55, bsdf.inputs['Roughness'].default_value))
        if img is not None:
            image_bump(nt, bsdf, img, 0.12, 0.015)

# glass rebuild
# v3: how much of a grazing-angle mirror the pane keeps is per-time-of-day
# (P['glass_graze'] / P['glass_rough'] in PRESETS); morning keeps the locked v2
# values so its render stays bit-identical.
GLASS_NODES = {}
GLASS_EMIT = {}
GLASS_WINRAMP = {}

def rebuild_glass(m, dark):
    """Fresnel-weighted clear pane.

    v2: the old shader was a pure refractive slab (transmission 0.88, no alpha),
    so at the shallow angle we look at the shopfronts it behaved like a mirror and
    hid the interior. Now near-normal rays go straight through to the shop, and
    only grazing angles pick up a thin specular sheen.
    """
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    transp = nt.nodes.new('ShaderNodeBsdfTransparent')
    transp.inputs['Color'].default_value = (0.88, 0.94, 0.93, 1) if not dark else (0.82, 0.89, 0.90, 1)
    gloss = nt.nodes.new('ShaderNodeBsdfPrincipled')
    gloss.inputs['Base Color'].default_value = (0.05, 0.07, 0.075, 1) if dark else (0.09, 0.12, 0.13, 1)
    set_in(gloss, 'Roughness', 0.07 if dark else 0.045)
    set_in(gloss, 'IOR', 1.52)
    if 'Transmission Weight' in gloss.inputs:
        gloss.inputs['Transmission Weight'].default_value = 0.55 if dark else 0.75
    if 'Specular IOR Level' in gloss.inputs:
        gloss.inputs['Specular IOR Level'].default_value = 0.60
    lw = nt.nodes.new('ShaderNodeLayerWeight')
    lw.inputs['Blend'].default_value = 0.16
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = 0.02
    mr.inputs['From Max'].default_value = 0.80
    mr.inputs['To Min'].default_value = 0.01
    mr.inputs['To Max'].default_value = 0.52 if not dark else 0.62
    mr.clamp = True
    nt.links.new(lw.outputs['Fresnel'], mr.inputs['Value'])
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(mr.outputs['Result'], mix.inputs['Fac'])
    nt.links.new(transp.outputs[0], mix.inputs[1])
    nt.links.new(gloss.outputs[0], mix.inputs[2])
    # v3.6: 窗光独立层。旧实现把 emission 挂在 Fresnel 混合的镜面分支上，
    # 近法线方向（大窗正对相机的大部分面积）全走透明分支，夜里窗户光被
    # 稀释到 ~1/3，比路灯光池暗淡得多。这层不受 Fresnel 影响，由 preset
    # 的 glass_emit 直接驱动，能像路灯一样亮出光晕。
    # v3.7: 强度 = 基值 × 逐窗噪声系数（0.42~1.35）——共享材质下每扇窗
    # 亮暗不同，夜里不再是"整排同亮度的灯箱"。
    gem = nt.nodes.new('ShaderNodeEmission')
    gem.inputs['Color'].default_value = (*srgb('#ffc178'), 1)
    gbase = nt.nodes.new('ShaderNodeValue')
    gbase.outputs['Value'].default_value = 0.0
    gtc = nt.nodes.new('ShaderNodeTexCoord')
    # v3.14: 用 Voronoi（cell 级恒定值）代替连续噪声——噪声的渐变会让
    # 单扇窗呈现"半亮半暗"，Voronoi 让整扇窗取同一个亮暗值。
    gnoise = nt.nodes.new('ShaderNodeTexVoronoi')
    gnoise.inputs['Scale'].default_value = 0.45
    nt.links.new(gtc.outputs['Object'], gnoise.inputs['Vector'])
    gnmr = nt.nodes.new('ShaderNodeMapRange')
    gnmr.inputs['From Min'].default_value = 0.18
    gnmr.inputs['From Max'].default_value = 0.62
    gnmr.inputs['To Min'].default_value = 0.0
    gnmr.inputs['To Max'].default_value = 1.0
    gnmr.clamp = True
    nt.links.new(gnoise.outputs['Distance'], gnmr.inputs['Value'])
    # v3.13: 亮窗比例色带——dusk 只亮约一半窗（用户要求），night 大部分亮。
    # ramp 的阶跃位置由 preset 的 win_ramp 控制。
    gramp = nt.nodes.new('ShaderNodeValToRGB')
    gramp.color_ramp.interpolation = 'EASE'
    nt.links.new(gnmr.outputs['Result'], gramp.inputs['Fac'])
    gmul = nt.nodes.new('ShaderNodeMath'); gmul.operation = 'MULTIPLY'
    nt.links.new(gbase.outputs['Value'], gmul.inputs[0])
    nt.links.new(gramp.outputs[0], gmul.inputs[1])
    nt.links.new(gmul.outputs['Value'], gem.inputs['Strength'])
    GLASS_WINRAMP[m.name] = gramp
    add = nt.nodes.new('ShaderNodeAddShader')
    nt.links.new(mix.outputs[0], add.inputs[0])
    nt.links.new(gem.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], out.inputs[0])
    if 'Emission Color' in gloss.inputs:
        gloss.inputs['Emission Color'].default_value = (*srgb('#ffb066'), 1)
        gloss.inputs['Emission Strength'].default_value = 0.0
    m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else m.blend_method
    GLASS_NODES[m.name] = (mr, gloss)
    GLASS_EMIT[m.name] = gbase
    return gloss


for m in glass_mats:
    rebuild_glass(m, 'Dark' in m.name)

# unlit / emission materials
for m in unlit_mats:
    nt = m.node_tree
    em = next((n for n in nt.nodes if n.type == 'EMISSION'), None)
    if em is None:
        # convert to simple emissive
        nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(em.outputs[0], out.inputs[0])
    m['cranewick_emission'] = 1.0
    emission_mats.append(m)
    print('[mat] unlit', m.name)

# unlit glass gets rebuilt as a clear pane
for m in list(unlit_mats):
    if m.name in ('glass', 'glassDark'):
        rebuild_glass(m, 'Dark' in m.name)
        unlit_mats.remove(m)
        print('[mat] unlit glass -> clear', m.name)

# classify sign/unlit materials
SIGN_HINTS = ('Material_', 'Material.', 'sign')
for m in emission_mats:
    m['cw_base_emission'] = 1.0
    if m.name in ('windowGlow', 'interior'):
        m['cw_role'] = 'window'
    elif m.name in ('lampGlass', 'warmDim', 'redLamp'):
        m['cw_role'] = 'lamp'
    elif m.name == 'warnLamp':
        m['cw_role'] = 'marker'
    elif m.name == 'outline':
        m['cw_role'] = 'outline'
    else:
        m['cw_role'] = 'sign'

MARKER_MAT_NAMES = set()

# v3.13: 新模型桥上/船上的示廓灯——白色透明发光小面片，导出后是无名
# Material_xx（会被 SIGN_HINTS 误归为招牌）。按结构+发光色识别归为 marker，
# 发光色统一暖橙，dusk/night 由 preset 的 marker 点亮。
def _marker_maxdim(_mn):
    _mx = 0.0
    for _o in bpy.data.objects:
        if _o.type != 'MESH':
            continue
        if not any(ms.material and ms.material.name == _mn for ms in _o.material_slots):
            continue
        _bb = [_o.matrix_world @ Vector(c) for c in _o.bound_box]
        _mx = max(_mx, max(v.x for v in _bb) - min(v.x for v in _bb),
                  max(v.y for v in _bb) - min(v.y for v in _bb),
                  max(v.z for v in _bb) - min(v.z for v in _bb))
    return _mx

for _m in list(emission_mats):
    if _m.get('cw_role') != 'sign' or not _m.name.startswith('Material_'):
        continue
    _nts = {_n.type for _n in _m.node_tree.nodes}
    if 'BSDF_TRANSPARENT' not in _nts:
        continue
    _emn = next((_n for _n in _m.node_tree.nodes if _n.type == 'EMISSION'), None)
    if _emn is None:
        continue
    _ec = _emn.inputs['Color'].default_value[:3]
    # v3.15: 白色透明发光件里有大量 3~40m 的装饰灯带/示廓长条——整条
    # marker 化会爆亮成橙带（用户看到"绿色圆点"）。只有小灯珠(<1.2m)
    # 才算舷灯/示廓灯；长条保持 sign 的柔和微光。
    if all(abs(_ec[i] - 1.0) < 0.1 for i in range(3)) and _marker_maxdim(_m.name) < 1.2:
        _emn.inputs['Color'].default_value = (*srgb('#ffb266'), 1)
        _m['cw_role'] = 'marker'
        MARKER_MAT_NAMES.add(_m.name)
        print('[mat] marker light:', _m.name)

MARKER_MAT_NAMES.add('warnLamp')

# ------------------------------------------------------------------ airship windows / lamps
# v3.9: 上一版按"mat.xxx 小物体"猜窗，把收起的帆卷/桅架点亮了（真舷窗是
# merge 后的大 mesh，被尺寸条件漏掉）。现在改由导出端保证：MAT.warm 的
# 用户（吊舱两排舷窗×32 + 尾灯 + 探照灯透镜）在 export.mjs 里统一换成
# 命名材质 'shipPorthole'，这里按名字处理——底色保留暖橙，加可控发光，
# 全天内部亮灯（白天被外光盖住，晨/昏/夜可见）。
_pm = bpy.data.materials.get('shipPorthole')
if _pm is not None and _pm.use_nodes:
    _pnt = _pm.node_tree
    _pout = next((n for n in _pnt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
    _pbsdf = next((n for n in _pnt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if _pbsdf is None:
        _pbsdf = _pnt.nodes.new('ShaderNodeBsdfPrincipled')
        _pnt.links.new(_pbsdf.outputs[0], _pout.inputs[0])
    set_in(_pbsdf, 'Roughness', 0.35)
    _pem = _pnt.nodes.new('ShaderNodeEmission')
    _pem.inputs['Color'].default_value = (*srgb('#ffc46a'), 1)
    _pem.inputs['Strength'].default_value = 0.0
    _padd = _pnt.nodes.new('ShaderNodeAddShader')
    _pnt.links.new(_pbsdf.outputs[0], _padd.inputs[0])
    _pnt.links.new(_pem.outputs[0], _padd.inputs[1])
    _pnt.links.new(_padd.outputs[0], _pout.inputs[0])
    _pm['cw_role'] = 'porthole'
    _pm['cw_base_emission'] = 1.0
    emission_mats.append(_pm)
    print('[mat] shipPorthole -> glow')
# ------------------------------------------------------------------ normal maps
def save_img(name, rgb, path):
    h, w = rgb.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = rgb
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    img.reload()
    return img

def make_normal(kind, res=1024, tile=6.0):
    rng = np.random.default_rng(11 if kind != 'rain' else 23)
    u = np.linspace(0, 1, res, endpoint=False)
    X, Y = np.meshgrid(u * tile, u * tile)
    h = np.zeros_like(X)
    # periodic directional waves
    ncomp = 10 if kind == 'calm' else 14
    for i in range(ncomp):
        kx = int(rng.integers(1, 5))
        ky = int(rng.integers(1, 5))
        amp = rng.uniform(0.004, 0.016) * (tile / 6.0)
        ph = rng.uniform(0, 2 * np.pi)
        h += amp * np.sin(2 * np.pi * (kx * X / tile + ky * Y / tile) + ph)
    # broad swells: largest scale that still tiles
    for i in range(3):
        kx = int(rng.integers(1, 3))
        ky = int(rng.integers(1, 3))
        amp = rng.uniform(0.012, 0.030) * (tile / 6.0)
        ph = rng.uniform(0, 2 * np.pi)
        h += amp * np.sin(2 * np.pi * (kx * X / tile + ky * Y / tile) + ph)
    if kind == 'rain':
        drops = 520
        for i in range(drops):
            cx, cy = rng.uniform(0, tile, 2)
            r0 = rng.uniform(0.010, 0.052) * (tile / 4.0)
            width = rng.uniform(0.004, 0.014) * (tile / 4.0)
            amp = rng.uniform(0.0007, 0.0022)
            k = rng.uniform(90, 230)
            dx = X - cx; dy = Y - cy
            dx -= tile * np.round(dx / tile); dy -= tile * np.round(dy / tile)
            d = np.sqrt(dx * dx + dy * dy)
            ring = np.exp(-((d - r0) / width) ** 2)
            h += amp * ring * np.sin(k * (d - r0))
        # micro dimples
        for i in range(420):
            cx, cy = rng.uniform(0, tile, 2)
            w = rng.uniform(0.004, 0.014) * (tile / 4.0)
            amp = rng.uniform(0.0005, 0.0016)
            dx = X - cx; dy = Y - cy
            dx -= tile * np.round(dx / tile); dy -= tile * np.round(dy / tile)
            h -= amp * np.exp(-(dx * dx + dy * dy) / (w * w))
    gy, gx = np.gradient(h, tile / res, tile / res)
    strength = 1.0 if kind == 'calm' else 1.8
    nx = -gx * strength; ny = -gy * strength; nz = np.ones_like(nx)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5], axis=-1)
    return save_img('nrm_' + kind, rgb, os.path.join(TEXDIR, f'normal_{kind}.png'))

nrm_calm = make_normal('calm', 1024, 5.5)
nrm_rain = make_normal('rain', 1024, 4.0)
nrm_puddle = make_normal('rain', 1024, 1.8)

# ------------------------------------------------------------------ water
WATER_NODES = {}

def water_material(name, rain):
    m, bsdf, out = new_mat(name)
    bsdf.inputs['Base Color'].default_value = (0.012, 0.036, 0.041, 1) if rain else (0.009, 0.031, 0.035, 1)
    set_in(bsdf, 'Roughness', 0.08 if rain else 0.10)
    set_in(bsdf, 'IOR', 1.333)
    bsdf.inputs['Metallic'].default_value = 0.0
    if 'Coat Weight' in bsdf.inputs:
        bsdf.inputs['Coat Weight'].default_value = 0.30 if rain else 0.20
        bsdf.inputs['Coat Roughness'].default_value = 0.06 if rain else 0.12
    if 'Specular Tint' in bsdf.inputs:
        bsdf.inputs['Specular Tint'].default_value = (0.62, 0.88, 0.90, 1)
    nt = m.node_tree
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1/3.2 if rain else 1/7.0, 1/3.2 if rain else 1/7.0, 1.0)
    mp.inputs['Rotation'].default_value = (0, 0, math.radians(17 if rain else 0))
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = nrm_rain if rain else nrm_calm
    tex.interpolation = 'Linear'
    tex.extension = 'REPEAT'
    tex.image.colorspace_settings.name = 'Non-Color'
    nt.links.new(mp.outputs['Vector'], tex.inputs['Vector'])
    nm = nt.nodes.new('ShaderNodeNormalMap')
    set_in(nm, 'Strength', 2.10 if rain else 1.55)
    nt.links.new(tex.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    # broad gloss variation so the surface does not read as a flat slab
    rn = nt.nodes.new('ShaderNodeTexNoise')
    rn.inputs['Scale'].default_value = 0.32
    rn.inputs['Detail'].default_value = 2.0
    nt.links.new(tc.outputs['Object'], rn.inputs['Vector'])
    rmr = nt.nodes.new('ShaderNodeMapRange')
    rmr.inputs['From Min'].default_value = 0.30
    rmr.inputs['From Max'].default_value = 0.70
    rmr.inputs['To Min'].default_value = 0.09 if rain else 0.10
    rmr.inputs['To Max'].default_value = 0.22 if rain else 0.24
    rmr.clamp = True
    nt.links.new(rn.outputs['Fac'], rmr.inputs['Value'])
    nt.links.new(rmr.outputs['Result'], bsdf.inputs['Roughness'])
    WATER_NODES[name] = (bsdf, nm, rmr)
    return m

WM_DAY = water_material('CW_water_calm', False)
WM_RAIN = water_material('CW_water_rain', True)

def wave_height(x, y):
    z = 0.058 * np.sin(0.31 * x + 0.26 * y + 0.8)
    z += 0.034 * np.sin(-0.55 * x + 0.47 * y + 2.4)
    z += 0.020 * np.sin(1.05 * x + 0.82 * y + 4.1)
    z += 0.010 * np.sin(2.35 * x - 1.80 * y + 1.3)
    z += 0.006 * np.sin(3.90 * y + 0.7)
    z += 0.003 * np.sin(5.10 * x + 3.10 * y + 2.0)
    return z

def make_water_grid(name, x0, x1, y0, y1, nx, ny, z0, mat):
    xs = np.linspace(x0, x1, nx + 1)
    ys = np.linspace(y0, y1, ny + 1)
    verts = []
    for y in ys:
        for x in xs:
            verts.append((x, y, z0 + wave_height(x, y)))
    faces = []
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            b = a + 1
            c = a + nx + 2
            d = a + nx + 1
            faces.append((a, b, c, d))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    C_WATER.objects.link(ob)
    ob.data.materials.append(mat)
    return ob

water = make_water_grid('CW_CanalWater', -45.0, 96.5, -9.08, 9.08, 920, 160, -0.02, WM_DAY)

# soft out-of-focus light pools on the water (halo, not mirror)
def glow_material(name, color, strength, breakup=False):
    m, b, out = new_mat(name)
    b.inputs['Base Color'].default_value = (0, 0, 0, 1)
    set_in(b, 'Roughness', 1.0)
    if 'Emission Color' in b.inputs:
        b.inputs['Emission Color'].default_value = (*srgb(color), 1)
        b.inputs['Emission Strength'].default_value = strength
    nt = m.node_tree
    uv = nt.nodes.new('ShaderNodeUVMap')
    sub = nt.nodes.new('ShaderNodeVectorMath'); sub.operation = 'SUBTRACT'
    sub.inputs[1].default_value = (0.5, 0.5, 0.0)
    ln = nt.nodes.new('ShaderNodeVectorMath'); ln.operation = 'LENGTH'
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = 0.04
    mr.inputs['From Max'].default_value = 0.48
    mr.inputs['To Min'].default_value = 0.30
    mr.inputs['To Max'].default_value = 0.0
    mr.clamp = True
    nt.links.new(uv.outputs['UV'], sub.inputs[0])
    nt.links.new(sub.outputs['Vector'], ln.inputs[0])
    nt.links.new(ln.outputs['Value'], mr.inputs['Value'])
    if 'Alpha' in b.inputs:
        if breakup:
            tc = nt.nodes.new('ShaderNodeTexCoord')
            nz = nt.nodes.new('ShaderNodeTexNoise')
            nz.inputs['Scale'].default_value = 1.9
            nz.inputs['Detail'].default_value = 2.0
            nz.inputs['Roughness'].default_value = 0.55
            nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
            nr = nt.nodes.new('ShaderNodeValToRGB')
            nr.color_ramp.elements[0].position = 0.28
            nr.color_ramp.elements[0].color = (0, 0, 0, 1)
            nr.color_ramp.elements[1].position = 0.62
            nr.color_ramp.elements[1].color = (1, 1, 1, 1)
            nt.links.new(nz.outputs['Fac'], nr.inputs['Fac'])
            mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
            nt.links.new(mr.outputs['Result'], mul.inputs[0])
            nt.links.new(nr.outputs['Color'], mul.inputs[1])
            nt.links.new(mul.outputs[0], b.inputs['Alpha'])
        else:
            nt.links.new(mr.outputs['Result'], b.inputs['Alpha'])
    return m

GLOW_WARM = glow_material('CW_GlowWarm', '#ffb264', 1.1, breakup=True)
GLOW_COOL = glow_material('CW_GlowCool', '#9fc4e0', 0.7, breakup=True)

def add_water_glow(name, x, y, sx, sy, mat):
    verts = [(x - sx, y - sy, 0), (x + sx, y - sy, 0), (x + sx, y + sy, 0), (x - sx, y + sy, 0)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], [(0, 1, 2, 3)])
    me.update()
    uv = me.uv_layers.new(name='UVMap')
    for i, co in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv.data[i].uv = co
    ob = bpy.data.objects.new(name, me)
    C_GLOW.objects.link(ob)
    ob.location.z = 0.085
    ob.data.materials.append(mat)
    ob.visible_shadow = False
    return ob

for i, (gx, gy, gw, gh) in enumerate([
        (-20.1, -6.3, 0.62, 3.8), (-13.1, -6.6, 0.55, 3.3), (-6.1, -6.2, 0.68, 4.1),
        (20.1, -6.5, 0.58, 3.5), (-18.0, 6.2, 0.66, 4.0), (-11.0, 6.5, 0.56, 3.4),
        (-5.0, 6.0, 0.54, 3.2), (12.0, 6.4, 0.64, 3.8), (20.0, 6.2, 0.55, 3.3),
        (-9.0, 1.0, 0.7, 3.2), (2.0, -3.0, 0.55, 2.8)]):
    add_water_glow('CW_WaterGlow_%02d' % i, gx, gy, gw, gh, GLOW_WARM)
add_water_glow('CW_WaterGlowCool', 5.0, 1.5, 0.7, 2.6, GLOW_COOL)
GLOW_SHEEN = glow_material('CW_WaterSheenGlow', '#8fb0d0', 0.45)
for _sn in GLOW_SHEEN.node_tree.nodes:
    if _sn.type == 'MAP_RANGE':
        _sn.inputs['To Min'].default_value = 0.18
        _sn.inputs['To Max'].default_value = 0.0
add_water_glow('CW_WaterSheen', 0.0, 0.0, 20.0, 7.0, GLOW_SHEEN)

# a broad sky card that is visible only in reflections, so the canal gets a
# soft moon/sky sheen that reveals the wave normals at night
CARD_MAT = glow_material('CW_WaterSkyCard', '#8fb0d0', 2.2)
for _cn in CARD_MAT.node_tree.nodes:
    if _cn.type == 'MAP_RANGE':
        _cn.inputs['To Min'].default_value = 1.0
        _cn.inputs['To Max'].default_value = 0.0
_card_verts = [(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)]
_card_me = bpy.data.meshes.new('CW_WaterSkyCard')
_card_me.from_pydata([(x * 38, y * 24, z) for x, y, z in _card_verts], [], [(0, 1, 2, 3)])
_card_me.update()
_cu = _card_me.uv_layers.new(name='UVMap')
for _i, _co in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
    _cu.data[_i].uv = _co
_card = bpy.data.objects.new('CW_WaterSkyCard', _card_me)
C_GLOW.objects.link(_card)
_card.location = (14, 26, 32)
_card.rotation_euler = (Vector((-4, 0, 0)) - Vector(_card.location)).to_track_quat('Z', 'Y').to_euler()
_card.data.materials.append(CARD_MAT)
_card.visible_camera = False
_card.visible_diffuse = False
_card.visible_glossy = True
_card.visible_shadow = False

# foam material
def foam_material(name):
    m, bsdf, out = new_mat(name)
    bsdf.inputs['Base Color'].default_value = (0.58, 0.66, 0.63, 1)
    set_in(bsdf, 'Roughness', 0.38)
    set_in(bsdf, 'Metallic', 0.0)
    nt = m.node_tree
    tc = nt.nodes.new('ShaderNodeTexCoord')
    n1 = nt.nodes.new('ShaderNodeTexNoise')
    n1.inputs['Scale'].default_value = 14.0
    n1.inputs['Detail'].default_value = 8.0
    n1.inputs['Roughness'].default_value = 0.7
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.38
    ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
    ramp.color_ramp.elements[1].position = 0.62
    ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
    nt.links.new(tc.outputs['UV'], n1.inputs['Vector'])
    nt.links.new(n1.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bsdf.inputs['Alpha'])
    if 'Emission Color' in bsdf.inputs:
        bsdf.inputs['Emission Color'].default_value = (0.55, 0.65, 0.62, 1)
        bsdf.inputs['Emission Strength'].default_value = 0.02
    return m

FOAM = foam_material('CW_Foam')

def add_foam_object(name, verts, faces, uvs):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    uv = me.uv_layers.new(name='UVMap')
    for i, co in enumerate(uvs):
        uv.data[i].uv = co
    ob = bpy.data.objects.new(name, me)
    C_FX.objects.link(ob)
    ob.data.materials.append(FOAM)
    return ob

def strip_mesh(x0, x1, w0, w1, n=24, z=0.015, yc=0.0):
    verts, faces, uvs = [], [], []
    for i in range(n + 1):
        t = i / n
        x = x0 + (x1 - x0) * t
        w = w0 + (w1 - w0) * t
        verts += [(x, yc - w, z), (x, yc + w, z)]
        uvs += [(t * 2, 0), (t * 2, 1)]
    for i in range(n):
        a = i * 2
        faces.append((a, a + 1, a + 3, a + 2))
    return verts, faces, uvs

# wake behind stern (ship moves +X, so wake trails -X)
v, f, uv = strip_mesh(-17.3, -22.2, 1.9, 3.9, 24, 0.02, 0)
wake = add_foam_object('CW_Wake', v, f, uv)
# paddle churn discs
for side, yy in (('N', -2.25), ('S', 2.25)):
    bpy.ops.mesh.primitive_circle_add(vertices=32, radius=0.85, fill_type='NGON',
                                      location=(-7.9, yy, 0.03), rotation=(0, 0, 0))
    ob = bpy.context.object
    ob.name = 'CW_PaddleChurn_' + side
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    C_FX.objects.link(ob)
    ob.data.materials.append(FOAM)

# ------------------------------------------------------------------ puddles
PUDDLES = [
    (-21.2, 11.9, 2.8, 1.4, 0.3, 2.352), (-14.2, 11.65, 2.2, 1.3, 1.2, 2.352),
    (-6.8, 12.0, 3.2, 1.5, 2.0, 2.352), (0.9, 11.5, 1.8, 1.2, 0.7, 2.352),
    (8.7, 11.9, 2.4, 1.3, 2.6, 2.352), (16.2, 11.75, 2.6, 1.3, 1.6, 2.352),
    (-21.0, -11.7, 2.4, 1.3, 2.2, 2.352), (-15.4, -11.9, 2.8, 1.4, 0.5, 2.352),
    (-7.2, -11.6, 2.2, 1.3, 1.8, 2.352), (1.4, -11.95, 3.0, 1.5, 2.8, 2.352),
    (7.9, -11.7, 1.9, 1.2, 1.0, 2.352), (14.2, -11.9, 2.5, 1.3, 0.1, 2.352),
    (21.0, -11.6, 1.8, 1.2, 2.4, 2.352),
    (3.6, -15.2, 2.2, 1.4, 0.9, 2.502), (6.4, -16.6, 1.8, 1.5, 2.3, 2.502),
]

def puddle_material():
    m, bsdf, out = new_mat('CW_Puddle')
    bsdf.inputs['Base Color'].default_value = (0.016, 0.026, 0.030, 1)
    set_in(bsdf, 'Roughness', 0.012)
    set_in(bsdf, 'IOR', 1.333)
    if 'Coat Weight' in bsdf.inputs:
        bsdf.inputs['Coat Weight'].default_value = 0.8
        bsdf.inputs['Coat Roughness'].default_value = 0.01
    nt = m.node_tree
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1/1.8, 1/1.8, 1)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = nrm_puddle
    tex.extension = 'REPEAT'
    tex.image.colorspace_settings.name = 'Non-Color'
    nt.links.new(mp.outputs['Vector'], tex.inputs['Vector'])
    nm = nt.nodes.new('ShaderNodeNormalMap')
    set_in(nm, 'Strength', 0.8)
    nt.links.new(tex.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    return m

PM = puddle_material()

def make_puddle(i, x, y, w, h, rot, z):
    n = 80
    verts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        r = 0.5 + 0.06 * math.sin(a * 3 + i * 1.7) + 0.035 * math.sin(a * 7 + i)
        verts.append((math.cos(a) * r * w, math.sin(a) * r * h, 0))
    me = bpy.data.meshes.new('puddle_' + str(i))
    me.from_pydata(verts, [], [tuple(range(n))])
    me.update()
    ob = bpy.data.objects.new('CW_Puddle_' + str(i), me)
    C_PUDDLE.objects.link(ob)
    ob.location = (x, y, z + 0.004)
    ob.rotation_euler = (0, 0, rot)
    ob.data.materials.append(PM)
    # wet rim halo
    ob2 = ob.copy()
    ob2.data = me.copy()
    ob2.name = 'CW_WetRim_' + str(i)
    ob2.scale = (1.16, 1.16, 1)
    ob2.location.z -= 0.003
    halo = bpy.data.materials.new('CW_WetRim')
    halo.use_nodes = True
    nt = halo.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.030, 0.029, 0.026, 1)
    set_in(b, 'Roughness', 0.10)
    if 'Coat Weight' in b.inputs:
        b.inputs['Coat Weight'].default_value = 0.5
        b.inputs['Coat Roughness'].default_value = 0.04
    ob2.data.materials.clear()
    ob2.data.materials.append(halo)
    C_PUDDLE.objects.link(ob2)

for i, p in enumerate(PUDDLES):
    make_puddle(i, *p)

# ------------------------------------------------------------------ rain
def rain_material(night=False):
    m, bsdf, out = new_mat('CW_Rain')
    bsdf.inputs['Base Color'].default_value = (0.58, 0.66, 0.72, 1)
    # v3.15: 低粗糙+清漆让点光在雨丝上打出锐利高光——灯旁/光束内的
    # 雨滴显著更亮，暗处的雨保持含蓄。
    set_in(bsdf, 'Roughness', 0.08)
    set_in(bsdf, 'Metallic', 0.0)
    if 'Coat Weight' in bsdf.inputs:
        bsdf.inputs['Coat Weight'].default_value = 0.55
        bsdf.inputs['Coat Roughness'].default_value = 0.05
    bsdf.inputs['Alpha'].default_value = 0.30
    if 'Emission Color' in bsdf.inputs:
        bsdf.inputs['Emission Color'].default_value = (0.50, 0.60, 0.70, 1)
        bsdf.inputs['Emission Strength'].default_value = 0.06
    return m

RM = rain_material()

RAIN_CENTERS = []   # (vert_base, vert_count, center) 供光照暴露度分级

def build_rain(count=7000):
    rng = np.random.default_rng(5)
    verts, faces = [], []
    wind = Vector((0.16, 0.05, -1.0)); wind.normalize()
    for i in range(count):
        # cluster around camera's field of view
        x = rng.uniform(-30, 24)
        y = rng.uniform(-19, 19)
        z = rng.uniform(0.4, 21)
        L = rng.uniform(0.22, 0.58)
        w = rng.uniform(0.0016, 0.0045)
        c = Vector((x, y, z))
        d = wind * (L * 0.5)
        side = Vector((0.0, 1.0, 0.0)) * w
        a = c - d - side; b = c - d + side; cc = c + d - side; dd = c + d + side
        base = len(verts)
        verts += [tuple(a), tuple(b), tuple(cc), tuple(dd)]
        if i % 2 == 0:
            faces.append((base, base + 1, base + 2, base + 3))
            RAIN_CENTERS.append((base, 4, c.copy()))
        else:
            side2 = Vector((1.0, 0.0, 0.25)).normalized() * w
            a2 = c - d - side2; b2 = c - d + side2; c2 = c + d - side2; d2 = c + d + side2
            verts += [tuple(a2), tuple(b2), tuple(c2), tuple(d2)]
            faces.append((base + 4, base + 5, base + 6, base + 7))
            RAIN_CENTERS.append((base, 8, c.copy()))
    me = bpy.data.meshes.new('CW_RainStreaks')
    me.from_pydata(verts, [], faces)
    me.update()
    _attr = me.attributes.new('cw_lit', 'FLOAT', 'POINT')
    ob = bpy.data.objects.new('CW_RainStreaks', me)
    C_RAIN.objects.link(ob)
    me.materials.append(RM)
    ob.visible_shadow = False

build_rain()

def ring_batch(name, count, zone, rmin, rmax, z, seed=9, alpha=0.55):
    rng = np.random.default_rng(seed)
    verts, faces = [], []
    seg = 18
    for i in range(count):
        if zone == 'water':
            x = rng.uniform(-22, 22); y = rng.uniform(-8.7, 8.7)
            z = wave_height(x, y) + 0.008
        else:
            p = PUDDLES[int(rng.integers(0, len(PUDDLES)))]
            x = p[0] + rng.uniform(-0.5, 0.5) * p[2]; y = p[1] + rng.uniform(-0.5, 0.5) * p[3]
            z = p[5] + 0.008
        r = rng.uniform(rmin, rmax); wd = rng.uniform(0.008, 0.028)
        base = len(verts)
        for k in range(seg):
            a = 2 * math.pi * k / seg
            verts.append((x + math.cos(a) * (r - wd), y + math.sin(a) * (r - wd), z))
        for k in range(seg):
            a = 2 * math.pi * k / seg
            verts.append((x + math.cos(a) * (r + wd), y + math.sin(a) * (r + wd), z))
        for k in range(seg):
            k2 = (k + 1) % seg
            faces.append((base + k, base + k2, base + seg + k2, base + seg + k))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    C_DETAIL.objects.link(ob)
    m, bsdf, out = new_mat(name + '_mat')
    bsdf.inputs['Base Color'].default_value = (0.55, 0.62, 0.66, 1)
    set_in(bsdf, 'Roughness', 0.30)
    bsdf.inputs['Alpha'].default_value = alpha
    if 'Emission Color' in bsdf.inputs:
        bsdf.inputs['Emission Color'].default_value = (0.45, 0.55, 0.62, 1)
        bsdf.inputs['Emission Strength'].default_value = 0.05
    me.materials.append(m)
    return ob

ring_batch('CW_WaterRings', 170, 'water', 0.04, 0.17, 0.02, 9, 0.20)
ring_batch('CW_PuddleRings', 80, 'puddle', 0.03, 0.13, 0.0, 15, 0.26)

# nearby bokeh droplets
rng = np.random.default_rng(31)
for i in range(55):
    x = rng.uniform(-33, -22); y = rng.uniform(-22, -8); z = rng.uniform(5, 18)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=rng.uniform(0.006, 0.022),
                                         location=(x, y, z))
    ob = bpy.context.object; ob.name = 'CW_ForeDrops_%02d' % i
    for c in list(ob.users_collection): c.objects.unlink(ob)
    C_RAIN.objects.link(ob)
    m = bpy.data.materials.get('CW_Droplet') or new_mat('CW_Droplet')[0]
    if not ob.data.materials: ob.data.materials.append(m)
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.75, 0.82, 0.9, 1)
    set_in(b, 'Roughness', 0.02)
    set_in(b, 'IOR', 1.33)
    if 'Transmission Weight' in b.inputs: b.inputs['Transmission Weight'].default_value = 0.9

# ------------------------------------------------------------------ drips
DROP_MAT = new_mat('CW_DripWater')[0]
bdb = DROP_MAT.node_tree.nodes['Principled BSDF']
bdb.inputs['Base Color'].default_value = (0.68, 0.78, 0.82, 1)
set_in(bdb, 'Roughness', 0.03)
set_in(bdb, 'IOR', 1.33)
if 'Transmission Weight' in bdb.inputs: bdb.inputs['Transmission Weight'].default_value = 0.8

rng = np.random.default_rng(41)
drip_sources = []
for cx in (-19.5, -12.5, -5.5, 11.8, 20.4):
    for k in range(3):
        drip_sources.append((cx + rng.uniform(-2.6, 2.6), 11.82, rng.uniform(4.9, 5.6)))
for cx in (2.5, 5.0, 7.5):
    drip_sources.append((cx, 9.4, 6.2))
for i, (x, y, ztop) in enumerate(drip_sources):
    zbot = 2.36
    h = ztop - zbot
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.0055, depth=h, location=(x, y, zbot + h / 2))
    ob = bpy.context.object; ob.name = 'CW_Drip_%02d' % i
    for c in list(ob.users_collection): c.objects.unlink(ob)
    C_DETAIL.objects.link(ob)
    ob.data.materials.append(DROP_MAT)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=0.018, location=(x, y, zbot))
    d = bpy.context.object; d.name = 'CW_DropBead_%02d' % i
    for c in list(d.users_collection): c.objects.unlink(d)
    C_DETAIL.objects.link(d)
    d.data.materials.append(DROP_MAT)

# ------------------------------------------------------------------ steam puffs
def steam_material():
    m, bsdf, out = new_mat('CW_SteamPuff')
    bsdf.inputs['Base Color'].default_value = (0.86, 0.90, 0.92, 1)
    set_in(bsdf, 'Roughness', 1.0)
    bsdf.inputs['Alpha'].default_value = 0.0
    if 'Emission Color' in bsdf.inputs:
        bsdf.inputs['Emission Color'].default_value = (0.72, 0.78, 0.82, 1)
        bsdf.inputs['Emission Strength'].default_value = 0.10
    nt = m.node_tree
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 3.2
    nz.inputs['Detail'].default_value = 6.0
    nz.inputs['Roughness'].default_value = 0.65
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.40
    ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
    ramp.color_ramp.elements[1].position = 0.72
    ramp.color_ramp.elements[1].color = (0.55, 0.55, 0.55, 1)
    nt.links.new(nz.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bsdf.inputs['Alpha'])
    return m

STEAM = steam_material()

# lift the dark rib bands a touch so shadowed bronze still reads
for bn in ('bronze', 'brass', 'brassLo'):
    m = bpy.data.materials.get(bn)
    if m and m.use_nodes:
        b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if b and 'Emission Color' in b.inputs:
            b.inputs['Emission Color'].default_value = b.inputs['Base Color'].default_value
            b.inputs['Emission Strength'].default_value = 0.12

# ------------------------------------------------------------------ distant city extension
C_DIST = make_coll('DISTANT')
rngd = np.random.default_rng(77)

def simple_mat(name, col, rough=0.9):
    m, b, o = new_mat(name)
    b.inputs['Base Color'].default_value = (*col, 1)
    set_in(b, 'Roughness', rough)
    set_in(b, 'Metallic', 0.0)
    return m

DM = [simple_mat('CW_DistBrickA', srgb('#5e4938')),
      simple_mat('CW_DistBrickB', srgb('#4b3c31')),
      simple_mat('CW_DistBrickC', srgb('#6a5542')),
      simple_mat('CW_DistBrickD', srgb('#3f342c'))]
DIST_GROUND = simple_mat('CW_DistGround', srgb('#1d2024'), 0.92)
DIST_BANK = simple_mat('CW_DistBank', srgb('#4a4036'), 0.8)

def add_box(name, loc, dim, mat, coll=C_DIST):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.scale = dim
    for c in list(ob.users_collection): c.objects.unlink(ob)
    coll.objects.link(ob)
    ob.data.materials.append(mat)
    return ob

# huge ground under everything
add_box('CW_DistantGround', (10, 0, -5.62), (260, 220, 0.12), DIST_GROUND)

# far banks east of the block (water itself is part of the single displaced grid)
EXTRA_WATER = []
for side in (-1, 1):
    add_box('CW_EastBank_%d' % side, (72, side * 13.5, -1.4), (98, 9, 6.9), DIST_BANK)
    add_box('CW_EastWalk_%d' % side, (72, side * 11.1, 2.16), (98, 3.9, 0.16), DM[2])

WIN_MAT = bpy.data.materials.get('windowGlow')

def add_windows(x, y, z0, z1, face='west', count=6, seed=0):
    rr = np.random.default_rng(seed)
    for k in range(count):
        z = rr.uniform(z0, z1)
        yy = y + rr.uniform(-1.6, 1.6)
        if face == 'west':
            bpy.ops.mesh.primitive_plane_add(size=1, location=(x - 0.08, yy, z), rotation=(0, math.radians(-90), 0))
        else:
            bpy.ops.mesh.primitive_plane_add(size=1, location=(x, y - 0.08, z), rotation=(math.radians(90), 0, 0))
        ob = bpy.context.object
        ob.name = 'CW_DistWindow'
        ob.scale = (rr.uniform(0.6, 1.0), rr.uniform(0.9, 1.4), 1)
        for c in list(ob.users_collection): c.objects.unlink(ob)
        C_DIST.objects.link(ob)
        if WIN_MAT:
            ob.data.materials.append(WIN_MAT)

# low wharf sheds on the continuation, so the portal has foreground depth
for i, (xx, yy, ww, dd, hh) in enumerate([(30, -15.5, 9, 7, 6.2), (38, 16.5, 11, 8, 7.4),
                                          (52, -16.0, 12, 8, 8.0), (62, 17.2, 10, 7, 6.6)]):
    add_box('CW_EastShed_%d' % i, (xx, yy, 2.2 + hh / 2), (ww, dd, hh),
            bpy.data.materials.get('brickD') or DM[0])
    add_windows(xx - ww / 2 + 0.6, yy, 3.5, 2.2 + hh - 0.8, 'west', 4, 700 + i)

# east-bank distant terraces seen through the lift bridge
x = 56.0
bld = 0
while x < 96:
    w = rngd.uniform(6.5, 12.0)
    for side in (-1, 1):
        d = rngd.uniform(6.0, 10.0)
        h = rngd.uniform(7.0, 15.0)
        y = side * (15.0 + rngd.uniform(0.5, 7.0))
        mat = bpy.data.materials.get(['brickB','brickC','brickD','brickA'][bld % 4]) or DM[bld % len(DM)]
        add_box('CW_EastBld_%d' % bld, (x + w / 2, y, 2.2 + h / 2), (w, d, h), mat)
        if bld % 2 == 0:
            add_windows(x + w - 0.5, y, 4.2, 2.2 + h - 1.2, 'west', 7, 100 + bld)
        bld += 1
    x += w + rngd.uniform(1.2, 4.0)

# (distant skyline handled by backdrop)

for i in range(12):
    y = rngd.uniform(-55, 55)
    h = rngd.uniform(8, 26)
    add_box('CW_SkylineE_%d' % i, (118 + rngd.uniform(0, 10), y, -5.6 + h / 2),
            (rngd.uniform(7, 14), rngd.uniform(7, 14), h), DM[i % len(DM)])

# hazy far town: fills the high background band with a layered skyline
FAR_MATS = [simple_mat('CW_FarTownA', srgb('#3f4a55'), 0.95),
            simple_mat('CW_FarTownB', srgb('#4a5461'), 0.95),
            simple_mat('CW_FarTownC', srgb('#343e48'), 0.95),
            simple_mat('CW_FarTownD', srgb('#565f69'), 0.95)]
farn = 0
for gy in range(30, 121, 10):
    for gx in range(6, 132, 11):
        fx = gx + rngd.uniform(-3.2, 3.2)
        fy = gy + rngd.uniform(-3.0, 3.0)
        fw = rngd.uniform(5.0, 10.0)
        fd = rngd.uniform(5.0, 10.0)
        fh = rngd.uniform(5.5, 13.0) + gy * 0.075
        add_box('CW_FarTown_%d' % farn, (fx, fy, 2.0 + fh / 2), (fw, fd, fh),
                FAR_MATS[farn % len(FAR_MATS)])
        if farn % 7 == 0:
            add_box('CW_FarChimney_%d' % farn, (fx + fw * 0.22, fy - fd * 0.18, 2.0 + fh + 1.8),
                    (1.0, 1.0, 3.6), FAR_MATS[(farn + 1) % len(FAR_MATS)])
        farn += 1
for i, (tx, ty, th) in enumerate([(34, 74, 25), (58, 88, 30), (86, 66, 22), (112, 96, 27)]):
    add_box('CW_FarTower_%d' % i, (tx, ty, 2.0 + th / 2), (4.2, 4.2, th), FAR_MATS[1])
    add_box('CW_FarSpire_%d' % i, (tx, ty, 2.0 + th + 3.2), (1.2, 1.2, 6.4), FAR_MATS[2])

# ------------------------------------------------------------------ sky backdrop cyclorama
bpy.ops.mesh.primitive_cylinder_add(vertices=120, radius=132, depth=95, location=(0, 0, 34), end_fill_type='NOTHING')
cyc = bpy.context.object
cyc.name = 'CW_SkyBackdrop'
for c in list(cyc.users_collection): c.objects.unlink(cyc)
C_DIST.objects.link(cyc)
cyc.visible_shadow = False
cyc.data.materials.append(None)
bm = bpy.data.materials.new('CW_SkyBackdropMat')
bm.use_nodes = True
bnt = bm.node_tree
bnt.nodes.clear()
bout = bnt.nodes.new('ShaderNodeOutputMaterial')
bem = bnt.nodes.new('ShaderNodeEmission')
bnt.links.new(bem.outputs[0], bout.inputs[0])
btc = bnt.nodes.new('ShaderNodeTexCoord')
bsep = bnt.nodes.new('ShaderNodeSeparateXYZ')
bnt.links.new(btc.outputs['Object'], bsep.inputs['Vector'])
bmap = bnt.nodes.new('ShaderNodeMapRange')
bmap.inputs['From Min'].default_value = -45.0
bmap.inputs['From Max'].default_value = 55.0
bnt.links.new(bsep.outputs['Z'], bmap.inputs['Value'])
bramp = bnt.nodes.new('ShaderNodeValToRGB')
bnt.links.new(bmap.outputs['Result'], bramp.inputs['Fac'])
bem.inputs['Strength'].default_value = 0.55
bnt.links.new(bramp.outputs['Color'], bem.inputs['Color'])
cyc.data.materials.clear(); cyc.data.materials.append(bm)
CYC_RAMP = bramp
CYC_EM = bem
CYC_MAP = bmap

print('[distant]', bld, 'east buildings')

# ------------------------------------------------------------------ airship material detail
ENV_IMG = bpy.data.images.get('Image_7')
for o in ship_root.children_recursive:
    if o.type != 'MESH':
        continue
    if len(o.data.vertices) == 4477 and any(ms.material and ms.material.name == 'mat' for ms in o.material_slots):
        m, b, out = new_mat('CW_EnvelopeCanvas')
        nt = m.node_tree
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = ENV_IMG
        tex.interpolation = 'Linear'
        tint = nt.nodes.new('ShaderNodeMixRGB')
        tint.blend_type = 'MULTIPLY'
        tint.inputs['Fac'].default_value = 1.0
        tint.inputs['Color2'].default_value = (*srgb('#dcc198'), 1)
        nt.links.new(tex.outputs['Color'], tint.inputs['Color1'])
        nt.links.new(tint.outputs['Color'], b.inputs['Base Color'])
        set_in(b, 'Roughness', 0.93)
        set_in(b, 'Metallic', 0.0)
        set_in(b, 'Specular IOR Level', 0.28)
        if 'Sheen Weight' in b.inputs:
            b.inputs['Sheen Weight'].default_value = 0.25
            b.inputs['Sheen Roughness'].default_value = 0.5
        bi = ENV_IMG.copy(); bi.colorspace_settings.name = 'Non-Color'
        bt = nt.nodes.new('ShaderNodeTexImage'); bt.image = bi
        bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.30
        bump.inputs['Distance'].default_value = 0.012
        nt.links.new(bt.outputs['Color'], bump.inputs['Height'])
        nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
        o.material_slots[0].material = m
        print('[ship] envelope canvas set on', o.name)
        break

# v3.11: 气囊多层蒙皮按"色值指纹"统一调成奶油帆布系（HTML 原版观感：
# 飞艇亮奶油 RGB≈207/196/173）。旧 BAND_TUNE 按 mat.001-004 名字调——GLB
# 无名材质在 Blender 里的编号随导出顺序漂移，t=30 重导后错位命中，气囊被
# 强设深棕+金属化。现在只匹配飞艇子树实际使用的材质，且按导出原色对号。
#
# v3.28: 调色只允许作用在「气囊网格」上。原先直接改材质本身，而三档气囊指纹
# (0.95,0.76,0.42)/(0.73,0.48,0.16)/(0.43,0.29,0.11) 与 brassHi/brass/brassLo
# 的颜色完全重合（GLB 里同名共享材质），于是螺旋桨叶片、明轮叶片、桅杆箍、
# 齿轮这些机械件被一起刷成奶油（metal 0 / rough 0.84）——"白色螺旋桨"的真因。
# 现在给气囊网格复制独立材质（CW_EnvSkin_*）并只调副本，机械件保留原材质。
_SHIP_MATS = set()
for _o in ship_root.children_recursive:
    if _o.type == 'MESH':
        for _ms in _o.material_slots:
            if _ms.material:
                _SHIP_MATS.add(_ms.material.name)
ENVELOPE_TUNE = {
    (0.95, 0.76, 0.42): ((0.93, 0.88, 0.76, 1), 0.0, 0.86),   # 主帆布层
    (0.91, 0.85, 0.75): ((0.93, 0.89, 0.79, 1), 0.0, 0.86),   # 内衬
    (0.73, 0.48, 0.16): ((0.81, 0.72, 0.58, 1), 0.0, 0.84),   # 条纹层
    (0.49, 0.29, 0.13): ((0.73, 0.64, 0.52, 1), 0.0, 0.84),
    (0.43, 0.29, 0.11): ((0.71, 0.63, 0.52, 1), 0.0, 0.84),   # 深色带层
}
# 气囊组 = SHIP_ROOT 下顶点数最多的子树（多层蒙皮，约 8 万顶点）
_env_groups = []
for _ch in ship_root.children:
    _nv = sum(len(_o.data.vertices) for _o in _ch.children_recursive if _o.type == 'MESH')
    _env_groups.append((_nv, _ch))
_env_groups.sort(key=lambda t: -t[0])
_ENV_ROOT = _env_groups[0][1] if _env_groups else None
_ENV_COPIES = {}
if _ENV_ROOT is not None:
    print('[ship] envelope group', _ENV_ROOT.name, 'verts', _env_groups[0][0])
    for _o in _ENV_ROOT.children_recursive:
        if _o.type != 'MESH':
            continue
        for _slot in _o.material_slots:
            _m = _slot.material
            if not _m or not _m.name.startswith('mat'):
                continue
            if _m.name not in _ENV_COPIES:
                _c = _m.copy()
                _c.name = 'CW_EnvSkin_' + _m.name
                _ENV_COPIES[_m.name] = _c
            _slot.material = _ENV_COPIES[_m.name]
    print('[ship] envelope skin copies', len(_ENV_COPIES), sorted(_ENV_COPIES))

for _mn in sorted(_ENV_COPIES):
    _m = _ENV_COPIES[_mn]
    if not _m.use_nodes:
        continue
    _b = next((_n for _n in _m.node_tree.nodes if _n.type == 'BSDF_PRINCIPLED'), None)
    if _b is None:
        continue
    _cur = tuple(_b.inputs['Base Color'].default_value[:3])
    for _key, (_base, _met, _rough) in ENVELOPE_TUNE.items():
        if all(abs(_cur[k] - _key[k]) < 0.045 for k in range(3)):
            # GLB 材质的 Base Color 连着帆布贴图，不断开链接设色无效；
            # 贴图改作 bump 保留布纹细节。
            for _l in list(_b.inputs['Base Color'].links):
                _m.node_tree.links.remove(_l)
            _b.inputs['Base Color'].default_value = _base
            set_in(_b, 'Metallic', _met)
            set_in(_b, 'Roughness', _rough)
            _timg = None
            for _n in _m.node_tree.nodes:
                if _n.type == 'TEX_IMAGE' and _n.image:
                    _timg = _n.image
            if _timg is not None:
                image_bump(_m.node_tree, _b, _timg, 0.25, 0.012)
            print('[ship] envelope tuned', _m.name, _key, '->', _base[:3])
            break

for o in ship_root.children_recursive:
    if o.type == 'MESH' and len(o.data.vertices) > 8000:
        names = [ms.material.name for ms in o.material_slots if ms.material]
        if any(n in _SHIP_MATS for n in names):
            o.visible_shadow = False

# ------------------------------------------------------------------ airship material detail
# The envelope mesh is the large cream-canvas lathe; give it a dedicated fabric material.
for o in ship_root.children_recursive:
    if o.type != 'MESH':
        continue
    if len(o.data.vertices) == 4477 and any(ms.material and ms.material.name == 'mat' for ms in o.material_slots):
        src = next(ms.material for ms in o.material_slots if ms.material)
        m = src.copy(); m.name = 'CW_EnvelopeCanvas'
        nt = m.node_tree
        b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        for l in list(b.inputs['Base Color'].links):
            nt.links.remove(l)
        b.inputs['Base Color'].default_value = (0.88, 0.84, 0.73, 1)
        set_in(b, 'Roughness', 0.93)
        set_in(b, 'Metallic', 0.0)
        if 'Sheen Weight' in b.inputs:
            b.inputs['Sheen Weight'].default_value = 0.45
            b.inputs['Sheen Roughness'].default_value = 0.5
        img = None
        for l in b.inputs['Base Color'].links:
            if l.from_node.type == 'TEX_IMAGE':
                img = l.from_node.image
        if img:
            image_bump(nt, b, img, 0.34, 0.015)
        add_noise_bump(nt, b, scale=55, detail=2, strength=0.05)
        o.material_slots[0].material = m
        print('[ship] envelope material set on', o.name)
        break

# the ribs are close to the envelope; their long contact shadows read as black bands
for o in ship_root.children_recursive:
    if o.type == 'MESH' and len(o.data.vertices) > 8000:
        names = [ms.material.name for ms in o.material_slots if ms.material]
        if any(n in ('mat.002', 'mat.003', 'mat.004', 'brass', 'brassHi', 'brassLo') for n in names):
            o.visible_shadow = False
            print('[ship] rib shadows off', o.name, len(o.data.vertices))

# some glTF band meshes came in with inverted normals (rendered pitch black)
for o in ship_root.children_recursive:
    if o.type != 'MESH':
        continue
    names = [ms.material.name for ms in o.material_slots if ms.material]
    if any(n in ('mat.001', 'mat.003', 'mat.004') for n in names):
        me = o.data
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me); bm.free()
        me.update()
        print('[ship] normals recalculated', o.name, len(me.vertices), names)

# tone the brass: keep colour visible instead of mirror-black
for m in bpy.data.materials:
    b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if m.use_nodes else None
    if not b: continue
    c = tuple(round(v, 2) for v in b.inputs['Base Color'].default_value[:3])
    _raw = tuple(b.inputs['Base Color'].default_value[:3])
    # v3.28: 与 brass/brassHi 同色的无名材质（mat.002 / mat.003，气囊与机械件共享的
    # 那几档）也按黄铜收口，否则桨叶/明轮/桅杆会留在 metal 0.05 / rough 0.82 的哑粉状态。
    _alias_brass = any(all(abs(_raw[i] - t[i]) < 0.02 for i in range(3))
                       for t in ((0.949, 0.757, 0.416), (0.725, 0.478, 0.165)))
    if m.name in ('brass', 'brassHi') or _alias_brass:
        set_in(b, 'Metallic', 0.38)
        set_in(b, 'Roughness', 0.44)
    elif m.name == 'brassLo' or c == (0.43, 0.29, 0.11):
        b.inputs['Base Color'].default_value = (0.52, 0.36, 0.17, 1)
        set_in(b, 'Metallic', 0.20)
        set_in(b, 'Roughness', 0.55)
    elif m.name == 'bronze' or c == (0.49, 0.29, 0.13):
        b.inputs['Base Color'].default_value = (0.58, 0.38, 0.19, 1)
        set_in(b, 'Metallic', 0.18)
        set_in(b, 'Roughness', 0.56)
    elif m.name == 'copper' or c == (0.64, 0.31, 0.18):
        set_in(b, 'Metallic', 0.55)
        set_in(b, 'Roughness', 0.42)

# ------------------------------------------------------------------ camera
cam_data = bpy.data.cameras.new('CW_Camera')
cam_data.lens = 42
cam_data.sensor_width = 36
cam_data.sensor_fit = 'HORIZONTAL'
cam_data.clip_start = 0.1
cam_data.clip_end = 300
cam = bpy.data.objects.new('CW_Camera', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam.location = (-38.0, -26.0, 16.8)
target = Vector((-9.0, 0.0, 7.2))
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam_data.dof.use_dof = True
cam_data.dof.focus_distance = (target - cam.location).length
cam_data.dof.aperture_fstop = 5.0

# ------------------------------------------------------------------ lights
def add_light(name, kind, loc, energy, color, size=1.0, target=None, spot_size=None, spot_blend=0.3):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color
    if kind == 'AREA':
        ld.shape = 'RECTANGLE'
        ld.size = size
        ld.size_y = size
    if kind in ('POINT', 'SPOT'):
        ld.shadow_soft_size = size
    if kind == 'SPOT':
        ld.spot_size = spot_size or math.radians(40)
        ld.spot_blend = spot_blend
        ld.show_cone = False
    ob = bpy.data.objects.new(name, ld)
    scene.collection.objects.link(ob)
    ob.location = loc
    if target is not None:
        ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    C_LIGHT.objects.link(ob)
    scene.collection.objects.unlink(ob)
    return ob

def add_sun(name='CW_Sun'):
    ld = bpy.data.lights.new(name, 'SUN')
    ld.angle = math.radians(1.6)
    ob = bpy.data.objects.new(name, ld)
    scene.collection.objects.link(ob); C_LIGHT.objects.link(ob); scene.collection.objects.unlink(ob)
    return ob

SUN = add_sun()

SKY_FILL = add_light('CW_SkyFill', 'AREA', (0, -14, 34), 150, srgb('#a9c4dc'), size=34, target=(0, 0, 2))
HORIZON = add_light('CW_HorizonWarm', 'AREA', (-4, 26, 13), 0, srgb('#ff9b57'), size=14, target=(-7, 0, 2))
EAST_RIM = add_light('CW_EastRim', 'AREA', (22, -4, 13), 0, srgb('#bcd3e2'), size=12, target=(-4, 2, 2))
SHIP_FILL = add_light('CW_ShipFill', 'AREA', (-17, -7, 11), 0, srgb('#cfe2f0'), size=10, target=(-9, 0, 5.0))
SHIP_TOP = add_light('CW_ShipTop', 'AREA', (-12, -2, 15.5), 0, srgb('#ffe3bd'), size=8, target=(-9, 0, 6.0))
SHIP_BOUNCE = add_light('CW_ShipBounce', 'AREA', (-4, 8, 4), 0, srgb('#ffc98f'), size=4, target=(-9, 0, 3.0))
# 水面反照：真实日落时湿水面会把暖光弹回建筑下沿，旧版完全依赖天空补光，
# 所以下层墙面只能靠"自己亮"。这里加一盏仅可见漫反射的反射板。
WATER_BOUNCE = add_light('CW_WaterBounce', 'AREA', (0, 0, 0.15), 0, srgb('#ffb070'),
                         size=54, target=(0, 0, 16))
WATER_BOUNCE.data.size_y = 13
WATER_BOUNCE.visible_camera = False
WATER_BOUNCE.visible_glossy = False
WATER_BOUNCE.data.use_shadow = False
WATER_SHEEN = add_light('CW_WaterSheen', 'AREA', (18, 26, 22), 0, srgb('#9fc3d8'), size=80, target=(-4, 0, 0))
WATER_SHEEN.data.shape = 'DISK'
WATER_SHEEN.visible_diffuse = False
WATER_SHEEN.visible_glossy = True
WATER_SHEEN.visible_camera = False
WATER_SHEEN.data.use_shadow = False
SEARCH = add_light('CW_Searchlight', 'SPOT', (-6.89, -1.31, 2.70), 0, srgb('#ffd9b0'),
                   size=0.09, target=(14.73, 3.51, -1.59), spot_size=math.radians(19), spot_blend=0.35)

# v3.9: 飞艇探照灯的可见光束——锥壳发射面（轴向从灯端衰减到末端 +
# Fresnel 边缘柔化），白天隐藏，强度走 preset 的 beam。search spot 本身
# 继续负责照亮光束范围内的物体/水面。
_beam_len = 27.0
_beam_r = _beam_len * math.tan(math.radians(19)) * 0.8
bpy.ops.mesh.primitive_cone_add(radius1=_beam_r, radius2=0.14, depth=_beam_len,
                                location=(0, 0, 0), vertices=28)
BEAM = bpy.context.object
BEAM.name = 'CW_SearchBeam'
_beam_dir = (Vector((14.73, 3.51, -1.59)) - Vector((-6.89, -1.31, 2.70))).normalized()
BEAM.location = Vector((-6.89, -1.31, 2.70)) + _beam_dir * (_beam_len / 2)
BEAM.rotation_euler = (-_beam_dir).to_track_quat('Z', 'Y').to_euler()
BEAM.visible_shadow = False
_bm = bpy.data.materials.new('CW_Beam')
_bm.use_nodes = True
_bnt = _bm.node_tree; _bnt.nodes.clear()
_bout = _bnt.nodes.new('ShaderNodeOutputMaterial')
_btr = _bnt.nodes.new('ShaderNodeBsdfTransparent')
_btr.inputs['Color'].default_value = (*srgb('#ffe6c0'), 1)
_bem = _bnt.nodes.new('ShaderNodeEmission')
_bem.inputs['Color'].default_value = (*srgb('#ffe0ad'), 1)
_btc = _bnt.nodes.new('ShaderNodeTexCoord')
_bsep = _bnt.nodes.new('ShaderNodeSeparateXYZ')
_bnt.links.new(_btc.outputs['Object'], _bsep.inputs['Vector'])
# 轴向：局部 z 从 -L/2(远端) 到 +L/2(灯端) → 权重 0 → 1
_bmr = _bnt.nodes.new('ShaderNodeMapRange')
_bmr.inputs['From Min'].default_value = -_beam_len / 2
_bmr.inputs['From Max'].default_value = _beam_len / 2
_bmr.inputs['To Min'].default_value = 0.0
_bmr.inputs['To Max'].default_value = 1.0
_bnt.links.new(_bsep.outputs['Z'], _bmr.inputs['Value'])
# 边缘柔化：正对相机的中心亮、掠射边缘淡
_blw = _bnt.nodes.new('ShaderNodeLayerWeight')
_blw.inputs['Blend'].default_value = 0.4
_bpw = _bnt.nodes.new('ShaderNodeMath'); _bpw.operation = 'POWER'; _bpw.inputs[1].default_value = 1.6
_bnt.links.new(_blw.outputs['Facing'], _bpw.inputs[0])
_binv = _bnt.nodes.new('ShaderNodeMath'); _binv.operation = 'SUBTRACT'; _binv.inputs[0].default_value = 1.0
_bnt.links.new(_bpw.outputs['Value'], _binv.inputs[1])
_bmul1 = _bnt.nodes.new('ShaderNodeMath'); _bmul1.operation = 'MULTIPLY'
_bnt.links.new(_bmr.outputs['Result'], _bmul1.inputs[0])
_bnt.links.new(_binv.outputs['Value'], _bmul1.inputs[1])
# 全局强度（preset 驱动）
BEAM_VAL = _bnt.nodes.new('ShaderNodeValue')
BEAM_VAL.outputs['Value'].default_value = 0.0
_bmul2 = _bnt.nodes.new('ShaderNodeMath'); _bmul2.operation = 'MULTIPLY'
_bnt.links.new(_bmul1.outputs['Value'], _bmul2.inputs[0])
_bnt.links.new(BEAM_VAL.outputs['Value'], _bmul2.inputs[1])
_bmix = _bnt.nodes.new('ShaderNodeMixShader')
_bnt.links.new(_bmul2.outputs['Value'], _bmix.inputs['Fac'])
_bnt.links.new(_btr.outputs[0], _bmix.inputs[1])
_bnt.links.new(_bem.outputs[0], _bmix.inputs[2])
_bnt.links.new(_bmix.outputs[0], _bout.inputs[0])
BEAM.data.materials.append(_bm)
for _c in list(BEAM.users_collection):
    _c.objects.unlink(BEAM)
C_FX.objects.link(BEAM)

LAMP_POS = [(-20.1, 10.55), (-13.1, 10.55), (-6.1, 10.55), (20.1, 10.55)]
LAMP_N = [(-10.0, -10.55), (-0.9, -10.55), (12.7, -10.55), (19.9, -10.55)]
LAMPS = []
for i, (x, y) in enumerate(LAMP_POS + LAMP_N):
    ob = add_light('CW_Lamp_%d' % i, 'POINT', (x, y, 4.10), 0, srgb('#ffb35e'), size=0.26)
    LAMPS.append(ob)

# v3.14: 示廓/舷灯只发亮不照物——按 marker 网格的顶点位置布真实点光
# （间隔 1.7m 合并、上限 22 盏），把桥栏/船舷/桥头附近真正照亮。
# v3.16a: 桥大梁下缘的通航示廓灯——HTML 里是 Sprite 光斑（export 剥离），
# GLB 无实体所以是暗洞。按升降桥桥面 bbox 重建 8 对暖橙灯珠实体（随
# marker 材质走 preset 强度），下方点光扫描会顺手照亮它们。
def _lift_span_deck():
    # 升降桥面特征：横跨运河（y 向长）、x 向窄（<7m）。t=30 lift=1 时
    # 桥面抬到 z≈10（HTML deckWorld y=10.51），旧版误取 z 4~5 的低处构件
    # 导致灯珠悬空、正确位置全黑。
    best = None
    for _o in bpy.data.objects:
        if _o.type != 'MESH':
            continue
        _bb = [_o.matrix_world @ Vector(c) for c in _o.bound_box]
        _xs = [v.x for v in _bb]; _ys = [v.y for v in _bb]; _zs = [v.z for v in _bb]
        _yl = max(_ys) - min(_ys)
        if (_yl > 18 and 2.5 < sum(_xs) / 8 < 7.5
                and max(_xs) - min(_xs) < 7 and 7.0 < sum(_zs) / 8 < 12.0):
            if best is None or _yl > best[1]:
                best = ((min(_xs), max(_xs), min(_ys), max(_ys), min(_zs), max(_zs)), _yl)
    return best[0] if best else None

_nav_m, _nav_b, _nav_out = new_mat('CW_BridgeNavLamp')
set_in(_nav_b, 'Base Color', (0.05, 0.03, 0.012, 1))
set_in(_nav_b, 'Roughness', 0.4)
_nem = _nav_m.node_tree.nodes.new('ShaderNodeEmission')
_nem.inputs['Color'].default_value = (*srgb('#ffb347'), 1)
_nem.inputs['Strength'].default_value = 0.0
_nadd = _nav_m.node_tree.nodes.new('ShaderNodeAddShader')
_nav_m.node_tree.links.new(_nav_b.outputs[0], _nadd.inputs[0])
_nav_m.node_tree.links.new(_nem.outputs[0], _nadd.inputs[1])
_nav_m.node_tree.links.new(_nadd.outputs[0], _nav_out.inputs[0])
_nav_m['cw_role'] = 'marker'
_nav_m['cw_base_emission'] = 1.0
emission_mats.append(_nav_m)
MARKER_MAT_NAMES.add(_nav_m.name)
def _deck_glow_mat():
    # 示廓灯光斑：Mix(透明, 发光, Facing^5)——边缘处 Fac→0 时背景原样
    # 保留（无圆轮廓），辉光收在中心。教训：AddShader(透明,发光) 是概率
    # 采样，会把亮背景减半成暗圆；Mix 的合成才是"辉光叠加"的正确语义。
    _gm = bpy.data.materials.new('CW_BridgeNavGlow')
    _gm.use_nodes = True
    _gn = _gm.node_tree; _gn.nodes.clear()
    _go = _gn.nodes.new('ShaderNodeOutputMaterial')
    _ge = _gn.nodes.new('ShaderNodeEmission')
    _ge.inputs['Color'].default_value = (*srgb('#ffd9a8'), 1)
    _ge.inputs['Strength'].default_value = 0.0
    _gt = _gn.nodes.new('ShaderNodeBsdfTransparent')
    _glw = _gn.nodes.new('ShaderNodeLayerWeight')
    _glw.inputs['Blend'].default_value = 0.55
    _gcl = _gn.nodes.new('ShaderNodeMath'); _gcl.operation = 'MAXIMUM'
    _gcl.inputs[1].default_value = 0.0
    _gn.links.new(_glw.outputs['Facing'], _gcl.inputs[0])
    _gpw = _gn.nodes.new('ShaderNodeMath'); _gpw.operation = 'POWER'; _gpw.inputs[1].default_value = 5.0
    _gn.links.new(_gcl.outputs[0], _gpw.inputs[0])
    # 强度与混合系数同曲线：轮廓处两者同时归零，杜绝"亮轮廓线"
    _gmul = _gn.nodes.new('ShaderNodeMath'); _gmul.operation = 'MULTIPLY'
    _gn.links.new(_gpw.outputs[0], _gmul.inputs[0])
    _gbase = _gn.nodes.new('ShaderNodeValue')
    _gbase.outputs['Value'].default_value = 1.0
    _gn.links.new(_gbase.outputs['Value'], _gmul.inputs[1])
    _gn.links.new(_gmul.outputs['Value'], _ge.inputs['Strength'])
    _gmix = _gn.nodes.new('ShaderNodeMixShader')
    _gn.links.new(_gpw.outputs[0], _gmix.inputs['Fac'])
    _gn.links.new(_gt.outputs[0], _gmix.inputs[1])
    _gn.links.new(_ge.outputs[0], _gmix.inputs[2])
    _gn.links.new(_gmix.outputs[0], _go.inputs[0])
    return _gm, _gbase

_deck = _lift_span_deck()
if _deck:
    _x0, _x1, _y0, _y1, _z0, _z1 = _deck
    _yc = (_y0 + _y1) / 2
    # HTML: mk.position=(sx*3.55, deckY-0.5, -11.4+i*3.2)，deck 无缩放
    _cx = (_x0 + _x1) / 2
    # 精确挂点：HTML bridge.deckWorld 在 t=30(lift=1) 为 y=10.51，灯=deckY-0.5
    _lz = 10.01
    _glow_m, BRIDGE_NAV_GLOW = _deck_glow_mat()
    for _i in range(8):
        for _ex, _tag in ((_cx - 3.55, 'W'), (_cx + 3.55, 'E')):
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.16, segments=12, ring_count=8,
                location=(_ex, _yc + (11.4 - _i * 3.2), _lz))
            _ob = bpy.context.object
            _ob.name = 'CW_BridgeNav_%d%s' % (_i, _tag)
            _ob.data.materials.append(_nav_m)
            _ob.visible_shadow = False   # 点光在珠心：珠体投影=自己挡自己的光（黑圈根因）
            for _c in list(_ob.users_collection):
                _c.objects.unlink(_ob)
            C_FX.objects.link(_ob)
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.34, segments=16, ring_count=10,
                location=(_ob.location.x, _ob.location.y, _ob.location.z))
            _go = bpy.context.object
            _go.name = 'CW_BridgeNavGlow_%d%s' % (_i, _tag)
            _go.data.materials.append(_glow_m)
            for _c in list(_go.users_collection):
                _c.objects.unlink(_go)
            C_FX.objects.link(_go)
            _go.visible_shadow = False
            _go.hide_render = True   # v3.26: 概率采样边缘伪影，弃用光斑壳；
                                     # 柔光点=加大珠体+合成器眩光
    print('[bridge] nav clearance lamps built at deck-top z=%.2f' % _lz)

# v3.16b: 飞艇舷侧航行灯（左红 0xff453a / 右绿 0x30d158 小球，HTML 建模实体
# 在，光晕 Sprite 被剥离）——提亮自发光 + 红绿点光照亮附近艇体/气囊。
def _nav_halo_mat(tag, hexcol):
    _hm = bpy.data.materials.new('CW_NavHalo_%s' % tag)
    _hm.use_nodes = True
    _hn = _hm.node_tree; _hn.nodes.clear()
    _ho = _hn.nodes.new('ShaderNodeOutputMaterial')
    _he = _hn.nodes.new('ShaderNodeEmission')
    _he.inputs['Color'].default_value = (*srgb(hexcol), 1)
    _he.inputs['Strength'].default_value = 0.0
    _ht = _hn.nodes.new('ShaderNodeBsdfTransparent')
    _hlw = _hn.nodes.new('ShaderNodeLayerWeight')
    _hlw.inputs['Blend'].default_value = 0.5
    _hinv = _hn.nodes.new('ShaderNodeMath'); _hinv.operation = 'SUBTRACT'
    _hinv.inputs[0].default_value = 1.0
    _hn.links.new(_hlw.outputs['Facing'], _hinv.inputs[1])
    _hpw = _hn.nodes.new('ShaderNodeMath'); _hpw.operation = 'POWER'; _hpw.inputs[1].default_value = 2.2
    _hn.links.new(_hinv.outputs[0], _hpw.inputs[0])
    _hmix = _hn.nodes.new('ShaderNodeMixShader')
    _hn.links.new(_hpw.outputs[0], _hmix.inputs['Fac'])
    _hn.links.new(_ht.outputs[0], _hmix.inputs[1])
    _hn.links.new(_he.outputs[0], _hmix.inputs[2])
    _hn.links.new(_hmix.outputs[0], _ho.inputs[0])
    return _hm, _he

NAV_HALO_MATS = {}
for _tag, _col in (('red', '#ff5644'), ('green', '#3ee06a')):
    NAV_HALO_MATS[_tag] = _nav_halo_mat(_tag, _col)

NAVLIGHT_OBJS = []
for _o in ship_root.children_recursive:
    if _o.type != 'MESH':
        continue
    for _ms in _o.material_slots:
        _m = _ms.material
        if not _m or not _m.use_nodes:
            continue
        _em = next((_n for _n in _m.node_tree.nodes if _n.type == 'EMISSION'), None)
        if _em is None:
            continue
        _c = _em.inputs['Color'].default_value[:3]
        _kind = None
        if abs(_c[0] - 1.0) < 0.08 and abs(_c[1] - 0.271) < 0.12 and abs(_c[2] - 0.227) < 0.14:
            _kind = ('red', '#ff5644')
        elif abs(_c[0] - 0.188) < 0.14 and abs(_c[1] - 0.82) < 0.12 and abs(_c[2] - 0.345) < 0.14:
            _kind = ('green', '#3ee06a')
        if _kind:
            _m['cw_role'] = 'navlight'
            _m['cw_base_emission'] = 1.0
            emission_mats.append(_m)
            _p = _o.matrix_world.translation.copy()
            _lo = add_light('CW_NavLamp_%s' % _kind[0], 'POINT', tuple(_p), 0,
                            srgb(_kind[1]), size=0.38)
            NAVLIGHT_OBJS.append(_lo)
            _o.visible_shadow = False   # 舷灯球包住点光，必须免投影
            _o.scale = (_o.scale.x * 1.5, _o.scale.y * 1.5, _o.scale.z * 1.5)
            print('[ship] nav lamp %s at (%.1f,%.1f,%.1f)' % (_kind[0], _p.x, _p.y, _p.z))

_marker_pts = []
for _o in bpy.data.objects:
    if _o.type != 'MESH':
        continue
    if not any(ms.material and ms.material.name in MARKER_MAT_NAMES for ms in _o.material_slots):
        continue
    _bb2 = [_o.matrix_world @ Vector(c) for c in _o.bound_box]
    if max(max(v.x for v in _bb2) - min(v.x for v in _bb2),
           max(v.y for v in _bb2) - min(v.y for v in _bb2),
           max(v.z for v in _bb2) - min(v.z for v in _bb2)) > 1.2:
        continue
    _mw = _o.matrix_world
    for _v in _o.data.vertices:
        _p = _mw @ _v.co
        if all((_p - _q).length > 1.7 for _q in _marker_pts):
            _marker_pts.append(_p.copy())
if len(_marker_pts) > 22:
    _step = int(len(_marker_pts) / 22) + 1
    _marker_pts = _marker_pts[::_step]
MARKER_LIGHTS = []
for _i, _p in enumerate(_marker_pts):
    _ob = add_light('CW_Marker_%d' % _i, 'POINT', tuple(_p), 0, srgb('#ffb266'), size=0.35)
    MARKER_LIGHTS.append(_ob)
print('[lights] marker point lights:', len(MARKER_LIGHTS))


# ------------------------------------------------------------------ lamp halos
# 真实镜头里灯泡周围会有一层柔光；Cycles 的 Glare 对这种小面积高亮不够稳，
# 直接在每个灯头套一个"面法向渐变"的发光球，任何机位都能读到光晕。
C_HALO = make_coll('LAMP_HALO')
_hnt = bpy.data.materials.new('CW_LampHalo')
_hnt.use_nodes = True
_hn = _hnt.node_tree
_hn.nodes.clear()
_hout = _hn.nodes.new('ShaderNodeOutputMaterial')
_hem = _hn.nodes.new('ShaderNodeEmission')
_hem.inputs['Color'].default_value = (*srgb('#ffb267'), 1)
_hem.inputs['Strength'].default_value = 9.0
_htr = _hn.nodes.new('ShaderNodeBsdfTransparent')
_hlw = _hn.nodes.new('ShaderNodeLayerWeight')
_hlw.inputs['Blend'].default_value = 0.5
_hinv = _hn.nodes.new('ShaderNodeMath'); _hinv.operation = 'SUBTRACT'
_hinv.inputs[0].default_value = 1.0
_hn.links.new(_hlw.outputs['Facing'], _hinv.inputs[1])
_hpw = _hn.nodes.new('ShaderNodeMath'); _hpw.operation = 'POWER'; _hpw.inputs[1].default_value = 2.4
_hn.links.new(_hinv.outputs[0], _hpw.inputs[0])
_hmix = _hn.nodes.new('ShaderNodeMixShader')
_hn.links.new(_hpw.outputs[0], _hmix.inputs['Fac'])
_hn.links.new(_htr.outputs[0], _hmix.inputs[1])
_hn.links.new(_hem.outputs[0], _hmix.inputs[2])
_hn.links.new(_hmix.outputs[0], _hout.inputs[0])
HALO_MAT = _hnt
HALOS = []
for i, (x, y) in enumerate(LAMP_POS + LAMP_N):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.34, location=(x, y, 4.10), segments=20, ring_count=12)
    ob = bpy.context.object
    ob.name = 'CW_LampHalo_%d' % i
    ob.data.materials.append(_hnt)
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    C_HALO.objects.link(ob)
    ob.visible_shadow = False
    HALOS.append(ob)

SHOP_LIGHTS = []
for i, (x, y) in enumerate([(-18.0, 12.0), (-11.0, 12.0), (-5.0, 12.0), (12.0, 12.0), (20.0, 12.0)]):
    ob = add_light('CW_ShopSpill_%d' % i, 'AREA', (x, y, 3.3), 0, srgb('#ffb968'), size=3.2, target=(x, -2.0, 2.0))
    SHOP_LIGHTS.append(ob)

# 店内没有真实灯位（GLB 里店内只有一张贴图），这里在橱窗后方补暖光点，
# 让玻璃后面读得出货架/柜台的明暗层次，而不是一块反光板。
SHOP_INSIDE = []
for i, x in enumerate([-26.0, -22.0, -18.0, -14.0, -10.0, -6.0, -2.0, 6.0, 10.0, 14.0, 18.0, 22.0, 26.0]):
    # 橱窗里塞满货品，灯放进去只会被埋住；改成窗外一束窄光斜射进柜台
    ob = add_light('CW_ShopInside_%d' % i, 'SPOT', (x, 12.35, 3.75), 0, srgb('#ffc07a'),
                   size=0.12, target=(x + 0.4, 15.5, 3.0), spot_size=math.radians(62), spot_blend=0.55)
    SHOP_INSIDE.append(ob)

# 南岸店铺背对运河，店里原来一盏灯都没有，夜里隔着玻璃只能看到黑店；
# 镜像补一排同规格暖光。
SHOP_INSIDE_S = []
for i, x in enumerate([-10.0, -0.6, 12.8, 20.0, 6.0]):
    ob = add_light('CW_ShopInsideS_%d' % i, 'SPOT', (x, -12.35, 3.75), 0, srgb('#ffc07a'),
                   size=0.12, target=(x + 0.4, -15.5, 3.0), spot_size=math.radians(62), spot_blend=0.55)
    SHOP_INSIDE_S.append(ob)

# v3.16c: 雨丝"被照亮"——按每根雨丝到灯（路灯/店铺/示廓/舷灯）与探照灯
# 光束轴的距离算暴露度，写进顶点属性 cw_lit；材质里用属性放大自发光，
# 灯下/光束内的雨丝显著更亮，暗处含蓄。
_lit_pts = [(_lo.location, 2.1, 3.0) for _lo in LAMPS]
_lit_pts += [(_lo.location, 2.0, 1.6) for _lo in SHOP_LIGHTS]
_lit_pts += [(_lo.location, 1.2, 2.0) for _lo in MARKER_LIGHTS]
_lit_pts += [(_lo.location, 1.6, 1.4) for _lo in NAVLIGHT_OBJS]
_sdir = (Vector((14.73, 3.51, -1.59)) - SEARCH.location).normalized()
_rain_me = bpy.data.objects['CW_RainStreaks'].data
_vals = np.zeros(len(_rain_me.vertices), dtype=np.float32)
for _base, _nv, _c in RAIN_CENTERS:
    _v = 0.0
    for _p, _r, _w in _lit_pts:
        _d2 = (_c - _p).length_squared
        _v += _w / (1.0 + _d2 / (_r * _r))
    _t = (_c - SEARCH.location).dot(_sdir)
    if 0.0 < _t < 26.0:
        _rad = 0.25 + 0.30 * _t
        _dist = (_c - SEARCH.location - _sdir * _t).length
        _v += 2.6 * max(0.0, 1.0 - _dist / _rad)
    _lit = min(1.0, _v / 4.2)
    _vals[_base:_base + _nv] = _lit
_rain_me.attributes['cw_lit'].data.foreach_set('value', _vals)
# 材质：cw_lit → 1..9 倍率 × 基础 rain_emit → Emission Strength
_rat = RM.node_tree.nodes.new('ShaderNodeAttribute')
_rat.attribute_name = 'cw_lit'
_rmr2 = RM.node_tree.nodes.new('ShaderNodeMapRange')
_rmr2.inputs['From Min'].default_value = 0.0
_rmr2.inputs['From Max'].default_value = 1.0
_rmr2.inputs['To Min'].default_value = 1.0
_rmr2.inputs['To Max'].default_value = 13.0
RM.node_tree.links.new(_rat.outputs['Fac'], _rmr2.inputs['Value'])
RAIN_EM_VAL = RM.node_tree.nodes.new('ShaderNodeValue')
RAIN_EM_VAL.outputs['Value'].default_value = 0.1
_rmul3 = RM.node_tree.nodes.new('ShaderNodeMath'); _rmul3.operation = 'MULTIPLY'
RM.node_tree.links.new(_rmr2.outputs['Result'], _rmul3.inputs[0])
RM.node_tree.links.new(RAIN_EM_VAL.outputs['Value'], _rmul3.inputs[1])
RM.node_tree.links.new(_rmul3.outputs['Value'],
                       RM.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'])
print('[rain] exposure tiers written')


# ------------------------------------------------------------------ shop interiors
# v3: GLB 里店内只有一圈发光贴图，隔着玻璃看是"一块均匀亮板"。往每家店里塞
# 实体陈设（地板/货架/柜台/吊灯），被 SHOP_INSIDE 的窄光扫出真实明暗层次，
# 玻璃后就有可读的细节了。morning 模式整组隐藏，锁定图不随之改变。
C_SHOPINT = make_coll('SHOP_INTERIORS')

NORTH_SHOPS = [(-20.1, 1), (-13.1, 2), (-6.1, 3), (11.2, 4), (19.8, 5)]   # (窗中心x, 种子)
SOUTH_SHOPS = [(-10.0, 6), (-0.6, 7), (12.8, 8), (20.0, 9)]

def _shop_box(name, cx, cy, cz, sx, sy, sz, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, cy, cz))
    ob = bpy.context.object
    ob.name = name
    ob.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    ob.data.materials.append(mat)
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    C_SHOPINT.objects.link(ob)
    return ob

def build_shop_interiors():
    # shared materials
    floor_m, fb, _ = new_mat('CW_ShopFloor')
    set_in(fb, 'Base Color', (0.30, 0.21, 0.14, 1)); set_in(fb, 'Roughness', 0.62)
    shelf_m, sb, _ = new_mat('CW_ShopShelf')
    set_in(sb, 'Base Color', (0.30, 0.19, 0.11, 1)); set_in(sb, 'Roughness', 0.55)
    counter_m, cbt, _ = new_mat('CW_ShopCounter')
    set_in(cbt, 'Base Color', (0.55, 0.44, 0.30, 1)); set_in(cbt, 'Roughness', 0.5)
    goods_m, gb_, _ = new_mat('CW_ShopGoods')
    set_in(gb_, 'Base Color', (0.78, 0.61, 0.42, 1)); set_in(gb_, 'Roughness', 0.6)
    pend_m = bpy.data.materials.new('CW_ShopPendant')
    pend_m.use_nodes = True
    _pn = pend_m.node_tree; _pn.nodes.clear()
    _pout = _pn.nodes.new('ShaderNodeOutputMaterial')
    _pem = _pn.nodes.new('ShaderNodeEmission')
    _pem.inputs['Color'].default_value = (*srgb('#ffc98a'), 1)
    _pem.inputs['Strength'].default_value = 0.0
    _pn.links.new(_pem.outputs[0], _pout.inputs[0])
    pend_m['cw_role'] = 'pendant'
    pend_m['cw_base_emission'] = 1.0
    emission_mats.append(pend_m)

    FLOOR_Z = 2.34
    for shops, sgn in ((NORTH_SHOPS, 1.0), (SOUTH_SHOPS, -1.0)):
        for cx, seed in shops:
            r = random.Random(seed)
            wall_y = 13.1 * sgn          # 玻璃所在立面
            back_y = 16.6 * sgn          # 店内深处
            mid_y = (wall_y + back_y) / 2
            half_w = 1.45
            # 地板
            _shop_box('SI_Floor', cx, mid_y + sgn * 0.9, FLOOR_Z - 0.02, half_w * 2 + 0.3, 3.4, 0.04, floor_m)
            # 靠侧墙货架 x2（背板 + 3 层横板）
            for sx_ in (cx - half_w + 0.45, cx + half_w - 0.45):
                _shop_box('SI_ShelfBack', sx_, back_y - sgn * 0.15, FLOOR_Z + 0.88, 0.95, 0.05, 1.76, shelf_m)
                for li in range(3):
                    _shop_box('SI_ShelfBoard', sx_, back_y - sgn * 0.32, FLOOR_Z + 0.45 + li * 0.55, 0.95, 0.30, 0.045, shelf_m)
                    if r.random() < 0.8:   # 货物盒
                        _shop_box('SI_Goods', sx_ + r.uniform(-0.25, 0.25), back_y - sgn * 0.32,
                                  FLOOR_Z + 0.58 + li * 0.55, r.uniform(0.22, 0.34), 0.2, r.uniform(0.16, 0.26), goods_m)
            # 柜台（离玻璃 1.4m，最显眼的位置）
            _shop_box('SI_Counter', cx + r.uniform(-0.3, 0.3), wall_y + sgn * 1.4, FLOOR_Z + 0.48,
                      r.uniform(1.3, 1.6), 0.5, 0.92, counter_m)
            for k in range(2):            # 台面上零货
                _shop_box('SI_CGoods', cx + r.uniform(-0.55, 0.55), wall_y + sgn * 1.4 + r.uniform(-0.1, 0.1),
                          FLOOR_Z + 1.05, r.uniform(0.18, 0.3), r.uniform(0.15, 0.25), r.uniform(0.12, 0.2), goods_m)
            # 吊灯 x2（发光小球，强度走 preset 的 pendant）
            for px in (cx - 0.7, cx + 0.7):
                bpy.ops.mesh.primitive_uv_sphere_add(radius=0.085, location=(px, mid_y + sgn * 0.6, FLOOR_Z + 1.78),
                                                     segments=16, ring_count=10)
                ob = bpy.context.object
                ob.name = 'SI_Pendant'
                ob.data.materials.append(pend_m)
                for c in list(ob.users_collection):
                    c.objects.unlink(ob)
                C_SHOPINT.objects.link(ob)
    print('[shop] interiors built:', len(C_SHOPINT.objects), 'objects')

build_shop_interiors()

SHIP_LIGHTS = []
for i, (x, y, z) in enumerate([(-12.5, 1.4, 3.0), (-8.0, -1.5, 2.9), (-3.5, 1.2, 3.2)]):
    ob = add_light('CW_ShipLight_%d' % i, 'POINT', (x, y, z), 0, srgb('#ffb45e'), size=0.2)
    SHIP_LIGHTS.append(ob)
for _l in (SHIP_FILL, SHIP_TOP, SHIP_BOUNCE):
    _l.visible_glossy = False
    _l.visible_camera = False

# v3: 原灯位悬在 z=16 的半空（照不到桥），下移到桥拱上方 1m，
# 让它真正在桥面上形成光池和光晕。
BRIDGE_LIGHT = add_light('CW_BridgeLight', 'POINT', (5.0, 0.0, 6.0), 0, srgb('#ffae62'), size=0.35)

# ------------------------------------------------------------------ wet glitter paths
C_GLINT = make_coll('GLINTS')
glint_bsdf = None

def glint_material():
    global glint_bsdf
    m, b, o = new_mat('CW_Glint')
    b.inputs['Base Color'].default_value = (0.02, 0.02, 0.02, 1)
    set_in(b, 'Roughness', 0.4)
    b.inputs['Alpha'].default_value = 0.5
    nt = m.node_tree
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (7.0, 2.6, 1.0)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = 4.5
    if 'Detail' in n.inputs: n.inputs['Detail'].default_value = 4.0
    nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
    nramp = nt.nodes.new('ShaderNodeValToRGB')
    nramp.color_ramp.elements[0].position = 0.44
    nramp.color_ramp.elements[1].position = 0.58
    nt.links.new(n.outputs['Fac'], nramp.inputs['Fac'])
    # length falloff along the strip so the path fades toward the viewer
    uv = nt.nodes.new('ShaderNodeUVMap')
    uvmap = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(uv.outputs['UV'], uvmap.inputs['Vector'])
    lramp = nt.nodes.new('ShaderNodeValToRGB')
    lramp.color_ramp.elements[0].position = 0.0
    lramp.color_ramp.elements[0].color = (0.15, 0.15, 0.15, 1)
    lramp.color_ramp.elements[1].position = 0.30
    lramp.color_ramp.elements[1].color = (1, 1, 1, 1)
    e = lramp.color_ramp.elements.new(0.78); e.color = (0.75, 0.75, 0.75, 1)
    e = lramp.color_ramp.elements.new(1.0); e.color = (0.0, 0.0, 0.0, 1)
    nt.links.new(uvmap.outputs['Y'], lramp.inputs['Fac'])
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
    nt.links.new(nramp.outputs['Color'], mul.inputs[0])
    nt.links.new(lramp.outputs['Color'], mul.inputs[1])
    nt.links.new(mul.outputs[0], b.inputs['Alpha'])
    if 'Emission Color' in b.inputs:
        b.inputs['Emission Color'].default_value = (1.0, 0.52, 0.18, 1)
    glint_bsdf = b
    return m

GLINT_MAT = glint_material()

def add_glint(name, x, z, width0, width1, tint, strength, seed):
    cam_c = Vector((-30.0, -20.0, 18.0))
    lp = Vector((x, 12.85, -z))
    t = -cam_c.z / (lp.z - cam_c.z)
    R = cam_c + (lp - cam_c) * t
    # stagger start/length per seed so the streak paths don't line up in rows
    y0 = 8.9 - 0.5 * ((seed * 7) % 5)
    y1 = max(0.6, R.y - (4.4 + 1.3 * ((seed * 3) % 4)))
    if y1 >= y0 - 0.5:
        y1 = y0 - 0.5
    seg = 10
    verts, faces, uvs = [], [], []
    for i in range(seg + 1):
        u = i / seg
        y = y0 + (y1 - y0) * u
        w = width0 + (width1 - width0) * u
        verts += [(x - w, y, 0.018), (x + w, y, 0.018)]
        uvs += [(0.0, u), (1.0, u)]
    for i in range(seg):
        a = i * 2
        faces.append((a, a + 1, a + 3, a + 2))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    uv = me.uv_layers.new(name='UVMap')
    for i, co in enumerate(uvs):
        uv.data[i].uv = co
    ob = bpy.data.objects.new(name, me)
    C_GLINT.objects.link(ob)
    ob.data.materials.append(GLINT_MAT)
    ob.visible_shadow = False
    return ob

for i, (lx, ly) in enumerate(LAMP_POS):
    add_glint('CW_Glint_lamp_%d' % i, lx + 0.3 * (i - 1.5), 4.05, 0.05, 0.14, '#ffb35e', 1.0, i)
for i, (sx, sz) in enumerate([(-18.4, 3.3), (-11.3, 3.3), (-5.2, 3.3), (12.0, 3.3), (20.1, 3.3),
                              (-21.0, 6.6), (-14.5, 7.4), (-7.5, 6.2), (2.0, 7.8), (9.0, 6.9),
                              (16.0, 7.2), (22.0, 6.4)]):
    add_glint('CW_Glint_sign_%d' % i, sx + 0.45 * ((i % 3) - 1), sz, 0.035, 0.11, '#ffbb6a', 1.0, 40 + i)

# ------------------------------------------------------------------ world / sky
world = bpy.data.worlds.new('CW_World')
scene.world = world
world.use_nodes = True
wnt = world.node_tree
wnt.nodes.clear()
wout = wnt.nodes.new('ShaderNodeOutputWorld')
wbg = wnt.nodes.new('ShaderNodeBackground')
wnt.links.new(wbg.outputs[0], wout.inputs[0])
wbg.inputs[1].default_value = 1.0

def build_sky(mode):
    P = PRESETS[mode]
    wnt.nodes.clear()
    wout = wnt.nodes.new('ShaderNodeOutputWorld')
    if P['sky'] == 'physical':
        sky = wnt.nodes.new('ShaderNodeTexSky')
        sky.sky_type = 'MULTIPLE_SCATTERING'
        for attr, val in [('sun_elevation', math.radians(P['sky_sun_elev'])),
                          ('sun_rotation', math.radians(P['sky_sun_rot'])),
                          ('altitude', 30), ('air_density', 1.0),
                          ('dust_density', P['sky_dust']),
                          ('ozone_density', 1.0)]:
            if hasattr(sky, attr):
                setattr(sky, attr, val)
        # v3: 关掉太阳盘后 Nishita 只剩大气渐变环境光，方向性照明完全由 CW_Sun
        # 承担——之前天空太阳和 CW_Sun 方位不一致，两个影子方向打架。
        if hasattr(sky, 'sun_disc'):
            sky.sun_disc = P.get('sky_sun_disc', True)
        if hasattr(sky, 'sun_intensity') and not P.get('sky_sun_disc', True):
            sky.sun_intensity = 0.0
        bg = wnt.nodes.new('ShaderNodeBackground')
        bg.inputs[1].default_value = P['sky_strength']
        wnt.links.new(sky.outputs['Color'], bg.inputs['Color'])
        wnt.links.new(bg.outputs[0], wout.inputs[0])
        return
    # custom gradient for rain
    geo = wnt.nodes.new('ShaderNodeNewGeometry')
    sep = wnt.nodes.new('ShaderNodeSeparateXYZ')
    wnt.links.new(geo.outputs['Incoming'], sep.inputs['Vector'])
    ramp = wnt.nodes.new('ShaderNodeValToRGB')
    # v3.4: 地平线暖色带上缘位置按时段调（dusk 只贴一线，night 稍高）。
    # 旧值 0.40 让整个下半天都是暖色，world 环境光把暗部全染红。
    ramp.color_ramp.elements[0].position = 0.08
    ramp.color_ramp.elements[1].position = P.get('sky_top_pos', 0.40)
    ramp.color_ramp.elements[0].color = (*srgb(P['sky_horizon']), 1)
    ramp.color_ramp.elements[1].color = (*srgb(P['sky_top']), 1)
    # soft horizon glow
    mp = wnt.nodes.new('ShaderNodeMath')
    mp.operation = 'MULTIPLY'
    mp.inputs[1].default_value = -3.0
    wnt.links.new(sep.outputs['Z'], mp.inputs[0])
    wnt.links.new(mp.outputs[0], ramp.inputs['Fac'])
    bg = wnt.nodes.new('ShaderNodeBackground')
    bg.inputs[1].default_value = P['sky_strength']
    wnt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    # glow lobe aimed at the actual sun/moon azimuth (v2: was hard-coded to the
    # wrong side of the sky, which is why the dusk sky fought the key light).
    # v3.3: two stacked bugs made the whole sky red — POWER of an even exponent
    # lit BOTH sides (negative dot came out positive), and world 'Incoming'
    # points at the camera, so the lobe actually sat anti-sun. Negate gd and
    # clamp to >= 0 so exactly one lobe shines, on the sun side.
    dot = wnt.nodes.new('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'
    gd = Vector(P['sky_glow_dir']).normalized()
    dot.inputs[1].default_value = (-gd.x, -gd.y, -gd.z)
    wnt.links.new(geo.outputs['Incoming'], dot.inputs[0])
    dpos = wnt.nodes.new('ShaderNodeMath'); dpos.operation = 'MAXIMUM'
    dpos.inputs[1].default_value = 0.0
    wnt.links.new(dot.outputs['Value'], dpos.inputs[0])
    pw = wnt.nodes.new('ShaderNodeMath'); pw.operation = 'POWER'; pw.inputs[1].default_value = 12.0
    wnt.links.new(dpos.outputs[0], pw.inputs[0])
    mul = wnt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = P['sky_glow_amt']
    wnt.links.new(pw.outputs[0], mul.inputs[0])
    glow = wnt.nodes.new('ShaderNodeMixRGB'); glow.blend_type = 'ADD'; glow.inputs['Fac'].default_value = 1.0
    glow.inputs['Color2'].default_value = (*srgb(P['sky_glow_col']), 1)
    wnt.links.new(ramp.outputs['Color'], glow.inputs['Color1'])
    wnt.links.new(mul.outputs[0], glow.inputs['Fac'])
    wnt.links.new(glow.outputs[0], bg.inputs['Color'])
    wnt.links.new(bg.outputs[0], wout.inputs[0])

# ------------------------------------------------------------------ mist volume
mvol = bpy.data.materials.new('CW_Mist')
mvol.use_nodes = True
mnt = mvol.node_tree
mnt.nodes.clear()
mout = mnt.nodes.new('ShaderNodeOutputMaterial')
pv = mnt.nodes.new('ShaderNodeVolumePrincipled')
pv.inputs['Color'].default_value = (0.72, 0.78, 0.82, 1)
pv.inputs['Anisotropy'].default_value = 0.42
pv.inputs['Density'].default_value = 0.004
# v2 fix: a volume shader belongs on the Volume socket. It used to be linked to
# Surface, which turned the 100x80x44 haze box into an enclosing surface that
# swallowed the sun and the world light -> flat walls, no shadows, no direction.
mnt.links.new(pv.outputs[0], mout.inputs['Volume'])
# height falloff
tex = mnt.nodes.new('ShaderNodeTexCoord')
sepz = mnt.nodes.new('ShaderNodeSeparateXYZ')
mnt.links.new(tex.outputs['Object'], sepz.inputs['Vector'])
mr = mnt.nodes.new('ShaderNodeMapRange')
mr.inputs['From Min'].default_value = 0.0
mr.inputs['From Max'].default_value = 30.0
mr.inputs['To Min'].default_value = 1.0
mr.inputs['To Max'].default_value = 0.08
mnt.links.new(sepz.outputs['Z'], mr.inputs['Value'])
mulden = mnt.nodes.new('ShaderNodeMath'); mulden.operation = 'MULTIPLY'
mnt.links.new(mr.outputs['Result'], mulden.inputs[0])
mnt.links.new(mulden.outputs[0], pv.inputs['Density'])
MIST_DENSITY = mulden

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 14))
mist = bpy.context.object
mist.name = 'CW_MistVolume'
mist.scale = (100, 80, 44)
mist.data.materials.append(mvol)
for c in list(mist.users_collection): c.objects.unlink(mist)
C_FX.objects.link(mist)
MIST = mist

# ------------------------------------------------------------------ render settings
scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
try:
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = (d.type == 'METAL')
    scene.cycles.device = 'GPU'
except Exception as e:
    print('[gpu]', e)
    scene.cycles.device = 'CPU'
scene.cycles.samples = 64 if PREVIEW else 96
scene.cycles.use_denoising = True
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = 0.035
scene.cycles.max_bounces = 6
scene.cycles.diffuse_bounces = 3
scene.cycles.glossy_bounces = 4
scene.cycles.transmission_bounces = 4
scene.cycles.transparent_max_bounces = 8
scene.cycles.caustics_reflective = False
scene.cycles.caustics_refractive = False
scene.cycles.use_fast_gi = True
scene.render.use_persistent_data = True
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.render.resolution_percentage = 35 if PREVIEW else 100
scene.render.film_transparent = False
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
scene.render.image_settings.color_depth = '8'
scene.view_settings.view_transform = 'AgX'
try:
    scene.view_settings.look = 'AgX - Medium High Contrast'
except Exception:
    pass

# compositor (Blender 5.x node-group compositor)
scene.use_nodes = True
bpy.context.view_layer.use_pass_z = True
if scene.compositing_node_group is None:
    scene.compositing_node_group = bpy.data.node_groups.new('CW_Compositing', 'CompositorNodeTree')
nt = scene.compositing_node_group
nt.nodes.clear()
if not any(i.name == 'Image' and i.in_out == 'OUTPUT' for i in nt.interface.items_tree):
    nt.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
rl = nt.nodes.new('CompositorNodeRLayers')
fogmap = nt.nodes.new('ShaderNodeMapRange')
fogmap.inputs['From Min'].default_value = 24.0
fogmap.inputs['From Max'].default_value = 145.0
fogmap.inputs['To Min'].default_value = 0.0
fogmap.inputs['To Max'].default_value = 1.0
fogmap.clamp = True
nt.links.new(rl.outputs['Depth'], fogmap.inputs['Value'])
fogmul = nt.nodes.new('ShaderNodeMath'); fogmul.operation = 'MULTIPLY'; fogmul.inputs[1].default_value = 0.62
nt.links.new(fogmap.outputs['Result'], fogmul.inputs[0])
fogcol = nt.nodes.new('ShaderNodeMixRGB'); fogcol.blend_type = 'MIX'
fogcol.inputs['Color2'].default_value = (*srgb('#c3c8c3'), 1)
nt.links.new(fogmul.outputs[0], fogcol.inputs['Factor'])
nt.links.new(rl.outputs['Image'], fogcol.inputs['Color1'])
cb = nt.nodes.new('CompositorNodeColorBalance')
cb.inputs['Type'].default_value = 'Lift/Gamma/Gain'
nt.links.new(fogcol.outputs[0], cb.inputs['Image'])
glare = nt.nodes.new('CompositorNodeGlare')
try:
    glare.inputs['Type'].default_value = 'Fog Glow'
    glare.inputs['Quality'].default_value = 'High'
except Exception as e:
    print('[glare]', e)
glare.inputs['Threshold'].default_value = 1.1
glare.inputs['Size'].default_value = 0.62
glare.inputs['Strength'].default_value = 0.55
bc = nt.nodes.new('CompositorNodeBrightContrast')
bc.inputs['Bright'].default_value = 0.0
bc.inputs['Contrast'].default_value = 12.0
nt.links.new(cb.outputs['Image'], bc.inputs['Image'])
hs = nt.nodes.new('CompositorNodeHueSat')
hs.inputs['Saturation'].default_value = 1.05
nt.links.new(bc.outputs['Image'], hs.inputs['Image'])
nt.links.new(hs.outputs['Image'], glare.inputs['Image'])
lens = nt.nodes.new('CompositorNodeLensdist')
lens.inputs['Distortion'].default_value = 0.0
lens.inputs['Dispersion'].default_value = 0.004
nt.links.new(glare.outputs['Image'], lens.inputs['Image'])
# vignette
mask = nt.nodes.new('CompositorNodeEllipseMask')
mask.inputs['Position'].default_value = (0.5, 0.5)
mask.inputs['Size'].default_value = (1.08, 1.08)
blur = nt.nodes.new('CompositorNodeBlur')
blur.inputs['Size'].default_value = (240, 240)
nt.links.new(mask.outputs['Mask'], blur.inputs['Image'])
inv = nt.nodes.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'
inv.inputs[0].default_value = 1.0
nt.links.new(blur.outputs['Image'], inv.inputs[1])
vmul = nt.nodes.new('ShaderNodeMath'); vmul.operation = 'MULTIPLY'; vmul.inputs[1].default_value = 0.30
nt.links.new(inv.outputs[0], vmul.inputs[0])
vig = nt.nodes.new('ShaderNodeMixRGB'); vig.blend_type = 'MIX'; vig.inputs['Color2'].default_value = (0, 0, 0, 1)
nt.links.new(vmul.outputs[0], vig.inputs['Factor'])
nt.links.new(lens.outputs['Image'], vig.inputs['Color1'])
gout = nt.nodes.new('NodeGroupOutput')
nt.links.new(vig.outputs[0], gout.inputs['Image'])

PAVE_KEYS = {'slab', 'cobble'}

# ------------------------------------------------------------------ lighting presets
# 每一档时段的全部可调参数集中在这里；morning 已在 2026-10-24 锁定，
# 数值与上一轮出图完全一致（见 renders/presets/cranewick_morning_locked.json）。
PRESETS = {
    'morning': dict(
        sky='physical', sky_strength=0.55, sky_sun_elev=18.0, sky_sun_rot=105.0, sky_dust=0.70,
        sky_sun_disc=True,
        sun=(5.0, '#ffd0a0', 2.0, (18.0, 22.0, -42.0)),
        skyfill=(14.0, '#a9c8e2'), horizon=(12.0, '#ffcf9c'), rim=(30.0, '#cfe2ff'),
        shipfill=(75.0, '#a9c8e2'), shiptop=(45.0, '#ffe3bd'), shipbounce=(14.0, '#ffb27a'),
        lamps=0.0, shop=0.0, indoor=0.0, shiplights=0.0, bridge=0.0, search=0.0, sheen=0.0,
        search_col='#cfe2ff', water_emit=0.0, water_emit_day=0.0, waterbounce=(0.0, '#ffb070'),
        exposure=-0.35, xform='AgX', look='AgX - Medium High Contrast',
        glare=(1.4, 0.55, 0.35), vignette=0.22, fog_col='#b3c6d6', fog_mul=0.22,
        stops=[(0.00, '#8fa6b8'), (0.12, '#9db8ca'), (0.35, '#8fb2cc'), (0.65, '#719dc2'), (1.00, '#5a86ae')],
        cyc_em=0.42, cyc_zmin=-45.0, cyc_zmax=55.0,
        lift=(0.985, 1.000, 1.028, 1.0), gain=(1.090, 1.000, 0.918, 1.0), gamma=(1.02, 1.0, 0.99, 1.0),
        contrast=12.0, sat=1.08,
        vol=('#d8c6ad', 0.008),
        em_window=0.10, em_lamp=0.06, em_sign=0.65, em_interior=0.10,
        glass_emit=0.010, glass_emit_dark=0.018,
        glass_graze=(0.52, 0.62), glass_rough=(0.045, 0.07), pendant=0.0, porthole=1.2, beam=0.0,
        marker=0.2, marker_W=0.0, nav_em=1.2, nav_W=0.0, nav_halo=0.0, win_ramp=[(0.0, 1.0), (1.0, 1.0)],
        water_gloss=(0.10, 0.24, 0.20, 1.55),
        glow_warm=0.62, glow_cool=0.40, glow_sheen=0.0, rain_emit=0.12, halo=0.0,
    ),
    # 正午（v3.4）：v3.2 验收剩黑水+整体发闷。水面材质改镜面映天（见
    # water_material），主光/环境/曝光各提一档到明亮正午。
    'noon': dict(
        sky='physical', sky_strength=0.40, sky_sun_elev=62.0, sky_sun_rot=36.0, sky_dust=0.08,
        sky_sun_disc=False,
        sun=(8.0, '#fff8ec', 1.1, (0.22, 0.42, -0.88)),
        skyfill=(10.0, '#b7d2ea'), horizon=(0.8, '#ffd9b0'), rim=(1.5, '#e6f1ff'),
        shipfill=(42.0, '#cfe2f0'), shiptop=(30.0, '#ffe9c8'), shipbounce=(16.0, '#ffc98f'),
        lamps=0.0, shop=0.0, indoor=12.0, shiplights=0.0, bridge=0.0, search=0.0, sheen=2200.0,
        search_col='#cfe2ff', water_emit=0.0, water_emit_day=0.030, waterbounce=(2000.0, '#bcd4ea'),
        exposure=0.15, xform='AgX', look='AgX - Medium High Contrast',
        glare=(1.2, 0.6, 0.35), vignette=0.22, fog_col='#9db3c8', fog_mul=0.08,
        stops=[(0.00, '#eef2f4'), (0.28, '#c4dcf0'), (0.62, '#7fb2e2'), (1.00, '#3268b8')],
        cyc_em=0.42, cyc_zmin=-2.0, cyc_zmax=52.0,
        lift=(1.0, 1.0, 1.008, 1.0), gain=(1.03, 1.0, 0.955, 1.0), gamma=(1.0, 1.0, 1.0, 1.0),
        contrast=14.0, sat=1.12,
        vol=('#c8d3d8', 0.0025),
        em_window=0.05, em_lamp=0.05, em_sign=0.22, em_interior=0.06,
        glass_emit=0.004, glass_emit_dark=0.006,
        glass_graze=(0.36, 0.48), glass_rough=(0.032, 0.05), pendant=0.30, porthole=0.7, beam=0.0,
        marker=0.15, marker_W=0.0, nav_em=0.6, nav_W=0.0, nav_halo=0.0,
        water_gloss=(0.05, 0.16, 0.34, 1.10),
        glow_warm=0.0, glow_cool=0.0, glow_sheen=0.0, rain_emit=0.12, halo=0.0,
    ),
    # 傍晚（v3.4）：红污染的根因不是辉光瓣也不是雾，而是 world 渐变——
    # strength 1.7 + 暖色占下半天（top_pos 0.40）= 全方位红环境光灌进每个
    # 暗部。改法：暖色只贴地平线（top_pos 0.16），环境强度砍到 1.15，
    # 暗部交还给 140W 蓝灰 skyfill；桥灯/探照灯收敛消中央孤立热斑。
    'dusk': dict(
        sky='rain', sky_strength=0.45, sky_horizon='#d98a52', sky_top='#2e3c64',
        sky_top_pos=0.10,
        sky_glow_col='#ffa050', sky_glow_amt=0.42, sky_glow_dir=(-0.90, -0.42, 0.07),
        sun=(16.0, '#ffab66', 1.6, (0.90, 0.42, -0.065)),
        skyfill=(26.0, '#7b93b0'), horizon=(13.0, '#ffa065'), rim=(33.0, '#8fa6bd'),
        shipfill=(36.0, '#9db7d4'), shiptop=(30.0, '#ffd0a4'), shipbounce=(18.0, '#ffb27a'),
        lamps=460.0, shop=40.0, indoor=260.0, shiplights=6.0, bridge=12.0, search=180.0, sheen=850.0,
        search_col='#ffd3a1', water_emit=0.03, waterbounce=(3200.0, '#ffab68'),
        exposure=0.22, xform='AgX', look='AgX - Medium High Contrast',
        glare=(1.25, 0.68, 0.40), vignette=0.24, fog_col='#4a5868', fog_mul=0.15,
        stops=[(0.00, '#b98a5e'), (0.20, '#8d6a60'), (0.45, '#55586e'), (0.75, '#333d55'), (1.00, '#1c2438')],
        cyc_em=0.62, cyc_zmin=-2.0, cyc_zmax=52.0,
        lift=(0.995, 1.000, 1.020, 1.0), gain=(0.970, 1.000, 1.050, 1.0), gamma=(1.0, 1.0, 1.0, 1.0),
        contrast=3.0, sat=1.06,
        # v3.3: 旧密度 0.005 的雾被 10W 低角度橙阳穿过 ~60m，把全场景散射成
        # 红色蒙雾（R:G:B=1:0.24）。晴朗日落的霾薄得多，降到 0.0016。
        vol=('#9aa3ae', 0.0016),
        em_window=0.40, em_lamp=2.6, em_sign=0.45, em_interior=0.55,
        glass_emit=0.22, glass_emit_dark=0.45,
        glass_graze=(0.40, 0.52), glass_rough=(0.038, 0.055), pendant=2.6, porthole=3.0, beam=0.42,
        marker=4.5, marker_W=55.0, nav_em=8.0, nav_W=55.0, nav_halo=0.0, win_ramp=[(0.48, 0.05), (0.56, 1.0)],
        glow_warm=0.30, glow_cool=0.18, glow_sheen=0.22, rain_emit=0.38, halo=6.5,
    ),
    # 午夜（v3.4）：主要橱窗"纯黄块"的来源是 interior 贴图自发光——压到
    # 0.55 让它退成中亮背景，被照亮的货架/吊灯剪影才能浮出来；南岸近景
    # 店内灯打 75 折，右暗区冷补再提一档。
    'night': dict(
        sky='rain', sky_strength=5.0, sky_horizon='#33465e', sky_top='#101b30',
        sky_glow_col='#5c7898', sky_glow_amt=0.10, sky_glow_dir=(-0.50, -0.62, 0.10),
        sun=(2.6, '#a8c4e8', 3.5, (0.50, 0.62, -0.60)),
        skyfill=(110.0, '#3e5c80'), horizon=(6.0, '#ff9a5c'), rim=(55.0, '#4a688e'),
        shipfill=(38.0, '#9db9dd'), shiptop=(35.0, '#d5e4ff'), shipbounce=(25.0, '#ffb27a'),
        lamps=1200.0, shop=45.0, indoor=380.0, shiplights=10.0, bridge=20.0, search=460.0, sheen=3600.0,
        search_col='#cfe2ff', water_emit=0.11, waterbounce=(10000.0, '#6f8fae'),
        exposure=-0.45, xform='AgX', look='AgX - Medium High Contrast',
        glare=(0.60, 0.90, 0.72), vignette=0.26, fog_col='#101722', fog_mul=0.10,
        stops=[(0.00, '#1e2c40'), (0.22, '#12203a'), (0.55, '#081120'), (1.00, '#03060c')],
        cyc_em=0.55, cyc_zmin=-2.0, cyc_zmax=52.0,
        lift=(0.995, 1.000, 1.020, 1.0), gain=(1.0, 1.0, 1.04, 1.0), gamma=(1.0, 1.0, 1.01, 1.0),
        contrast=3.0, sat=1.03,
        vol=('#5f7288', 0.004),
        em_window=0.75, em_lamp=3.2, em_sign=0.75, em_interior=0.55,
        glass_emit=0.45, glass_emit_dark=0.72,
        glass_graze=(0.34, 0.46), glass_rough=(0.030, 0.05), pendant=4.0, porthole=4.0, beam=1.0,
        marker=6.5, marker_W=95.0, nav_em=13.0, nav_W=95.0, nav_halo=0.0, win_ramp=[(0.10, 0.12), (0.20, 1.0)],
        glow_warm=0.55, glow_cool=0.30, glow_sheen=0.35, rain_emit=0.55, halo=9.0,
    ),

}

# ------------------------------------------------------------------ mode application

def apply_mode(mode):
    P = PRESETS[mode]
    rainy = mode in ('dusk', 'night')
    day = mode in ('morning', 'noon')
    # morning 已锁定：店内陈设是 v3 新增几何，早晨整组隐藏保持出图不变；
    # 间接光 clamp 只影响离群 firefly，但同样按模式开关以保锁定可复现。
    C_SHOPINT.hide_render = (mode == 'morning')
    scene.cycles.sample_clamp_indirect = 0.0 if mode == 'morning' else 10.0
    # world
    build_sky(mode)
    # water / puddles / rain visibility
    water.data.materials.clear(); water.data.materials.append(WM_RAIN if rainy else WM_DAY)
    for w in EXTRA_WATER:
        w.data.materials.clear(); w.data.materials.append(WM_RAIN if rainy else WM_DAY)
    _wb = next((n for n in WM_RAIN.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if _wb is not None and 'Emission Color' in _wb.inputs:
        # faint sky sheen so night water reads as liquid instead of a black void
        _wb.inputs['Emission Color'].default_value = (0.06, 0.11, 0.16, 1)
        _wb.inputs['Emission Strength'].default_value = 0.0 if day else P['water_emit']
    # v3.4: 白天水面的镜面度按 preset 调（noon 要成片映天光，morning 锁定
    # 旧默认值）；dusk/night 用 rain 水面，不经这里。
    wg = P.get('water_gloss')
    if wg and not rainy:
        _b, _n, _r = WATER_NODES.get('CW_water_calm', (None, None, None))
        if _r is not None:
            _r.inputs['To Min'].default_value = wg[0]
            _r.inputs['To Max'].default_value = wg[1]
            if 'Coat Weight' in _b.inputs:
                _b.inputs['Coat Weight'].default_value = wg[2]
            _n.inputs['Strength'].default_value = wg[3]
    # v3.5: 白天水面的天光漫反射分量（正午影子区的水不再黑成一片）；
    # morning 锁定为 0。
    _wd = next((n for n in WM_DAY.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if _wd is not None and 'Emission Color' in _wd.inputs:
        _wd.inputs['Emission Color'].default_value = (0.10, 0.16, 0.20, 1)
        _wd.inputs['Emission Strength'].default_value = P.get('water_emit_day', 0.0)
    for ob in C_PUDDLE.objects:
        ob.hide_render = not rainy
    for ob in C_RAIN.objects:
        ob.hide_render = not rainy
    for ob in C_DETAIL.objects:
        ob.hide_render = not rainy
    C_GLINT.hide_render = True
    C_GLOW.hide_render = not rainy
    for _gm, _gs in ((GLOW_WARM, P['glow_warm']), (GLOW_COOL, P['glow_cool']),
                     (GLOW_SHEEN, P['glow_sheen'])):
        _gb = next((n for n in _gm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if _gb is not None and 'Emission Strength' in _gb.inputs:
            _gb.inputs['Emission Strength'].default_value = _gs
    C_FX.hide_render = False
    MIST.hide_render = mode in ('morning', 'noon')
    # ---- surface response: pavement gets wet, masonry stays matte -------------
    # (v2 fix) the whole stone family used to go glossy at dusk/night, which made
    # brick walls read as self-lit mirrors. Only horizontal paving is wet.
    for m in stone_mats:
        b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not b:
            continue
        nm = m.name
        if nm in PAVE_KEYS:
            set_in(b, 'Roughness', 0.26 if rainy else 0.72)
            if 'Coat Weight' in b.inputs:
                b.inputs['Coat Weight'].default_value = 0.34 if rainy else 0.0
                b.inputs['Coat Roughness'].default_value = 0.10
            _pave = 0.30 if rainy else (0.44 if mode == 'noon' else 0.55)
            b.inputs['Base Color'].default_value = (_pave, _pave * 1.01, _pave * 0.99, 1)
        else:
            set_in(b, 'Roughness', 0.66 if rainy else 0.80)
            if 'Coat Weight' in b.inputs:
                b.inputs['Coat Weight'].default_value = 0.08 if rainy else 0.0
                b.inputs['Coat Roughness'].default_value = 0.30
    # ---- emission strength by role -------------------------------------------
    for m in emission_mats:
        role = m.get('cw_role', 'sign')
        em = next((n for n in m.node_tree.nodes if n.type == 'EMISSION'), None)
        if em is None:
            continue
        if m.name == 'interior':
            em.inputs['Strength'].default_value = P['em_interior']
        elif role == 'window':
            em.inputs['Strength'].default_value = P['em_window']
        elif role == 'lamp':
            em.inputs['Strength'].default_value = P['em_lamp']
        elif role == 'pendant':
            em.inputs['Strength'].default_value = P['pendant']
        elif role == 'porthole':
            em.inputs['Strength'].default_value = P['porthole']
        elif role == 'marker':
            em.inputs['Strength'].default_value = P['marker']
        elif role == 'navlight':
            em.inputs['Strength'].default_value = P['nav_em']
        elif role == 'sign':
            em.inputs['Strength'].default_value = P['em_sign']
        else:
            em.inputs['Strength'].default_value = 0.1
    # dark panes become warm lit rooms after dark so most windows read as "on";
    # in daylight a faint interior fill keeps them from reading as black holes.
    # v3.6: 驱动独立窗光层（不受 Fresnel 稀释），数值按新结构重新标定。
    for gname, gval in (('glassDark', P['glass_emit_dark']), ('glass', P['glass_emit'])):
        gm = bpy.data.materials.get(gname)
        if gm is None or gname not in GLASS_EMIT:
            continue
        GLASS_EMIT[gname].outputs['Value'].default_value = gval
        ramp = GLASS_WINRAMP.get(gname)
        if ramp is not None:
            els = ramp.color_ramp.elements
            while len(els) > 1:
                els.remove(els[-1])
            stops = P.get('win_ramp', [(0.0, 1.0), (1.0, 1.0)])
            els[0].position = stops[0][0]; els[0].color = (stops[0][1],) * 3 + (1.0,)
            for pos, val in stops[1:]:
                e = els.new(pos); e.color = (val,) * 3 + (1.0,)
    # v3: 掠射角镜面占比/粗糙度按时段调节——白天和灯亮的黄昏夜晚都把玻璃
    # 放得更透，室内陈设才读得出来；morning 保持锁定旧值。
    graze = P.get('glass_graze', (0.52, 0.62))
    grough = P.get('glass_rough', (0.045, 0.07))
    for gname, (gz, gr) in (('glass', (graze[0], grough[0])), ('glassDark', (graze[1], grough[1]))):
        gm = bpy.data.materials.get(gname)
        if gm is None or gname not in GLASS_NODES:
            continue
        mr, gloss = GLASS_NODES[gname]
        mr.inputs['To Max'].default_value = gz
        set_in(gloss, 'Roughness', gr)
    # ---- lights --------------------------------------------------------------
    sun = SUN.data
    sun.energy = P['sun'][0]; sun.color = srgb(P['sun'][1]); sun.angle = math.radians(P['sun'][2])
    d = Vector(P['sun'][3]).normalized()
    SUN.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    SKY_FILL.data.energy, SKY_FILL.data.color = P['skyfill'][0], srgb(P['skyfill'][1])
    HORIZON.data.energy, HORIZON.data.color = P['horizon'][0], srgb(P['horizon'][1])
    EAST_RIM.data.energy, EAST_RIM.data.color = P['rim'][0], srgb(P['rim'][1])
    SHIP_FILL.data.energy, SHIP_FILL.data.color = P['shipfill'][0], srgb(P['shipfill'][1])
    SHIP_TOP.data.energy, SHIP_TOP.data.color = P['shiptop'][0], srgb(P['shiptop'][1])
    SHIP_BOUNCE.data.energy, SHIP_BOUNCE.data.color = P['shipbounce'][0], srgb(P['shipbounce'][1])
    for i, ob in enumerate(LAMPS):
        far_side = i >= 4
        ob.data.energy = P['lamps'] * (0.8 if far_side else 1.0)
    for ob in SHOP_LIGHTS:
        ob.data.energy = P['shop']
    HALO_MAT.node_tree.nodes['Emission'].inputs['Strength'].default_value = P['halo']
    for ob in SHOP_INSIDE:
        ob.data.energy = P['indoor']
    # 南岸店铺离相机近，同功率下近景窗会过曝成纯黄块
    for ob in SHOP_INSIDE_S:
        ob.data.energy = P['indoor'] * 0.75
    for ob in MARKER_LIGHTS:
        ob.data.energy = P['marker_W']
    for ob in NAVLIGHT_OBJS:
        ob.data.energy = P['nav_W']
    for _he in NAV_HALO_MATS.values():
        _he[1].inputs['Strength'].default_value = 0.0
    if 'BRIDGE_NAV_GLOW' in dir():
        BRIDGE_NAV_GLOW.outputs['Value'].default_value = P['marker'] * 1.3
    for ob in SHIP_LIGHTS:
        ob.data.energy = P['shiplights']
    BRIDGE_LIGHT.data.energy = P['bridge']
    SEARCH.data.energy = P['search']
    SEARCH.data.color = srgb(P['search_col'])
    WATER_SHEEN.data.energy = P['sheen']
    WATER_BOUNCE.data.energy, WATER_BOUNCE.data.color = P['waterbounce'][0], srgb(P['waterbounce'][1])
    # ---- volume --------------------------------------------------------------
    pv = mnt.nodes['Principled Volume']
    pv.inputs['Color'].default_value = (*srgb(P['vol'][0]), 1)
    MIST_DENSITY.inputs[1].default_value = P['vol'][1]
    # ---- exposure / look -----------------------------------------------------
    scene.view_settings.exposure = P['exposure']
    scene.view_settings.view_transform = P['xform']
    scene.view_settings.look = P['look']
    # ---- compositor grade ----------------------------------------------------
    glare.inputs['Threshold'].default_value = P['glare'][0]
    glare.inputs['Size'].default_value = P['glare'][1]
    glare.inputs['Strength'].default_value = P['glare'][2]
    vmul.inputs[1].default_value = P['vignette']
    fogcol.inputs['Color2'].default_value = (*srgb(P['fog_col']), 1)
    fogmul.inputs[1].default_value = P['fog_mul']
    stops = P['stops']
    els = CYC_RAMP.color_ramp.elements
    while len(els) > 1:
        els.remove(els[-1])
    els[0].position = stops[0][0]; els[0].color = (*srgb(stops[0][1]), 1)
    for pos, col in stops[1:]:
        e = els.new(pos); e.color = (*srgb(col), 1)
    CYC_EM.inputs['Strength'].default_value = P['cyc_em']
    CYC_MAP.inputs['From Min'].default_value = P['cyc_zmin']
    CYC_MAP.inputs['From Max'].default_value = P['cyc_zmax']
    set_color(cb, 'Lift', P['lift'])
    set_color(cb, 'Gain', P['gain'])
    set_color(cb, 'Gamma', P['gamma'])
    bc.inputs['Contrast'].default_value = P['contrast']
    hs.inputs['Saturation'].default_value = P['sat']
    # 探照灯光束：白天不可见，晨昏夜强度由 beam 控制
    BEAM.hide_render = P.get('beam', 0.0) <= 0.001
    BEAM_VAL.outputs['Value'].default_value = P.get('beam', 0.0)
    # rain look
    if rainy:
        RM.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = 0.55
        if 'Emission Strength' in RM.node_tree.nodes['Principled BSDF'].inputs:
            RAIN_EM_VAL.outputs['Value'].default_value = P['rain_emit']
    print('[mode]', mode, 'set', 'color=', scene.view_settings.view_transform, scene.view_settings.look, 'exp=', scene.view_settings.exposure, flush=True)
    if 'dumppreset' in argv:
        dump_preset(mode)


def dump_preset(mode):
    import json
    P = PRESETS[mode]
    rec = {
        'locked_at': time.strftime('%Y-%m-%d %H:%M:%S'),
        'mode': mode,
        'render': {'engine': 'CYCLES', 'samples': scene.cycles.samples,
                   'resolution': [scene.render.resolution_x, scene.render.resolution_y],
                   'view_transform': scene.view_settings.view_transform,
                   'look': scene.view_settings.look, 'exposure': scene.view_settings.exposure},
        'preset': {k: (list(v) if isinstance(v, tuple) else v) for k, v in P.items()},
        'lights_W': {'sun': SUN.data.energy, 'skyfill': SKY_FILL.data.energy,
                     'horizon': HORIZON.data.energy, 'rim': EAST_RIM.data.energy,
                     'lamps': LAMPS[0].data.energy, 'shop_spill': SHOP_LIGHTS[0].data.energy,
                     'shop_indoor': SHOP_INSIDE[0].data.energy, 'bridge': BRIDGE_LIGHT.data.energy,
                     'search': SEARCH.data.energy, 'water_sheen': WATER_SHEEN.data.energy},
    }
    os.makedirs(os.path.join(OUT, 'presets'), exist_ok=True)
    path = os.path.join(OUT, 'presets', 'cranewick_%s_locked.json' % mode)
    with open(path, 'w') as f:
        json.dump(rec, f, indent=2, ensure_ascii=False)
    print('[preset] saved', path, flush=True)

if 'probe' in argv:
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1.5, location=(-29.0, -18.0, 14.0))
    _po = bpy.context.object
    _pm = bpy.data.materials.new('CW_Probe')
    _pm.use_nodes = True
    _pn = _pm.node_tree; _pn.nodes.clear()
    _pout = _pn.nodes.new('ShaderNodeOutputMaterial')
    _pem = _pn.nodes.new('ShaderNodeEmission')
    _pem.inputs[0].default_value = (1.0, 0.2, 0.1, 1)
    _pem.inputs[1].default_value = 50.0
    _pn.links.new(_pem.outputs[0], _pout.inputs[0])
    _po.data.materials.append(_pm)

# save a master blend after build
if SAVE_BLEND:
    apply_mode('morning')
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'cranewick_scene.blend'))
    print('[blend] saved')

for mode in MODES:
    apply_mode(mode)
    if 'probe' in argv:
        print('[probe] meshes visible:', len([o for o in scene.objects if o.type == 'MESH' and not o.hide_render]), 'cam', tuple(cam.location), 'sun', SUN.data.energy, 'sky', SKY_FILL.data.energy, flush=True)
    if 'rayhit' in argv:
        _dg = bpy.context.evaluated_depsgraph_get()
        for _u, _v in [(0.05, 0.08), (0.10, 0.10), (0.20, 0.06), (0.30, 0.10), (0.10, 0.25)]:
            _sx = (_u - 0.5) * 2 * 18.0
            _sy = (_v - 0.5) * 2 * (18.0 * 9.0 / 16.0)
            _dir = (cam.matrix_world.to_3x3() @ Vector((_sx, _sy, -cam_data.lens))).normalized()
            _hit, _loc, _nrm, _idx, _ob, _mat = scene.ray_cast(_dg, cam.matrix_world.translation, _dir)
            _mats = [m.name for m in _ob.data.materials] if _hit and _ob and hasattr(_ob.data, 'materials') else []
            print('[ray]', _u, _v, _hit, _ob.name if _ob else None, _mats,
                  tuple(round(x, 2) for x in _loc) if _hit else None, flush=True)
    if 'nocomp' in argv:
        scene.use_nodes = False
    if 'flatsky' in argv:
        wnt.nodes.clear()
        _wo = wnt.nodes.new('ShaderNodeOutputWorld')
        _wb2 = wnt.nodes.new('ShaderNodeBackground')
        _wb2.inputs[0].default_value = (0.4, 0.5, 0.6, 1)
        _wb2.inputs[1].default_value = 1.0
        wnt.links.new(_wb2.outputs[0], _wo.inputs[0])
    if 'noglow' in argv:
        C_GLOW.hide_render = True
    if 'norainfx' in argv:
        for _c in (C_RAIN, C_DETAIL, C_PUDDLE):
            _c.hide_render = True
    if 'expboost' in argv:
        scene.view_settings.exposure += 5.0
    if 'sunonly' in argv:
        for _lo in (SKY_FILL, HORIZON, EAST_RIM, SHIP_FILL, SHIP_TOP, SHIP_BOUNCE, WATER_SHEEN,
                    BRIDGE_LIGHT, SEARCH, *LAMPS, *SHOP_LIGHTS, *SHIP_LIGHTS):
            _lo.data.energy = 0
        for _n in wnt.nodes:
            if _n.type == 'BACKGROUND':
                _n.inputs[1].default_value = 0
    if 'sunx' in argv:
        SUN.data.energy *= float([a for a in argv if a.startswith('sunx')][0][4:] or 5)
    if 'nosun' in argv:
        SUN.data.energy = 0
    if 'nodist' in argv:
        C_DIST.hide_render = True
    if 'nomist' in argv:
        MIST.hide_render = True
    if 'nocyc' in argv:
        bpy.data.objects['CW_SkyBackdrop'].hide_render = True
    if 'noground' in argv:
        bpy.data.objects['CW_DistantGround'].hide_render = True
    suffix = 'preview' if PREVIEW else '1080p'
    scene.render.filepath = os.path.join(OUT, f'cranewick_{mode}_{suffix}.png')
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    print('[render]', mode, round(time.time() - t0, 1), 's ->', scene.render.filepath)
