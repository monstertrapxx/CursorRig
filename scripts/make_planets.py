# Generates textured planet / moon / sun GLBs (procedural textures, no photographs) into ./out
import numpy as np, json, struct, io, os, sys
from PIL import Image
from scipy.ndimage import gaussian_filter

TW, TH = 512, 256
u = (np.arange(TW) + 0.5) / TW; v = (np.arange(TH) + 0.5) / TH
U, V = np.meshgrid(u, v)
LAT = (0.5 - V) * np.pi            # +pi/2 at the top
LON = (U - 0.5) * 2 * np.pi

def noise(sv, su, seed):
    r = np.random.default_rng(seed).standard_normal((TH, TW))
    n = gaussian_filter(r, sigma=(sv, su), mode=('nearest', 'wrap'))
    return (n - n.mean()) / (n.std() + 1e-9)
def fbm(seed, base=40, oct=5, gain=0.55):
    t = 0; a = 1; s = base
    for k in range(oct):
        t = t + a * noise(s, s * 1.0, seed + k * 11); a *= gain; s = max(0.8, s / 2)
    return (t - t.mean()) / (t.std() + 1e-9)
def mix(c0, c1, t): return np.array(c0)[None, None] / 255 * (1 - t[..., None]) + np.array(c1)[None, None] / 255 * t[..., None]
def sm(x, a, b): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def craters(seed, n, strong=0.5):
    rng = np.random.default_rng(seed); h = np.zeros((TH, TW))
    for _ in range(n):
        cx, cy = rng.uniform(0, TW), rng.uniform(8, TH - 8); r = rng.uniform(2, 11) ** 1.0
        yy, xx = np.ogrid[:TH, :TW]
        dx = np.minimum(abs(xx - cx), TW - abs(xx - cx)) / max(0.4, np.cos(LAT[int(cy), 0]))
        d = np.sqrt(dx ** 2 + (yy - cy) ** 2) / r
        h += np.where(d < 1, -(1 - d ** 2) * 0.8, 0) + np.exp(-((d - 1.05) ** 2) * 18) * 0.5
    return h * strong

def tex_mercury():
    n = fbm(1, 24); c = craters(2, 180)
    t = np.clip(0.5 + 0.18 * n + 0.35 * c, 0, 1)
    return mix((70, 66, 62), (172, 166, 158), t), 0.9
def tex_moon(seed=3, dark=0.5):
    n = fbm(seed, 28); maria = sm(fbm(seed + 5, 60, 3), 0.5, 1.2) * dark; c = craters(seed + 7, 140)
    t = np.clip(0.6 + 0.12 * n + 0.3 * c - maria * 0.55, 0, 1)
    return mix((60, 60, 62), (190, 188, 184), t), 0.95
def tex_venus():
    w = fbm(4, 70, 3); band = np.sin(LAT * 5 + w * 1.6) * 0.5 + 0.5
    t = np.clip(0.55 + 0.25 * band + 0.1 * fbm(6, 30), 0, 1)
    return mix((205, 168, 96), (246, 226, 168), t), 0.7
def tex_earth():
    h = fbm(7, 90, 6); land = sm(h, 0.25, 0.45)
    lat = np.abs(LAT) / (np.pi / 2)
    ice = sm(lat, 0.82, 0.92)
    elev = np.clip((h - 0.3) * 1.4, 0, 1)
    dry = sm(fbm(9, 55, 3) + (1 - lat) * -0.4 + (lat > 0.25) * 0, 0.2, 1.0)
    green = np.array([58, 112, 52]) / 255; brown = np.array([150, 120, 76]) / 255; sand = np.array([205, 182, 120]) / 255
    desert = sm(fbm(11, 60, 3) * (1 - lat * 1.3), 0.6, 1.3)
    landc = green[None, None] * (1 - desert[..., None]) + sand[None, None] * desert[..., None]
    landc = landc * (1 - elev[..., None] * 0.5) + brown[None, None] * elev[..., None] * 0.5
    deep = np.array([10, 38, 92]) / 255; shallow = np.array([30, 92, 160]) / 255
    ocean = deep[None, None] * (1 - sm(h, -0.1, 0.3)[..., None]) + shallow[None, None] * sm(h, -0.1, 0.3)[..., None]
    col = ocean * (1 - land[..., None]) + landc * land[..., None]
    col = col * (1 - ice[..., None]) + np.array([240, 244, 250])[None, None] / 255 * ice[..., None]
    cl = sm(fbm(13, 40, 5) + 0.15 * np.sin(LAT * 4) , 0.55, 1.4) * 0.8
    col = col * (1 - cl[..., None]) + cl[..., None]
    rough = 0.25 * (1 - land) + 0.8 * land
    return col, rough
