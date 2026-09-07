# Compress image free · Images to target size

A small, English-language image tool. Choose one JPG, JPEG, JFIF, PNG, or WebP,
enter a target in KB, and download a JPG, PNG, or WebP that fits. A target below
the original size **compresses**; a target above it **upscales** the resolution.
No backend, build step, runtime dependencies, analytics, ads, or image uploads.

## Run locally

Open `index.html` directly in a modern browser. The scripts use `defer` and a
shared `window.Describean` namespace rather than ES module imports, so `file://`
works without a server.

Alternatively, from this directory:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Visit **http://localhost:8000**. Stop the server with `Ctrl+C`.

## Use

1. Drop a JPG, JPEG, JFIF, PNG, or WebP into the upload area, or click **Select Image**.
2. Review its name, oriented pixel dimensions, and original file size.
3. Enter a whole number from **1 to 50,000 KB**, or choose 50 / 100 / 200 / 500 KB.
   A note under the field states whether that target will compress or upscale.
4. Choose **JPG**, **PNG**, or **WebP** output and click the action button. Its
   label follows the target: **Compress Image** or **Upscale Image**. You can
   cancel while it is processing.
5. Review the preview, actual size, size change, and before/after resolution.
6. Click **Download Image** to save `original-name-compressed.jpg` or
   `original-name-upscaled.jpg`, `.png`, or `.webp`.

The default target is **200 KB**. **1 KB = 1,000 bytes** and **1 MB = 1,000,000
bytes** throughout the app. This is a conservative byte budget for upload forms
that instead interpret KB as 1,024 bytes. Display sizes are rounded; the actual
download is checked against the exact byte limit.

## Processing modes

The target size alone selects the mode; there is no separate switch.

| Target vs. original file size | Mode | What changes |
| --- | --- | --- |
| Target **below** original | `compress` | Quality first, then resolution, until it fits |
| Target **equal to** original | `convert` | Format conversion only; same-format input passes through unchanged |
| Target **above** original | `upscale` | Resolution is enlarged to use the extra budget |

`getProcessingMode()` decides this, and `processImage()` dispatches to
`compressImage()` or `upscaleImage()`. In every mode the target is a **ceiling**:
the downloaded file is verified to be at or below it before the result is shown.

Because the default target is 200 KB, an input smaller than 200 KB upscales by
default. The mode note and the button label both say so before you click.

## Compression behavior

- **Output is selectable: JPG, PNG, or WebP.** The default is JPG. JPG composites
  transparent areas onto **white**; PNG and WebP preserve transparency, including
  partial transparency. Unsupported browser encoders are disabled in the selector,
  and actual output MIME types are verified to prevent silent format fallback.
- An input already in the selected output format is returned with unchanged
  bytes, pixels, and metadata when the target equals its size, which is the
  `convert` mode passthrough. A smaller target re-encodes it, and a larger one
  upscales it. JPEG includes `.jpg`, `.jpeg`, and `.jfif`; its output filename
  uses `.jpg`.
- Upscaling, and format conversion during it, can make a small input larger while
  still meeting the target. The UI reports **Size increase** in this case instead
  of claiming a reduction.
- For JPG and WebP, `findBestQuality()` tests quality 0.1 and 1.0 at each resolution, then
  performs **10 binary search iterations** if the target falls between them. It
  keeps the highest tested quality whose actual encoded Blob fits the budget.
- If quality 0.1 still exceeds the limit, `compressImage()` reduces dimensions by
  a factor of **0.9** and searches again. The aspect ratio is retained, subject to
  integer-pixel rounding. Each resize is drawn from the decoded original.
- This policy prioritizes resolution until the quality floor is reached. It is
  a practical heuristic, not a guarantee of the best perceptual quality across
  every possible quality/resolution combination.
- PNG has no Canvas quality setting. It is encoded losslessly at each resolution;
  if it exceeds the target, dimensions are reduced by 0.9 until it fits. A small
  PNG target can require more resolution loss than JPG or WebP. No palette
  quantization or external PNG optimizer is used.
- Browser image encoders quantize quality and produce different results. Files
  can be smaller than the requested size; the limit is a ceiling, not an exact
  output size.
- Re-encoding uses the browser Canvas encoder. Source EXIF metadata is not
  copied; orientation is applied by the browser decoder. This is not a DPI or
  metadata preservation tool.

## Upscaling behavior

- Upscaling **resamples pixels with the browser Canvas interpolator**. It adds
  pixels; it does not reconstruct detail that the original does not contain.
  This is not a machine-learning super-resolution tool.
- `upscaleImage()` computes the largest allowed edge from three caps, then finds
  the largest resolution whose actual encoded Blob fits the target:

  | Cap | Value |
  | --- | --- |
  | Enlargement factor | **4×** per side |
  | Total pixels | **16 megapixels** |
  | Longest side | **8,192 pixels** |
  | Target size | **10,000 KB (10 MB)** |

- It first encodes at the maximum allowed edge. If that fits the target, it is
  used. Otherwise it binary-searches integer edge lengths for at most **8
  iterations**, keeping only candidates whose encoded Blob fits. The bound keeps
  a 16 MP upscale from spending an unbounded number of full-resolution encodes,
  and it lands within roughly a dozen pixels of the best edge.
