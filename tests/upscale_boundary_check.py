"""Check real encoder budgets near the smallest feasible enlargement."""
import base64
from pathlib import Path
import random
import tempfile

from PIL import Image
from playwright.sync_api import expect, sync_playwright

from browser_check import ROOT, choose, process_and_download


def check_boundary(page, fixture):
    encoded = base64.b64encode(fixture.read_bytes()).decode("ascii")
    for output_format in ["jpeg", "png", "webp"]:
        # Compute a real whole-KB ceiling that can fit at least one enlarged pixel.
        # This exercises browser encoder differences without hard-coding byte counts.
        measurements = page.evaluate("""async ({encoded, format}) => {
          const D = window.Describean;
          const file = new File([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))],
            'boundary.jpg', {type: 'image/jpeg'});
          const source = await D.loadImage(file);
          const canvas = D.resizeImage(source.image, 1601, 1200, undefined,
            {preserveAlpha: D.getOutputFormat(format).alpha});
          try {
            const blob = await D.encodeImage(canvas, format, format === 'png' ? undefined : 0.8);
            return {minimumBytes: blob.size, targetKB: Math.ceil(blob.size / 1000)};
          } finally {
            source.dispose();
            canvas.width = canvas.height = 0;
          }
        }""", {"encoded": encoded, "format": output_format})
        target = measurements["targetKB"]
        assert fixture.stat().st_size < target * 1000 <= 10_000_000
        choose(page, fixture)
        extension = "jpg" if output_format == "jpeg" else output_format
        data, size = process_and_download(page, target, f"boundary-upscaled.{extension}", output_format=output_format)
        assert size[0] > 1600 and size[1] >= 1200, size
        expect(page.locator("#result-note")).to_contain_text("Resolution enlarged")
        print(f"  {output_format}: {target} KB target → {len(data)} bytes, {size[0]}×{size[1]}", flush=True)

    # A truly impossible budget still rejects; the fallback must not exceed it.
    choose(page, fixture)
    page.locator("#output-format").select_option("png")
    page.locator("#target-size").fill("220")
    page.locator("#compress-button").click()
    expect(page.locator("#error-message")).to_contain_text("cannot be enlarged", timeout=120_000)
    expect(page.locator("#result")).to_be_hidden()
    expect(page.locator("#compress-button")).to_be_enabled()

    # Cancelling an upscale must restore controls without publishing a stale result.
    page.locator("#target-size").fill("2000")
    page.locator("#compress-button").click()
    page.locator("#cancel-button").click()
    expect(page.locator("#status")).to_contain_text("cancelled", timeout=30_000)
    expect(page.locator("#result")).to_be_hidden()
    expect(page.locator("#output-format")).to_be_enabled()
    expect(page.locator("#compress-button")).to_be_enabled()


def main():
    with tempfile.TemporaryDirectory(prefix="describean-boundary-") as directory:
        fixture = Path(directory) / "boundary.jpg"
        Image.frombytes("RGB", (1600, 1200), random.Random(91).randbytes(1600 * 1200 * 3)).save(fixture, quality=10)
        with sync_playwright() as playwright:
            for name in ["chromium", "firefox"]:
                browser = getattr(playwright, name).launch()
                page = browser.new_page(accept_downloads=True)
                page.set_default_timeout(15_000)
                page.goto((ROOT / "index.html").as_uri())
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                check_boundary(page, fixture)
                assert not errors, errors
                browser.close()
                print(f"PASS {name}: near-minimum JPG/PNG/WebP budgets, impossible budget, upscale cancellation", flush=True)


if __name__ == "__main__":
    main()