def tex_mars():
    n = fbm(15, 40); d = sm(fbm(17, 80, 4), 0.2, 1.1)
    t = np.clip(0.55 + 0.15 * n, 0, 1)
    col = mix((140, 66, 40), (200, 112, 66), t) * (1 - 0.5 * d[..., None] * 0.7)
    cap = sm(np.abs(LAT) / (np.pi / 2), 0.9, 0.96)
    col = col * (1 - cap[..., None]) + np.array([240, 236, 232])[None, None] / 255 * cap[..., None]
    return col, 0.9
def banded(seed, cols, freq, warp=1.2, noisek=0.12, spot=None):
    w = fbm(seed, 36, 4); y = LAT + w * 0.05 * warp
    b = (np.sin(y * freq) * 0.5 + 0.5) * 0.6 + (np.sin(y * freq * 2.3 + 1.1) * 0.5 + 0.5) * 0.4
    b = np.clip(b + noisek * fbm(seed + 3, 20, 3), 0, 1)
    col = np.zeros((TH, TW, 3))
    stops = np.linspace(0, 1, len(cols))
    for k in range(3):
        col[..., k] = np.interp(b, stops, [c[k] / 255 for c in cols])
    if spot:
        la, lo, rx, ry, c = spot
        d = ((LON - lo) / rx) ** 2 + ((LAT - la) / ry) ** 2
        s = np.exp(-d * 2.5)
        col = col * (1 - s[..., None]) + np.array(c)[None, None] / 255 * s[..., None]
    return col, 0.55
def tex_jupiter(): return banded(20, [(150, 96, 60), (222, 196, 160), (190, 130, 86), (236, 220, 190), (168, 112, 76), (214, 180, 140)], 26, 1.6, 0.15, (-0.38, 1.2, 0.22, 0.1, (178, 70, 48)))
def tex_saturn(): return banded(22, [(176, 150, 98), (232, 214, 162), (205, 184, 128), (240, 226, 178)], 18, 0.6, 0.06)
def tex_uranus(): return banded(24, [(138, 206, 214), (170, 228, 232), (150, 214, 222)], 10, 0.3, 0.03)
def tex_neptune(): return banded(26, [(36, 62, 172), (70, 110, 224), (50, 84, 196), (96, 140, 236)], 14, 0.8, 0.07, (-0.3, 0.6, 0.18, 0.09, (16, 30, 100)))
def tex_io():
    n = fbm(30, 30); s = sm(fbm(31, 40, 3), 0.3, 1.0); sp = sm(fbm(33, 14, 2), 1.3, 2.0)
    col = mix((214, 170, 60), (240, 220, 120), np.clip(0.5 + 0.2 * n, 0, 1)) * (1 - 0.35 * s[..., None])
    col = col * (1 - sp[..., None]) + np.array([60, 36, 30])[None, None] / 255 * sp[..., None]
    return col, 0.85
def tex_europa():
    n = fbm(34, 40, 3); cr = np.abs(np.sin(LON * 6 + fbm(35, 30, 3) * 3) * np.cos(LAT * 4 + fbm(36, 30, 3) * 2)); line = sm(1 - cr, 0.93, 1.0)
    col = mix((226, 214, 190), (246, 240, 226), np.clip(0.5 + 0.2 * n, 0, 1)) * (1 - 0.5 * line[..., None]) + np.array([150, 92, 60])[None, None] / 255 * (0.3 * line[..., None])
    return col, 0.5
def tex_ganymede():
    n = fbm(37, 30); dk = sm(fbm(38, 55, 3), 0.1, 1.0); c = craters(39, 90, 0.35)
    t = np.clip(0.5 + 0.15 * n + 0.2 * c, 0, 1)
    return mix((88, 76, 66), (176, 166, 152), t) * (1 - 0.3 * dk[..., None]), 0.85
def tex_callisto():
    n = fbm(40, 28); c = craters(41, 260, 0.55)
    t = np.clip(0.38 + 0.1 * n + 0.3 * c, 0, 1)
    return mix((40, 38, 36), (170, 164, 156), t), 0.95
