/** Local reference-image preparation only; no network or generated imagery. */
export const MAX_IMAGE_INPUT_BYTES = 3 * 1024 * 1024;
export const MAX_IMAGE_UPLOAD_BYTES = 120 * 1024;
export const MAX_IMAGE_DECODED_PIXELS = 16_000_000;
/** Local quality policy, NOT a documented provider requirement. */
export const MIN_IMAGE_SHORT_EDGE = 384;
export const IMAGE_JPEG_QUALITIES = [0.85, 0.75, 0.65] as const;
const BROWSER_OPERATION_TIMEOUT_MS = 10_000;

export type ImageDimensions = { width: number; height: number };
export type NormalizedImageUpload = ImageDimensions & {
  /** Canonical preview AND submission source: these are the exact upload bytes. */
  dataUrl: string;
  mimeType: "image/png" | "image/jpeg";
  originalBytes: number;
  bytes: number;
  optimized: boolean;
};

/** Only fixed, user-safe copy escapes this module; decoder errors are discarded. */
export class ImageUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageUploadError";
  }
}

function validateDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new ImageUploadError("This image has invalid dimensions. Choose another JPEG or PNG.");
  }
  if (width > MAX_IMAGE_DECODED_PIXELS / height) {
    throw new ImageUploadError("This image is too large to decode safely. Choose an image up to 16 megapixels.");
  }
}

/** No cropping or upscaling. Aspect is preserved to within one rounded pixel. */
export function planImageUpload(width: number, height: number): ImageDimensions[] {
  validateDimensions(width, height);
  const plans: ImageDimensions[] = [];
  for (const maxEdge of [1024, 768]) {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const next = { width: Math.round(width * scale), height: Math.round(height * scale) };
    if (Math.min(next.width, next.height) < MIN_IMAGE_SHORT_EDGE) {
      if (plans.length === 0) {
        throw new ImageUploadError("This image is too small or too narrow. Its short edge must remain at least 384 pixels when fitted within 1024 pixels. Choose another image.");
      }
      continue;
    }
    if (!plans.some(p => p.width === next.width && p.height === next.height)) plans.push(next);
  }
  return plans;
}

/** Read dimensions BEFORE invoking a decoder, including for highly compressed images. */
function headerDimensions(bytes: Uint8Array, mimeType: string): ImageDimensions {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mimeType === "image/png" && bytes.length >= 33 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b) &&
      view.getUint32(8) === 13 && view.getUint32(12) === 0x49484452) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mimeType === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 0xda || marker === 0xd9 || marker === 0x00) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (length < 8) break;
        return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
      }
      offset += length;
    }
  }
  throw new ImageUploadError("This file is not a valid JPEG or PNG. Choose another image.");
}

function bounded<T>(operation: Promise<T>, onLateValue?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(new ImageUploadError("Image preparation took too long. Choose a smaller image and try again."));
    }, BROWSER_OPERATION_TIMEOUT_MS);
    operation.then(value => {
      clearTimeout(timer);
      if (expired) {
        try { onLateValue?.(value); } catch { /* Late cleanup must not cause an unhandled rejection. */ }
      } else resolve(value);
    }, error => {
      clearTimeout(timer);
      if (!expired) reject(error);
    });
  });
}

type DecodedImage = ImageDimensions & { source: CanvasImageSource; release: () => void };

async function decodeImage(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    // Browser applies EXIF orientation; planning uses these displayed dimensions.
    const bitmap = await bounded(createImageBitmap(file, { imageOrientation: "from-image" }), late => late.close());
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  }
  if (typeof Image === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new ImageUploadError("Image preparation is unavailable in this browser. Try another browser.");
  }
  const url = URL.createObjectURL(file);
  let img: HTMLImageElement | undefined;
  const release = () => {
    if (img) { img.onload = null; img.onerror = null; img.src = ""; }
    URL.revokeObjectURL(url);
  };
  try {
    img = new Image();
    const source = img;
    await bounded(new Promise<void>((resolve, reject) => {
      source.onload = () => resolve();
      source.onerror = () => reject(new ImageUploadError("This image could not be opened. Choose another JPEG or PNG."));
      source.src = url;
    }));
    return { source, width: source.naturalWidth, height: source.naturalHeight, release };
  } catch (error) {
    release();
    throw error;
  }
}

