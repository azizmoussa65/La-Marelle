// Génère toutes les images de l'application à partir du logo de l'école (assets/logo-source.jpg) :
// icônes PWA (www/icons), logo de l'interface (www/img), logo des PDF (server), sources Capacitor (assets/)
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';

const SOURCE = 'assets/logo-source.jpg';
const BLANC = { r: 255, g: 255, b: 255, alpha: 1 };
mkdirSync('www/icons', { recursive: true });
mkdirSync('www/img', { recursive: true });

// Logo sans les grandes marges blanches de l'image d'origine
const LOGO = await sharp(SOURCE).trim({ background: '#ffffff', threshold: 30 }).png().toBuffer();
const logo = size => sharp(LOGO).resize(size, size, { fit: 'contain', background: BLANC });
// Logo centré sur un carré blanc, avec une marge (icônes « maskable » et Android : rien n'est coupé)
const avecMarge = async (taille, logoTaille, fond = BLANC) => sharp({ create: { width: taille, height: taille, channels: 4, background: fond } })
  .composite([{ input: await logo(logoTaille).png().toBuffer(), gravity: 'center' }]);

// Navigateur / PWA
await logo(192).png().toFile('www/icons/icon-192.png');
await logo(512).png().toFile('www/icons/icon-512.png');
await (await avecMarge(512, 400)).png().toFile('www/icons/icon-maskable-512.png');
// Interface (écran de connexion, menu) et PDF
await logo(320).png({ compressionLevel: 9 }).toFile('www/img/logo.png');
await logo(300).png({ compressionLevel: 9 }).toFile('server/logo.png');

// Sources Capacitor : icône adaptative Android = premier plan (logo) + arrière-plan (blanc)
await (await avecMarge(1024, 900)).png().toFile('assets/icon-only.png');
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: BLANC } }).png().toFile('assets/icon-background.png');
await (await avecMarge(1024, 620, { r: 0, g: 0, b: 0, alpha: 0 })).png().toFile('assets/icon-foreground.png');

// Écran de démarrage : fond blanc + logo au centre
for (const nom of ['splash.png', 'splash-dark.png']) await (await avecMarge(2732, 1000)).png().toFile('assets/' + nom);
console.log('Images générées à partir du logo ✔');

