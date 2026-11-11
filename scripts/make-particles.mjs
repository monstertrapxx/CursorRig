// Generates default-rigs/blossom.json and feathers.json (particle cursorchains). Run: node scripts/make-particles.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { newParticleRig } from '../src/lib/rig-core.js';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'default-rigs');
const make = (id, name, preset) => { const r = newParticleRig(name, preset); r.id = id; fs.writeFileSync(path.join(out, id + '.json'), JSON.stringify(r, null, 1)); console.log('wrote', id); };
make('blossom', 'Cherry blossom', 'blossom');
make('feathers', 'Black feathers', 'feathers');
