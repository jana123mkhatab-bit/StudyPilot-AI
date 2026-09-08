import "server-only";

export interface TextChunk {
  chunkIndex: number;
  content: string;
}

const TARGET_CHUNK_CHARS = 1_100;
const MIN_CHUNK_CHARS = 200;
const OVERLAP_CHARS = 150;

function splitIntoSentences(paragraph: string): string[] {
  return paragraph.split(/(?<=[.!?])\s+/).filter(Boolean);
}

/**
 * Paragraph-then-sentence-aware chunking: paragraph breaks (blank lines, preserved by
 * extractMaterialText) are treated as natural section boundaries; long paragraphs are packed into
 * ~TARGET_CHUNK_CHARS windows along sentence boundaries so a chunk never cuts a sentence in half,
 * with a small overlap so context isn't lost right at a chunk edge.
 *
 * There's no heading/page/slide detection here — the current extraction pipeline (lib/ai.ts)
 * doesn't preserve that structure, so `section`/`pageNumber` metadata is left null downstream
 * rather than fabricated.
 */
export function chunkText(text: string): TextChunk[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > TARGET_CHUNK_CHARS * 1.5) {
      for (const sentence of splitIntoSentences(paragraph)) {
        if (current.length + sentence.length + 1 > TARGET_CHUNK_CHARS && current.length >= MIN_CHUNK_CHARS) {
          flush();
          const overlapSource = chunks.at(-1);
          if (overlapSource) current = overlapSource.slice(-OVERLAP_CHARS) + " ";
        }
        current += (current ? " " : "") + sentence;
      }
      continue;
    }
    if (current.length + paragraph.length + 2 > TARGET_CHUNK_CHARS && current.length >= MIN_CHUNK_CHARS) {
      flush();
      const overlapSource = chunks.at(-1);
      if (overlapSource) current = overlapSource.slice(-OVERLAP_CHARS) + " ";
    }
    current += (current ? "\n\n" : "") + paragraph;
  }
  flush();

  return chunks.map((content, chunkIndex) => ({ chunkIndex, content }));
}
