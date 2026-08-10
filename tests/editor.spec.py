"""
End-to-end check for the Mangara editor.

Usage:
    python scripts/with_server.py --server "npx next dev -p 3001" --port 3001 \
        -- python tests/editor.spec.py

Requires MANGARA_TEST_EMAIL / MANGARA_TEST_PASSWORD for an existing confirmed
account (create one with `node scripts/create-test-user.mjs`).
"""

import os
import sys
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("MANGARA_BASE_URL", "http://localhost:3001")
EMAIL = os.environ.get("MANGARA_TEST_EMAIL")
PASSWORD = os.environ.get("MANGARA_TEST_PASSWORD")

if not EMAIL or not PASSWORD:
    sys.exit("Set MANGARA_TEST_EMAIL and MANGARA_TEST_PASSWORD first.")


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
    print("auth: OK")

    # --- editor loads -------------------------------------------------------
    page.wait_for_selector("canvas.lower-canvas", timeout=20_000)
    for tool in ["Select", "Pan", "Panel", "Pen", "Shape", "Text", "Bubble", "SFX"]:
        expect(page.get_by_title(tool, exact=False).first).to_be_visible()
    print("toolbar: all 8 tools present")

    # --- draw a panel -------------------------------------------------------
    page.get_by_title("Panel (P)").click()
    box = page.locator("canvas.lower-canvas").bounding_box()
    ox, oy = box["x"], box["y"]
    drag(page, ox + 380, oy + 220, ox + 700, oy + 470)
    page.wait_for_timeout(600)

    expect(page.get_by_text("1 layers")).to_be_visible()
    print("panel created")

    # --- inspector reflects geometry ---------------------------------------
    expect(page.get_by_text("GEOMETRY")).to_be_visible()
    w_before = page.locator("input[type=number]").nth(2).input_value()
    assert int(w_before) > 0, f"expected non-zero width, got {w_before}"
    print(f"inspector: geometry bound (w={w_before})")

    # --- edit geometry from the inspector -----------------------------------
    x_field = page.locator("input[type=number]").first
    x_field.fill("120")
    x_field.press("Tab")
    page.wait_for_timeout(400)
    assert x_field.input_value() == "120"
    print("inspector: geometry editable")

    # --- autosave + persistence across reload -------------------------------
    page.wait_for_selector("text=/Saved /", timeout=15_000)
    print("autosave: saved")

    page.reload(wait_until="networkidle")
    page.wait_for_selector("canvas.lower-canvas", timeout=20_000)
    page.wait_for_timeout(1500)
    expect(page.get_by_text("1 layers")).to_be_visible()
    print("persistence: panel survived reload")

    page.screenshot(path="tests/editor-screenshot.png")

    assert not errors, f"page errors: {errors}"
    browser.close()

print("\nALL CHECKS PASSED")