def tex_titan():
    b = np.sin(LAT * 6 + fbm(42, 70, 3) * 0.8) * 0.5 + 0.5
    return mix((196, 132, 52), (226, 168, 84), np.clip(0.45 + 0.2 * b + 0.05 * fbm(43, 30), 0, 1)), 0.7
def tex_sun():
    g = fbm(44, 8, 5, 0.6); gg = fbm(45, 3, 3, 0.5); t = np.clip(0.55 + 0.17 * g + 0.06 * gg, 0, 1)
    return mix((230, 96, 14), (255, 214, 96), t), 1.0

PLANETS = {'mercury': tex_mercury, 'venus': tex_venus, 'earth': tex_earth, 'moon': tex_moon, 'mars': tex_mars, 'jupiter': tex_jupiter,
           'saturn': tex_saturn, 'uranus': tex_uranus, 'neptune': tex_neptune, 'io': tex_io, 'europa': tex_europa,
           'ganymede': tex_ganymede, 'callisto': tex_callisto, 'titan': tex_titan, 'sun': tex_sun}

def jpg(a, q=88):
    b = io.BytesIO(); Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(b, 'JPEG', quality=q); return b.getvalue()
def png(a):
    b = io.BytesIO(); Image.fromarray(a).save(b, 'PNG', optimize=True); return b.getvalue()

def sphere(radius=0.5, SEG=64, RING=40):
    pos, nor, uv = [], [], []
    for i in range(RING + 1):
        la = np.pi / 2 - np.pi * i / RING
        for j in range(SEG + 1):
            lo = (j / SEG - 0.5) * 2 * np.pi
            p = np.array([np.cos(la) * np.sin(lo), np.sin(la), np.cos(la) * np.cos(lo)])
            pos.append(p * radius); nor.append(p); uv.append([j / SEG, i / RING])
    idx = []
    for i in range(RING):
        for j in range(SEG):
            a = i * (SEG + 1) + j; b = a + SEG + 1
            idx += [a, b, a + 1, a + 1, b, b + 1]
    return np.array(pos, np.float32), np.array(nor, np.float32), np.array(uv, np.float32), np.array(idx, np.uint32)

def rotm(ax, deg):
    t = np.radians(deg); c, s = np.cos(t), np.sin(t)
    if ax == 'x': return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if ax == 'z': return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])

def ring_mesh(rin, rout, SEG=96):
    pos, nor, uv, idx = [], [], [], []
    for j in range(SEG + 1):
        a = j / SEG * 2 * np.pi
        for k, r in enumerate((rin, rout)):
            pos.append([np.cos(a) * r, 0, np.sin(a) * r]); nor.append([0, 1, 0]); uv.append([k, j / SEG])
    for j in range(SEG):
        a = j * 2; idx += [a, a + 1, a + 2, a + 1, a + 3, a + 2]
    return np.array(pos, np.float32), np.array(nor, np.float32), np.array(uv, np.float32), np.array(idx, np.uint32)

def ring_texture():
    W = 512; x = np.linspace(0, 1, W)         # inner -> outer, in real proportions of Saturn's rings
    R = lambda r: (r - 1.11) / (2.27 - 1.11)
    a = np.zeros(W); col = np.zeros((W, 3))
    base = np.random.default_rng(5).standard_normal(W); base = gaussian_filter(base, 1.2)
    for lo, hi, dens in ((1.24, 1.53, 0.22), (1.53, 1.95, 0.92), (2.03, 2.27, 0.62)):
        m = (x >= R(lo)) & (x <= R(hi)); a[m] = dens * (0.8 + 0.2 * base[m] / (abs(base).max() + 1e-9) * 2)
    a[(x >= R(1.95)) & (x <= R(2.03))] = 0.03                       # Cassini division
    a[(x >= R(2.205)) & (x <= R(2.215))] *= 0.2                      # Encke gap
    fine = gaussian_filter(np.random.default_rng(6).standard_normal(W), 0.8); a = np.clip(a * (1 + 0.18 * fine), 0, 1)
    col[:] = np.array([214, 196, 152]); col *= (0.85 + 0.15 * gaussian_filter(base, 2)[:, None] / (abs(base).max() + 1e-9) * 3)
    img = np.zeros((16, W, 4), np.uint8)
    img[..., :3] = np.clip(col, 0, 255).astype(np.uint8)[None]; img[..., 3] = (a * 255).astype(np.uint8)[None]
    return img

