import sharp from "sharp";

export async function renderWebpPreview(input: Uint8Array, width: number) {
  return sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 86, effort: 4 })
    .toBuffer();
}
