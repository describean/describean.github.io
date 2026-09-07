(() => {
  "use strict";

  const { resizeImage, encodeImage, getOutputFormat } = window.Describean;
  const MIN_QUALITY = 0.1;
  const MAX_QUALITY = 1;
  const SEARCH_ITERATIONS = 10;
  const RESIZE_FACTOR = 0.9;
  // Bound canvas allocations on mobile while allowing 12 MP photos at full size.
  const MAX_CANVAS_PIXELS = 16 * 1000 * 1000;
  const MAX_CANVAS_EDGE = 8192;

  function checkCancelled(signal) {
    if (signal?.aborted) throw new DOMException("Compression cancelled.", "AbortError");
  }

  function validateTarget(targetBytes) {
    if (!Number.isSafeInteger(targetBytes) || targetBytes <= 0) {
      throw new Error("Please enter a valid target file size.");
    }
  }

  async function findBestQuality(canvas, targetBytes, format, { signal, minQuality = MIN_QUALITY } = {}) {
    validateTarget(targetBytes);
    async function encode(quality) {
      checkCancelled(signal);
      const blob = await encodeImage(canvas, format, quality);
      checkCancelled(signal);
      return blob;
    }

    // PNG has no Canvas quality control. Keep its pixels lossless at this resolution.
    if (format === "png") {
      const blob = await encode();
      return blob.size <= targetBytes ? { blob, quality: null } : null;
    }
    let low = minQuality;
    let high = MAX_QUALITY;
    const smallest = await encode(low);
    if (smallest.size > targetBytes) return null;

    const highest = await encode(high);
    if (highest.size <= targetBytes) return { blob: highest, quality: high };

    // Always retain an actually encoded candidate at or BELOW the byte budget.
    // Encoder quality is quantized, so an exact target size is not always possible.
    let best = { blob: smallest, quality: low };
    for (let iteration = 0; iteration < SEARCH_ITERATIONS; iteration += 1) {
      const quality = (low + high) / 2;
      const blob = await encode(quality);
      if (blob.size <= targetBytes) {
        best = { blob, quality };
        low = quality;
      } else {
        high = quality;
      }
    }
    return best;
  }

  async function compressImage(source, originalFile, targetBytes, format, { signal, onProgress = () => {} } = {}) {
    validateTarget(targetBytes);
    const output = getOutputFormat(format);
    checkCancelled(signal);
    // Passthrough is only valid when both the format and byte budget already match.
    if (source.format === format && originalFile.size <= targetBytes) {
      return {
        blob: originalFile.slice(0, originalFile.size, output.mimeType), width: source.width, height: source.height,
        quality: null, unchanged: true, format,
      };
    }

    let scale = Math.min(1, MAX_CANVAS_EDGE / Math.max(source.width, source.height),
      Math.sqrt(MAX_CANVAS_PIXELS / (source.width * source.height)));
    let width = Math.max(1, Math.floor(source.width * scale));
    let height = Math.max(1, Math.floor(source.height * scale));
    const canvas = document.createElement("canvas");

    try {
      while (true) {
        checkCancelled(signal);
        onProgress({ width, height, resized: width !== source.width || height !== source.height });
        // Give the UI a chance to paint status changes and handle cancellation.
        await new Promise((resolve) => setTimeout(resolve, 0));
        checkCancelled(signal);
        // Draw from the decoded original each time to avoid cumulative resampling.
        resizeImage(source.image, width, height, canvas, { preserveAlpha: output.alpha });
        const best = await findBestQuality(canvas, targetBytes, format, { signal });
        if (best) {
          return { ...best, width, height, unchanged: false, format };
        }
        if (width === 1 && height === 1) {
          throw new Error(`This target is too small for a ${output.label} file. Please increase the target size.`);
        }
        scale *= RESIZE_FACTOR;
        width = Math.max(1, Math.floor(source.width * scale));
        height = Math.max(1, Math.floor(source.height * scale));
      }
    } finally {
      // Release the large pixel buffer, including on cancellation and encode errors.
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  window.Describean = { ...window.Describean, findBestQuality, compressImage };
})();
