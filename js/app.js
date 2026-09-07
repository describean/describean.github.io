(() => {
  "use strict";

  const { loadImage, formatFileSize, compressJPEG, compressedFileName, downloadBlob } = window.Describean;
  const $ = (id) => document.getElementById(id);
  const form = $("compress-form");
  const input = $("file-input");
  const dropZone = $("drop-zone");
  const targetInput = $("target-size");
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

  async function selectFiles(files) {
    if (!files.length || controller || loading) return;
    if (files.length !== 1) {
      showError("Please choose one JPG at a time.");
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
    dropZone.setAttribute("aria-label", "Select a JPG or JPEG image");
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
      showError(error.message || "This image could not be opened. Please try another JPG.");
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
      showError("Choose a JPG image first.");
      dropZone.focus();
      return;
    }

    clearResult();
    showError();
    controller = new AbortController();
    updateControls();
    setStatus("Finding the best quality for your target size…");

    try {
      result = await compressJPEG(source, originalFile, targetBytes, {
        signal: controller.signal,
        onProgress({ width, height, resized }) {
          setStatus(resized
            ? `Adjusting to ${width} × ${height} px and finding the best quality…`
            : "Finding the best quality at your original resolution…");
        },
      });
      // Keep the download guarantee independent of the search implementation.
      if (result.blob.size > targetBytes) throw new Error("The result exceeds your target. Please try again.");
      resultURL = URL.createObjectURL(result.blob);
      $("compressed-preview").src = resultURL;
      $("result-original").textContent = formatFileSize(originalFile.size);
      $("result-original").title = `${originalFile.size.toLocaleString("en")} bytes`;
      $("result-compressed").textContent = formatFileSize(result.blob.size);
      $("result-compressed").title = `${result.blob.size.toLocaleString("en")} bytes`;
      const reduction = Math.max(0, (1 - result.blob.size / originalFile.size) * 100);
      $("result-reduction").textContent = `${reduction.toFixed(1)}%`;
      $("result-resolution").textContent = `${source.width} × ${source.height} → ${result.width} × ${result.height} px`;
      $("target-badge").textContent = `✓ Within ${targetBytes / 1000} KB`;
      const resized = result.width !== source.width || result.height !== source.height;
      $("result-note").textContent = result.unchanged
        ? "Already within your target. Your original image is ready to download without any quality loss."
        : resized
          ? "Resolution reduced to meet your target. Image proportions are preserved."
          : "Original resolution preserved. Your JPG is ready to download.";
      $("result").hidden = false;
      setStatus(result.unchanged ? "Your image already meets the target size." : `Done. Your image is ${reduction.toFixed(1)}% smaller.`);
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
    if (result && originalFile) downloadBlob(result.blob, compressedFileName(originalFile.name));
  });

  updateControls();
})();
