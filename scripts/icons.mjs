// Génère toutes les images de l'application à partir du logo de l'école (assets/logo-source.jpg) :
// icônes PWA (www/icons), logo de l'interface (www/img), logo des PDF (server), sources Capacitor (assets/)
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

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
