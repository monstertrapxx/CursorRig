// "+ PNG": pick a picture from the computer and turn it into a cursorbit (copies of it orbiting the cursor) and a cursor emitter (it
// drifts off the cursor like particles). The picture is shrunk to at most 256 px a side and stored inside each rig as a PNG data string,
// so the rigs can be shared as .crig files like any other.
const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 9);

export function pickPng() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/png,image/webp,image/jpeg,image/*'; inp.style.display = 'none';
    let done = false;
    const finish = (v) => { if (done) return; done = true; inp.remove(); resolve(v); };
    inp.addEventListener('change', () => {
      const file = inp.files && inp.files[0];
      if (!file) return finish(null);
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const W = img.naturalWidth, H = img.naturalHeight;
          let max = 256, uri = '';
          for (let tries = 0; tries < 3 && (!uri || uri.length > 600000); tries++, max = Math.round(max / 2)) {
            const k = Math.min(1, max / Math.max(W, H)), w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, w, h);
            uri = c.toDataURL('image/png');
          }
          finish(uri && uri.length <= 600000 ? { name: (file.name || 'Picture').replace(/\.[^.]+$/, '').slice(0, 40) || 'Picture', uri } : null);
        } catch (e) { finish(null); }
        URL.revokeObjectURL(url);
      };
      img.onerror = () => { URL.revokeObjectURL(url); finish(null); };
      img.src = url;
    });
    inp.addEventListener('cancel', () => finish(null));
    document.body.appendChild(inp);
    inp.click();
  });
}

const physics = { gravity: 30, damping: 0.02, iterations: 12, substeps: 4, flatten: 0.15, depthSway: 0 };

// the cursorbit: the picture (one copy to start with; the menu has a slider for more) on a tilted ring around the cursor
export function pngOrbitRig(name, uri, count = 1) {
  const ring = { id: uid('ring'), name: 'orbit', radius: 1.5, tilt: 62, node: -18, speed: 1.2, trail: false, color: '#ffffff' };
  const segments = Array.from({ length: count }, (_, i) => i).map((i) => ({
    id: uid('seg'), name: name + ' ' + (i + 1), parent: null, length: 0.5, rest: [0, 0, 0, 1], stiffness: 0, mass: 1,
    orbit: { ring: ring.id, angle: i * 360 / count, spin: 0 },
    attachments: [{ id: uid('att'), name, kind: 'primitive', shape: 'sphere', image: uri, fit: true, useColor: true, color: '#ffffff', metalness: 0, roughness: 1, opacity: 1,
      emissive: '#000000', emissiveIntensity: 0, flatShading: false, thickness: 0.3, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1.1, 1.1, 1.1], visible: true, noSpin: true }],
  }));
  return { format: 'cursor-rig', version: 1, id: uid('rig'), name: name + ' orbit', scale: 40, type: 'orbit', physics, anchor: { offset: [0, 0, 0], attachments: [] },
    orbit: { baseSpeed: 0.7, maxSpeed: 9, sensitivity: 12, trails: false, sunSpin: 0, sway: 0.3, rings: [ring] }, segments };
}

// the cursor emitter: the picture drifts off the cursor like petals do
export function pngEmitterRig(name, uri) {
  return { format: 'cursor-rig', version: 1, id: uid('rig'), name: name + ' emitter', scale: 56, type: 'particles', physics, anchor: { offset: [0, 0, 0], attachments: [] },
    particles: { preset: 'image', shape: 'image', image: uri, max: 60, rate: 8, rateFast: 34, life: [2.0, 3.4], size: [0.55, 0.9], gravity: 0.7, drag: 1.6, flutter: 0.5, tumble: 0.7, spread: 0.15, launch: 0.5, push: 0.2, sensitivity: 12, colors: ['#ffffff'] }, segments: [] };
}

// the template icons in the library: the real thing, drawn with a black square with a white question mark as the picture
let _q = null;
export function questionUri() {
  if (_q) return _q;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#fff'; g.font = 'bold 96px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', 64, 70);
  return (_q = c.toDataURL('image/png'));
}
export function templateRig(id) {
  const r = id === '__tpl_orbit' ? pngOrbitRig('?', questionUri(), 1) : pngEmitterRig('?', questionUri());
  r.id = id; r.name = id === '__tpl_orbit' ? 'Custom PNG Cursorbit' : 'Custom PNG Emitter';
  return r;
}
