"""
End-to-end check for manga panel layouting.

    python scripts/with_server.py --server "npx next dev -p 3001" --port 3001 \
        -- python tests/layout.spec.py

Covers the Panel sub-toolbar (shape modes, Split, Merge) and the page layout
templates. Idempotent: every panel it creates is undone at the end.
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


def layer_count(page) -> int:
    return int(
        page.get_by_text(re.compile(r"^\d+ layers$")).first.inner_text().split()[0]
    )


def settled(page, timeout_ms=15_000) -> int:
    waited, last = 0, None
    while waited < timeout_ms:
        cur = layer_count(page)
        if cur == last:
            return cur
        last, waited = cur, waited + 500
        page.wait_for_timeout(500)
    return last or 0


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 950})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: d.accept())  # layout replace confirmation

    page.goto(BASE, timeout=30_000)
    page.wait_for_load_state("networkidle")
    page.fill("#email", EMAIL)
    page.fill("#password", PASSWORD)
    with page.expect_navigation(wait_until="networkidle", timeout=30_000):
        page.locator("#password").press("Enter")
    page.wait_for_selector("canvas.lower-canvas", timeout=20_000)
    print("auth: OK")

    base = settled(page)

    # --- the sub-toolbar only appears with the Panel tool up ----------------
    page.get_by_title("Panel (P)").click()
    page.wait_for_timeout(400)
    for label in ["Rectangle", "Polygon", "Freeform"]:
        expect(page.get_by_role("button", name=label, exact=True)).to_be_visible()
    for label in ["Split V", "Split H", "Merge", "Layout"]:
        expect(page.get_by_role("button", name=re.compile(label))).to_be_visible()
    print("sub-toolbar: shape modes + split/merge/layout present")

    # --- apply a layout template -------------------------------------------
    page.get_by_role("button", name=re.compile("Layout")).click()
    page.wait_for_timeout(300)
    page.get_by_text("3 tiers", exact=True).click()
    page.wait_for_timeout(1200)
    after_layout = layer_count(page)
    assert after_layout == 3, f"3-tier template made {after_layout} panels, expected 3"
    print("layout: 3-tier template produced exactly 3 panels")

    # --- split ---------------------------------------------------------------
    box = page.locator("canvas.lower-canvas").bounding_box()
    page.get_by_title("Select (V)").click()
    page.wait_for_timeout(400)
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + 120)
    page.wait_for_timeout(600)
    page.get_by_title("Panel (P)").click()
    page.wait_for_timeout(400)
    page.get_by_role("button", name=re.compile("Split V")).click()
    page.wait_for_timeout(800)
    after_split = layer_count(page)
    assert after_split == 4, f"split gave {after_split} panels, expected 4"
    print("split: 3 -> 4 panels")

    # --- polygon panel ------------------------------------------------------
    page.get_by_role("button", name="Polygon", exact=True).click()
    page.wait_for_timeout(200)
    ox, oy = box["x"], box["y"]
    for pt in [(300, 620), (460, 600), (500, 720), (320, 740)]:
        page.mouse.click(ox + pt[0], oy + pt[1])
        page.wait_for_timeout(150)
    page.mouse.dblclick(ox + 320, oy + 740)
    page.wait_for_timeout(1000)
    after_poly = layer_count(page)
    assert after_poly == 5, f"polygon gave {after_poly} panels, expected 5"
    print("polygon: closed outline became a panel")

    # --- undo everything back to the starting state -------------------------
    for _ in range(12):
        if layer_count(page) == base:
            break
        page.get_by_title("Undo (Ctrl+Z)").click()
        page.wait_for_timeout(250)
    final = layer_count(page)
    assert final == base, f"undo left {final} layers, expected {base}"
    page.wait_for_timeout(1500)
    print(f"undo: restored to {base} layers")

    page.screenshot(path="tests/layout-screenshot.png")
    assert not errors, f"page errors: {errors}"
    browser.close()

print("\nPANEL LAYOUTING OK")
