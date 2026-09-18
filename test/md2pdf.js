// Render an Arabic (RTL) Markdown file to PDF with headless Chromium. Usage: node md2pdf.js in.md out.pdf
const fs = require('fs');
const { marked } = require('marked');
const { chromium } = require('playwright');
const [,, inPath, outPath] = process.argv;
const md = fs.readFileSync(inPath, 'utf8');
const body = marked.parse(md, { gfm: true });
const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
@page { size: A4; margin: 18mm 16mm; }
body { font-family: "Noto Naskh Arabic", "Noto Sans Arabic", "Amiri", "Arial", sans-serif; font-size: 12.5pt; line-height: 1.85; color: #111; direction: rtl; }
h1 { font-size: 24pt; color: #0b2a5b; border-bottom: 3px solid #ffb547; padding-bottom: 6px; margin-top: 0; }
h2 { font-size: 18pt; color: #0b2a5b; margin-top: 28px; border-right: 6px solid #ffb547; padding-right: 10px; page-break-after: avoid; }
h3 { font-size: 14.5pt; color: #1b4a8a; margin-top: 20px; page-break-after: avoid; }
p { margin: 6px 0 10px; text-align: justify; }
blockquote { border-right: 4px solid #60c8ff; background: #f2f8ff; margin: 10px 0; padding: 8px 14px; }
table { border-collapse: collapse; width: 100%; margin: 10px 0 16px; font-size: 11pt; page-break-inside: avoid; }
th, td { border: 1px solid #c9d2e3; padding: 6px 8px; vertical-align: top; }
th { background: #e8eef9; }
code { font-family: "DejaVu Sans Mono", monospace; font-size: 10pt; background: #f3f3f3; padding: 1px 4px; border-radius: 3px; direction: ltr; unicode-bidi: embed; }
pre { background: #f6f6f6; border: 1px solid #ddd; padding: 10px; direction: ltr; text-align: left; font-size: 9.5pt; line-height: 1.4; overflow: hidden; white-space: pre-wrap; }
ul, ol { padding-right: 24px; padding-left: 0; }
li { margin: 3px 0; }
hr { border: 0; border-top: 1px solid #ccc; margin: 22px 0; }
strong { color: #0b2a5b; }
</style></head><body>${body}</body></html>`;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({ path: outPath, format: 'A4', printBackground: true, displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="width:100%;text-align:center;font-size:9px;color:#777;font-family:sans-serif">BLINK — SPHEREx Time Machine · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' } });
  await browser.close();
  console.log('wrote', outPath, fs.statSync(outPath).size, 'bytes');
})();
