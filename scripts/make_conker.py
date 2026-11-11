import numpy as np, json, struct, io
from PIL import Image
from scipy.ndimage import gaussian_filter

rng = np.random.default_rng(7)
TW, TH = 1024, 512
u = (np.arange(TW) + 0.5) / TW
v = (np.arange(TH) + 0.5) / TH
U, V = np.meshgrid(u, v)

def noise(sv, su, seed):
    r = np.random.default_rng(seed).standard_normal((TH, TW))
    n = gaussian_filter(r, sigma=(sv, su), mode=('nearest', 'wrap'))
    n = (n - n.mean()) / (n.std() + 1e-9)
    return n

# grain runs pole to pole (long in v), like the flame figure on a real conker
fine = noise(30, 3.2, 1)
mid = noise(45, 7, 2)
broad = noise(60, 14, 3)
mott = noise(3, 3, 4)
speck = noise(0.8, 0.8, 5)
warp = noise(50, 10, 6)
flame = np.sin((U * 26 + warp * 0.35) * 2 * np.pi)
flame = (flame * 0.5 + 0.5) ** 2.2
t = 0.5 + 0.08 * fine + 0.10 * mid + 0.08 * broad + 0.005 * mott + 0.30 * (flame - 0.4)
t = np.clip(t, 0, 1)
dark = np.array([52, 17, 6]) / 255.0
warm = np.array([112, 44, 14]) / 255.0
light = np.array([176, 88, 34]) / 255.0
col = dark + (warm - dark) * t[..., None]
hi = np.clip((t - 0.62) / 0.38, 0, 1)[..., None]
col = col + (light - col) * hi * 0.8
col = col * (0.985 + 0.015 * speck[..., None])

# the pale, matte "eye" patch (hilum) on the +Z side, a little below the equator
lon = (U - 0.5) * 2 * np.pi
lat = (0.5 - V) * np.pi
d = np.stack([np.cos(lat) * np.sin(lon), np.sin(lat), np.cos(lat) * np.cos(lon)], -1)
c = np.array([0.0, np.sin(-0.28), np.cos(-0.28)])
ang = np.arccos(np.clip(d @ c, -1, 1))
edge = ang + mott * 0.004 + broad * 0.012
patch = np.clip((0.60 - edge) / 0.07, 0, 1)
patch = patch * patch * (3 - 2 * patch)
rim = np.clip(1 - np.abs(edge - 0.66) / 0.09, 0, 1)
pale = np.array([214, 190, 148]) / 255.0
pale2 = np.array([186, 156, 112]) / 255.0
pcol = pale + (pale2 - pale) * np.clip(0.35 + 0.35 * (ang / 0.6) + 0.1 * fine, 0, 1)[..., None]
pcol = pcol * (0.985 + 0.015 * speck[..., None])
col = col * (1 - rim[..., None] * 0.55)               # darker ring round the patch
col = col * (1 - patch[..., None]) + pcol * patch[..., None]
col = np.clip(col, 0, 1)
base = (np.clip(col, 0, 1) ** (1 / 1.0) * 255).astype(np.uint8)

# roughness (G) / metallic (B): polished nut, matte patch
rough = 0.16 + 0.03 * (1 - t) + patch * 0.5
rough = np.clip(rough, 0.08, 1)
mr = np.zeros((TH, TW, 3), np.uint8)
mr[..., 1] = (rough * 255).astype(np.uint8)

# normal map from a height field of grain + the patch's slight texture
h = 0.3 * fine + 0.2 * mid
h = gaussian_filter(h, 2.0, mode=('nearest', 'wrap'))
gx = np.roll(h, -1, 1) - np.roll(h, 1, 1)
gy = np.roll(h, -1, 0) - np.roll(h, 1, 0)
k = 0.25
nrm = np.stack([-gx * k, gy * k, np.ones_like(h)], -1)
nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
nimg = ((nrm * 0.5 + 0.5) * 255).astype(np.uint8)

def png(a):
    b = io.BytesIO(); Image.fromarray(a).save(b, 'PNG', optimize=True); return b.getvalue()
imgs = [png(base), png(mr), png(nimg)]