async function dataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await bounded(blob.arrayBuffer()));
  if (bytes.byteLength !== blob.size || bytes.byteLength > MAX_IMAGE_UPLOAD_BYTES) {
    throw new ImageUploadError("This image could not be prepared within the upload limit. Choose another image.");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

/**
 * Accept a JPEG/PNG File (or Blob), at most 3 MiB. Returns at most 120 KiB binary.
 * Small valid originals retain their exact bytes even above a 1024 px long edge.
 * All inputs must satisfy the local 384 px short-edge and decoded-pixel policies.
 * These are local quality/resource choices, not official provider requirements.
 * Otherwise tries at most six JPEG encodes, explicitly flattening alpha onto WHITE.
 * Always draw from the original decoded reference (never repeatedly recompress).
 * Use result.dataUrl for preview as well as submission; do not preview the source File.
 * Scheduling/quality choices are deterministic; codec bytes may differ across browsers.
 */
export async function normalizeImageUpload(file: Blob): Promise<NormalizedImageUpload> {
  let decoded: DecodedImage | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      throw new ImageUploadError("Choose a JPEG or PNG image.");
    }
    if (file.size <= 0 || file.size > MAX_IMAGE_INPUT_BYTES) {
      throw new ImageUploadError("Choose a non-empty JPEG or PNG image up to 3 MiB.");
    }
    const input = new Uint8Array(await bounded(file.arrayBuffer()));
    const header = headerDimensions(input, file.type);
    validateDimensions(header.width, header.height);
    decoded = await decodeImage(file);
    validateDimensions(decoded.width, decoded.height);
    // Only a possible EXIF rotation may change dimensions reported by the decoder.
    if (!((decoded.width === header.width && decoded.height === header.height) ||
          (decoded.width === header.height && decoded.height === header.width))) {
      throw new ImageUploadError("This image has inconsistent dimensions. Choose another JPEG or PNG.");
    }
    if (Math.min(decoded.width, decoded.height) < MIN_IMAGE_SHORT_EDGE) {
      throw new ImageUploadError("Choose an image with a short edge of at least 384 pixels for reference quality.");
    }
    if (file.size <= MAX_IMAGE_UPLOAD_BYTES) {
      return { dataUrl: await dataUrl(file), mimeType: file.type, width: decoded.width, height: decoded.height,
        originalBytes: file.size, bytes: file.size, optimized: false };
    }
    const plans = planImageUpload(decoded.width, decoded.height);
    canvas = document.createElement("canvas");
    for (const plan of plans) {
      canvas.width = plan.width;
      canvas.height = plan.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new ImageUploadError("Image preparation is unavailable in this browser. Try another browser.");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, plan.width, plan.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(decoded.source, 0, 0, plan.width, plan.height);
      for (const quality of IMAGE_JPEG_QUALITIES) {
        const blob = await bounded(new Promise<Blob | null>(resolve => canvas!.toBlob(resolve, "image/jpeg", quality)));
        if (!blob || blob.type !== "image/jpeg" || blob.size <= 0) {
          throw new ImageUploadError("This browser could not encode the image as JPEG. Try another browser.");
        }
        if (blob.size <= MAX_IMAGE_UPLOAD_BYTES) {
          return { dataUrl: await dataUrl(blob), mimeType: "image/jpeg", ...plan,
            originalBytes: file.size, bytes: blob.size, optimized: true };
        }
      }
    }
    throw new ImageUploadError("This image cannot fit within 120 KiB while keeping enough detail. Choose a simpler image.");
  } catch (error) {
    if (error instanceof ImageUploadError) throw error;
    throw new ImageUploadError("This image could not be prepared. Choose another JPEG or PNG and try again.");
  } finally {
    // Cleanup must not replace user-safe errors with browser exception text.
    try { decoded?.release(); } catch { /* Best-effort browser resource cleanup. */ }
    try { if (canvas) { canvas.width = 0; canvas.height = 0; } } catch { /* As above. */ }
  }
}
