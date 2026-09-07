/* Inspect local file bytes before decoding. File extensions and MIME types can lie. */
(() => {
  "use strict";

  const EXTENSIONS = { jpg: "jpeg", jpeg: "jpeg", jfif: "jpeg", png: "png", webp: "webp" };
  const SUPPORTED_FORMATS = "JPG, JPEG, JFIF, PNG, or WebP";
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunkName = (bytes, offset) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  const damagedFile = () => new Error("This image file is incomplete or damaged. Please choose another image.");
  const animatedFile = () => new Error("Animated images are not supported yet. Please choose a still PNG, WebP, or JPEG image.");

  function inspectPNG(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      const type = chunkName(bytes, offset + 4);
      const next = offset + length + 12; // Length, type, data, CRC.
      if (next > bytes.length) throw damagedFile();
      if (offset === 8 && (type !== "IHDR" || length !== 13)) throw damagedFile();
      if (type === "acTL" || type === "fcTL" || type === "fdAT") throw animatedFile();
      if (type === "IEND") {
        if (length !== 0) throw damagedFile();
        return;
      }
      offset = next;
    }
    throw damagedFile();
  }

  function inspectWebP(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = view.getUint32(4, true) + 8;
    if (end !== bytes.length || end <= 12) throw damagedFile();
    let offset = 12;
    while (offset + 8 <= end) {
      const type = chunkName(bytes, offset);
      const length = view.getUint32(offset + 4, true);
      const next = offset + 8 + length + (length % 2); // RIFF chunks have even padding.
      if (next > end) throw damagedFile();
      if (type === "VP8X") {
        if (length !== 10) throw damagedFile();
        if (bytes[offset + 8] & 0x02) throw animatedFile();
      }
      if (type === "ANIM" || type === "ANMF") throw animatedFile();
      offset = next;
    }
    if (offset !== end) throw damagedFile();
  }

  async function inspectImageFile(file) {
    const extension = file?.name.split(".").pop().toLowerCase();
    const expected = Object.hasOwn(EXTENSIONS, extension) ? EXTENSIONS[extension] : null;
    if (!file?.name.includes(".") || !expected) {
      throw new Error(`Please choose a ${SUPPORTED_FORMATS} image. Other formats are not supported yet.`);
    }
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    let format = null;
    if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
      format = "jpeg";
    } else if (PNG_SIGNATURE.every((byte, index) => header[index] === byte)) {
      format = "png";
    } else if (header.length === 12 && chunkName(header, 0) === "RIFF" && chunkName(header, 8) === "WEBP") {
      format = "webp";
    }
    if (format !== expected) {
      throw new Error(`This file does not contain valid ${extension.toUpperCase()} image data. Please choose a ${SUPPORTED_FORMATS} image.`);
    }
    // Walk container chunks, not raw text: a metadata string can contain "acTL" or "ANIM".
    // The browser decoder subsequently checks that the pixel data can actually be read.
    if (format === "png" || format === "webp") {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (format === "png") inspectPNG(bytes);
      else inspectWebP(bytes);
    }
    return { format, mimeType: `image/${format}` };
  }

  window.Describean = { ...window.Describean, inspectImageFile };
})();
