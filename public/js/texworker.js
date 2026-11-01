// Hors du fil principal : décode une photo et la compresse pour la carte graphique (voir bc.js).
// Reçoit { id, url, kind }, renvoie { id, levels } (niveaux de mipmap compressés) ou { id, error }.
import { compress } from './bc.js';

// Les formats compressés veulent des côtés en puissances de deux (quelques photos font 1024 × 985…).
const pot = n => 2 ** Math.round(Math.log2(n));

self.onmessage = async ({ data: { id, url, kind } }) => {
  try {
    const blob = await (await fetch(url)).blob();
    // valeurs brutes, sans conversion de couleur, comme les envoyait three.js
    let bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
    const w = pot(bmp.width), h = pot(bmp.height);
    if (w !== bmp.width || h !== bmp.height) {
      bmp.close();
      bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    }
    const c = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
    c.drawImage(bmp, 0, 0);
    bmp.close();
    const levels = compress(c.getImageData(0, 0, w, h).data, w, h, kind);
    self.postMessage({ id, levels }, levels.map(l => l.data.buffer));
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
