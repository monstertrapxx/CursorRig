import sys,json
sys.path.insert(0,'/tmp/cr/rag')
import numpy as np
import zombie as Z, skinrig as SR

def humanoid_segs(bones, meshes, vp):
    H=lambda n:bones[n]['head']; T=lambda n:bones[n]['tail']
    allv=np.array([v[0] for m in meshes for v in m['V']]); top=allv[:,1].max()
    neck=T('col2'); neck=np.array([0,neck[1],neck[2]]); hips=H('bassin'); hips=np.array([0,hips[1],hips[2]])
    topp=np.array([0,top,neck[2]])
    shg,shd=H('avbras.g'),H('avbras.d')
    C=np.array([0,(shg[1]+shd[1])/2,(shg[2]+shd[2])/2])
    if C[1]>neck[1]-0.02*(top-allv[:,1].min()): C[1]=neck[1]-0.02*(top-allv[:,1].min())
    segs=[]; add=lambda n,p,s,e,**kw:segs.append(dict(name=n,parent=p,start=tuple(s),end=tuple(e),**kw))
    add('head',None,topp,neck,stiff=0,mass=1)
    add('chest','head',neck,C,stiff=0.6,limit=50,mass=0.4)
    add('torso','chest',C,hips,stiff=0.9,limit=25,mass=1.2)
    for s in 'gd':
        sh=H('avbras.'+s); el=H('bras.'+s); wr=H('main.'+s); tip=wr+(T('main.'+s)-wr)
        add(f'{s} shoulder','chest',C,sh,stiff=0.98,mass=0.3)
        add(f'{s} upper arm',f'{s} shoulder',sh,el,stiff=0.02,limit=120,mass=0.6)
        add(f'{s} forearm',f'{s} upper arm',el,wr,stiff=0.01,limit=110,mass=0.5)
        add(f'{s} hand',f'{s} forearm',wr,tip,stiff=0.01,limit=80,mass=0.4)
        th=H('cuiss.'+s); kn=H('jamb.'+s)
        miny=min(v[0][1] for mi,m in enumerate(meshes) for i,v in enumerate(m['V']) if vp[mi][i]==f'jamb_{s}')
        add(f'{s} hip','torso',hips,th,stiff=0.98,mass=0.3)
        add(f'{s} thigh',f'{s} hip',th,kn,stiff=0.03,limit=80,mass=1)
        add(f'{s} shin',f'{s} thigh',kn,(kn[0],miny,kn[2]),stiff=0.01,limit=100,mass=0.8)
    p2s={'head':'head','torso':'torso'}
    for s in 'gd': p2s.update({f'avbras_{s}':f'{s} upper arm',f'bras_{s}':f'{s} forearm',f'main_{s}':f'{s} hand',f'cuiss_{s}':f'{s} thigh',f'jamb_{s}':f'{s} shin'})
    return segs,p2s

def skin_meshes(meshes,bones,b2p,p2s,vp):
    def part_of(n):
        while n:
            if n in b2p: return b2p[n]
            n=bones[n]['parent'] if n in bones else None
        return None
    out=[]
    for mi,m in enumerate(meshes):
        wd=[]
        for i,w in enumerate(m['W']):
            d={}
            for b,wt in w:
                p=part_of(b); s=p2s.get(p) if p else None
                if s: d[s]=d.get(s,0)+wt
            if not d: d={p2s.get(vp[mi][i],'torso'):1.0}
            wd.append(d)
        out.append(dict(P=[v[0] for v in m['V']],N=[v[1] for v in m['V']],UV=[v[3][0] for v in m['V']],F=m['F'],tex=m['tex'][0],wd=wd))
    return out

def build(dumpdir,rid,name,prefix,outdir,base):
    bones,meshes=Z.load_dump(dumpdir)
    vp=Z.vparts(meshes,bones,Z.B2P)
    allv=np.array([v[0] for m in meshes for v in m['V']]); K=1.7/(allv[:,1].max()-allv[:,1].min())
    imgs=Z.images(meshes)
    segs,p2s=humanoid_segs(bones,meshes,vp)
    ms=skin_meshes(meshes,bones,Z.B2P,p2s,vp)
    return SR.build(base,rid,name,prefix,K,segs,ms,imgs,outdir)
if __name__=='__main__':
    base=json.load(open('/tmp/claude-0/-home-claude/34603d08-b118-5cde-bf26-103b23158c8a/scratchpad/ui/site/rigs/popoy.json'))
    r=build(sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4],'/tmp/cr/rag/o2',base); print('segs',len(r['segments']))
