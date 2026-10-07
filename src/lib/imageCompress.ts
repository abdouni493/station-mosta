/**
 * ─── Compression des images avant envoi ────────────────────────────────────────
 * Une photo de téléphone pèse 3 à 8 Mo pour 4000 × 3000 px ; une facture lisible
 * en tient dans ~1600 px et 150-400 Ko. On fait ici, sans dépendance, ce que fait
 * la référence du genre (`browser-image-compression`) :
 *   1. décoder en respectant l'orientation EXIF (`createImageBitmap`) ;
 *   2. réduire au plus grand côté voulu, par paliers de moitié (net, pas flou) ;
 *   3. ré-encoder en WebP (JPEG si le navigateur ne sait pas), puis baisser la
 *      qualité tant que le fichier dépasse la taille cible.
 * Le résultat n'est gardé QUE s'il est plus léger que l'original ; un SVG, un GIF
 * (animé) ou une image illisible repart tel quel — compresser ne bloque jamais.
 * ──────────────────────────────────────────────────────────────────────────────
 */

export interface CompressOptions {
  /** Plus grand côté, en pixels. */
  maxSide?: number;
  /** Taille visée, en kilo-octets. */
  maxKB?: number;
  /** Qualité de départ (0-1). */
  quality?: number;
}

/** Les réglages par usage : une facture doit rester lisible, un logo petit. */
export const IMAGE_PRESETS = {
  document: { maxSide: 2000, maxKB: 450, quality: 0.82 },
  photo:    { maxSide: 1280, maxKB: 250, quality: 0.8 },
  avatar:   { maxSide: 512,  maxKB: 90,  quality: 0.8 },
} satisfies Record<string, CompressOptions>;

let webpOk: boolean | null = null;
function supportsWebp(): boolean {
  if (webpOk === null) {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      webpOk = c.toDataURL('image/webp').startsWith('data:image/webp');
    } catch { webpOk = false; }
  }
  return webpOk;
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' } as any); }
    catch { /* certains navigateurs refusent l'option : repli sur <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (c: HTMLCanvasElement, type: string, q: number) =>
  new Promise<Blob | null>(res => c.toBlob(res, type, q));

export async function compressImage(file: File, opts: CompressOptions = IMAGE_PRESETS.photo): Promise<File> {
  const { maxSide = 1600, maxKB = 300, quality = 0.8 } = opts;
  if (!file || !file.type.startsWith('image/') || /svg|gif/.test(file.type)) return file;
  // Déjà petit et déjà dans un format compact : rien à gagner.
  if (file.size <= maxKB * 1024 && /webp|jpeg/.test(file.type)) return file;

  try {
    const src = await decode(file);
    const w0 = (src as any).width, h0 = (src as any).height;
    if (!w0 || !h0) return file;
    const scale = Math.min(1, maxSide / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));

    // Réduction par paliers de moitié, puis le dernier pas exact.
    let canvas = document.createElement('canvas');
    let cw = w0, ch = h0;
    canvas.width = cw; canvas.height = ch;
    let ctx = canvas.getContext('2d')!;
    ctx.drawImage(src as any, 0, 0);
    while (cw / 2 >= w && ch / 2 >= h) {
      const next = document.createElement('canvas');
      next.width = Math.round(cw / 2); next.height = Math.round(ch / 2);
      const nctx = next.getContext('2d')!;
      nctx.imageSmoothingQuality = 'high';
      nctx.drawImage(canvas, 0, 0, next.width, next.height);
      canvas = next; cw = next.width; ch = next.height;
    }
    if (cw !== w || ch !== h) {
      const last = document.createElement('canvas');
      last.width = w; last.height = h;
      ctx = last.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(canvas, 0, 0, w, h);
      canvas = last;
    }
    if ('close' in src) (src as ImageBitmap).close();

    // Un PNG sans WebP garde sa transparence en PNG ; sinon WebP, ou JPEG.
    const type = supportsWebp() ? 'image/webp' : file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    let q = quality;
    let out = await toBlob(canvas, type, q);
    while (out && out.size > maxKB * 1024 && q > 0.45 && type !== 'image/png') {
      q -= 0.1;
      out = await toBlob(canvas, type, q);
    }
    if (!out || out.size >= file.size) return file;

    const ext = type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg';
    const name = (file.name || 'image').replace(/\.[^.]+$/, '') + '.' + ext;
    return new File([out], name, { type, lastModified: Date.now() });
  } catch (e) {
    console.warn('[compressImage] envoi de l\'original', e);
    return file;
  }
}

/** Lecture en data-URL (repli hors ligne) — de l'image DÉJÀ compressée. */
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
