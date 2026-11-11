"""Measure a collision radius per segment from a skinned ragdoll GLB.  usage: python3 radii.py dir  -> dir/radii.json {rigfile:{segId:radius}}"""
import json, struct, sys, glob, os
import numpy as np
SKIP = {'chest', 'shoulder', 'hip', 'neck base', 'key ring'}
def load_glb(p):
    b = open(p, 'rb').read(); jl = struct.unpack('<I', b[12:16])[0]; js = json.loads(b[20:20+jl]); bin_ = b[20+jl+8:]
    return js, bin_
def acc(js, bin_, i, dt, nc):
    a = js['accessors'][i]; bv = js['bufferViews'][a['bufferView']]; off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.frombuffer(bin_, dt, a['count'] * nc, off).reshape(a['count'], nc)
def qrot(q, v):
    x, y, z, w = q; u = np.array([x, y, z]); return 2*np.dot(u, v)*u + (w*w - np.dot(u, u))*v + 2*w*np.cross(u, v)
def qinv(q): return (-q[0], -q[1], -q[2], q[3])
out = {}
d = sys.argv[1]
for rf in glob.glob(d + '/*ragdoll*.json'):
    r = json.load(open(rf)); att = [a for s in r['segments'] for a in s['attachments'] if a.get('skin')][0]
    js, bin_ = load_glb(d + '/' + att['model'])
    ids = [n['name'] for n in js['nodes'][:len(js['skins'][0]['joints'])]]
    pos = np.array([n['translation'] for n in js['nodes'][:len(ids)]])
    segs = {s['id']: s for s in r['segments']}
    P = []; J = []; W = []
    for p in js['meshes'][0]['primitives']:
        at = p['attributes']; P.append(acc(js, bin_, at['POSITION'], np.float32, 3)); J.append(acc(js, bin_, at['JOINTS_0'], np.uint16, 4)); W.append(acc(js, bin_, at['WEIGHTS_0'], np.float32, 4))
    P = np.concatenate(P); J = np.concatenate(J); W = np.concatenate(W)
    dom = J[np.arange(len(J)), W.argmax(1)]; wm = W.max(1)
    res = {}
    for j, sid in enumerate(ids):
        s = segs[sid]; nm = s['name'].split(' ', 1)[-1] if s['name'][:2] in ('g ', 'd ', 'L ', 'R ') else s['name']
        if nm in SKIP: continue
        R = att['skin']['bones'][sid]; dr = qrot(qinv(R), np.array([0, -1., 0])); L = s['length']
        m = (dom == j) & (wm > 0.6)
        if m.sum() < 12: continue
        rel = P[m] - pos[j]; t = rel @ dr; perp = np.linalg.norm(rel - np.outer(t, dr), axis=1)
        ok = (t > -0.1*L) & (t < 1.1*L)
        if ok.sum() < 10: continue
        res[sid] = round(float(0.8 * np.percentile(perp[ok], 75)), 4)
    out[os.path.basename(rf)] = res
    print(os.path.basename(rf), {segs[k]['name']: v for k, v in res.items()})
json.dump(out, open(d + '/radii.json', 'w'))
