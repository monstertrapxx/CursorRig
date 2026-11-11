// The big metal key ring at the top of a chain: the top piece (no parent) carrying a metal ring/torus part.
// Only chains that have one get the "Key ring size" slider in the menu.
export function topRing(rig) {
  const segs = rig?.segments || [];
  const ids = new Set(segs.map((s) => s.id));
  for (const s of segs) {
    if (s.parent && ids.has(s.parent)) continue;
    const ok = (s.attachments || []).some((a) => a.kind !== 'model' && (a.shape === 'torus' || a.shape === 'ring') && (a.metalness ?? 0) >= 0.5);
    if (ok) return s;
    return null;   // only the very first top piece counts
  }
  return null;
}
