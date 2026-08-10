"""
End-to-end check for the Mangara editor.

    python scripts/with_server.py --server "npx next dev -p 3001" --port 3001 \
        -- python tests/editor.spec.py

Needs MANGARA_TEST_EMAIL / MANGARA_TEST_PASSWORD for a confirmed account
(create one with `node --env-file=.env.local scripts/create-test-user.mjs`).

The test is idempotent: it asserts on layer-count *deltas* rather than absolute
counts, and deletes the layer it created, so repeated runs neither accumulate
panels nor depend on a clean database.
"""

import os
import re
import sys
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("MANGARA_BASE_URL", "http://localhost:3001")
EMAIL = os.environ.get("MANGARA_TEST_EMAIL")
PASSWORD = os.environ.get("MANGARA_TEST_PASSWORD")

if not EMAIL or not PASSWORD:
    sys.exit("Set MANGARA_TEST_EMAIL and MANGARA_TEST_PASSWORD first.")

STATUS = "div.ml-auto.text-xs"


def layer_count(page) -> int:
    text = page.get_by_text(re.compile(r"^\d+ layers$")).first.inner_text()
    return int(text.split()[0])


def settled_layer_count(page, timeout_ms: int = 15_000) -> int:
    """
    Layers arrive from an async fetch after the canvas mounts, so reading the
    count too early yields a baseline that's still climbing. Poll until it
    holds steady across two consecutive reads.
    """
    waited, last = 0, None
    while waited < timeout_ms:
        current = layer_count(page)
        if current == last:
            return current
        last = current
        page.wait_for_timeout(500)
        waited += 500
    return last if last is not None else 0


def drag(page, x1, y1, x2, y2):
    page.mouse.move(x1, y1)
    page.mouse.down()
    page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, steps=6)
    page.mouse.move(x2, y2, steps=6)
    page.mouse.up()


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 950})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    # --- auth ---------------------------------------------------------------
    page.goto(BASE, timeout=30_000)
    page.wait_for_load_state("networkidle")
    assert "/login" in page.url, f"expected redirect to /login, got {page.url}"

    page.fill("#email", EMAIL)
    page.fill("#password", PASSWORD)
    with page.expect_navigation(wait_until="networkidle", timeout=30_000):
        page.locator("#password").press("Enter")
    assert page.url.rstrip("/") == BASE.rstrip("/"), f"sign-in landed on {page.url}"
    print("auth: signed in and reached the workspace")

    # --- editor loads -------------------------------------------------------
    page.wait_for_selector("canvas.lower-canvas", timeout=20_000)
    for tool in ["Select", "Pan", "Panel", "Pen", "Shape", "Text", "Bubble", "SFX"]:
        expect(page.get_by_title(tool, exact=False).first).to_be_visible()
    print("toolbar: all 8 tools rendered")

    before = settled_layer_count(page)

    # --- draw a panel -------------------------------------------------------
    page.get_by_title("Panel (P)").click()
    box = page.locator("canvas.lower-canvas").bounding_box()
    ox, oy = box["x"], box["y"]
    drag(page, ox + 380, oy + 220, ox + 700, oy + 470)
    page.wait_for_timeout(600)

    assert layer_count(page) == before + 1, "drawing a panel did not add a layer"
    print(f"canvas: panel drawn ({before} -> {before + 1} layers)")

    # --- inspector is bound to the selection --------------------------------
    expect(page.get_by_text("GEOMETRY")).to_be_visible()
    width = int(page.locator("input[type=number]").nth(2).input_value())
    assert width > 0, f"expected non-zero width, got {width}"
    print(f"inspector: geometry bound to selection (w={width})")

    # --- editing a field drives the canvas ----------------------------------
    x_field = page.locator("input[type=number]").first
    x_field.fill("120")
    x_field.press("Tab")
    page.wait_for_timeout(400)
    assert x_field.input_value() == "120", "geometry field did not accept edit"
    print("inspector: geometry editable")

    # --- autosave -----------------------------------------------------------
    expect(page.locator(STATUS)).to_have_text(re.compile(r"^Saved "), timeout=20_000)
    print("autosave: persisted")

    # --- survives a reload --------------------------------------------------
    page.reload(wait_until="networkidle")
    page.wait_for_selector("canvas.lower-canvas", timeout=20_000)
    assert settled_layer_count(page) == before + 1, "panel did not survive reload"
    print("persistence: panel reloaded from the database")

    # --- undo/redo ----------------------------------------------------------
    page.get_by_title("Panel (P)").click()
    drag(page, ox + 780, oy + 240, ox + 980, oy + 420)
    page.wait_for_timeout(400)
    assert layer_count(page) == before + 2
    page.get_by_title("Undo (Ctrl+Z)").click()
    page.wait_for_timeout(300)
    assert layer_count(page) == before + 1, "undo did not remove the new panel"
    print("undo: removed the new panel")

    # --- layers tab ---------------------------------------------------------
    page.get_by_role("button", name="layers", exact=True).click()
    page.wait_for_timeout(300)
    expect(page.get_by_role("button", name=re.compile("panel")).first).to_be_visible()
    print("layers: panel listed")

    # --- cleanup: delete what this run created ------------------------------
    page.get_by_role("button", name=re.compile("panel")).first.click()
    page.wait_for_timeout(200)
    page.get_by_title("Delete").click()
    page.wait_for_timeout(300)
    assert layer_count(page) == before, "cleanup did not restore the original count"
    expect(page.locator(STATUS)).to_have_text(re.compile(r"^Saved "), timeout=20_000)
    print(f"cleanup: back to {before} layers and saved")

    page.screenshot(path="tests/editor-screenshot.png")

    assert not errors, f"page errors: {errors}"
    browser.close()

print("\nALL CHECKS PASSED")
