(() => {
  "use strict";

  const { loadImage, formatFileSize, compressImage, outputFileName, downloadBlob, getOutputFormat, supportsOutputFormat } = window.Describean;
  const $ = (id) => document.getElementById(id);
  const form = $("compress-form");
  const input = $("file-input");
  const dropZone = $("drop-zone");
  const targetInput = $("target-size");
  const formatInput = $("output-format");
  const presets = [...document.querySelectorAll("[data-target]")];
  let source = null;
  let originalFile = null;
  let result = null;
  let resultURL = null;
  let loading = false;
  let controller = null;
  let selectionVersion = 0;
  let dragDepth = 0;

  function updateControls() {
    const busy = loading || Boolean(controller);
    input.disabled = busy;
    dropZone.disabled = busy;
    targetInput.disabled = busy;
    formatInput.disabled = busy;
    presets.forEach((button) => { button.disabled = busy; });
    $("compress-button").disabled = busy || !source;
    $("compress-label").textContent = controller ? "Compressing…" : loading ? "Opening image…" : "Compress Image";
    $("cancel-button").hidden = !controller;
    form.setAttribute("aria-busy", String(busy));
  }

  function setStatus(message) {
    $("status").textContent = message;
    $("activity").hidden = !message;
  }

  function showError(message = "") {
    $("error-message").textContent = message;
    $("error-message").hidden = !message;
  }

  function clearResult() {
    $("result").hidden = true;
    $("compressed-preview").removeAttribute("src");
    if (resultURL) URL.revokeObjectURL(resultURL);
    resultURL = null;
    result = null;
  }

  function readTarget(reportError = true) {
    const value = Number(targetInput.value);
    const valid = targetInput.value.trim() !== "" && Number.isSafeInteger(value) && value >= 1 && value <= 50_000;
    if (reportError) {
      targetInput.setAttribute("aria-invalid", String(!valid));
      $("target-error").hidden = valid;
      $("target-error").textContent = valid ? "" : "Enter a whole number from 1 to 50,000 KB.";
    }
    return valid ? value * 1000 : null;
  }

  function targetChanged() {
    clearResult();
    showError();
    setStatus("");
    readTarget();
    presets.forEach((button) => {
      button.setAttribute("aria-pressed", String(Number(button.dataset.target) === Number(targetInput.value)));
    });
  }

  function formatChanged() {
    clearResult();
    showError();
    setStatus("");
    $("output-note").textContent = formatInput.value === "jpeg"
      ? "Transparent areas become white."
      : formatInput.value === "png"
        ? "Keeps transparency. Resolution may decrease to fit the size limit."
        : "Keeps transparency. Quality is adjusted to fit the size limit.";
  }

  for (const option of formatInput.options) {
    if (!supportsOutputFormat(option.value)) {
      option.disabled = true;
      option.textContent += " (not supported in this browser)";
    }
  }
  formatInput.addEventListener("change", formatChanged);

  async function selectFiles(files) {
    if (!files.length || controller || loading) return;
    if (files.length !== 1) {
      showError("Please choose one image at a time.");
      return;
    }

    const version = ++selectionVersion;
    clearResult();
    showError();
    if (source) source.dispose();
    source = null;
    originalFile = null;
    $("original-preview").removeAttribute("src");
    $("empty-upload").hidden = false;
    $("selected-upload").hidden = true;
    dropZone.setAttribute("aria-label", "Select a JPG, JPEG, JFIF, PNG, or WebP image");
    loading = true;
    setStatus("Opening your image…");
    updateControls();

    try {
      const loaded = await loadImage(files[0]);
      if (version !== selectionVersion) {
        loaded.dispose();
        return;
      }
      source = loaded;
      originalFile = files[0];
      $("original-preview").src = source.url;
      $("file-name").textContent = originalFile.name;
      $("file-name").title = originalFile.name;
      $("file-details").textContent = `${source.width} × ${source.height} px · ${formatFileSize(originalFile.size)}`;
      $("empty-upload").hidden = true;
      $("selected-upload").hidden = false;
      dropZone.setAttribute("aria-label", `Change image. Selected: ${originalFile.name}`);
      setStatus("Image ready. Set your target size, then compress.");
    } catch (error) {
      showError(error.message || "This image could not be opened. Please try another image.");
      setStatus("");
    } finally {
      if (version === selectionVersion) {
        loading = false;
        updateControls();
      }
    }
  }

  dropZone.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const files = [...input.files];
    input.value = ""; // Allow selecting the same file again, including after an error.
    void selectFiles(files);
  });

  // Prevent a dropped file from navigating away from the tool, even outside the box.
  for (const type of ["dragover", "drop"]) {
    window.addEventListener(type, (event) => {
      if ([...event.dataTransfer.types].includes("Files")) event.preventDefault();
    });
  }
  dropZone.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dragDepth += 1;
    if (!loading && !controller) dropZone.classList.add("is-dragging");
  });
  dropZone.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropZone.classList.remove("is-dragging");
  });
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = loading || controller ? "none" : "copy";
  });
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    dropZone.classList.remove("is-dragging");
    void selectFiles([...event.dataTransfer.files]);
  });

  targetInput.addEventListener("input", targetChanged);
  presets.forEach((button) => {
    button.addEventListener("click", () => {
      targetInput.value = button.dataset.target;
      targetChanged();
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (controller || loading) return;
    const targetBytes = readTarget();
    if (!targetBytes) {
      targetInput.focus();
      return;
    }
    if (!source) {
      showError("Choose an image first.");
      dropZone.focus();
      return;
    }

    clearResult();
    showError();
    controller = new AbortController();
    updateControls();
    setStatus("Finding the best quality for your target size…");

    try {
      const format = formatInput.value;
      const output = getOutputFormat(format);
      result = await compressImage(source, originalFile, targetBytes, format, {
        signal: controller.signal,
        onProgress({ width, height, resized }) {
          setStatus(resized
            ? `Adjusting to ${width} × ${height} px and finding the best quality…`
            : "Finding the best quality at your original resolution…");
        },
      });
      // Keep the download guarantee independent of the search implementation.
      if (result.blob.size > targetBytes) throw new Error("The result exceeds your target. Please try again.");
      if (result.blob.type !== output.mimeType) throw new Error(`The ${output.label} output could not be created. Please try again.`);
      resultURL = URL.createObjectURL(result.blob);
      $("compressed-preview").src = resultURL;
      $("result-original").textContent = formatFileSize(originalFile.size);
      $("result-original").title = `${originalFile.size.toLocaleString("en")} bytes`;
      $("result-compressed").textContent = formatFileSize(result.blob.size);
      $("result-compressed").title = `${result.blob.size.toLocaleString("en")} bytes`;
      $("result-format-label").textContent = `Output ${output.label}`;
      const reduction = (1 - result.blob.size / originalFile.size) * 100;
      const increased = result.blob.size > originalFile.size;
      $("result-change-label").textContent = increased ? "Size increase" : "Reduction";
      $("result-reduction").textContent = `${Math.abs(reduction).toFixed(1)}%`;
      $("result-resolution").textContent = `${source.width} × ${source.height} → ${result.width} × ${result.height} px`;
      $("target-badge").textContent = `✓ Within ${targetBytes / 1000} KB`;
      const resized = result.width !== source.width || result.height !== source.height;
      const notes = [result.unchanged
        ? "Already within your target. Your original image is ready to download without any quality loss."
        : resized
          ? "Resolution reduced to meet your target. Image proportions are preserved."
          : `Original resolution preserved. Your ${output.label} is ready to download.`];
      if (source.format !== format) notes.push(`Converted from ${getOutputFormat(source.format).label} to ${output.label}.`);
      if (format === "jpeg" && source.format !== "jpeg") notes.push("Transparent areas became white.");
      if (output.alpha) notes.push("Transparency is preserved.");
      if (increased) notes.push("Format conversion made this file larger, but it is still within your target size.");
      $("result-note").textContent = notes.join(" ");
      $("result").hidden = false;
      setStatus(result.unchanged ? "Your image already meets the target size."
        : increased ? `Done. Your ${output.label} is within the target size.`
          : `Done. Your image is ${reduction.toFixed(1)}% smaller.`);
      $("result").focus({ preventScroll: true });
    } catch (error) {
      clearResult();
      if (error.name === "AbortError") {
        setStatus("Compression cancelled. Your image is ready to try again.");
      } else {
        setStatus("");
        showError(error.message || "Something went wrong. Please try a smaller image.");
      }
    } finally {
      controller = null;
      updateControls();
    }
  });

  $("cancel-button").addEventListener("click", () => controller?.abort());
  $("download-button").addEventListener("click", () => {
    if (result && originalFile) downloadBlob(result.blob, outputFileName(originalFile.name, result.format));
  });

  updateControls();
})();
