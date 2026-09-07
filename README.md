# describean · JPG to target size

A small, English-language image tool. Choose one JPG/JPEG, enter a target in KB,
compress it locally, and download the result. No backend, build step, runtime
dependencies, analytics, ads, or image uploads.

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

1. Drop a JPG/JPEG into the upload area, or click **Select Image**.
2. Review its name, oriented pixel dimensions, and original file size.
3. Enter a whole number from **1 to 50,000 KB**, or choose 50 / 100 / 200 / 500 KB.
4. Click **Compress Image**. You can cancel while it is processing.
5. Review the preview, actual size, reduction, and before/after resolution.
6. Click **Download Image** to save `original-name-compressed.jpg`.

The default target is **200 KB**. **1 KB = 1,000 bytes** and **1 MB = 1,000,000
bytes** throughout the app. This is a conservative byte budget for upload forms
that instead interpret KB as 1,024 bytes. Display sizes are rounded; the actual
download is checked against the exact byte limit.

## Compression behavior

- A file already at or below the target is returned unchanged, with its original
  pixels and metadata. It is downloaded with the `-compressed.jpg` filename.
- At each resolution, `findBestJPEGQuality()` tests quality 0.1 and 1.0, then
  performs **10 binary search iterations** if the target falls between them. It
  keeps the highest tested quality whose actual encoded Blob fits the budget.
- If quality 0.1 still exceeds the limit, `compressJPEG()` reduces dimensions by
  a factor of **0.9** and searches again. The aspect ratio is retained, subject to
  integer-pixel rounding. Each resize is drawn from the decoded original.
- This policy prioritizes resolution until the quality floor is reached. It is
  a practical heuristic, not a guarantee of the best perceptual quality across
  every possible quality/resolution combination.
- Browser JPEG encoders quantize quality and produce different results. Files
  can be smaller than the requested size; the limit is a ceiling, not an exact
  output size.
- Re-encoding uses the browser Canvas JPEG encoder. Source EXIF metadata is not
  copied; orientation is applied by the browser decoder. This is not a DPI or
  metadata preservation tool.

## Limits and privacy

- One `.jpg` or `.jpeg` file at a time. Both the JPEG signature and successful
  decoding are required; renaming a PNG to `.jpg` does not make it acceptable.
- Maximum input: **50 MB** and **40 megapixels**. Browser/device memory limits
  can still prevent some large images from opening.
- To bound canvas memory, re-encoded images above **16 megapixels** or **8,192
  pixels on one side** are initially scaled down. The resulting dimensions are
  shown in the results. Original files already within the target bypass canvas.
- Extremely small budgets that cannot hold even a 1×1 JPEG return an error.
- Cancel takes effect between asynchronous encoding operations; an in-flight
  browser decode or encode cannot be interrupted immediately.
- Images are only read through local File/Blob URLs. There are no `fetch`, XHR,
  uploads, tracking requests, external fonts, or third-party resources.
- GitHub Pages (or a local static server) serves the site files, not image data.
  Processing continues offline once the page assets have loaded. An offline
  reload is not guaranteed; there is no service worker.
- Modern Chrome/Edge, Firefox, and Safari support the required APIs. Mobile
  device behavior and JPEG encoding results can vary.

## Structure

```text
index.html                 Accessible English UI, relative asset paths
css/styles.css             Responsive styles, no external fonts
assets/favicon.svg         Small vector brand mark
js/image-utils.js          loadImage, formatFileSize, resizeImage,
                          encodeJPEG, compressedFileName, downloadBlob
js/jpeg-compressor.js      findBestJPEGQuality, compressJPEG
js/app.js                  File selection, UI state, validation, results
tests/browser_check.py     Optional real-browser integration checks
.nojekyll                  Skip Jekyll processing on GitHub Pages
```

Add future image tools as separate scripts alongside `jpeg-compressor.js` and
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
on an available loopback port and generates its JPEG fixtures in a temporary
directory. It checks real downloaded JPEG bytes and dimensions, the preset size
limits, automatic resizing, invalid input, cancellation, EXIF orientation, local
file access, offline processing, and desktop/mobile overflow. Screenshots are
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
- [GitHub Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
