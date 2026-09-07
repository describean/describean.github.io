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
  const MAX_TARGET_BYTES = 50 * 1000 * 1000;
  const MAX_UPSCALE_BYTES = 10 * 1000 * 1000;
  const MAX_UPSCALE_SCALE = 4;
  const MIN_UPSCALE_QUALITY = 0.8;
  const UPSCALE_SEARCH_ITERATIONS = 8;

  function getProcessingMode(originalBytes, targetBytes) {
    return targetBytes > originalBytes ? "upscale" : targetBytes < originalBytes ? "compress" : "convert";
  }

  function checkCancelled(signal) {
    if (signal?.aborted) throw new DOMException("Compression cancelled.", "AbortError");
  }

  function validateTarget(targetBytes) {
    if (!Number.isSafeInteger(targetBytes) || targetBytes <= 0 || targetBytes > MAX_TARGET_BYTES) {
      throw new Error("Please enter a target file size from 1 to 50,000 KB.");
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

  async function upscaleImage(source, targetBytes, format, { signal, onProgress = () => {} } = {}) {
    validateTarget(targetBytes);
    if (targetBytes > MAX_UPSCALE_BYTES) throw new Error("Upscaling supports targets up to 10,000 KB (10 MB). Please lower the target.");
    checkCancelled(signal);
    const output = getOutputFormat(format);
    const originalEdge = Math.max(source.width, source.height);
    const maxEdge = Math.floor(Math.min(originalEdge * MAX_UPSCALE_SCALE, MAX_CANVAS_EDGE,
      originalEdge * Math.sqrt(MAX_CANVAS_PIXELS / (source.width * source.height))));
    if (maxEdge <= originalEdge) {
      throw new Error("This image is already at the enlargement limit (16 MP or 8,192 px per side). Choose a smaller target to compress it instead.");
    }
    const canvas = document.createElement("canvas");

    async function encodeAtEdge(edge) {
      checkCancelled(signal);
      const width = Math.max(1, Math.floor(source.width * edge / originalEdge));
      const height = Math.max(1, Math.floor(source.height * edge / originalEdge));
      onProgress({ width, height, upscaled: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
      checkCancelled(signal);
      resizeImage(source.image, width, height, canvas, { preserveAlpha: output.alpha });
      const quality = format === "png" ? undefined : MIN_UPSCALE_QUALITY;
      const blob = await encodeImage(canvas, format, quality);
      checkCancelled(signal);
      return { blob, width, height, edge, quality: quality ?? null };
    }

    try {
      const largest = await encodeAtEdge(maxEdge);
      let best = largest.blob.size <= targetBytes ? largest : null;
      if (!best) {
        // Search integer pixel dimensions, keeping only encoded candidates within budget.
        // The quality floor avoids sacrificing most of the image quality to add pixels.
        let low = originalEdge + 1;
        let high = maxEdge - 1;
        // Bounded so a 16 MP upscale cannot spend an unbounded number of
        // full-resolution encodes; it still lands within about a dozen pixels.
        for (let iteration = 0; iteration < UPSCALE_SEARCH_ITERATIONS && low <= high; iteration += 1) {
          const edge = Math.floor((low + high) / 2);
          const candidate = await encodeAtEdge(edge);
          if (candidate.blob.size <= targetBytes) {
            best = candidate;
            low = edge + 1;
          } else {
            high = edge - 1;
          }
        }
      }
      if (!best) {
        throw new Error(`This image cannot be enlarged as ${output.label} within this target. Try a higher target (up to 10 MB) or another output format.`);
      }
      let optimized = best;
      if (format !== "png") {
        resizeImage(source.image, best.width, best.height, canvas, { preserveAlpha: output.alpha });
        optimized = await findBestQuality(canvas, targetBytes, format, { signal, minQuality: MIN_UPSCALE_QUALITY }) || best;
      }
      checkCancelled(signal);
      return {
        ...best, ...optimized, format, unchanged: false, mode: "upscale",
        limitReached: best.edge === maxEdge,
      };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  async function processImage(source, originalFile, targetBytes, format, options = {}) {
    validateTarget(targetBytes);
    const mode = getProcessingMode(originalFile.size, targetBytes);
    if (mode === "upscale") return upscaleImage(source, targetBytes, format, options);
    const result = await compressImage(source, originalFile, targetBytes, format, options);
    return { ...result, mode };
  }

  window.Describean = {
    ...window.Describean, findBestQuality, compressImage, upscaleImage, processImage,
    getProcessingMode, MAX_UPSCALE_BYTES,
  };
})();
