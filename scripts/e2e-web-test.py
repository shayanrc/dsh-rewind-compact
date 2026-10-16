#!/usr/bin/env python3
"""Automated end-to-end test of /rewind-compact in the web UI.

Drives a real browser (Playwright) against a running web profile:
  new session -> two turns -> /rewind-compact -> answer both picker dialogs
  -> assert the completion message.

Interaction notes learned the hard way:
  * the chat input is a contenteditable whose aria-label changes once the
    session has messages — select the LAST [contenteditable="true"].
  * the picker options are <button role="radio">: a MOUSE CLICK does not
    register; focus the option and press Space. Enter advances/submits.
  * a pending picker dialog dies with the page, so one script run must
    complete the whole flow.

Usage:
  See "Automated browser E2E" in TESTING.md for the one-time scratch-dir setup
  (venv + chromium) and the exact run command.

Pass the boot URL (with ?token=...) as argv[1].
"""
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8124/?token=<fresh-boot-token>"
INPUT = '[contenteditable="true"]'

def type_send(page, text, wait):
    box = page.locator(INPUT).last
    box.click(); box.type(text, delay=10); page.keyboard.press("Enter")
    page.wait_for_timeout(wait)

def pick_option(page, contains):
    """Focus the radio whose aria-label contains `contains`, select with Space."""
    radios = page.locator('button[role="radio"]')
    idx = None
    for i in range(radios.count()):
        label = radios.nth(i).get_attribute("aria-label", timeout=3000) or ""
        if contains.lower() in label.lower():
            idx = i; break
    if idx is None:
        raise RuntimeError(f"option {contains!r} not found")
    radios.nth(idx).focus()
    page.keyboard.press(" ")
    page.wait_for_timeout(800)
    return radios.nth(idx).get_attribute("aria-checked", timeout=3000)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    page = b.new_page(viewport={"width": 1400, "height": 900})
    page.goto(URL, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(6000)
    page.locator('button[aria-label="New session"]').first.click(); page.wait_for_timeout(3000)

    print("== turns ==")
    type_send(page, "Reply with exactly: alpha", 15000)
    type_send(page, "Reply with exactly: beta", 15000)

    print("== command ==")
    type_send(page, "/rewind-compact", 6000)
    page.screenshot(path="70-q1.png")

    print("== q1: pick 'turn 2' ==")
    print("   checked:", pick_option(page, "turn 2"))
    page.keyboard.press("Enter"); page.wait_for_timeout(2500)
    page.screenshot(path="71-q2.png")
    print("   on q2:", "Which side" in page.inner_text("body"))

    print("== q2: pick 'Compact before' ==")
    print("   checked:", pick_option(page, "Compact before"))
    page.keyboard.press("Enter")
    print("   submitted; waiting for result...")
    page.wait_for_timeout(30000)

    page.screenshot(path="72-result.png")
    body = page.inner_text("body")
    print("== result tail ==")
    print(body[-1400:])
    b.close()