// Petite icône des notifications (barre d'état) : les cases colorées de la marelle (et « KIDS »),
// en blanc sur fond transparent (Android n'affiche que la silhouette de cette icône)
const { data, info } = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const pixels = Buffer.alloc(info.width * info.height * 4, 255);
for (let k = 0; k < info.width * info.height; k++) {
  const [r, g, b] = [data[k * 3], data[k * 3 + 1], data[k * 3 + 2]];
  const couleur = Math.max(r, g, b) - Math.min(r, g, b);   // le texte noir et le fond blanc ne sont pas colorés
  pixels[k * 4 + 3] = couleur > 80 ? 255 : couleur > 50 ? (couleur - 50) * 8 : 0;
}
const marelle = await sharp(pixels, { raw: { width: info.width, height: info.height, channels: 4 } }).trim().png().toBuffer();
const badge = (taille, marge) => sharp(marelle)
  .resize(taille - 2 * marge, taille - 2 * marge, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .extend({ top: marge, bottom: marge, left: marge, right: marge, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png();
await badge(96, 8).toFile('www/icons/badge-96.png');
for (const [dossier, taille] of [['mdpi', 24], ['hdpi', 36], ['xhdpi', 48], ['xxhdpi', 72], ['xxxhdpi', 96]]) {
  mkdirSync(`android/app/src/main/res/drawable-${dossier}`, { recursive: true });
  await badge(taille, Math.round(taille / 12)).toFile(`android/app/src/main/res/drawable-${dossier}/ic_stat_notif.png`);
}
console.log('Icône des notifications générée ✔');

// ---- Logo animé de la page de connexion : texte du logo d'un côté, les 6 cases de la marelle de l'autre ----
// Les cases (pixels colorés, sauf l'orange de « KIDS ») sont découpées une par une et retirées du texte ;
// leurs positions (en % du logo) vont dans www/marelle-cases.css
{
  const { data, info } = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, N = W * H;
  const teinte = (r, g, b) => {
    const M = Math.max(r, g, b), m = Math.min(r, g, b);
    if (M === m) return 0;
    const h = M === r ? ((g - b) / (M - m)) % 6 : M === g ? (b - r) / (M - m) + 2 : (r - g) / (M - m) + 4;
    return (h * 60 + 360) % 360;
  };
  const sat = k => Math.max(data[k * 3], data[k * 3 + 1], data[k * 3 + 2]) - Math.min(data[k * 3], data[k * 3 + 1], data[k * 3 + 2]);
  const orange = k => { const h = teinte(data[k * 3], data[k * 3 + 1], data[k * 3 + 2]); return h > 14 && h < 40; };

  // Cases = grandes zones colorées connexes
  const etiquette = new Int32Array(N);
  const cases = [];
  for (let k = 0; k < N; k++) {
    if (etiquette[k] || sat(k) <= 60 || orange(k)) continue;
    const id = cases.length + 1, pile = [k], pixels = [];
    etiquette[k] = id;
    while (pile.length) {
      const p = pile.pop(); pixels.push(p);
      for (const q of [p - 1, p + 1, p - W, p + W])
        if (q >= 0 && q < N && !etiquette[q] && sat(q) > 60 && !orange(q)) { etiquette[q] = id; pile.push(q); }
    }
    if (pixels.length > 2000) cases.push({ id, pixels });
    else for (const p of pixels) etiquette[p] = -1;
  }
  // Bords adoucis : chaque case garde aussi les pixels voisins (anticrénelage), 3 pixels autour
  const proche = new Int32Array(N);
  for (const c of cases) for (const p of c.pixels) proche[p] = c.id;
  for (let passe = 0; passe < 3; passe++) {
    const copie = proche.slice();
    for (let k = 0; k < N; k++) if (!copie[k]) {
      const v = [k - 1, k + 1, k - W, k + W].find(q => q >= 0 && q < N && copie[q] > 0);
      if (v !== undefined) proche[k] = copie[v];
    }
  }
  for (const c of cases) {
    let x0 = W, y0 = H, x1 = 0, y1 = 0, s = 0, cx = 0, cy = 0;
    for (const p of c.pixels) { const x = p % W, y = (p / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); s += sat(p); cx += x; cy += y; }
    Object.assign(c, { x0: x0 - 3, y0: y0 - 3, x1: x1 + 3, y1: y1 + 3, satMoy: s / c.pixels.length, cx: cx / c.pixels.length, cy: cy / c.pixels.length });
  }
  // Ordre de la marelle : de gauche à droite (la case du haut avant celle du bas)
  cases.sort((a, b) => Math.abs(a.cx - b.cx) < 40 ? a.cy - b.cy : a.cx - b.cx);

  // Texte du logo : les cases sont remplacées par du blanc, avec 10 pixels autour (ombres grises de l'image
  // d'origine), sauf le texte noir et l'orange de « KIDS »
  const efface = new Uint8Array(N);
  for (let k = 0; k < N; k++) if (proche[k] > 0) efface[k] = 1;
  for (let passe = 0; passe < 10; passe++) {
    const copie = efface.slice();
    for (let k = 0; k < N; k++) if (!copie[k] && [k - 1, k + 1, k - W, k + W].some(q => q >= 0 && q < N && copie[q])) efface[k] = 1;
  }
  const texte = Buffer.from(data);
  for (let k = 0; k < N; k++) {
    const sombre = Math.min(data[k * 3], data[k * 3 + 1], data[k * 3 + 2]) < 120 && sat(k) < 60;
    if (proche[k] > 0 || (efface[k] && !sombre && !orange(k))) texte[k * 3] = texte[k * 3 + 1] = texte[k * 3 + 2] = 255;
  }
  const zone = await sharp(SOURCE).trim({ background: '#ffffff', threshold: 30 }).toBuffer({ resolveWithObject: true });
  const bx = -zone.info.trimOffsetLeft, by = -zone.info.trimOffsetTop, bw = zone.info.width, bh = zone.info.height;
  // Fond transparent (« couleur vers alpha » depuis le blanc) : le logo se pose sur n'importe quelle couleur
  const transparent = Buffer.alloc(N * 4);
  for (let k = 0; k < N; k++) {
    const c = [texte[k * 3], texte[k * 3 + 1], texte[k * 3 + 2]];
    const a = (255 - Math.min(...c)) / 255;
    for (let j = 0; j < 3; j++) transparent[k * 4 + j] = a ? Math.round((c[j] - (1 - a) * 255) / a) : 0;
    transparent[k * 4 + 3] = Math.round(a * 255);
  }
  await sharp(transparent, { raw: { width: W, height: H, channels: 4 } }).extract({ left: bx, top: by, width: bw, height: bh })
    .resize(Math.round(bw * 0.6)).png({ compressionLevel: 9 }).toFile('www/img/marelle-texte.png');

  // Une image par case, fond transparent (couleur « dé-mélangée » du blanc sur les bords)
  const pct = v => (v * 100).toFixed(2) + '%';
  let css = `/* Fichier généré par scripts/icons.mjs (npm run icons) : position des 6 cases dans le logo */\n`
    + `.logo-marelle { aspect-ratio: ${bw} / ${bh}; }\n`;
  for (const [i, c] of cases.entries()) {
    const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1, px = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = (c.y0 + y) * W + c.x0 + x, o = (y * w + x) * 4;
      if (proche[k] !== c.id) continue;
      const a = Math.min(1, sat(k) / (c.satMoy * 0.85));
      for (let j = 0; j < 3; j++) px[o + j] = a ? Math.max(0, Math.min(255, Math.round((data[k * 3 + j] - (1 - a) * 255) / a))) : 0;
      px[o + 3] = Math.round(a * 255);
    }
    await sharp(px, { raw: { width: w, height: h, channels: 4 } }).resize(Math.round(w * 0.6)).png({ compressionLevel: 9 })
      .toFile(`www/img/case-${i}.png`);
    css += `.case-${i} { left: ${pct((c.x0 - bx) / bw)}; top: ${pct((c.y0 - by) / bh)}; width: ${pct(w / bw)}; height: ${pct(h / bh)}; }\n`;
  }
  writeFileSync('www/marelle-cases.css', css);
  console.log(`Logo animé : ${cases.length} cases découpées ✔`);
}
