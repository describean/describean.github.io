/* Shared browser utilities. Classic scripts also work when index.html opens via file://. */
(() => {
  "use strict";

  const MAX_FILE_BYTES = 50 * 1000 * 1000;
  const MAX_IMAGE_PIXELS = 40 * 1000 * 1000;
  const { inspectImageFile } = window.Describean;
  const OUTPUT_FORMATS = Object.freeze({
    jpeg: { label: "JPG", extension: "jpg", mimeType: "image/jpeg", alpha: false },
    png: { label: "PNG", extension: "png", mimeType: "image/png", alpha: true },
    webp: { label: "WebP", extension: "webp", mimeType: "image/webp", alpha: true },
  });

  function getOutputFormat(format) {
    if (!Object.hasOwn(OUTPUT_FORMATS, format)) throw new Error("Choose JPG, PNG, or WebP as the output format.");
    return OUTPUT_FORMATS[format];
  }

  function supportsOutputFormat(format) {
    const { mimeType } = getOutputFormat(format);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    try {
      return canvas.toDataURL(mimeType).startsWith(`data:${mimeType};`);
    } catch {
      return false;
    }
  }

  function formatFileSize(bytes) {
    if (bytes < 1000) return `${bytes} B`;
    const unit = bytes < 1000 * 1000 ? "KB" : "MB";
    const size = bytes / (unit === "KB" ? 1000 : 1000 * 1000);
    return `${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(size)} ${unit}`;
  }

  async function loadImage(file) {
    if (file?.size > MAX_FILE_BYTES) {
      throw new Error("This image is over 50 MB. Please choose a smaller image.");
    }
    const { format, mimeType } = await inspectImageFile(file);
    // Normalize missing or inaccurate OS MIME types using the inspected file bytes.
    const url = URL.createObjectURL(file.slice(0, file.size, mimeType));
    const image = new Image();
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("This image could not be opened. It may be damaged or unsupported by your browser. Please try another image."));
        image.src = url;
      });
      // Modern browsers apply EXIF orientation when decoding and drawing the image.
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (!width || !height) throw new Error("This image has no readable pixels. Please try another image.");
      if (width * height > MAX_IMAGE_PIXELS) {
        throw new Error("This image is over 40 megapixels. Please choose a smaller image for browser processing.");
      }
      return {
        image, width, height, url, format,
        dispose() {
          URL.revokeObjectURL(url);
          image.src = "";
        },
      };
    } catch (error) {
      URL.revokeObjectURL(url);
      image.src = "";
      throw error;
    }
  }

  function resizeImage(image, width, height, canvas = document.createElement("canvas"), { preserveAlpha = false } = {}) {
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Your browser could not prepare this image. Please try a smaller image.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    if (!preserveAlpha) {
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function encodeImage(canvas, format, quality) {
    const { mimeType, label } = getOutputFormat(format);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob || !blob.size || blob.type !== mimeType) {
          reject(new Error(`Your browser could not create ${label} output. Please choose another format or a smaller image.`));
          return;
        }
        resolve(blob);
      }, mimeType, quality);
    });
  }

  function outputFileName(name, format, action = "compressed") {
    return `${name.replace(/\.(jpe?g|jfif|png|webp)$/i, "") || "image"}-${action}.${getOutputFormat(format).extension}`;
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    // Leave time for browsers to start the download before releasing its URL.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  window.Describean = {
    ...window.Describean,
    OUTPUT_FORMATS, getOutputFormat, supportsOutputFormat,
    formatFileSize, loadImage, resizeImage, encodeImage, outputFileName, downloadBlob,
  };
})();
