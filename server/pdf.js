/* =========================================================
   Documents PDF (pdfkit) : liste des élèves d'une classe
   Polices standard (Helvetica) : accents français OK, pas d'emoji.
   Texte en arabe (noms de classes, d'élèves) : police Amiri (dossier polices/).
   ========================================================= */
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

// Couleurs de La Marelle : bleu marine + rouge du logo
const BLEU = '#1b2f8f', NUIT = '#0b1a45', ROUGE_LOGO = '#d7141a', GRIS = '#5b6478', TRAIT = '#dde3ee', FOND = '#f3f5fa';
const LOGO = fileURLToPath(new URL('./logo.png', import.meta.url));
const MARGE = 40;
const ARABE = fileURLToPath(new URL('./polices/Amiri-Regular.ttf', import.meta.url));
const ARABE_GRAS = fileURLToPath(new URL('./polices/Amiri-Bold.ttf', import.meta.url));

// Police selon le texte : Amiri s'il contient de l'arabe (espaces entre les mots \u00E9largis), sinon Helvetica
const arabe = texte => /[\u0600-\u06FF]/.test(String(texte ?? ''));
const police = (doc, texte, gras = false) =>
  doc.font(arabe(texte) ? (gras ? 'Arabe-Gras' : 'Arabe') : (gras ? 'Helvetica-Bold' : 'Helvetica'));
const espaceMots = texte => (arabe(texte) ? 3 : 0);

// Espaces insécables du format français → espace simple (absents des polices standard)
const net = t => String(t ?? '').replace(/[  ]/g, ' ');
const aujourdhui = () => net(new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Tunis' }));

function nouveauDocument(res, nomFichier, titre, layout = 'portrait') {
  const doc = new PDFDocument({ size: 'A4', layout, margin: MARGE, bufferPages: true, info: { Title: titre, Author: 'La Marelle' } });
  res.setHeader('Content-Type', 'application/pdf');
  doc.registerFont('Arabe', ARABE);
  doc.registerFont('Arabe-Gras', ARABE_GRAS);
  // Nom en arabe : « filename » en ASCII, « filename* » avec le vrai nom
  res.setHeader('Content-Disposition',
    `inline; filename="${nomFichier.replace(/[^\w.-]+/g, '_')}"; filename*=UTF-8''${encodeURIComponent(nomFichier)}`);
  res.setHeader('Cache-Control', 'no-store');
  doc.pipe(res);
  return doc;
}

function entete(doc, titre, sousTitre) {
  const l = doc.page.width;
  doc.rect(0, 0, l, 70).fill(NUIT);
  doc.rect(0, 70, l, 4).fill(ROUGE_LOGO);
  // Logo de l'école dans un rond blanc
  let x = MARGE;
  if (existsSync(LOGO)) {
    doc.circle(MARGE + 26, 35, 27).fill('#ffffff');
    doc.image(LOGO, MARGE + 7, 16, { fit: [38, 38], align: 'center', valign: 'center' });
    x = MARGE + 64;
  }
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text('La ', x, 18, { continued: true })
    .fillColor('#ff8a8d').text('Marelle');
  doc.font('Helvetica').fontSize(9).fillColor('#cbd5e1').text('La Marelle · École préparatoire', x, 42);
  doc.fontSize(9).text(`Édité le ${aujourdhui()}`, MARGE, 42, { width: l - 2 * MARGE, align: 'right' });
  police(doc.fillColor(NUIT), titre, true).fontSize(16).text(titre, MARGE, 90, { wordSpacing: espaceMots(titre) });
  if (sousTitre) doc.font('Helvetica').fontSize(10).fillColor(GRIS).text(sousTitre, MARGE, doc.y + 2);
  doc.moveDown(1);
}

// Numéros de page en bas de chaque page
function piedDePage(doc) {
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    const bas = doc.page.height - 28;
    doc.page.margins.bottom = 0;
    doc.fontSize(8).fillColor(GRIS).font('Helvetica')
      .text(`La Marelle · page ${i + 1} / ${pages.count}`, MARGE, bas, { width: doc.page.width - 2 * MARGE, align: 'center' });
  }
}

