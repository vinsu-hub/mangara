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
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("MANGARA_BASE_URL", "http://localhost:3001")
EMAIL = os.environ.get("MANGARA_TEST_EMAIL")
PASSWORD = os.environ.get("MANGARA_TEST_PASSWORD")

if not EMAIL or not PASSWORD:
    sys.exit("Set MANGARA_TEST_EMAIL and MANGARA_TEST_PASSWORD first.")

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
    title.fill("The Storm Intensifies")
    title.blur()
    page.wait_for_timeout(800)

    synopsis = page.locator("aside textarea").nth(1)
    synopsis.fill("The storm grows violent. Kaito senses movement in the dark.")
    synopsis.blur()

    page.locator("aside select").first.select_option("climax")
    page.wait_for_timeout(1000)
    print("scene details: title, synopsis and act tag saved")

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
    expect(page.get_by_text("The Storm Intensifies").first).to_be_visible(timeout=15_000)
    expect(page.get_by_text("Climax").first).to_be_visible()
    expect(page.get_by_label("Beat 1", exact=True)).to_have_value(
        "Kaito walks through the village in rain."
    )
    print("persistence: scene, tag and edited beat survived reload")

    # --- outline tab reflects it -------------------------------------------
    page.get_by_role("button", name="Outline", exact=True).click()
    page.wait_for_timeout(600)
    expect(page.get_by_text(re.compile("The Storm Intensifies")).first).to_be_visible()
    print("outline: renders the scene")

    # --- cleanup ------------------------------------------------------------
    page.get_by_role("button", name="Chapters", exact=True).click()
    page.wait_for_timeout(600)
    page.get_by_text("The Storm Intensifies").first.click()
    page.wait_for_timeout(600)
    page.get_by_role("button", name=re.compile("Delete scene")).click()
    page.wait_for_timeout(1200)
    final = page.get_by_text("SCENE", exact=True).count()
    assert final == before, f"cleanup left {final} scenes, expected {before}"
    print(f"cleanup: back to {before} scenes")

    page.screenshot(path="tests/storyboard-screenshot.png")
    assert not errors, f"page errors: {errors}"
    browser.close()

print("\nSTORY BOARD OK")
