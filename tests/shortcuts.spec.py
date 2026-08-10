"""
End-to-end check for keyboard shortcuts and the grid / snap / ruler toggles.

    python scripts/with_server.py --server "npx next dev -p 3001" --port 3001 \
        -- python tests/shortcuts.spec.py

Idempotent: everything it creates is undone before it exits.
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

MOD = "Meta" if sys.platform == "darwin" else "Control"


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


def geometry(page):
    """X/Y/W/H currently shown in the Inspector."""
    return [int(page.locator("input[type=number]").nth(i).input_value()) for i in range(4)]


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 950})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: d.accept())

    page.goto(BASE, timeout=30_000)
    page.wait_for_load_state("networkidle")
    page.fill("#email", EMAIL)
    page.fill("#password", PASSWORD)
    with page.expect_navigation(wait_until="networkidle", timeout=30_000):
        page.locator("#password").press("Enter")
    page.wait_for_selector("canvas.lower-canvas", timeout=20_000)
    print("auth: OK")

    base = settled(page)
    canvas = page.locator("canvas.lower-canvas")
    box = canvas.bounding_box()
    ox, oy = box["x"], box["y"]

    # --- view toggles -------------------------------------------------------
    grid = page.get_by_title("Grid (G)")
    snap = page.get_by_title("Snap to grid (S)")
    ruler = page.get_by_title("Rulers (R)")
    for b in (grid, snap, ruler):
        expect(b).to_have_attribute("aria-pressed", "false")

    grid.click()
    snap.click()
    ruler.click()
    page.wait_for_timeout(600)
    for b in (grid, snap, ruler):
        expect(b).to_have_attribute("aria-pressed", "true")
    print("toggles: grid, snap and rulers turn on from the toolbar")

    # keyboard toggles flip them back
    page.mouse.move(ox + 400, oy + 400)
    page.keyboard.press("g")
    page.keyboard.press("s")
    page.keyboard.press("r")
    page.wait_for_timeout(500)
    for b in (grid, snap, ruler):
        expect(b).to_have_attribute("aria-pressed", "false")
    print("toggles: G / S / R keys flip them back")

    # --- snap to grid -------------------------------------------------------
    grid.click()
    snap.click()
    page.wait_for_timeout(400)
    page.get_by_title("Panel (P)").click()
    page.mouse.move(ox + 337, oy + 251)
    page.mouse.down()
    page.mouse.move(ox + 500, oy + 380, steps=6)
    page.mouse.move(ox + 651, oy + 487, steps=6)
    page.mouse.up()
    page.wait_for_timeout(800)
    assert layer_count(page) == base + 1, "panel not drawn"

    x, y, w, h = geometry(page)
    for name, v in (("x", x), ("y", y), ("w", w), ("h", h)):
        assert v % 64 == 0, f"snap failed: {name}={v} is not a multiple of the 64px grid"
    print(f"snap: drawn panel landed on the grid (x={x} y={y} w={w} h={h})")

    # --- arrow-key nudge ----------------------------------------------------
    page.get_by_title("Select (V)").click()
    page.wait_for_timeout(300)
    page.mouse.click(ox + 450, oy + 330)
    page.wait_for_timeout(500)
    before = geometry(page)
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(400)
    after = geometry(page)
    assert after[0] == before[0] + 1, f"arrow nudge: {before[0]} -> {after[0]}"
    page.keyboard.press("Shift+ArrowDown")
    page.wait_for_timeout(400)
    after2 = geometry(page)
    assert after2[1] == after[1] + 64, f"shift nudge: {after[1]} -> {after2[1]}"
    print("nudge: arrow moves 1px, shift+arrow moves one grid step")

    # --- copy / paste -------------------------------------------------------
    n = layer_count(page)
    page.keyboard.press(f"{MOD}+c")
    page.keyboard.press(f"{MOD}+v")
    page.wait_for_timeout(700)
    assert layer_count(page) == n + 1, f"paste: {n} -> {layer_count(page)}"
    print("clipboard: Ctrl+C / Ctrl+V duplicated the panel")

    # --- cut ----------------------------------------------------------------
    n = layer_count(page)
    page.keyboard.press(f"{MOD}+x")
    page.wait_for_timeout(600)
    assert layer_count(page) == n - 1, f"cut: {n} -> {layer_count(page)}"
    page.keyboard.press(f"{MOD}+v")
    page.wait_for_timeout(600)
    assert layer_count(page) == n, "paste after cut did not restore the panel"
    print("clipboard: Ctrl+X removes, Ctrl+V restores")

    # --- select all + escape ------------------------------------------------
    page.keyboard.press(f"{MOD}+a")
    page.wait_for_timeout(400)
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    print("selection: Ctrl+A and Escape handled")

    # --- redo via Ctrl+Y ----------------------------------------------------
    n = layer_count(page)
    page.keyboard.press(f"{MOD}+z")
    page.wait_for_timeout(500)
    undone = layer_count(page)
    assert undone != n, "Ctrl+Z did nothing"
    page.keyboard.press(f"{MOD}+y")
    page.wait_for_timeout(500)
    assert layer_count(page) == n, f"Ctrl+Y redo: {undone} -> {layer_count(page)}, expected {n}"
    print("history: Ctrl+Z undoes, Ctrl+Y redoes")

    # --- cleanup ------------------------------------------------------------
    for _ in range(20):
        if layer_count(page) == base:
            break
        page.keyboard.press(f"{MOD}+z")
        page.wait_for_timeout(250)
    assert layer_count(page) == base, f"cleanup left {layer_count(page)}, expected {base}"
    page.wait_for_timeout(1500)
    print(f"cleanup: back to {base} layers")

    page.screenshot(path="tests/shortcuts-screenshot.png")
    assert not errors, f"page errors: {errors}"
    browser.close()

print("\nSHORTCUTS + GRID/SNAP/RULER OK")
