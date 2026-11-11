import sys,json,os,math,copy
sys.path.insert(0,'/tmp/cr/rag')
import numpy as np
from PIL import Image
import ragdoll as R

def load_dump(d):
    dump=json.load(open(d+'/dump.json'))
    c=lambda p:[p[0],p[2],-p[1]]          # Blender Z-up -> three.js Y-up, character faces +Z
    bones={b['name']:dict(parent=b['parent'],head=np.array(c(b['head'])),tail=np.array(c(b['tail']))) for b in dump['bones']}
    meshes=[]
    for m in dump['meshes']:
        if m['name'].startswith('Icosphere'): continue
        V=[(c(p),c(n),None,[uv],None,None) for p,n,uv in zip(m['V'],m['N'],m['UV'])]
        meshes.append(dict(name=m['name'],V=V,F=m['F'],tex=[m['tex'] or ('color',)+tuple(m['color'] or (0.6,0.6,0.6,1))],W=m['W']))
    return bones,meshes

def vparts(meshes,bones,b2p):
    def part_of(n):
        while n:
            if n in b2p: return b2p[n]
            n=bones[n]['parent'] if n in bones else None
        return None
    return [[part_of(w[0][0]) if w else None for w in m['W']] for m in meshes]

def images(meshes):
    imgs={}
    for m in meshes:
        t=m['tex'][0]
        if isinstance(t,tuple):
            col=tuple(int(max(0,min(1,x))*255) for x in t[1:4]); key='c%02x%02x%02x'%col; imgs[key]=Image.new('RGB',(8,8),col); m['tex']=[key]
        else:
            im=Image.open(t).convert('RGB')
            if max(im.size)>512: im=im.resize((512,512*im.size[1]//im.size[0]) if im.size[0]>=im.size[1] else (512*im.size[0]//im.size[1],512))
            import io; b=io.BytesIO(); im.save(b,'JPEG',quality=88); b.seek(0); imgs[t]=Image.open(b)
    return imgs

def zombie_spec(bones, meshes, vp, K, hang_arm_extra=0.0):
    H=lambda n:bones[n]['head']; T=lambda n:bones[n]['tail']
    segs=[]; S={}
    def add(name,parent,part,start,end,**kw):
        segs.append(dict(name=name,parent=parent,part=part,start=tuple(start),end=tuple(end),**kw))
        if part: S[part]=dict(start=tuple(start),theta_orig=R.ang(np.array(end[:2])-np.array(start[:2])))
    allv=np.array([v[0] for m in meshes for v in m['V']]); top=allv[:,1].max()
    neck=T('col2'); neck=np.array([0,neck[1],neck[2]]); hips=H('bassin'); hips=np.array([0,hips[1],hips[2]])
    topp=np.array([0,top,neck[2]])
    add('head',None,'head',topp,neck,stiff=0,mass=1)
    add('torso','head','torso',neck,hips,stiff=0.35,limit=45,mass=1.2)
    for s,sg in (('g',1),('d',-1)):
        sh=H('avbras.'+s); el=H('bras.'+s); wr=H('main.'+s)
        tip=wr+(T('main.'+s)-wr)
        add(f'{s} shoulder','head',None,neck,sh,stiff=0.98,mass=0.3)
        add(f'{s} upper arm',f'{s} shoulder',f'avbras_{s}',sh,el,stiff=0.12,limit=100,mass=0.6,dz=0.06)
        add(f'{s} forearm',f'{s} upper arm',f'bras_{s}',el,wr,stiff=0.08,limit=90,mass=0.5,dz=0.07)
        add(f'{s} hand',f'{s} forearm',f'main_{s}',wr,tip,stiff=0.05,limit=70,mass=0.4,dz=0.08)
        th=H('cuiss.'+s); kn=H('jamb.'+s)
        add(f'{s} hip','torso',None,hips,th,stiff=0.98,mass=0.3)
        miny=min(v[0][1] for mi,m in enumerate(meshes) for i,v in enumerate(m['V']) if vp[mi][i]==f'jamb_{s}')
        add(f'{s} thigh',f'{s} hip',f'cuiss_{s}',th,kn,stiff=0.14,limit=60,mass=1,dz=(0.02 if s=='g' else 0.0))
        add(f'{s} shin',f'{s} thigh',f'jamb_{s}',kn,(kn[0],miny,kn[2]),stiff=0.08,limit=80,mass=0.8,dz=(0.03 if s=='g' else 0.01))
    return segs,S

B2P={'cou':'head','tet':'head','GGG':'torso','bassin':'torso','col1':'torso','col2':'torso','clav.g':'torso','clav.d':'torso'}
for s in ('g','d'):
    B2P.update({'avbras.'+s:'avbras_'+s,'bras.'+s:'bras_'+s,'main.'+s:'main_'+s,'cuiss.'+s:'cuiss_'+s,'jamb.'+s:'jamb_'+s,'pied.'+s:'jamb_'+s})

def build(dumpdir,rid,name,prefix,outdir,base):
    bones,meshes=load_dump(dumpdir)
    vp=vparts(meshes,bones,B2P)
    allv=np.array([v[0] for m in meshes for v in m['V']]); K=1.7/(allv[:,1].max()-allv[:,1].min())
    imgs=images(meshes)
    segs,S=zombie_spec(bones,meshes,vp,K)
    parts=R.export_parts(meshes,vp,S,K,imgs,outdir,prefix)
    r=R.build_rig(base,rid,name,prefix,K,segs)
    json.dump(r,open(f'{outdir}/{rid}.json','w'),indent=1)
    return parts
if __name__=='__main__':
    base=json.load(open('/tmp/claude-0/-home-claude/34603d08-b118-5cde-bf26-103b23158c8a/scratchpad/ui/site/rigs/popoy.json'))
    os.makedirs('/tmp/cr/rag/o',exist_ok=True)
    print(build(sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4],'/tmp/cr/rag/o',base))