def write_glb(path, meshes, images, emissive=False):
    bin_parts, views, acc = [], [], []
    def add(data, target=None):
        off = sum(len(x) for x in bin_parts); pad = (-len(data)) % 4
        bin_parts.append(data + b'\0' * pad)
        vw = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target: vw['target'] = target
        views.append(vw); return len(views) - 1
    prims, mats, textures, gimages = [], [], [], []
    for im_bytes, mime in images:
        gimages.append({'bufferView': add(im_bytes), 'mimeType': mime}); textures.append({'source': len(gimages) - 1, 'sampler': 0})
    for m in meshes:
        pos, nor, uv, idx = m['geo']
        a0 = len(acc)
        for arr, comp, typ, tgt in ((pos, 5126, 'VEC3', 34962), (nor, 5126, 'VEC3', 34962), (uv, 5126, 'VEC2', 34962), (idx, 5125, 'SCALAR', 34963)):
            acc.append({'bufferView': add(arr.tobytes(), tgt), 'componentType': comp, 'count': len(arr), 'type': typ})
        acc[a0]['min'] = pos.min(0).tolist(); acc[a0]['max'] = pos.max(0).tolist()
        mats.append(m['mat']); prims.append({'attributes': {'POSITION': a0, 'NORMAL': a0 + 1, 'TEXCOORD_0': a0 + 2}, 'indices': a0 + 3, 'material': len(mats) - 1})
    g = {'asset': {'version': '2.0', 'generator': 'Cursor Rig planet generator'}, 'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0}],
         'meshes': [{'primitives': prims}], 'materials': mats, 'textures': textures,
         'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 33071}], 'images': gimages,
         'accessors': acc, 'bufferViews': views, 'buffers': [{'byteLength': sum(len(x) for x in bin_parts)}]}
    js = json.dumps(g).encode(); js += b' ' * ((-len(js)) % 4); bn = b''.join(bin_parts)
    open(path, 'wb').write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(bn)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(bn), b'BIN\0') + bn)

os.makedirs('out', exist_ok=True)
for name, fn in PLANETS.items():
    col, rough = fn()
    geo = sphere(0.5)
    if name == 'sun':
        mat = {'pbrMetallicRoughness': {'baseColorFactor': [0, 0, 0, 1], 'metallicFactor': 0, 'roughnessFactor': 1}, 'emissiveTexture': {'index': 0}, 'emissiveFactor': [1, 1, 1], 'doubleSided': False}
        write_glb(f'out/solar-{name}.glb', [{'geo': geo, 'mat': mat}], [(jpg(col), 'image/jpeg')]); continue
    r = float(np.mean(rough)) if not isinstance(rough, float) else rough
    mat = {'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': min(1.0, r + 0.1)}}
    if name == 'saturn':
        s = 0.22 / 0.5; pos, nor, uv, idx = geo
        pos = pos * s
        rp, rn, ru, ri = ring_mesh(0.22 * 1.11 / 1.0 / 1.0 * 1.0, 0.5)   # outer ring radius 0.5 => whole body fits a 1 unit box
        rp = rp  # ring inner = 0.5*1.11/2.27
        rp, rn, ru, ri = ring_mesh(0.5 * 1.11 / 2.27, 0.5)
        R = rotm('z', -26.7) @ rotm('x', 24)
        pos = (pos @ R.T).astype(np.float32); nor = (nor @ R.T).astype(np.float32)
        rp = (rp @ R.T).astype(np.float32); rn = (rn @ R.T).astype(np.float32)
        rmat = {'pbrMetallicRoughness': {'baseColorTexture': {'index': 1}, 'metallicFactor': 0, 'roughnessFactor': 0.85}, 'alphaMode': 'BLEND', 'doubleSided': True}
        write_glb(f'out/solar-{name}.glb', [{'geo': (pos, nor, uv, idx), 'mat': mat}, {'geo': (rp, rn, ru, ri), 'mat': rmat}], [(jpg(col), 'image/jpeg'), (png(ring_texture()), 'image/png')])
        continue
    if name == 'uranus':
        pos, nor, uv, idx = geo; R = rotm('z', -97.8) @ rotm('x', 12)
        geo = ((pos @ R.T).astype(np.float32), (nor @ R.T).astype(np.float32), uv, idx)
    write_glb(f'out/solar-{name}.glb', [{'geo': geo, 'mat': mat}], [(jpg(col), 'image/jpeg')])
print(sorted(os.listdir('out')), sum(os.path.getsize('out/' + f) for f in os.listdir('out')) // 1024, 'KB')
