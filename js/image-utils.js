/* Shared browser utilities. Classic scripts also work when index.html opens via file://. */
(() => {
  "use strict";

  const MAX_FILE_BYTES = 50 * 1000 * 1000;
  const MAX_IMAGE_PIXELS = 40 * 1000 * 1000;

  function formatFileSize(bytes) {
    if (bytes < 1000) return `${bytes} B`;
    const unit = bytes < 1000 * 1000 ? "KB" : "MB";
    const size = bytes / (unit === "KB" ? 1000 : 1000 * 1000);
    return `${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(size)} ${unit}`;
  }

  async function loadImage(file) {
    if (!file || !/\.jpe?g$/i.test(file.name)) {
      throw new Error("Please choose a JPG or JPEG file. Other formats are not supported yet.");
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new Error("This image is over 50 MB. Please choose a smaller JPG.");
    }
    // Check the actual file header: an extension or MIME type alone is not reliable.
    const header = new Uint8Array(await file.slice(0, 3).arrayBuffer());
    if (header[0] !== 0xff || header[1] !== 0xd8 || header[2] !== 0xff) {
      throw new Error("This file is not a valid JPEG image. Please choose another JPG.");
    }

    const url = URL.createObjectURL(file);
    const image = new Image();
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("This JPG could not be opened. It may be damaged. Please try another image."));
        image.src = url;
      });
      // Modern browsers apply EXIF orientation when decoding and drawing the image.
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (!width || !height) throw new Error("This image has no readable pixels. Please try another JPG.");
      if (width * height > MAX_IMAGE_PIXELS) {
        throw new Error("This image is over 40 megapixels. Please choose a smaller image for browser processing.");
      }
      return {
        image, width, height, url,
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

  function resizeImage(image, width, height, canvas = document.createElement("canvas")) {
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Your browser could not prepare this image. Please try a smaller JPG.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function encodeJPEG(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob || !blob.size || blob.type !== "image/jpeg") {
          reject(new Error("Your browser could not encode this JPG. Please try a smaller image or another browser."));
          return;
        }
        resolve(blob);
      }, "image/jpeg", quality);
    });
  }

  function compressedFileName(name) {
    return `${name.replace(/\.jpe?g$/i, "") || "image"}-compressed.jpg`;
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
    formatFileSize, loadImage, resizeImage, encodeJPEG, compressedFileName, downloadBlob,
  };
})();
