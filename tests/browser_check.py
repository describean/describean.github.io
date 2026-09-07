"""Real image/browser integration checks; no dependencies are served to site users."""
import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import io
from pathlib import Path
import random
import tempfile
import threading

from PIL import Image
from PIL.PngImagePlugin import PngInfo
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "test-results"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def fixtures(directory):
    rng = random.Random(42)
    photo = directory / "test-photo.JPEG"
    Image.frombytes("RGB", (1600, 1200), rng.randbytes(1600 * 1200 * 3)).save(photo, quality=95)
    large = directory / "large.jpg"
    Image.frombytes("RGB", (4000, 3000), rng.randbytes(4000 * 3000 * 3)).save(large, quality=90)
    tiny = directory / "tiny.jpg"
    Image.new("RGB", (20, 10), "#5588cc").save(tiny)
    portrait = directory / "oriented.jpg"
    image = Image.new("RGB", (120, 80), "red")
    image.paste("blue", (60, 0, 120, 80))
    exif = Image.Exif()
    exif[274] = 6  # 90 degrees clockwise: output should be 80×120, red above blue.
    exif[37510] = b"A" * 2000
    image.save(portrait, quality=95, exif=exif)
    disguised = directory / "not-a-jpeg.jpg"
    Image.new("RGB", (20, 20), "green").save(disguised, format="PNG")
    damaged = directory / "damaged.jpg"
    damaged.write_bytes(b"\xff\xd8\xff\xe0broken")
    png = directory / "test.graphic.PNG"
    webp = directory / "test-photo.WebP"
    jfif = directory / "test-photo.JFIF"
    jfif.write_bytes(photo.read_bytes())
    metadata = PngInfo()
    metadata.add_text("Description", "acTL fcTL fdAT ANIM ANMF in text are not animation chunks.")
    with Image.open(photo) as original:
        original.save(png, pnginfo=metadata)
        original.save(webp, quality=90)
    transparent = Image.new("RGBA", (120, 80), (0, 0, 0, 0))
    transparent.paste((255, 0, 0, 255), (40, 20, 80, 60))
    transparent.paste((0, 0, 255, 128), (5, 20, 25, 60))
    alpha_png = directory / "transparent.png"
    alpha_webp = directory / "transparent.webp"
    transparent.save(alpha_png, pnginfo=metadata)
    transparent.save(alpha_webp, lossless=True, xmp=b"ANIM ANMF in metadata are not animation chunks.")
    palette_png = directory / "palette.png"
    palette = Image.new("P", (120, 80), 0)
    palette.putpalette([0, 0, 0, 255, 0, 0, 0, 0, 255] + [0] * (768 - 9))
    palette.paste(1, (40, 20, 80, 60))
    palette.paste(2, (5, 20, 25, 60))
    palette.save(palette_png, transparency=bytes([0, 255, 128]))
    animated_png = directory / "animated.png"
    animated_webp = directory / "animated.webp"
    frames = [Image.new("RGBA", (80, 60), color) for color in ["red", "blue"]]
    frames[0].save(animated_png, save_all=True, append_images=frames[1:], duration=100, loop=0)
    frames[0].save(animated_webp, save_all=True, append_images=frames[1:], duration=100, loop=0, lossless=True)
    damaged_png = directory / "damaged.png"
    damaged_png.write_bytes(alpha_png.read_bytes()[:-8])
    damaged_webp = directory / "damaged.webp"
    damaged_webp.write_bytes(alpha_webp.read_bytes()[:-8])
    return {"photo": photo, "large": large, "tiny": tiny,
            "portrait": portrait, "disguised": disguised, "damaged": damaged,
            "png": png, "webp": webp, "jfif": jfif,
            "alpha_png": alpha_png, "alpha_webp": alpha_webp, "palette_png": palette_png,
            "animated_png": animated_png, "animated_webp": animated_webp,
            "damaged_png": damaged_png, "damaged_webp": damaged_webp}


def choose(page, path):
    page.locator("#file-input").set_input_files(str(path))
    expect(page.locator("#file-name")).to_have_text(path.name)
    expect(page.locator("#compress-button")).to_be_enabled()