- The search encodes at a **quality floor of 0.8** so that resolution is not
  bought by destroying image quality. Once the resolution is fixed,
  `findBestQuality()` raises quality back up within the same budget.
  PNG is encoded losslessly and has no quality step.
- Aspect ratio is preserved, subject to integer-pixel rounding.
- A target above **10,000 KB** is rejected for upscaling before processing
  starts, with an inline field error. The same target is still valid for
  compressing a larger input, up to the 50,000 KB field maximum.
- When the result stops at a cap, the notes say **"Maximum allowed enlargement
  reached"** and the file can be well under the requested size. A 20 × 10 input
  reaches only 80 × 40, no matter how large the target is.
- An input already at or above 16 MP or 8,192 pixels per side cannot be enlarged
  at all and returns an explanatory error instead of a silent no-op.

## Limits and privacy

- One `.jpg`, `.jpeg`, `.jfif`, `.png`, or `.webp` file at a time. Extensions are
  case-insensitive. File signatures must match the extension, and decoding must
  succeed; renaming a PNG to `.jpg` does not make it acceptable. Missing or
  inaccurate OS MIME types are normalized from the inspected bytes.
- **Still images only.** PNG animation chunks (APNG, including files named `.png`)
  and animated WebP containers are detected and rejected with an explanation;
  animations are never silently reduced to a single frame. GIF, AVIF, HEIC/HEIF,
  BMP, SVG, and other formats are not supported in this version.
- Maximum input: **50 MB** and **40 megapixels**. Browser/device memory limits
  can still prevent some large images from opening.
- To bound canvas memory, re-encoded images above **16 megapixels** or **8,192
  pixels on one side** are initially scaled down. The resulting dimensions are
  shown in the results. The same ceiling bounds upscaling.
- Upscaling is additionally capped at **4× per side** and a **10 MB** target.
- Extremely small budgets that cannot hold even a 1×1 output image return an error.
- Cancel takes effect between asynchronous encoding operations; an in-flight
  browser decode or encode cannot be interrupted immediately.
- Images are only read through local File/Blob URLs. There are no `fetch`, XHR,
  uploads, tracking requests, external fonts, or third-party resources.
- GitHub Pages (or a local static server) serves the site files, not image data.
  Processing continues offline once the page assets have loaded. An offline
  reload is not guaranteed; there is no service worker.
- Modern Chrome/Edge, Firefox, and Safari support the required APIs. Mobile
  device behavior and image encoding results can vary.

## Structure

```text
index.html                 Accessible English UI, relative asset paths
css/styles.css             Responsive styles, no external fonts
assets/favicon.svg         Small vector brand mark
js/image-formats.js        inspectImageFile: signatures and animation checks
js/image-utils.js          loadImage, formatFileSize, resizeImage,
                          encodeImage, outputFileName, downloadBlob, output formats
js/image-processor.js      getProcessingMode, findBestQuality, compressImage,
                          upscaleImage, processImage
js/app.js                  File selection, UI state, validation, results
tests/browser_check.py     Optional real-browser integration checks
.nojekyll                  Skip Jekyll processing on GitHub Pages
```

Add future image tools as separate scripts alongside `image-processor.js` and
reuse `image-utils.js`. Keep format-specific encoding separate from UI state.

## Browser checks (optional development dependencies)

The site itself needs no installation. To run the integration checks:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install playwright Pillow
python -m playwright install chromium firefox
python tests/browser_check.py
```

On Linux, Playwright may need browser system packages; its installation output
identifies any missing libraries. The test starts and stops its own static server
on an available loopback port and generates JPEG/JFIF, PNG, and WebP fixtures in a
temporary directory. It checks actual JPG/PNG/WebP formats, downloaded bytes and dimensions, preset
size limits, transparent and partially transparent pixels, palette PNG, animation
rejection, incorrect file signatures and MIME types, automatic resizing, upscaling
with its 4× / 16 MP / 10 MB caps, mode-dependent button labels and file names,
invalid input, cancellation, EXIF orientation, local file access, offline
processing, and desktop/mobile overflow. Cross-format PNG/WebP alpha preservation and JPG white
backgrounds are checked using decoded output pixels. Screenshots are
written to `test-results/` (ignored by Git).

Run one browser with `python tests/browser_check.py --browser chromium` or
`--browser firefox`.

## GitHub Pages

For `https://describean.github.io/`, use the **describean/describean.github.io**
repository. Keep `index.html` and `.nojekyll` in its root.

After committing and pushing the site files:

1. Open the repository's **Settings → Pages**.
2. Set **Source → Deploy from a branch**.
3. Select **main** and **/ (root)**, then **Save**.
4. Wait for the Pages deployment shown in **Actions** to finish.
5. Open **https://describean.github.io/**.

No custom GitHub Actions workflow is needed. Paths are relative, so the files
also work under a project subdirectory or another static host.

## Implementation references

- [Canvas toBlob and JPEG quality](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob)
- [PNG and APNG container specification](https://www.w3.org/TR/png-3/)
- [WebP container and animation flags](https://developers.google.com/speed/webp/docs/riff_container)
- [GitHub Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
