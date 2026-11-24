import path from "node:path";
import { fileURLToPath } from "node:url";

// The fonts built into pdfkit (Helvetica, Courier) only have Western European
// letters: a Tamil name printed in them comes out as random symbols. Text that
// needs more is printed in Noto Sans Tamil (assets/fonts, SIL Open Font
// License), which also has the Latin letters and ₹. All other text keeps the
// built-in fonts, so it looks exactly as before.
const FONTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "fonts");
const REGULAR = path.join(FONTS, "NotoSansTamil-Regular.ttf");
const BOLD = path.join(FONTS, "NotoSansTamil-Bold.ttf");

// What the built-in fonts can print (WinAnsi).
const BUILT_IN = "\\t\\n\\r\\x20-\\x7e\\xa0-\\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const OTHER = new RegExp(`[^${BUILT_IN}]`);
const RUNS = new RegExp(`[^${BUILT_IN}]+(?: +[^${BUILT_IN}]+)*|[${BUILT_IN}]+`, "g");
const needsFont = (text) => OTHER.test(text);

// A letter not even Noto Sans Tamil has (another script, an emoji) prints as
// "?" rather than an empty box. Joiners are part of how Tamil is written.
const printable = (doc, text) =>
  [...text].map((ch) => (/[\n\t‌‍]/.test(ch) || doc._font.font?.hasGlyphForCodePoint(ch.codePointAt(0)) !== false ? ch : "?")).join("");

// Call once on a new PDFDocument.
export function useUnicodeFonts(doc) {
  const setFont = doc.font.bind(doc);
  let current = "Helvetica";
  doc.font = (src, ...rest) => {
    current = src;
    return setFont(src, ...rest);
  };
  for (const method of ["text", "heightOfString", "widthOfString"]) {
    const plain = doc[method].bind(doc);
    doc[method] = (value, ...rest) => {
      const text = value === null || value === undefined ? "" : String(value);
      if (current === REGULAR || current === BOLD || !needsFont(text)) return plain(text, ...rest);
      const before = current;
      doc.font(/bold/i.test(before) ? BOLD : REGULAR);
      try {
        return plain(printable(doc, text), ...rest);
      } finally {
        doc.font(before);
      }
    };
  }
  return doc;
}

// Fixed-width text (bills). Columns line up by character position, so on a
// line with Tamil in it each piece is put at its own column, and a Tamil piece
// wider than its column is made smaller to fit. Lines without any print as before.
export function monoText(doc, text, options = {}) {
  if (!needsFont(text)) return doc.text(text, options);
  const left = doc.page.margins.left;
  const size = doc._fontSize;
  const charWidth = doc.widthOfString("0");
  const ascent = (doc._font.ascender / 1000) * size;
  const lineHeight = doc.currentLineHeight(true) + (options.lineGap || 0);
  for (const line of text.split("\n")) {
    if (!needsFont(line)) {
      doc.text(line || " ", left, doc.y, options);
      continue;
    }
    if (doc.y + lineHeight > doc.page.maxY()) doc.addPage();
    const baseline = doc.y + ascent;
    let at = 0;
    for (const run of line.match(RUNS)) {
      const x = left + at * charWidth;
      at += run.length;
      if (!needsFont(run)) {
        doc.text(run, x, baseline, { lineBreak: false, baseline: "alphabetic" });
        continue;
      }
      doc.font(REGULAR).fontSize(size);
      const shown = printable(doc, run);
      const room = run.length * charWidth;
      const wide = doc.widthOfString(shown);
      if (wide > room) doc.fontSize((size * room) / wide);
      doc.text(shown, x, baseline, { lineBreak: false, baseline: "alphabetic" });
      doc.font("Courier").fontSize(size);
    }
    doc.x = left;
    doc.y = baseline - ascent + lineHeight;
  }
  return doc;
}
