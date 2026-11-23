// Reads the text off an uploaded purchase bill, entirely in the browser - the
// file is never uploaded or stored anywhere. Text-based PDFs are read
// directly (exact text, no OCR); photos, scans and image-only PDF pages go
// through Tesseract, the standard open-source OCR engine. The heavy
// libraries are loaded on demand so the rest of the app doesn't pay for them.

export const MAX_FILE_MB = 10;
export const MAX_PDF_PAGES = 5;
const MAX_IMAGE_SIDE = 3500; // px - larger photos are scaled down (memory safety)
const MIN_OCR_WIDTH = 1600; // px - small images are scaled up so text is legible

const TYPES = {
  jpg: { mime: ["image/jpeg", "image/pjpeg"], magic: [[0xff, 0xd8, 0xff]] },
  jpeg: { mime: ["image/jpeg", "image/pjpeg"], magic: [[0xff, 0xd8, 0xff]] },
  png: { mime: ["image/png"], magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
  pdf: { mime: ["application/pdf", "application/x-pdf"], magic: [[0x25, 0x50, 0x44, 0x46, 0x2d]] }, // %PDF-
};
export const ACCEPT = ".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf";

// Checks extension, declared type, size AND the file's first bytes, so a
// renamed file (e.g. an .exe called bill.jpg) is rejected before it's parsed.
export async function validateBillFile(file) {
  if (!file) return "Choose a bill to upload.";
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const type = TYPES[ext];
  if (!type) return "Only JPG, JPEG, PNG or PDF files are supported.";
  if (file.type && !type.mime.includes(file.type)) return "The file type doesn't match its extension. Please upload a JPG, PNG or PDF.";
  if (file.size === 0) return "This file is empty.";
  if (file.size > MAX_FILE_MB * 1024 * 1024) return `File is too large - please keep it under ${MAX_FILE_MB} MB.`;
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const ok = type.magic.some((sig) => sig.every((b, i) => head[i] === b));
  if (!ok) return "This file doesn't look like a valid JPG, PNG or PDF.";
  return "";
}

export const isPdf = (file) => /\.pdf$/i.test(file?.name || "");

// Grayscale + resize to a size Tesseract reads well. Returns a canvas.
function prepareCanvas(source, width, height) {
  let scale = 1;
  if (width < MIN_OCR_WIDTH) scale = Math.min(MIN_OCR_WIDTH / width, 3);
  if (Math.max(width, height) * scale > MAX_IMAGE_SIDE) scale = MAX_IMAGE_SIDE / Math.max(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

async function imageFileToCanvas(file) {
  // createImageBitmap honours the photo's EXIF rotation.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    return prepareCanvas(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close?.();
  }
}

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

// Rebuilds the visual lines of a text PDF page: items sharing a baseline are
// joined left-to-right, with a wide gap kept as a column break.
export function pageItemsToText(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const h = Math.abs(it.transform[3]) || 10;
    let row = rows.find((r) => Math.abs(r.y - y) <= h * 0.5);
    if (!row) rows.push((row = { y, h, parts: [] }));
    row.parts.push({ x, w: it.width || 0, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows
    .map((r) => {
      r.parts.sort((a, b) => a.x - b.x);
      let out = "";
      let end = null;
      for (const p of r.parts) {
        if (end !== null) out += p.x - end > r.h * 1.5 ? "   " : p.x - end > r.h * 0.15 ? " " : "";
        out += p.s;
        end = p.x + p.w;
      }
      return out;
    })
    .join("\n");
}

// Returns { text, method: "pdf-text" | "ocr" | "mixed", pages }.
// onProgress({ stage, progress }) - progress is 0..1 for the current stage.
export async function extractBillText(file, { onProgress = () => {}, signal } = {}) {
  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  };
  const toOcr = []; // canvases
  const texts = [];
  let usedPdfText = false;
  let pages = 1;

  if (isPdf(file)) {
    onProgress({ stage: "Opening PDF…", progress: 0 });
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(await file.arrayBuffer());
    // pdfjs v6 removed PDFDocumentProxy.destroy(); the loading task owns the
    // document and its worker, so it is what gets destroyed when done.
    const loadingTask = pdfjs.getDocument({ data, enableXfa: false, stopAtErrors: false });
    let doc;
    try {
      doc = await loadingTask.promise;
    } catch (e) {
      loadingTask.destroy().catch(() => {});
      if (e?.name === "PasswordException") throw new Error("This PDF is password-protected. Please upload an unlocked copy.");
      throw new Error("This PDF couldn't be opened. It may be damaged.");
    }
    try {
      pages = Math.min(doc.numPages, MAX_PDF_PAGES);
      for (let n = 1; n <= pages; n++) {
        checkAbort();
        onProgress({ stage: `Reading page ${n} of ${pages}…`, progress: (n - 1) / pages });
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        const text = pageItemsToText(content.items);
        if (text.replace(/\s/g, "").length >= 40) {
          texts[n - 1] = text;
          usedPdfText = true;
        } else {
          // Scanned page with no text layer - render it and OCR it.
          const viewport = page.getViewport({ scale: 2.5 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          await page.render({ canvas, viewport }).promise;
          toOcr.push({ index: n - 1, canvas: prepareCanvas(canvas, canvas.width, canvas.height) });
        }
        page.cleanup();
      }
    } finally {
      await loadingTask.destroy().catch(() => {});
    }
  } else {
    onProgress({ stage: "Preparing image…", progress: 0 });
    try {
      toOcr.push({ index: 0, canvas: await imageFileToCanvas(file) });
    } catch {
      throw new Error("This image couldn't be read. It may be damaged.");
    }
  }

  if (toOcr.length) {
    checkAbort();
    onProgress({ stage: "Loading OCR engine…", progress: 0 });
    const { createWorker, PSM } = await import("tesseract.js");
    let current = 0;
    const worker = await createWorker("eng", 1, {
      logger: (m) => {
        if (m.status === "recognizing text") {
          onProgress({ stage: toOcr.length > 1 ? `Reading text (page ${current + 1} of ${toOcr.length})…` : "Reading text…", progress: m.progress });
        } else if (/load|initiali/i.test(m.status)) {
          onProgress({ stage: "Loading OCR engine…", progress: m.progress || 0 });
        }
      },
    });
    const abort = () => worker.terminate();
    signal?.addEventListener("abort", abort);
    try {
      // PSM 6 (one uniform block) keeps each table row on one line;
      // preserved spaces keep column gaps visible to the parser.
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "1" });
      for (current = 0; current < toOcr.length; current++) {
        checkAbort();
        const { data } = await worker.recognize(toOcr[current].canvas);
        texts[toOcr[current].index] = data.text || "";
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      await worker.terminate().catch(() => {});
    }
  }

  checkAbort();
  const text = texts.filter(Boolean).join("\n");
  const method = toOcr.length && usedPdfText ? "mixed" : toOcr.length ? "ocr" : "pdf-text";
  return { text, method, pages };
}
