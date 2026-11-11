import sys,json; sys.path.insert(0,'/tmp/cr/rag')
import zombie as Z, zskin
for s in 'gd': Z.B2P['talon.'+s]='jamb_'+s
base=json.load(open('/tmp/claude-0/-home-claude/34603d08-b118-5cde-bf26-103b23158c8a/scratchpad/ui/site/rigs/popoy.json'))
r=zskin.build('d_bad_santa','badsanta_ragdoll','Bad Santa (ragdoll)','bsrag_badsanta','/tmp/cr/rag/o2',base)
print(len(r['segments']))
