import sys,json; sys.path.insert(0,'/tmp/cr/rag')
import numpy as np, zombie as Z, skinrig as SR, zskin
def segs_ninja(bones,meshes,vp):
    H=lambda n:bones[n]['head']; T=lambda n:bones[n]['tail']
    allv=np.array([v[0] for m in meshes for v in m['V']]); top=allv[:,1].max()
    nk=H('neck'); neck=np.array([0,nk[1],nk[2]]); hp=H('pelvis'); hips=np.array([0,hp[1],hp[2]])
    topp=np.array([0,top,neck[2]])
    shl,shr=H('humerusL'),H('humerusR')
    C=np.array([0,(shl[1]+shr[1])/2,(shl[2]+shr[2])/2])
    if C[1]>neck[1]-0.02*(top-allv[:,1].min()): C[1]=neck[1]-0.02*(top-allv[:,1].min())
    segs=[]; add=lambda n,p,s,e,**kw:segs.append(dict(name=n,parent=p,start=tuple(s),end=tuple(e),**kw))
    add('head',None,topp,neck,stiff=0,mass=1)
    add('chest','head',neck,C,stiff=0.6,limit=50,mass=0.4)
    add('torso','chest',C,hips,stiff=0.9,limit=25,mass=1.2)
    for s in 'LR':
        sh=H('humerus'+s); el=H('bras'+s); wr=H('palm'+s); tip=T('middle3'+s)
        add(f'{s} shoulder','chest',C,sh,stiff=0.98,mass=0.3)
        add(f'{s} upper arm',f'{s} shoulder',sh,el,stiff=0.02,limit=120,mass=0.6)
        add(f'{s} forearm',f'{s} upper arm',el,wr,stiff=0.01,limit=110,mass=0.5)
        add(f'{s} hand',f'{s} forearm',wr,tip,stiff=0.01,limit=80,mass=0.4)
        th=H('femur'+s); kn=H('tibia'+s)
        miny=allv[:,1].min()
        add(f'{s} hip','torso',hips,th,stiff=0.98,mass=0.3)
        add(f'{s} thigh',f'{s} hip',th,kn,stiff=0.03,limit=80,mass=1)
        add(f'{s} shin',f'{s} thigh',kn,(kn[0],miny,kn[2]),stiff=0.01,limit=100,mass=0.8)
    return segs
B2P={b:'torso' for b in ['BASE','BACK','pelvis','vert1','vert2','clavL','clavR']}
B2P.update(neck='head',head='head')
for s in 'LR':
    B2P.update({'humerus'+s:'ua_'+s,'bras'+s:'fa_'+s,'palm'+s:'h_'+s,'femur'+s:'th_'+s,'tibia'+s:'sh_'+s,'FOOT'+s:'sh_'+s})
p2s={'head':'head','torso':'torso'}
for s in 'LR': p2s.update({f'ua_{s}':f'{s} upper arm',f'fa_{s}':f'{s} forearm',f'h_{s}':f'{s} hand',f'th_{s}':f'{s} thigh',f'sh_{s}':f'{s} shin'})
bones,meshes=Z.load_dump('d_ninja_gray')
vp=Z.vparts(meshes,bones,B2P)
allv=np.array([v[0] for m in meshes for v in m['V']]); K=1.7/(allv[:,1].max()-allv[:,1].min())
imgs=Z.images(meshes)
segs=segs_ninja(bones,meshes,vp)
ms=zskin.skin_meshes(meshes,bones,B2P,p2s,vp)
base=json.load(open('/tmp/claude-0/-home-claude/34603d08-b118-5cde-bf26-103b23158c8a/scratchpad/ui/site/rigs/popoy.json'))
r=SR.build(base,'ninjagray_ragdoll','Ninja Gray (ragdoll)','bsrag_ninjagray','/tmp/cr/rag/o2',base=None) if False else SR.build(base,'ninjagray_ragdoll','Ninja Gray (ragdoll)','bsrag_ninjagray',K,segs,ms,imgs,'/tmp/cr/rag/o2')
print(len(r['segments']))