def compress_and_download(page, target, expected_name, *, preset=False, output_format="jpeg"):
    page.locator("#output-format").select_option(output_format)
    if preset:
        page.locator(f'[data-target="{target}"]').click()
    else:
        page.locator("#target-size").fill(str(target))
    page.locator("#compress-button").click()
    expect(page.locator("#result")).to_be_visible(timeout=120_000)
    expect(page.locator("#error-message")).to_be_hidden()
    with page.expect_download() as download_info:
        page.locator("#download-button").click()
    download = download_info.value
    assert download.suggested_filename == expected_name, download.suggested_filename
    data = Path(download.path()).read_bytes()
    assert 0 < len(data) <= target * 1000, (target, len(data))
    with Image.open(io.BytesIO(data)) as image:
        assert image.format == {"jpeg": "JPEG", "png": "PNG", "webp": "WEBP"}[output_format]
        image.load()
        dimensions = image.size
    return data, dimensions


def assert_no_overflow(page):
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Horizontal overflow"


def run_browser(playwright, name, base_url, files):
    browser = getattr(playwright, name).launch()
    print(f"Testing {name} {browser.version}", flush=True)
    context = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
    page = context.new_page()
    page.set_default_timeout(15_000)
    errors = []
    requests = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: requests.append((request.method, request.url)))
    page.goto(base_url)
    expect(page.locator("#compress-button")).to_be_disabled()
    expect(page.locator("#target-size")).to_have_value("200")
    expect(page.locator('[data-target="200"]')).to_have_attribute("aria-pressed", "true")
    expect(page.locator("#page-title")).to_contain_text("Compress images")
    expect(page.locator("#output-format")).to_have_value("jpeg")
    expect(page.locator("#file-help")).to_contain_text("JPG / JPEG / JFIF / PNG / WebP")
    assert_no_overflow(page)
    page.screenshot(path=str(OUTPUT / f"{name}-desktop.png"), full_page=True)
    page.wait_for_load_state("networkidle")
    requests.clear()

    # Actual encoder output: preset budgets, fixed resolution and resize fallback.
    choose(page, files["photo"])
    for target in [500, 200, 100, 50, 1]:
        data, (width, height) = compress_and_download(
            page, target, "test-photo-compressed.jpg", preset=target != 1)
        assert width <= 1600 and height <= 1200
        assert abs(width - height * 4 / 3) <= 2
        if target == 500:
            assert (width, height) == (1600, 1200)
            page.screenshot(path=str(OUTPUT / f"{name}-result.png"), full_page=True)
        if target == 50:
            assert width < 1600 and height < 1200
        print(f"  {target} KB: {len(data)} bytes, {width}×{height}", flush=True)

    # A result for an old target must immediately disappear when the input changes.
    for value in ["", "0", "-1", "0.5", "50001"]:
        page.locator("#target-size").fill(value)
        page.locator("#compress-button").click()
        expect(page.locator("#target-error")).to_be_visible()
        expect(page.locator("#result")).to_be_hidden()
        expect(page.locator("#target-size")).to_have_attribute("aria-invalid", "true")
    page.locator('[data-target="200"]').click()
    expect(page.locator("#target-error")).to_be_hidden()

    # Already-small input is downloaded byte-for-byte, without lossy re-encoding.
    choose(page, files["tiny"])
    data, size = compress_and_download(page, 200, "tiny-compressed.jpg")
    assert data == files["tiny"].read_bytes()
    assert size == (20, 10)
    expect(page.locator("#result-reduction")).to_have_text("0.0%")

    # All new inputs must produce true JPEG output at the requested byte ceiling.
    for key in ["png", "webp", "jfif"]:
        choose(page, files[key])
        for target in [200, 50]:
            data, (width, height) = compress_and_download(
                page, target, f"{files[key].stem}-compressed.jpg")
            assert width <= 1600 and height <= 1200
            assert abs(width - height * 4 / 3) <= 2
            print(f"  {key.upper()} → JPG, {target} KB: {len(data)} bytes, {width}×{height}", flush=True)

    # Small PNG/WebP inputs must still convert; test alpha and palette transparency.
    for key in ["alpha_png", "alpha_webp", "palette_png"]:
        choose(page, files[key])
        assert files[key].stat().st_size < 200_000
        data, size = compress_and_download(page, 200, f"{files[key].stem}-compressed.jpg")
        assert size == (120, 80)
        assert len(data) > files[key].stat().st_size  # Conversion can enlarge a small input.
        expect(page.locator("#result-change-label")).to_have_text("Size increase")
        expect(page.locator("#result-note")).to_contain_text("still within your target size")
        expect(page.locator("#status")).not_to_contain_text("smaller")
        with Image.open(io.BytesIO(data)) as flattened:
            assert min(flattened.getpixel((10, 10))) >= 245  # Transparent → white.
            red = flattened.getpixel((60, 40))
            assert red[0] > 240 and red[1] < 15 and red[2] < 15
            blue = flattened.getpixel((15, 40))
            assert 110 < blue[0] < 145 and 110 < blue[1] < 145 and blue[2] > 240
    print("  Transparency: RGBA PNG, palette PNG, and WebP flattened to white", flush=True)

    # Every supported input can be exported as each output format, with real byte limits.
    for key in ["photo", "png", "webp", "jfif"]:
        choose(page, files[key])
        for output_format in ["png", "webp"]:
            data, size = compress_and_download(page, 50, f"{files[key].stem}-compressed.{output_format}", output_format=output_format)
            assert size[0] <= 1600 and size[1] <= 1200
            print(f"  {key} → {output_format}: {len(data)} bytes, {size[0]}×{size[1]}", flush=True)
    # Cross-format alpha encoding, not merely same-format passthrough.
    for key, output_format in [("alpha_png", "webp"), ("alpha_webp", "png"), ("palette_png", "webp")]:
        choose(page, files[key])
        data, size = compress_and_download(page, 200, f"{files[key].stem}-compressed.{output_format}", output_format=output_format)
        assert size == (120, 80)
        with Image.open(io.BytesIO(data)) as converted:
            rgba = converted.convert("RGBA")
            assert rgba.getpixel((10, 10))[3] == 0
            assert 120 <= rgba.getpixel((15, 40))[3] <= 135
            assert rgba.getpixel((60, 40))[3] == 255
    page.locator("#output-format").select_option("jpeg")
    expect(page.locator("#result")).to_be_hidden()
    expect(page.locator("#output-note")).to_contain_text("become white")

    # JFIF with an unhelpful OS MIME type still uses the JPEG passthrough correctly.
    page.locator("#file-input").set_input_files({
        "name": "tiny.JFIF", "mimeType": "application/octet-stream", "buffer": files["tiny"].read_bytes(),
    })
    expect(page.locator("#file-name")).to_have_text("tiny.JFIF")
    expect(page.locator("#compress-button")).to_be_enabled()
    data, _ = compress_and_download(page, 200, "tiny-compressed.jpg")
    assert data == files["tiny"].read_bytes()
    expect(page.locator("#result-change-label")).to_have_text("Reduction")
    expect(page.locator("#result-reduction")).to_have_text("0.0%")

    # Cancel a 12 MP encode, then verify the same image can still be compressed.
    choose(page, files["large"])
    page.locator('[data-target="50"]').click()
    page.locator("#compress-button").click()
    expect(page.locator("#target-size")).to_be_disabled()
    expect(page.locator("#output-format")).to_be_disabled()
    page.locator("#cancel-button").click()
    expect(page.locator("#status")).to_contain_text("cancelled", timeout=30_000)
    expect(page.locator("#result")).to_be_hidden()
    expect(page.locator("#compress-button")).to_be_enabled()
    data, size = compress_and_download(page, 200, "large-compressed.jpg")
    assert size[0] < 4000
    print(f"  12 MP: {len(data)} bytes, {size[0]}×{size[1]}", flush=True)

    # EXIF rotation must be reflected in dimensions and actual output pixels.
    choose(page, files["portrait"])
    expect(page.locator("#file-details")).to_contain_text("80 × 120")
    data, size = compress_and_download(page, 1, "oriented-compressed.jpg")
    assert size == (80, 120), size
    with Image.open(io.BytesIO(data)) as oriented:
        top = oriented.getpixel((40, 20))
        bottom = oriented.getpixel((40, 100))
        assert top[0] > top[2] + 80 and bottom[2] > bottom[0] + 80, (top, bottom)

    # Invalid selection clears stale results and leaves the UI recoverable.
    for key in ["disguised", "damaged", "damaged_png", "damaged_webp", "animated_png", "animated_webp"]:
        page.locator("#file-input").set_input_files(str(files[key]))
        expect(page.locator("#error-message")).to_be_visible()
        expect(page.locator("#result")).to_be_hidden()
        expect(page.locator("#compress-button")).to_be_disabled()
        expect(page.locator("#drop-zone")).to_be_enabled()
        if key.startswith("animated"):
            expect(page.locator("#error-message")).to_contain_text("Animated images are not supported")
    page.locator("#file-input").set_input_files({
        "name": "wrong.gif", "mimeType": "image/gif", "buffer": b"GIF89a",
    })
    expect(page.locator("#error-message")).to_contain_text("JPG, JPEG, JFIF, PNG, or WebP")

    # Exercise an actual DataTransfer/drop handler with the fixture's JPEG bytes.
    page.evaluate("""({bytes, name}) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], name, {type: 'image/jpeg'}));
      document.querySelector('#drop-zone').dispatchEvent(new DragEvent('drop', {
        bubbles: true, cancelable: true, dataTransfer: transfer
      }));
    }""", {"bytes": list(files["tiny"].read_bytes()), "name": "dropped.jpg"})
    expect(page.locator("#file-name")).to_have_text("dropped.jpg")
    expect(page.locator("#compress-button")).to_be_enabled()
    compress_and_download(page, 100, "dropped-compressed.jpg")

    # New input formats also work through drop, with missing MIME type information.
    for key in ["alpha_png", "alpha_webp"]:
        page.evaluate("""({bytes, name}) => {
          const transfer = new DataTransfer();
          transfer.items.add(new File([new Uint8Array(bytes)], name));
          document.querySelector('#drop-zone').dispatchEvent(new DragEvent('drop', {
            bubbles: true, cancelable: true, dataTransfer: transfer
          }));
        }""", {"bytes": list(files[key].read_bytes()), "name": files[key].name})
        expect(page.locator("#file-name")).to_have_text(files[key].name)
        expect(page.locator("#compress-button")).to_be_enabled()
        compress_and_download(page, 100, f"{files[key].stem}-compressed.jpg")

    # All image work so far must have made zero HTTP requests after page load.
    assert not [(method, url) for method, url in requests if url.startswith(("http:", "https:"))], requests
    context.set_offline(True)
    choose(page, files["webp"])
    compress_and_download(page, 137, "test-photo-compressed.jpg")
    context.set_offline(False)

    # Mobile layout and result controls at narrow widths, including 320 px.
    for width in [320, 390, 768]:
        page.set_viewport_size({"width": width, "height": 844})
        assert_no_overflow(page)
    page.set_viewport_size({"width": 390, "height": 844})
    page.screenshot(path=str(OUTPUT / f"{name}-mobile-result.png"), full_page=True)
    page.reload()
    page.screenshot(path=str(OUTPUT / f"{name}-mobile.png"), full_page=True)
    assert_no_overflow(page)

    # No server, imports, or network are needed for the direct-open workflow.
    page.goto((ROOT / "index.html").as_uri())
    choose(page, files["png"])
    compress_and_download(page, 200, "test.graphic-compressed.jpg")
    assert not errors, errors
    context.close()
    browser.close()
    print(f"PASS {name}: all inputs → JPG/PNG/WebP, limits, alpha, animation rejection, downloads, resize, validation, cancel, EXIF, drop, offline, file://, responsive", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--browser", choices=["all", "chromium", "firefox"], default="all")
    args = parser.parse_args()
    OUTPUT.mkdir(exist_ok=True)
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix="describean-fixtures-") as directory:
            files = fixtures(Path(directory))
            with sync_playwright() as playwright:
                names = ["chromium", "firefox"] if args.browser == "all" else [args.browser]
                for name in names:
                    run_browser(playwright, name, f"http://127.0.0.1:{server.server_port}/", files)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
