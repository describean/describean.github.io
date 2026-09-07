(() => {
  "use strict";

  const { loadImage, formatFileSize, processImage, outputFileName, downloadBlob, getOutputFormat, supportsOutputFormat, getProcessingMode, MAX_UPSCALE_BYTES } = window.Describean;
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

  function selectedMode() {
    return originalFile ? getProcessingMode(originalFile.size, Number(targetInput.value) * 1000) : null;
  }

  function updateControls() {
    const busy = loading || Boolean(controller);
    input.disabled = busy;
    dropZone.disabled = busy;
    targetInput.disabled = busy;
    formatInput.disabled = busy;
    presets.forEach((button) => { button.disabled = busy; });
    $("compress-button").disabled = busy || !source;
    const mode = selectedMode();
    $("compress-label").textContent = loading ? "Opening image…"
      : controller ? (mode === "upscale" ? "Upscaling…" : "Processing…")
        : mode === "upscale" ? "Upscale Image" : mode === "compress" ? "Compress Image" : "Process Image";
    $("mode-note").hidden = !mode;
    $("mode-note").textContent = mode === "upscale"
      ? "Upscale: larger target, larger resolution. Up to 4× per side, 16 MP, 8,192 px per side, and a 10 MB target."
      : mode === "compress" ? "Compress: smaller target. Quality and resolution adjust to fit."
        : "Same size limit: keep the image or convert to your selected format.";
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
    const validNumber = targetInput.value.trim() !== "" && Number.isSafeInteger(value) && value >= 1 && value <= 50_000;
    const exceedsUpscaleLimit = originalFile && value * 1000 > originalFile.size && value * 1000 > MAX_UPSCALE_BYTES;
    const valid = validNumber && !exceedsUpscaleLimit;
    if (reportError) {
      targetInput.setAttribute("aria-invalid", String(!valid));
      $("target-error").hidden = valid;
      $("target-error").textContent = valid ? "" : !validNumber
        ? "Enter a whole number from 1 to 50,000 KB."
        : "Upscaling supports targets up to 10,000 KB (10 MB). Please lower the target.";
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
    updateControls();
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
    readTarget();
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
      readTarget();
      setStatus("Image ready. Set your target size and output format.");
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
    setStatus(selectedMode() === "upscale" ? "Finding a larger resolution within your target…" : "Finding the best quality for your target size…");

    try {
      const format = formatInput.value;
      const output = getOutputFormat(format);
      result = await processImage(source, originalFile, targetBytes, format, {
        signal: controller.signal,
        onProgress({ width, height, resized, upscaled }) {
          setStatus(upscaled ? `Trying a larger resolution: ${width} × ${height} px…` : resized
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
      // Only an upscale can grow the file: other modes cap it at or below the original.
      const increased = result.blob.size > originalFile.size;
      $("result-change-label").textContent = increased ? "Size increase" : "Reduction";
      $("result-reduction").textContent = `${Math.abs(reduction).toFixed(1)}%`;
      $("result-resolution").textContent = `${source.width} × ${source.height} → ${result.width} × ${result.height} px`;
      $("target-badge").textContent = `✓ Within ${targetBytes / 1000} KB`;
      const resized = result.width !== source.width || result.height !== source.height;
      const notes = [result.mode === "upscale"
        ? "Resolution enlarged using browser interpolation. This does not restore missing detail."
        : result.unchanged
          ? "Already within your target. Your original image is ready to download without any quality loss."
          : resized
            ? "Resolution reduced to meet your target. Image proportions are preserved."
            : `Original resolution preserved. Your ${output.label} is ready to download.`];
      if (source.format !== format) notes.push(`Converted from ${getOutputFormat(source.format).label} to ${output.label}.`);
      if (format === "jpeg" && source.format !== "jpeg") notes.push("Transparent areas became white.");
      if (output.alpha) notes.push("Transparency is preserved.");
      if (result.limitReached) notes.push("Maximum allowed enlargement reached. The file may be smaller than your target.");
      $("result-note").textContent = notes.join(" ");
      $("result").hidden = false;
      setStatus(result.mode === "upscale" ? `Done. Upscaled to ${result.width} × ${result.height} px within your target.`
        : result.unchanged ? "Your image already meets the target size."
          : `Done. Your image is ${reduction.toFixed(1)}% smaller.`);
      $("result").focus({ preventScroll: true });
    } catch (error) {
      clearResult();
      if (error.name === "AbortError") {
        setStatus("Processing cancelled. Your image is ready to try again.");
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
    if (result && originalFile) downloadBlob(result.blob, outputFileName(originalFile.name, result.format, result.mode === "upscale" ? "upscaled" : "compressed"));
  });

  updateControls();
})();
