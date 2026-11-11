"""Skinned ragdoll builder: ONE continuous skinned GLB (smooth joints, no gaps) + a rig json whose segments drive the bones.
The rig attachment carries  skin.bones = { segmentId: [x,y,z,w] }  (rotation that takes the segment frame at rest back to model axes).
rig-core (RigView) sets every bone's world matrix to  segmentFrame * thatRotation , so the mesh bends exactly where the segments bend."""
import json, io, copy, struct
import numpy as np
from PIL import Image
import ragdoll3 as R3
from ragdoll import uid

FLOAT, USHORT, UINT = 5126, 5123, 5125

def write_skinned_glb(path, prims, bone_names, bone_pos, imgs):
    buf = bytearray(); bvs = []; accs = []
    def add_bv(data, target=None):
        while len(buf) % 4: buf.append(0)
        off = len(buf); buf.extend(data)
        d = dict(buffer=0, byteOffset=off, byteLength=len(data))
        if target: d['target'] = target
        bvs.append(d); return len(bvs) - 1
    def add_acc(arr, ctype, typ, target=None, mm=False):
        v = add_bv(arr.tobytes(), target)
        a = dict(bufferView=v, componentType=ctype, count=int(len(arr)), type=typ)
        if mm: a['min'] = arr.min(0).astype(float).tolist(); a['max'] = arr.max(0).astype(float).tolist()
        accs.append(a); return len(accs) - 1
    images, textures, materials, texidx = [], [], [], {}
    def tex_material(key):
        if key in texidx: return texidx[key]
        im = imgs[key].convert('RGB'); b = io.BytesIO(); im.save(b, 'JPEG', quality=88)
        v = add_bv(b.getvalue())
        images.append(dict(bufferView=v, mimeType='image/jpeg')); textures.append(dict(sampler=0, source=len(images) - 1))
        materials.append(dict(pbrMetallicRoughness=dict(baseColorTexture=dict(index=len(textures) - 1), metallicFactor=0.0, roughnessFactor=0.7), doubleSided=True))
        texidx[key] = len(materials) - 1; return texidx[key]
    gprims = []
    for p in prims:
        P = np.asarray(p['P'], np.float32); N = np.asarray(p['N'], np.float32)
        UV = np.asarray(p['UV'], np.float32).copy(); UV[:, 1] = 1.0 - UV[:, 1]          # glTF v points down
        F = np.asarray(p['F'], np.uint32).reshape(-1)
        J = np.asarray(p['J'], np.uint16); W = np.asarray(p['W'], np.float32)
        gprims.append(dict(attributes=dict(POSITION=add_acc(P, FLOAT, 'VEC3', 34962, True), NORMAL=add_acc(N, FLOAT, 'VEC3', 34962),
                                           TEXCOORD_0=add_acc(UV, FLOAT, 'VEC2', 34962), JOINTS_0=add_acc(J, USHORT, 'VEC4', 34962), WEIGHTS_0=add_acc(W, FLOAT, 'VEC4', 34962)),
                           indices=add_acc(F, UINT, 'SCALAR', 34963), material=tex_material(p['tex'])))
    B = len(bone_names)
    ibm = np.zeros((B, 16), np.float32)
    for i, pp in enumerate(bone_pos):
        ibm[i] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -pp[0], -pp[1], -pp[2], 1]
    ibm_acc = add_acc(ibm, FLOAT, 'MAT4')
    nodes = [dict(name=n, translation=[float(x) for x in pp]) for n, pp in zip(bone_names, bone_pos)]
    nodes.append(dict(name='skel', children=list(range(B))))
    nodes.append(dict(name='mesh', mesh=0, skin=0))
    gltf = dict(asset=dict(version='2.0', generator='cursor-rig skinrig'), scene=0, scenes=[dict(nodes=[B, B + 1])], nodes=nodes,
                meshes=[dict(primitives=gprims)], skins=[dict(joints=list(range(B)), inverseBindMatrices=ibm_acc, skeleton=B)],
                materials=materials, textures=textures, images=images, samplers=[dict(magFilter=9729, minFilter=9987, wrapS=10497, wrapT=10497)],
                buffers=[dict(byteLength=len(buf))], bufferViews=bvs, accessors=accs)
    js = json.dumps(gltf, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    while len(buf) % 4: buf.append(0)
    out = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(js) + 8 + len(buf)) + struct.pack('<I', len(js)) + b'JSON' + js + struct.pack('<I', len(buf)) + b'BIN\0' + bytes(buf)
    open(path, 'wb').write(out)