function sousTitreSection(doc, texte) {
  place(doc, 40);
  doc.moveDown(0.6).font('Helvetica-Bold').fontSize(12).fillColor(NUIT).text(texte, MARGE);
  doc.moveDown(0.3);
}

// Nouvelle page si la place manque
function place(doc, hauteur) {
  if (doc.y + hauteur > doc.page.height - MARGE - 20) { doc.addPage(); doc.y = MARGE; }
}

// Tableau : colonnes [{ titre, largeur (fraction), align }], lignes [[...]] ; en-tête répété sur chaque page
function tableau(doc, colonnes, lignes, { total, couleurs } = {}) {
  const largeurTotale = doc.page.width - 2 * MARGE;
  const larg = colonnes.map(c => c.largeur * largeurTotale);
  const H = 20;
  const ligne = (cellules, y, style) => {
    let x = MARGE;
    if (style.fond) doc.rect(MARGE, y, largeurTotale, H).fill(style.fond);
    cellules.forEach((c, i) => {
      police(doc, c, style.gras).fontSize(style.taille || 9)
        .fillColor(style.couleurs?.[i] || style.couleur || '#1e293b')
        .text(net(c), x + 5, y + 6, { width: larg[i] - 10, align: colonnes[i].align || 'left', lineBreak: false, ellipsis: true,
          wordSpacing: espaceMots(c) });
      x += larg[i];
    });
    doc.moveTo(MARGE, y + H).lineTo(MARGE + largeurTotale, y + H).lineWidth(0.5).strokeColor(TRAIT).stroke();
  };
  // doc.text() déplace doc.y : on part toujours de la position mémorisée avant la ligne
  const ecrire = (cellules, style) => { const y = doc.y; ligne(cellules, y, style); doc.y = y + H; };
  const titres = () => { place(doc, H * 2); ecrire(colonnes.map(c => c.titre), { fond: '#e8eeff', gras: true, couleur: '#334155', taille: 8.5 }); };
  titres();
  lignes.forEach((l, k) => {
    if (doc.y + H > doc.page.height - MARGE - 20) { doc.addPage(); doc.y = MARGE; titres(); }
    ecrire(l, { fond: k % 2 ? '#fafbff' : null, couleurs: couleurs?.[k] });
  });
  if (total) { place(doc, H); ecrire(total, { fond: FOND, gras: true }); }
  doc.x = MARGE;
  doc.moveDown(0.5);
}

// ================= LISTE DES ÉLÈVES D'UNE CLASSE =================
export function pdfListeClasse(res, { classe, eleves }) {
  const d = new Date(), an = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  const doc = nouveauDocument(res, `liste-${classe.replace(/\s+/g, '-')}.pdf`, `Liste des élèves — ${classe}`);
  entete(doc, classe, `Liste des élèves · ${eleves.length} élève(s) · Année scolaire ${an}-${an + 1}`);
  if (!eleves.length) {
    doc.font('Helvetica-Oblique').fontSize(11).fillColor(GRIS).text('Aucun élève dans cette classe.', MARGE);
  } else {
    tableau(doc, [
      { titre: 'N°', largeur: 0.07, align: 'center' },
      { titre: 'Nom et prénom', largeur: 0.30 },
      { titre: 'Né(e) le', largeur: 0.13 },
      { titre: 'Tél. père', largeur: 0.17 },
      { titre: 'Tél. mère', largeur: 0.17 },
      { titre: 'Observations', largeur: 0.16 }
    ], eleves.map((e, i) => [i + 1, e.nom, e.naissance || '—', e.tel_pere || '—', e.tel_mere || '—', '']));
  }
  piedDePage(doc);
  doc.end();
}
