import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { trimTransparentPadding } from "../src/signatureImage.js";

function makePng(width: number, height: number, draw: (data: Buffer) => void): Uint8Array {
  const png = new PNG({ width, height });
  draw(png.data);
  return new Uint8Array(PNG.sync.write(png));
}

describe("trimTransparentPadding", () => {
  it("crops transparent margins around opaque pixels", () => {
    const source = makePng(20, 20, (data) => {
      const idx = (10 * 20 + 10) * 4;
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
      data[idx + 3] = 255;
    });

    const trimmed = trimTransparentPadding(source);
    const decoded = PNG.sync.read(Buffer.from(trimmed));

    expect(decoded.width).toBeLessThan(20);
    expect(decoded.height).toBeLessThan(20);
    expect(decoded.width).toBeGreaterThanOrEqual(5);
    expect(decoded.height).toBeGreaterThanOrEqual(5);
  });

  it("returns the original bytes for a fully transparent PNG", () => {
    const source = makePng(8, 8, () => undefined);
    const trimmed = trimTransparentPadding(source);
    expect(Buffer.from(trimmed)).toEqual(Buffer.from(source));
  });
});
