// Pick a picture from the computer for a folder's icon. The whole picture is resized to a 160x160 square (stretched if it is wide or tall, never cropped),
// so it stays small enough to keep inside the app settings.
export function pickIconImage() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
    let done = false;
    const finish = (v) => { if (done) return; done = true; inp.remove(); resolve(v); };
    inp.addEventListener('change', () => {
      const file = inp.files && inp.files[0];
      if (!file) return finish(null);
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const S = 160, c = document.createElement('canvas'); c.width = c.height = S;
          const g = c.getContext('2d');
          g.imageSmoothingQuality = 'high';
          g.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, S, S);   // the whole picture is resized to a square (a wide or tall picture is squashed to fit, nothing is cropped)
          let out = c.toDataURL('image/webp', 0.88);
          if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/png');
          finish(out);
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
