"""Post-process ragdoll rig jsons to be truly limp (video-game ragdoll): no spring back to rest on limbs, wide joint limits,
loose spine, shoulders that can shrug, hips that give a little. Idempotent. usage: python3 loosen.py default-rigs/*ragdoll*.json
Physics matched to Kuma/Kurimu: gravity 30, damping 0.025, substeps 4, flatten 0 (iterations 20 for the bigger tree)."""
import json, sys
LIM = {'upper arm': 160, 'forearm': 150, 'hand': 110, 'thigh': 110, 'shin': 130}
for f in sys.argv[1:]:
    r = json.load(open(f))
    for s in r['segments']:
        n = s['name']; nm = n.split(' ', 1)[-1] if n[:2] in ('g ', 'd ', 'L ', 'R ') else n; st = s.get('stiffness', 0)
        if n == 'chest': s['stiffness'] = 0.12; s['limit'] = 75
        elif n == 'torso': s['stiffness'] = 0.3; s['limit'] = 50
        elif nm == 'shoulder': s['stiffness'] = 0.35; s['limit'] = 50
        elif nm == 'hip': s['stiffness'] = 0.8; s['limit'] = 25
        elif 0 < st < 0.5:
            s['stiffness'] = 0
            if s.get('limit'): s['limit'] = max(s['limit'], LIM.get(nm, s['limit']))
    r['physics'].update(gravity=30, damping=0.05, iterations=20, substeps=4, flatten=0, depthSway=0.3)   # depthSway lets them swing toward/away from the viewer too
    if not r.get('tuned7'):      # once only: bigger on screen, and the body's total mass about the same as Kuma's so the key ring chain is not dragged stiff
        r['scale'] = 100
        for s in r['segments'][4:]: s['mass'] = round(s.get('mass', 1) * 0.55, 3)
        r['tuned7'] = True
    json.dump(r, open(f, 'w'), indent=1)
