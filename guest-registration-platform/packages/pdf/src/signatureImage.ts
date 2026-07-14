import { PNG } from "pngjs";

const TRIM_PADDING_PX = 2;

/**
 * Crops transparent margins from a PNG so only the drawn signature strokes remain.
 * Returns the original bytes when decoding fails or no opaque pixels are found.
 */
export function trimTransparentPadding(pngBytes: Uint8Array): Uint8Array {
  try {
    const source = PNG.sync.read(Buffer.from(pngBytes));
    const { width, height, data } = source;

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const alpha = data[(y * width + x) * 4 + 3]!;
        if (alpha > 0) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < 0 || maxY < 0) {
      return pngBytes;
    }

    const cropX = Math.max(0, minX - TRIM_PADDING_PX);
    const cropY = Math.max(0, minY - TRIM_PADDING_PX);
    const cropRight = Math.min(width - 1, maxX + TRIM_PADDING_PX);
    const cropBottom = Math.min(height - 1, maxY + TRIM_PADDING_PX);
    const cropWidth = cropRight - cropX + 1;
    const cropHeight = cropBottom - cropY + 1;

    const cropped = new PNG({ width: cropWidth, height: cropHeight });
    for (let y = 0; y < cropHeight; y++) {
      for (let x = 0; x < cropWidth; x++) {
        const srcIdx = ((cropY + y) * width + (cropX + x)) * 4;
        const dstIdx = (y * cropWidth + x) * 4;
        cropped.data[dstIdx] = data[srcIdx]!;
        cropped.data[dstIdx + 1] = data[srcIdx + 1]!;
        cropped.data[dstIdx + 2] = data[srcIdx + 2]!;
        cropped.data[dstIdx + 3] = data[srcIdx + 3]!;
      }
    }

    return new Uint8Array(PNG.sync.write(cropped));
  } catch {
    return pngBytes;
  }
}
