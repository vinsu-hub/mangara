"""
End-to-end check for alignment snapping, ruler guides, and the font wiring.

    python scripts/with_server.py --server "npx next dev -p 3001" --port 3001 \
        -- python tests/snapping.spec.py

Idempotent: every panel and guide it creates is removed before it exits.
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


def geom(page):
    """X/Y/W/H of the current selection, from the Inspector."""
    return [int(page.locator("input[type=number]").nth(i).input_value()) for i in range(4)]


def draw(page, ox, oy, x1, y1, x2, y2):
    page.get_by_title("Panel (P)").click()
    page.wait_for_timeout(250)
    page.mouse.move(ox + x1, oy + y1)
    page.mouse.down()
    page.mouse.move(ox + (x1 + x2) / 2, oy + (y1 + y2) / 2, steps=6)
    page.mouse.move(ox + x2, oy + y2, steps=6)
    page.mouse.up()
    page.wait_for_timeout(600)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 950})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE, timeout=30_000)
    page.wait_for_load_state("networkidle")
    page.fill("#email", EMAIL)
    page.fill("#password", PASSWORD)
    with page.expect_navigation(wait_until="networkidle", timeout=30_000):
        page.locator("#password").press("Enter")
    page.wait_for_selector("canvas.lower-canvas", timeout=20_000)
    print("auth: OK")

    # --- font wiring --------------------------------------------------------
    # Guards the bug where --font-sans referenced itself and every screen
    # silently fell back to the browser's default serif.
    family = page.evaluate("() => getComputedStyle(document.body).fontFamily")
    assert "Inter" in family, f"expected Inter to be applied, got {family!r}"
    mono = page.evaluate(
        "() => { const el=document.querySelector('input[type=number]');"
        " return el ? getComputedStyle(el).fontFamily : ''; }"
    )
    print(f"font: body is {family.split(',')[0]}")

    # Work on a page of our own. Isolation beats cleanup here: the reload
    # further down wipes the undo stack, so anything created before it can't
    # be undone, and blanket-deleting would take the workspace's panels with
    # it. Deleting the page at the end removes its panels and guides too.
    settled(page)
    page.get_by_role("button", name=re.compile(r"^\s*Page\s*$")).click()
    page.wait_for_timeout(2000)
    base = settled(page)
    assert base == 0, f"new page should start empty, had {base}"
    own_page = int(
        page.get_by_text(re.compile(r"^Page \d+$")).first.inner_text().split()[1]
    )
    box = page.locator("canvas.lower-canvas").bounding_box()
    ox, oy = box["x"], box["y"]
    print(f"setup: created an isolated page (page {own_page})")

    # Alignment only, so the grid can't be what produces the match.
    if page.get_by_title("Snap to grid (S)").get_attribute("aria-pressed") == "true":
        page.get_by_title("Snap to grid (S)").click()
    expect(page.get_by_title("Align to other panels (A)")).to_have_attribute(
        "aria-pressed", "true"
    )
    page.wait_for_timeout(300)

    # --- two panels, deliberately misaligned --------------------------------
    draw(page, ox, oy, 300, 200, 500, 320)
    a_x = geom(page)[0]
    draw(page, ox, oy, 360, 400, 560, 520)
    b_before = geom(page)[0]
    assert layer_count(page) == base + 2, "expected two new panels"
    assert b_before != a_x, "panels started aligned; the test proves nothing"
    print(f"setup: panel A x={a_x}, panel B x={b_before}")

    # --- drag B so its left edge lands ~3px from A's, and let snap finish it -
    page.get_by_title("Select (V)").click()
    page.wait_for_timeout(300)
    page.mouse.move(ox + 460, oy + 460)
    page.mouse.down()
    page.mouse.move(ox + 430, oy + 460, steps=6)
    # 360 -> 303: three screen px shy of A's left edge at 300.
    page.mouse.move(ox + 403, oy + 460, steps=8)
    page.mouse.up()
    page.wait_for_timeout(800)

    b_after = geom(page)[0]
    assert b_after == a_x, (
        f"alignment snap failed: B x={b_after} did not land on A x={a_x}"
    )
    print(f"align snap: B jumped {b_before} -> {b_after}, exactly matching A")

    # --- ruler guides -------------------------------------------------------
    if page.get_by_title("Rulers (R)").get_attribute("aria-pressed") == "false":
        page.get_by_title("Rulers (R)").click()
    page.wait_for_timeout(500)

    ruler = page.get_by_label("Vertical ruler")
    expect(ruler).to_be_visible()
    rb = ruler.bounding_box()
    page.mouse.move(rb["x"] + rb["width"] / 2, oy + 300)
    page.mouse.down()
    page.mouse.move(ox + 600, oy + 300, steps=8)
    page.mouse.up()
    page.wait_for_timeout(800)

    expect(page.get_by_label("Vertical guide 1")).to_be_visible(timeout=10_000)
    print("guides: pulled a vertical guide out of the ruler")

    # --- guides persist -----------------------------------------------------
    page.wait_for_selector("text=/Saved /", timeout=20_000)
    page.reload(wait_until="networkidle")
    page.wait_for_selector("canvas.lower-canvas", timeout=20_000)
    page.wait_for_timeout(2500)
    # A reload reopens the chapter's first page, so come back to ours.
    page.get_by_label(f"Page {own_page}", exact=True).click()
    page.wait_for_timeout(2000)
    if page.get_by_title("Rulers (R)").get_attribute("aria-pressed") == "false":
        page.get_by_title("Rulers (R)").click()
        page.wait_for_timeout(500)
    expect(page.get_by_label("Vertical guide 1")).to_be_visible(timeout=10_000)
    print("guides: survived a reload")

    # --- cleanup ------------------------------------------------------------
    page.get_by_title(re.compile("Clear 1 guide")).click()
    page.wait_for_timeout(600)
    assert page.get_by_label("Vertical guide 1").count() == 0, "guide not cleared"

    # Drop the whole page, which takes its panels and guides with it.
    delete_btn = page.get_by_label(f"Delete page {own_page}", exact=True)
    delete_btn.hover()
    delete_btn.click()
    page.get_by_role("alertdialog").get_by_role(
        "button", name="Delete page"
    ).click(timeout=10_000)
    page.wait_for_timeout(1500)
    assert page.get_by_label(f"Page {own_page}", exact=True).count() == 0, (
        "the test's page was not removed"
    )
    print("cleanup: removed the test's page, panels and guides with it")

    page.screenshot(path="tests/snapping-screenshot.png")
    assert not errors, f"page errors: {errors}"
    browser.close()

print("\nSNAPPING + GUIDES + FONT OK")
