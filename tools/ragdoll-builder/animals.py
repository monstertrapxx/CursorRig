import sys,json,os
sys.path.insert(0,'/tmp/cr/rag')
import numpy as np
import zombie as Z, ragdoll3 as R3

def mk(segs):
    S={}
    for s in segs:
        if s.get('part'):
            s['q_orig']=R3.qfrom(np.array(s['end'])-np.array(s['start'])); S[s['part']]=s
    return S

def bird_spec(bones,meshes,vp):
    H=lambda n:bones[n]['head']; T=lambda n:bones[n]['tail']
    allv=np.array([v[0] for m in meshes for v in m['V']])
    C=H('GGG')
    bodyv=[meshes[mi]['V'][i][0] for mi in range(len(meshes)) for i in range(len(meshes[mi]['V'])) if vp[mi][i]=='body']
    top=max(v[1] for v in bodyv)
    Hp=np.array([C[0],top,C[2]])
    segs=[]
    add=lambda name,parent,part,s,e,**kw:segs.append(dict(name=name,parent=parent,part=part,start=tuple(s),end=tuple(e),**kw))
    add('body',None,'body',Hp,C,stiff=0,mass=1.6)
    add('neck base','body',None,C,H('nec2'),stiff=0.98,mass=0.3)
    add('neck','neck base','neck',H('nec2'),T('nec2'),stiff=0.35,limit=60,mass=0.5)
    add('head','neck','head',H('nec3'),T('bec'),stiff=0.25,limit=70,mass=0.5)
    add('tail','body','tail',H('qe1'),T('qe2'),stiff=0.25,limit=60,mass=0.4)
    for s in 'gd':
        add(f'{s} shoulder','body',None,C,H('bras.'+s),stiff=0.98,mass=0.3)
        add(f'{s} wing 1',f'{s} shoulder','w1_'+s,H('bras.'+s),T('bras.'+s),stiff=0.2,limit=80,mass=0.5)
        add(f'{s} wing 2',f'{s} wing 1','w2_'+s,H('avbras.'+s),T('avbras.'+s),stiff=0.15,limit=80,mass=0.5)
        add(f'{s} wing 3',f'{s} wing 2','w3_'+s,H('main.'+s),T('main.'+s),stiff=0.1,limit=70,mass=0.4)
        add(f'{s} hip','body',None,C,H('cuiss.'+s),stiff=0.98,mass=0.3)
        add(f'{s} thigh',f'{s} hip','th_'+s,H('cuiss.'+s),T('cuiss.'+s),stiff=0.15,limit=50,mass=0.6)
        add(f'{s} leg',f'{s} thigh','lg_'+s,H('jaamb.'+s),T('pied.'+s),stiff=0.1,limit=70,mass=0.5)
    B={'GGG':'body','nec1':'body','nec2':'neck','nec3':'head','bec':'head','qe1':'tail','qe2':'tail'}
    for s in 'gd':
        B.update({'bras.'+s:'w1_'+s,'avbras.'+s:'w2_'+s,'main.'+s:'w3_'+s,'cuiss.'+s:'th_'+s,'jaamb.'+s:'lg_'+s,'pied.'+s:'lg_'+s})
    return segs,B

def rabbit_spec(bones,meshes,vp):
    H=lambda n:bones[n]['head']; T=lambda n:bones[n]['tail']
    C=H('bassin')
    bodyv=[meshes[mi]['V'][i][0] for mi in range(len(meshes)) for i in range(len(meshes[mi]['V'])) if vp[mi][i]=='body']
    top=max(v[1] for v in bodyv); Hp=np.array([C[0],top,C[2]])
    segs=[]
    add=lambda name,parent,part,s,e,**kw:segs.append(dict(name=name,parent=parent,part=part,start=tuple(s),end=tuple(e),**kw))
    add('body',None,'body',Hp,C,stiff=0,mass=1.6)
    add('neck','body','head',H('cou'),T('tet'),stiff=0.7,limit=35,mass=0.6)
    for s in 'gd':
        add(f'{s} shoulder','body',None,C,H('bras.'+s),stiff=0.98,mass=0.3)
        add(f'{s} arm',f'{s} shoulder','ar_'+s,H('bras.'+s),T('bras.'+s),stiff=0.12,limit=80,mass=0.4)
        add(f'{s} paw',f'{s} arm','pw_'+s,H('main.'+s),T('main.'+s),stiff=0.1,limit=80,mass=0.3)
        add(f'{s} hip','body',None,C,H('cuiss.'+s),stiff=0.98,mass=0.3)
        add(f'{s} thigh',f'{s} hip','th_'+s,H('cuiss.'+s),T('cuiss.'+s),stiff=0.15,limit=60,mass=0.6)
        add(f'{s} foot',f'{s} thigh','ft_'+s,H('pied.'+s),T('pied.'+s),stiff=0.1,limit=80,mass=0.4)
    B={'GGG':'body','bassin':'body','cou':'head','tet':'head'}
    for s in 'gd':
        B.update({'bras.'+s:'ar_'+s,'main.'+s:'pw_'+s,'cuiss.'+s:'th_'+s,'pied.'+s:'ft_'+s})
    return segs,B

def build(dumpdir,rid,name,prefix,outdir,base,spec):
    bones,meshes=Z.load_dump(dumpdir)
    # pass 1 parts by map (need map before spec for body top): map first
    segs,B=spec(bones,meshes,[[ 'body' for _ in m['V']] for m in meshes])  # placeholder to get B
    vp=Z.vparts(meshes,bones,B)
    segs,B=spec(bones,meshes,vp)
    none=sum(1 for v in vp for x in v if x is None); tot=sum(len(v) for v in vp)
    allv=np.array([v[0] for m in meshes for v in m['V']])
    ext=allv.max(0)-allv.min(0); K=1.7/max(ext[0],ext[1],ext[2]); print('extent',ext.round(2),'K',round(K,2),'unassigned verts',none,'/',tot)
    imgs=Z.images(meshes); S=mk(segs)
    parts=R3.export_parts(meshes,vp,S,K,imgs,outdir,prefix)
    for sg in segs:
        if sg.get('part') and sg['part'] not in parts: sg['part']=None
    r=R3.build_rig(base,rid,name,prefix,K,segs)
    json.dump(r,open(f'{outdir}/{rid}.json','w'),indent=1); return parts
if __name__=='__main__':
    base=json.load(open('/tmp/claude-0/-home-claude/34603d08-b118-5cde-bf26-103b23158c8a/scratchpad/ui/site/rigs/popoy.json'))
    d,rid,name,prefix,kind=sys.argv[1:6]
    print(build(d,rid,name,prefix,'/tmp/cr/rag/o',base,bird_spec if kind=='bird' else rabbit_spec))
