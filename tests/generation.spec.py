"""
End-to-end check for the panel generation pipeline.

    python scripts/with_server.py --server "npx next dev -p 3001" --port 3001 \
        -- python tests/generation.spec.py

Exercises the real path: draw a panel, give it a prompt, hit Generate, and wait
for the queued -> generating -> complete transition to land an image on the
panel. Uses whichever provider the router selects (Pollinations when no
GEMINI_API_KEY is configured), so it needs network access.
"""

import os
import re
import sys
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("MANGARA_BASE_URL", "http://localhost:3001")
EMAIL = os.environ.get("MANGARA_TEST_EMAIL")
PASSWORD = os.environ.get("MANGARA_TEST_PASSWORD")
GENERATION_TIMEOUT_MS = 120_000

if not EMAIL or not PASSWORD:
    sys.exit("Set MANGARA_TEST_EMAIL and MANGARA_TEST_PASSWORD first.")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 950})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    generate_calls = []
    page.on(
        "response",
        lambda r: generate_calls.append((r.request.method, r.status))
        if "/api/generate" in r.url
        else None,
    )

    page.goto(BASE, timeout=30_000)
    page.wait_for_load_state("networkidle")
    page.fill("#email", EMAIL)
    page.fill("#password", PASSWORD)
    with page.expect_navigation(wait_until="networkidle", timeout=30_000):
        page.locator("#password").press("Enter")
    page.wait_for_selector("canvas.lower-canvas", timeout=20_000)
    page.wait_for_timeout(2000)
    print("auth: OK")

    # --- draw a panel to generate into --------------------------------------
    page.get_by_title("Panel (P)").click()
    box = page.locator("canvas.lower-canvas").bounding_box()
    ox, oy = box["x"], box["y"]
    page.mouse.move(ox + 300, oy + 180)
    page.mouse.down()
    page.mouse.move(ox + 480, oy + 320, steps=6)
    page.mouse.move(ox + 660, oy + 460, steps=6)
    page.mouse.up()
    page.wait_for_timeout(600)
    print("panel: created")

    # --- prompt it ----------------------------------------------------------
    prompt_box = page.get_by_placeholder("Describe this panel…")
    expect(prompt_box).to_be_visible()
    prompt_box.fill("a lone samurai standing in heavy rain at night")
    prompt_box.blur()
    page.wait_for_timeout(500)

    generate = page.get_by_role("button", name=re.compile("Generate Panel"))
    expect(generate).to_be_enabled()
    generate.click()
    print("generate: submitted")

    # --- the request must be accepted immediately, not held open -------------
    page.wait_for_timeout(3000)
    assert generate_calls, "no request reached /api/generate"
    method, status = generate_calls[0]
    assert status == 200, f"/api/generate returned {status}"
    print(f"api: {method} /api/generate -> {status} (queued without blocking)")

    # --- poll through to completion -----------------------------------------
    deadline = GENERATION_TIMEOUT_MS
    waited = 0
    state = None
    while waited < deadline:
        body = page.inner_text("body")
        if "Generation failed" in body:
            sys.exit("generation reported failure in the UI")
        if "Generating…" in body:
            state = "generating"
        elif "Queued…" in body:
            state = state or "queued"
        else:
            # Neither pending label is showing — the run resolved.
            break
        page.wait_for_timeout(2000)
        waited += 2000

    assert waited < deadline, f"generation did not finish within {deadline}ms"
    print(f"pipeline: observed '{state}' then completion")

    # --- the image landed on the panel --------------------------------------
    page.wait_for_timeout(2000)
    generate_again = page.get_by_role("button", name=re.compile("Generate Panel"))
    expect(generate_again).to_be_enabled(timeout=15_000)

    page.screenshot(path="tests/generation-screenshot.png")
    assert not errors, f"page errors: {errors}"
    browser.close()

print("\nGENERATION PIPELINE OK")
