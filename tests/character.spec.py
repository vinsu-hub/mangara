"""
End-to-end check for the Character Ref tab.

    python scripts/with_server.py --server "npx next dev -p 3001" --port 3001 \
        -- python tests/character.spec.py

Idempotent: creates a character, exercises it, deletes it. Does not trigger
image generation — that costs a provider round trip and is covered by
tests/generation.spec.py.
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
    page.on("dialog", lambda d: d.accept())

    page.goto(BASE, timeout=30_000)
    page.wait_for_load_state("networkidle")
    page.fill("#email", EMAIL)
    page.fill("#password", PASSWORD)
    with page.expect_navigation(wait_until="networkidle", timeout=30_000):
        page.locator("#password").press("Enter")
    print("auth: OK")

    page.get_by_role("button", name="Character Ref", exact=True).click()
    expect(page.get_by_text("CHARACTERS").first).to_be_visible(timeout=20_000)
    print("character ref: rail routes here")

    # --- create -------------------------------------------------------------
    page.get_by_role("button", name=re.compile("Add Character")).click()
    page.wait_for_timeout(1500)
    expect(page.get_by_text("BASIC INFO")).to_be_visible(timeout=15_000)
    expect(page.get_by_text("CONSISTENCY LOCK")).to_be_visible()
    print("character: created, Overview rendered")

    # --- name + basic info --------------------------------------------------
    page.get_by_label("Character name", exact=True).fill("Kaito")
    page.get_by_label("Character name", exact=True).blur()
    page.wait_for_timeout(600)

    page.get_by_label("Age", exact=True).fill("24")
    page.get_by_label("Age", exact=True).blur()
    page.get_by_label("Weapon", exact=True).fill("Katana")
    page.get_by_label("Weapon", exact=True).blur()
    page.wait_for_timeout(1000)
    print("basic info: name, age and weapon saved")

    # --- consistency lock slider -------------------------------------------
    clothing = page.get_by_label("Clothing", exact=True)
    clothing.fill("60")
    clothing.dispatch_event("change")
    page.wait_for_timeout(1000)
    expect(page.get_by_text("60%")).to_be_visible()
    print("consistency lock: slider moved and reflected")

    # --- persistence --------------------------------------------------------
    page.reload(wait_until="networkidle")
    page.get_by_role("button", name="Character Ref", exact=True).click()
    page.wait_for_timeout(2500)
    # Select it explicitly — the list is name-sorted, so whichever character
    # happens to sort first would otherwise be the one under test.
    page.get_by_role("button", name=re.compile("Kaito")).first.click()
    page.wait_for_timeout(1200)
    expect(page.get_by_label("Character name", exact=True)).to_have_value("Kaito", timeout=15_000)
    expect(page.get_by_label("Age", exact=True)).to_have_value("24")
    expect(page.get_by_label("Weapon", exact=True)).to_have_value("Katana")
    expect(page.get_by_text("60%")).to_be_visible()
    print("persistence: character and lock value survived reload")

    # --- quick actions present ---------------------------------------------
    expect(page.get_by_role("button", name=re.compile("Use in Current Panel"))).to_be_visible()
    expect(page.get_by_role("button", name=re.compile("Generate set"))).to_be_visible()
    print("quick actions: present")

    # --- cleanup ------------------------------------------------------------
    page.get_by_role("button", name=re.compile("Delete character")).click()
    page.wait_for_timeout(1500)
    print("cleanup: character deleted")

    page.screenshot(path="tests/character-screenshot.png")
    assert not errors, f"page errors: {errors}"
    browser.close()

print("\nCHARACTER REF OK")