def pack_weights(wdicts, seg_index):
    """wdicts: per vertex {segName: weight} -> (J,W) arrays with the 4 strongest, normalised"""
    n = len(wdicts); J = np.zeros((n, 4), np.uint16); W = np.zeros((n, 4), np.float32)
    for i, d in enumerate(wdicts):
        items = sorted(((w, seg_index[s]) for s, w in d.items() if s in seg_index and w > 0), reverse=True)[:4]
        tot = sum(w for w, _ in items)
        if tot <= 0: items = [(1.0, 0)]; tot = 1.0
        for k, (w, j) in enumerate(items): J[i, k] = j; W[i, k] = w / tot
    return J, W

def build(base_rig, rid, name, prefix, K, seglist, meshes, imgs, outdir, scale=46, flatten=0.02, damping=0.05, rot=None):
    """seglist: dicts name,parent,start,end,stiff,limit,mass (3D, model units). meshes: dicts P,N,UV,F,tex,wd (per-vertex {segName: weight})."""
    for sd in seglist: sd['part'] = None
    rot = np.array([0, 0, 0, 1.0]) if rot is None else np.asarray(rot, float)
    if abs(rot[3] - 1) > 1e-9:                    # hang the whole character rotated by `rot` (e.g. a rabbit hung by its mouth): every segment points along its rotated original direction
        Rm = R3.qmat(rot)
        for sd in seglist: sd['hang'] = Rm @ (np.array(sd['end'], float) - np.array(sd['start'], float))
    H0 = np.array(seglist[0]['start'], float)
    r = R3.build_rig(base_rig, rid, name, prefix, K, seglist, scale, flatten)
    r['physics']['damping'] = damping
    ids = [s['id'] for s in r['segments'][4:]]
    names = [sd['name'] for sd in seglist]; seg_index = {n: i for i, n in enumerate(names)}
    bone_pos = [(np.array(sd['start'], float) - H0) * K for sd in seglist]
    prims = []
    for m in meshes:
        P = (np.asarray(m['P'], float) - H0) * K
        J, W = pack_weights(m['wd'], seg_index)
        prims.append(dict(P=P, N=m['N'], UV=m['UV'], F=m['F'], J=J, W=W, tex=m['tex']))
    write_skinned_glb(f'{outdir}/{prefix}.glb', prims, ids, bone_pos, imgs)
    tmpl = [a for s in r['segments'][:4] for a in s['attachments'] if a['kind'] == 'model']
    tmpl = tmpl[0] if tmpl else [a for s in json.loads(json.dumps(base_rig))['segments'] for a in s['attachments'] if a['kind'] == 'model'][0]
    a = copy.deepcopy(tmpl)
    a.update(id=uid('att'), name=name, model=f'{prefix}.glb', fit=False, useColor=False, position=[0, 0, 0], rotation=[0, 0, 0], scale=[1, 1, 1], visible=True, noSpin=True)
    a.pop('spin', None); a.pop('spinDrive', None)
    a['skin'] = {'bones': {ids[i]: [round(float(v), 6) for v in R3.qmul(R3.qinv(R3.qfrom(sd['hang'] if sd.get('hang') is not None else np.array(sd['end']) - np.array(sd['start']))), rot)] for i, sd in enumerate(seglist)}}
    r['segments'][4]['attachments'] = [a]
    r['physics']['yaw'] = True
    json.dump(r, open(f'{outdir}/{rid}.json', 'w'), indent=1)
    return r