# conker body: slightly squat and egg-shaped, with the pale scar sitting on a flattened, slightly dished face
SEG, RING = 128, 96
cdir = np.array([0.0, np.sin(-0.28), np.cos(-0.28)])
def sm(x): x = np.clip(x, 0, 1); return x * x * (3 - 2 * x)
pos, uv = [], []
for i in range(RING + 1):
    la = np.pi / 2 - np.pi * i / RING
    for j in range(SEG + 1):
        lo = (j / SEG - 0.5) * 2 * np.pi
        p = np.array([np.cos(la) * np.sin(lo), np.sin(la), np.cos(la) * np.cos(lo)])
        ang = np.arccos(np.clip(p @ cdir, -1, 1))
        r = 1.0
        r -= 0.10 * sm(1 - ang / 0.85)                      # a broad flat scar face, clearly cut in
        # lopsided like a real nut: low, slow lumps rather than a perfect ball
        r *= 1 + 0.012 * np.sin(2.1 * p[0] + 1.3) + 0.01 * np.sin(2.6 * p[1] - 0.4) + 0.01 * np.sin(1.9 * p[2] + 2.2)
        q = p * r
        q = q * np.array([1.0, 0.9, 0.93])                 # squat and a little wider than tall
        q[1] += 0.07 * max(p[1], 0) - 0.05 * max(-p[1], 0)  # fuller crown, tucked base
        pos.append(q * 0.5); uv.append([j / SEG, i / RING])
pos = np.array(pos, np.float32); uv = np.array(uv, np.float32)
idx = []
for i in range(RING):
    for j in range(SEG):
        a = i * (SEG + 1) + j; b = a + SEG + 1
        idx += [a, b, a + 1, a + 1, b, b + 1]
idx = np.array(idx, np.uint32)
fi = idx.reshape(-1, 3)
fn = np.cross(pos[fi[:, 1]] - pos[fi[:, 0]], pos[fi[:, 2]] - pos[fi[:, 0]])
nor = np.zeros_like(pos)
for k in range(3): np.add.at(nor, fi[:, k], fn)
nor /= np.linalg.norm(nor, axis=1, keepdims=True) + 1e-9
# seam: average normals of the duplicated edge column
for i in range(RING + 1):
    a_, b_ = i * (SEG + 1), i * (SEG + 1) + SEG
    m = nor[a_] + nor[b_]; m /= np.linalg.norm(m) + 1e-9; nor[a_] = nor[b_] = m
nor = nor.astype(np.float32)

bin_parts, views = [], []
def add(data, target=None):
    off = sum(len(x) for x in bin_parts)
    pad = (-len(data)) % 4
    bin_parts.append(data + b'\0' * pad)
    vw = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
    if target: vw['target'] = target
    views.append(vw); return len(views) - 1
vp = add(pos.tobytes(), 34962); vn = add(nor.tobytes(), 34962); vt = add(uv.tobytes(), 34962); vi = add(idx.tobytes(), 34963)
vimg = [add(b) for b in imgs]
gltf = {
  'asset': {'version': '2.0', 'generator': 'Cursor Rig conker generator'},
  'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': 'conker'}],
  'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2}, 'indices': 3, 'material': 0}]}],
  'materials': [{'name': 'conker', 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicRoughnessTexture': {'index': 1}, 'metallicFactor': 1.0, 'roughnessFactor': 1.0},
                 'normalTexture': {'index': 2, 'scale': 0.3}}],
  'textures': [{'source': i, 'sampler': 0} for i in range(3)],
  'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 33071}],
  'images': [{'bufferView': w, 'mimeType': 'image/png'} for w in vimg],
  'accessors': [
    {'bufferView': vp, 'componentType': 5126, 'count': len(pos), 'type': 'VEC3', 'min': pos.min(0).tolist(), 'max': pos.max(0).tolist()},
    {'bufferView': vn, 'componentType': 5126, 'count': len(nor), 'type': 'VEC3'},
    {'bufferView': vt, 'componentType': 5126, 'count': len(uv), 'type': 'VEC2'},
    {'bufferView': vi, 'componentType': 5125, 'count': len(idx), 'type': 'SCALAR'}],
  'bufferViews': views, 'buffers': [{'byteLength': sum(len(x) for x in bin_parts)}],
}
js = json.dumps(gltf).encode(); js += b' ' * ((-len(js)) % 4)
bn = b''.join(bin_parts)
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(bn)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(bn), b'BIN\0') + bn
open('conker.glb', 'wb').write(glb)
Image.fromarray(base).save('conker-texture.png')
print('glb bytes', len(glb))
