import "server-only";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import JSZip from "jszip";
import { createWorker } from "tesseract.js";
import { AIInputError } from "./ai/types";

/**
 * Multi-format document extraction: detects the real file type from its byte
 * signature (not just the extension), then routes to the right parser —
 * PDF (with a hand-rolled fallback parser for damaged cross-reference
 * tables, and OCR for image-only PDFs), DOCX (mammoth), PPTX (raw XML via
 * JSZip), images (Tesseract OCR), RTF, and plain text.
 */

const MAX_MATERIAL_CHARS = 150_000;

export async function extractMaterialText(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new AIInputError("Files must be smaller than 10 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = file.name.split(".").pop()?.toLowerCase();
  const detectedType = await detectUploadType(bytes, file.type, extension);
  if (detectedType === "unsupported") {
    throw new AIInputError(
      "This file type is not supported for lecture analysis. Upload a document, presentation, PDF, image, or plain-text file."
    );
  }

  let text = "";
  if (detectedType === "pdf") {
    const parser = new PDFParse({ data: bytes });
    try {
      text = (await parser.getText()).text;
    } catch {
      // Some PDFs have damaged cross-reference tables but still contain usable text objects.
      text = extractPdfTextFallback(bytes);
    } finally {
      await parser.destroy();
    }
    if (text.trim().length < 20) text = await ocrPdf(bytes);
  } else if (detectedType === "docx") {
    try {
      text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
    } catch {
      throw new AIInputError("This DOCX file could not be read. Upload a valid Word document.");
    }
  } else if (detectedType === "pptx") {
    text = await extractPptxText(bytes);
  } else if (detectedType === "image") {
    text = await ocrImage(bytes);
  } else if (detectedType === "rtf") {
    text = new TextDecoder("utf-8", { fatal: false })
      .decode(bytes)
      .replace(/\\'[0-9a-f]{2}/gi, " ")
      .replace(/\\[a-z]+-?\d* ?/gi, " ")
      .replace(/[{}]/g, " ");
  } else {
    text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  // Collapse horizontal whitespace only — paragraph/line breaks are preserved for RAG chunking
  // (lib/rag/chunking.ts).
  text = text
    .replace(/\0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_MATERIAL_CHARS);
  const printable = text.replace(/[^\x09-\x0d\x20-\x7e]/g, "").length;
  if (text.length < 20 || printable / Math.max(text.length, 1) < 0.65) {
    throw new AIInputError(
      detectedType === "pdf" || detectedType === "image"
        ? "No readable text was found. Make sure the document is clear and not password-protected."
        : "This file does not contain readable text. Upload a text-based lecture file."
    );
  }
  return text;
}

type UploadType = "pdf" | "docx" | "pptx" | "image" | "rtf" | "text" | "unsupported";

async function detectUploadType(bytes: Uint8Array, mimeType: string, extension?: string): Promise<UploadType> {
  const startsWith = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const ext = extension?.toLowerCase();
  if (startsWith(0x25, 0x50, 0x44, 0x46)) return "pdf";
  if (
    startsWith(0xff, 0xd8, 0xff) ||
    startsWith(0x89, 0x50, 0x4e, 0x47) ||
    startsWith(0x47, 0x49, 0x46, 0x38) ||
    startsWith(0x42, 0x4d) ||
    (startsWith(0x52, 0x49, 0x46, 0x46) &&
      new TextDecoder("ascii").decode(bytes.slice(8, 12)) === "WEBP")
  ) {
    return "image";
  }
  if (startsWith(0x50, 0x4b, 0x03, 0x04)) {
    try {
      const zip = await JSZip.loadAsync(bytes);
      const names = Object.keys(zip.files);
      if (names.includes("word/document.xml")) return "docx";
      if (names.some((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))) return "pptx";
    } catch {
      return "unsupported";
    }
  }
  if (ext === "docx" || mimeType.includes("wordprocessingml.document")) return "unsupported";
  if (ext === "pptx" || mimeType.includes("presentationml.presentation")) return "unsupported";
  if (ext === "rtf" || mimeType === "application/rtf") return "rtf";
  if (["txt", "md", "markdown", "csv", "json", "xml", "html"].includes(ext || "")) return "text";
  return "unsupported";
}

async function ocrImage(bytes: Uint8Array): Promise<string> {
  const worker = await createWorker("eng");
  try {
    return (await worker.recognize(Buffer.from(bytes))).data.text;
  } catch {
    throw new AIInputError("The image could not be processed with OCR.");
  } finally {
    await worker.terminate();
  }
}

async function ocrPdf(bytes: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: bytes });
  try {
    const screenshots = await parser.getScreenshot({ first: 10, desiredWidth: 1600 });
    const worker = await createWorker("eng");
    try {
      const pages: string[] = [];
      for (const page of screenshots.pages) {
        const result = await worker.recognize(Buffer.from(page.data));
        pages.push(result.data.text);
      }
      return pages.join("\n");
    } finally {
      await worker.terminate();
    }
  } catch {
    throw new AIInputError(
      "This PDF could not be read. It may be corrupted, password-protected, or image-only."
    );
  } finally {
    await parser.destroy();
  }
}

function extractPdfTextFallback(bytes: Uint8Array): string {
  const source = new TextDecoder("latin1").decode(bytes);
  const literalStrings = [...source.matchAll(/\((?:\\.|[^\\()])*\)/g)].map((match) =>
    match[0]
      .slice(1, -1)
      .replace(/\\([()\\])/g, "$1")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
  );
  const hexStrings = [...source.matchAll(/<([0-9a-f]{4,})>/gi)].map((match) => {
    const hex = match[1].length % 2 ? `${match[1]}0` : match[1];
    const bytes = Buffer.from(hex, "hex");
    let value = "";
    for (let index = 0; index + 1 < bytes.length; index += 2) {
      value += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
    }
    return value.replace(/\0/g, "");
  });
  return [...literalStrings, ...hexStrings]
    .filter((value) => /[A-Za-z0-9]/.test(value))
    .join(" ");
}

async function extractPptxText(bytes: Uint8Array): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const slideNames = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => {
        const slideNumber = (name: string) => Number(name.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
        return slideNumber(a) - slideNumber(b);
      });
    const slides = await Promise.all(
      slideNames.map(async (name) => {
        const xml = await zip.files[name].async("text");
        return [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi)]
          .map((match) => cleanExtractedText(decodeXmlEntities(match[1])))
          .filter(Boolean)
          .join(" ");
      })
    );
    return [...new Set(slides.map(cleanExtractedText).filter(Boolean))].join("\n");
  } catch {
    throw new AIInputError("This PPTX file could not be read. Upload a valid PowerPoint presentation.");
  }
}

function cleanExtractedText(value: string): string {
  return value
    .replace(/<a:[^>]*>/gi, " ")
    .replace(/<\/a:[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
