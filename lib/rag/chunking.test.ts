import { describe, it, expect } from "vitest";
import { chunkText } from "./chunking";

describe("chunkText", () => {
  it("returns nothing for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("keeps a short document as a single chunk", () => {
    const chunks = chunkText("Normalization reduces redundancy.\n\nIt has several normal forms.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].content).toContain("Normalization reduces redundancy.");
    expect(chunks[0].content).toContain("several normal forms.");
  });

  it("assigns sequential, zero-based chunk indexes", () => {
    const longParagraph = Array.from({ length: 40 }, (_, i) => `This is sentence number ${i} about databases.`).join(" ");
    const chunks = chunkText(longParagraph);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, i) => expect(chunk.chunkIndex).toBe(i));
  });

  it("never splits a chunk in the middle of a sentence", () => {
    const longParagraph = Array.from({ length: 60 }, (_, i) => `Sentence ${i} explains a distinct concept about transactions.`).join(" ");
    const chunks = chunkText(longParagraph);
    for (const chunk of chunks) {
      const trimmed = chunk.content.trim();
      expect(/[.!?]$/.test(trimmed)).toBe(true);
    }
  });

  it("keeps separate paragraphs as separate chunks once they exceed the packing threshold", () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) => `Paragraph ${i}: `.padEnd(250, `content-${i} `));
    const chunks = chunkText(paragraphs.join("\n\n"));
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("carries a small overlap into the next chunk so context isn't lost at a boundary", () => {
    const longParagraph = Array.from({ length: 60 }, (_, i) => `Sentence ${i} explains a distinct concept about transactions in detail.`).join(" ");
    const chunks = chunkText(longParagraph);
    expect(chunks.length).toBeGreaterThan(1);
    const tailOfFirst = chunks[0].content.slice(-150).trimStart();
    expect(chunks[1].content.startsWith(tailOfFirst)).toBe(true);
  });
});
