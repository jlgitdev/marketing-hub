import { describe, expect, it } from "vitest";
import { stripC2pa } from "@/server/images/strip-c2pa";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, payload: Buffer) {
  const chunk = Buffer.alloc(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0);
  chunk.write(type, 4, 4, "ascii");
  payload.copy(chunk, 8);
  return chunk;
}

function jpegSegment(marker: number, payload: Buffer) {
  const segment = Buffer.alloc(4 + payload.length);
  segment[0] = 0xff;
  segment[1] = marker;
  segment.writeUInt16BE(payload.length + 2, 2);
  payload.copy(segment, 4);
  return segment;
}

function webpChunk(type: string, payload: Buffer) {
  const padding = payload.length % 2;
  const chunk = Buffer.alloc(8 + payload.length + padding);
  chunk.write(type, 0, 4, "ascii");
  chunk.writeUInt32LE(payload.length, 4);
  payload.copy(chunk, 8);
  return chunk;
}

describe("C2PA image metadata stripping", () => {
  it("removes PNG caBX chunks while preserving image data", () => {
    const idat = pngChunk("IDAT", Buffer.from("encoded pixels"));
    const input = Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", Buffer.alloc(13)), pngChunk("caBX", Buffer.from("c2pa manifest")), idat, pngChunk("IEND", Buffer.alloc(0))]);
    const result = stripC2pa(input);
    expect(result).toMatchObject({ format: "PNG", removedItems: 1 });
    expect(result.bytes.includes(Buffer.from("caBX"))).toBe(false);
    expect(result.bytes.includes(Buffer.from("encoded pixels"))).toBe(true);
  });

  it("removes a contiguous JPEG C2PA JUMBF run and preserves scan bytes", () => {
    const scan = Buffer.from([0x11, 0x22, 0xff, 0x00, 0x33, 0xff, 0xd9]);
    const input = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      jpegSegment(0xe0, Buffer.from("JFIF")),
      jpegSegment(0xeb, Buffer.from("JP c2pa manifest part one")),
      jpegSegment(0xeb, Buffer.from("JP manifest part two")),
      jpegSegment(0xda, Buffer.alloc(6)),
      scan
    ]);
    const result = stripC2pa(input);
    expect(result).toMatchObject({ format: "JPEG", removedItems: 2 });
    expect(result.bytes.includes(Buffer.from("c2pa manifest"))).toBe(false);
    expect(result.bytes.subarray(-scan.length).equals(scan)).toBe(true);
  });

  it("removes WebP C2PA chunks and repairs the RIFF size", () => {
    const pixels = webpChunk("VP8 ", Buffer.from("encoded pixels"));
    const chunks = Buffer.concat([webpChunk("C2PA", Buffer.from("manifest")), pixels]);
    const header = Buffer.alloc(12);
    header.write("RIFF", 0, 4, "ascii");
    header.writeUInt32LE(chunks.length + 4, 4);
    header.write("WEBP", 8, 4, "ascii");
    const result = stripC2pa(Buffer.concat([header, chunks]));
    expect(result).toMatchObject({ format: "WebP", removedItems: 1 });
    expect(result.bytes.includes(Buffer.from("C2PA"))).toBe(false);
    expect(result.bytes.includes(Buffer.from("encoded pixels"))).toBe(true);
    expect(result.bytes.readUInt32LE(4)).toBe(result.bytes.length - 8);
  });
});
