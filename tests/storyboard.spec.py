"""
End-to-end check for the Story Board tab.

    python scripts/with_server.py --server "npx next dev -p 3001" --port 3001 \
        -- python tests/storyboard.spec.py

Idempotent: it creates a scene, exercises it, then deletes it, so repeated
runs neither accumulate data nor depend on a clean database.
"""

import os
import re
import sys
import time
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("MANGARA_BASE_URL", "http://localhost:3001")
EMAIL = os.environ.get("MANGARA_TEST_EMAIL")
PASSWORD = os.environ.get("MANGARA_TEST_PASSWORD")

if not EMAIL or not PASSWORD:
    sys.exit("Set MANGARA_TEST_EMAIL and MANGARA_TEST_PASSWORD first.")

# Unique per run so leftovers from an earlier failed run can never be matched
# instead of the scene under test.
TITLE = f"The Storm Intensifies {int(time.time())}"
# A page range far from anything the other suites touch, so it is reliably
# empty at the start and can be cleaned up at the end.
P0 = 500 + (int(time.time()) % 400)

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
    print("auth: OK")

    # --- open Story Board from the rail ------------------------------------
    page.get_by_role("button", name="Story Board", exact=True).click()
    expect(page.get_by_role("heading", name="STORY BOARD")).to_be_visible(timeout=20_000)
    expect(page.get_by_text("Loading story board")).to_have_count(0, timeout=20_000)
    for t in ["Chapters", "Scenes", "Beats", "Outline"]:
        expect(page.get_by_role("button", name=t, exact=True)).to_be_visible()
    print("story board: rail routes here, all 4 tabs present")

    # A default chapter exists from the project bootstrap.
    expect(page.get_by_text(re.compile(r"Chapter \d")).first).to_be_visible(timeout=15_000)

    # --- add a scene --------------------------------------------------------
    before = page.get_by_text("SCENE", exact=True).count()
    page.get_by_role("button", name=re.compile("Add Scene")).click()
    page.wait_for_timeout(1200)
    after = page.get_by_text("SCENE", exact=True).count()
    assert after == before + 1, f"scene not added ({before} -> {after})"
    print(f"scene: created ({before} -> {after})")

    # --- edit scene details -------------------------------------------------
    expect(page.get_by_text("SCENE DETAILS")).to_be_visible()
    title = page.locator("aside input").first
    title.fill(TITLE)
    title.blur()
    page.wait_for_timeout(800)

    synopsis = page.locator("aside textarea").nth(1)
    synopsis.fill("The storm grows violent. Kaito senses movement in the dark.")
    synopsis.blur()

    page.locator("aside select").first.select_option("climax")
    page.wait_for_timeout(1000)
    print("scene details: title, synopsis and act tag saved")

    # --- page range resolves against real pages -----------------------------
    page.locator("aside input[type=number]").first.fill(str(P0))
    page.locator("aside input[type=number]").nth(1).fill(str(P0 + 2))
    page.locator("aside input[type=number]").nth(1).blur()
    page.wait_for_timeout(1500)
    # Chapter 1 only has page 1, so none of 4-6 exist yet.
    expect(page.get_by_text(re.compile(r"0 of 3 pages in this range exist"))).to_be_visible(
        timeout=10_000
    )
    create = page.get_by_role("button", name=re.compile("Create the 3 missing pages"))
    expect(create).to_be_visible()
    create.click()
    page.wait_for_timeout(2500)
    expect(page.get_by_text(re.compile(r"3 of 3 pages in this range exist"))).to_be_visible(
        timeout=15_000
    )
    for label in [f"p{P0}", f"p{P0+1}", f"p{P0+2}"]:
        expect(page.get_by_role("button", name=label, exact=True)).to_be_visible()
    print(f"page range: {P0}-{P0+2} materialised as real pages")

    # opening a page jumps to the editor with that page loaded
    page.get_by_role("button", name=f"p{P0+1}", exact=True).click()
    page.wait_for_selector("canvas.lower-canvas", timeout=20_000)
    expect(page.get_by_text(f"Page {P0+1}")).to_be_visible(timeout=15_000)
    print(f"page range: opening p{P0+1} loaded it in the editor")

    page.get_by_role("button", name="Story Board", exact=True).click()
    expect(page.get_by_text("Loading story board")).to_have_count(0, timeout=20_000)
    page.wait_for_timeout(1500)
    page.get_by_text(TITLE).first.click()
    page.wait_for_timeout(800)

    # --- add a beat ---------------------------------------------------------
    page.get_by_role("button", name=re.compile("Add beat")).first.click()
    page.wait_for_timeout(1000)
    # Beats are inline-editable inputs in the details panel, so assert on value.
    beat = page.get_by_label("Beat 1", exact=True)
    expect(beat).to_have_value("New beat")
    beat.fill("Kaito walks through the village in rain.")
    beat.blur()
    page.wait_for_timeout(900)
    print("beats: added and edited inline")

    # --- persistence across reload -----------------------------------------
    page.reload(wait_until="networkidle")
    page.get_by_role("button", name="Story Board", exact=True).click()
    expect(page.get_by_text("Loading story board")).to_have_count(0, timeout=20_000)
    page.wait_for_timeout(1500)
    expect(page.get_by_text(TITLE).first).to_be_visible(timeout=15_000)
    expect(page.get_by_text("Climax").first).to_be_visible()
    expect(page.get_by_label("Beat 1", exact=True)).to_have_value(
        "Kaito walks through the village in rain."
    )
    print("persistence: scene, tag and edited beat survived reload")

    # --- outline tab reflects it -------------------------------------------
    page.get_by_role("button", name="Outline", exact=True).click()
    page.wait_for_timeout(600)
    expect(page.get_by_text(TITLE).first).to_be_visible()
    print("outline: renders the scene")

    # --- cleanup ------------------------------------------------------------
    page.get_by_role("button", name="Chapters", exact=True).click()
    page.wait_for_timeout(600)
    page.get_by_text(TITLE).first.click()
    page.wait_for_timeout(600)
    page.get_by_role("button", name=re.compile("Delete scene")).click()
    page.wait_for_timeout(1200)
    final = page.get_by_text("SCENE", exact=True).count()
    assert final == before, f"cleanup left {final} scenes, expected {before}"
    print(f"cleanup: back to {before} scenes")

    # remove the pages this run created, so repeated runs don't pile up pages
    page.get_by_role("button", name="Main Chat", exact=True).click()
    page.wait_for_selector("canvas.lower-canvas", timeout=20_000)
    page.wait_for_timeout(1500)
    for n in (P0, P0 + 1, P0 + 2):
        btn = page.get_by_label(f"Delete page {n}", exact=True)
        if btn.count():
            btn.first.hover()
            btn.first.click()
            page.get_by_role("button", name="Delete page").click(timeout=10_000)
            page.wait_for_timeout(900)
    remaining = [
        n for n in (P0, P0 + 1, P0 + 2)
        if page.get_by_label(f"Page {n}", exact=True).count()
    ]
    assert not remaining, f"pages {remaining} were not cleaned up"
    print("cleanup: created pages removed")

    page.screenshot(path="tests/storyboard-screenshot.png")
    assert not errors, f"page errors: {errors}"
    browser.close()

print("\nSTORY BOARD OK")
