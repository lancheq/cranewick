#!/usr/bin/env python3
"""生成 v14 相机轨迹：S1 连续推轨，S2/S3/S4 低机位（本地预览 + Blender 抽帧验证）。
用法: python3 gen_track_v14.py /tmp/cw_bake.json /tmp/cw_cam_old.json /tmp/cw_cam_new.json
"""
import json, sys

bake = json.load(open(sys.argv[1]))
old = json.load(open(sys.argv[2]))
out = sys.argv[3]

BAKE = {s['id']: s for s in bake['shots']}
OLD = {s['id']: s for s in old['shots']}

def catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return [0.5 * ((2 * p1[i]) + (-p0[i] + p2[i]) * t +
                   (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
                   (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3) for i in range(3)]

def path(points, u):
    """points: [(u, [x,y,z])]; catmull-rom, clamped ends"""
    n = len(points)
    if u <= points[0][0]:
        return list(points[0][1])
    if u >= points[-1][0]:
        return list(points[-1][1])
    for k in range(n - 1):
        u0, p1 = points[k]
        u1, p2 = points[k + 1]
        if u0 <= u <= u1:
            p0 = points[max(0, k - 1)][1]
            p3 = points[min(n - 1, k + 2)][1]
            t = (u - u0) / max(1e-6, u1 - u0)
            return catmull(p0, p1, p2, p3, t)
    return list(points[-1][1])

def shippos(sid, i):
    v = BAKE[sid]['frames'][i]['n']['SHIP_ROOT']
    return [v[0], v[1], v[2]]

def build(sid, pos_pts, name, lens, look_off=None, look_pts=None):
    sh = OLD[sid]
    n = len(sh['frames'])
    frames = []
    for i in range(n):
        u = i / max(1, n - 1)
        sp = shippos(sid, i)
        if look_pts is not None:
            look = path(look_pts, u)
        else:
            look = [sp[0] + look_off[0], sp[1] + look_off[1], sp[2] + look_off[2]]
        if pos_pts[0] == 'rel':
            rp = path(pos_pts[1:], u)
            pos = [sp[0] + rp[0], sp[1] + rp[1], sp[2] + rp[2]]
        else:
            pos = path(pos_pts, u)
        frames.append({'pos': [round(x, 4) for x in pos], 'look': [round(x, 4) for x in look]})
    return {'id': sid, 'name': name, 'tod': sh['tod'], 'rain': sh['rain'],
            't0': sh['t0'], 't1': sh['t1'], 'lens': lens, 'frames': frames}

SHOTS = []
# S1：一个连续长镜——从桥面推近封道牌，随桥面抬升缓慢升高（替代原三段式）
SHOTS.append(build(1,
    [(0.0, [6.2, 3.4, -18.2]), (0.5, [6.0, 3.8, -17.0]), (1.0, [5.9, 4.2, -16.0])],
    'S1 封道预警 · 连续推轨 v14', 42,
    look_pts=[(0.0, [4.8, 4.4, -11.9]), (0.5, [5.0, 5.0, -10.0]), (1.0, [5.0, 5.6, -8.0])]))
# S2：随飞艇下降的低机位，24mm；相机从西侧远处压下来
SHOTS.append(build(2,
    [(0.0, [-44.0, 10.5, 10.0]), (0.45, [-34.0, 6.5, 14.0]), (1.0, [-26.6, 5.5, 16.4])],
    'S2 飞艇下降 · 低机位随降 24mm v14', 24, look_off=(0, 2.0, 0)))
# S3：低机位全景看完整入水变形，26mm，缓慢靠近
SHOTS.append(build(3,
    [(0.0, [-28.5, 7.8, -8.8]), (0.5, [-27.2, 7.5, -8.0]), (1.0, [-26.0, 7.2, -7.2])],
    'S3 入水变形 · 低机位全景 26mm v14', 26, look_off=(0, 2.2, 0)))
# S4：低机位追拍，等距侧移绕艇（不推近，避免尾部怼脸）
SHOTS.append(build(4,
    ['rel', (0.0, [-16.0, 4.2, -8.0]), (0.5, [-17.0, 4.6, -5.5]), (1.0, [-17.5, 5.0, -3.0])],
    'S4 雨夜穿桥 · 低机位追拍绕行 28mm v14', 28, look_off=(0, 2.2, 0)))

meta = dict(old.get('meta', {}))
meta['version'] = 'v14-2026-10-26'
meta['note'] = 'S1 连续推轨；S2/S3/S4 低机位（本地 three.js + Blender 抽帧验证）；lens 为毫米，sensor 36 横装'
json.dump({'meta': meta, 'shots': SHOTS}, open(out, 'w', encoding='utf8'), ensure_ascii=False)
print('wrote', out, [(s['id'], len(s['frames']), s.get('lens')) for s in SHOTS])
