// E2E flows against the Vite dev server (127.0.0.1:5173, `npm run dev`).
// Playwright resolves from the npx cache (`npx playwright` has been run
// before); no package.json dependency.
// Run: node e2e.mjs
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";

// import playwright from the npx cache: same package `npx playwright` uses
const require = createRequire(import.meta.url);
function loadPlaywright() {
  const cands = [
    process.env.LOCALAPPDATA &&
      path.join(
        process.env.LOCALAPPDATA,
        "npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs",
      ),
    path.join(os.homedir(), "AppData/Local/hermes/hermes-agent/node_modules/playwright/index.mjs"),
    "playwright",
  ].filter(Boolean);
  for (const c of cands) {
    try {
      return import(pathToFileURL(c));
    } catch {
      /* next candidate */
    }
  }
  throw new Error("playwright not found: run `npx playwright --version` once");
}
import { pathToFileURL } from "node:url";
const { chromium } = await loadPlaywright();

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const ok = (name, cond, extra = "") => results.push([cond ? "PASS" : "FAIL", name, extra]);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();

// ---------- Flow 0: a fresh visit opens the library ----------
page.on("pageerror", (e) => results.push(["FAIL", "F1 pageerror", String(e).slice(0, 140)]));
await page.goto(BASE + "/", { waitUntil: "load" });
await page.waitForSelector(".libcard", { timeout: 30000 });
ok("F0 bare / lands in the library", /#\/$/.test(page.url()), page.url());
const libTitles = await page.locator(".libtitle").allTextContents();
ok(
  "F0 library lists the books in learning order",
  libTitles.join("|") === "Essential Grammar in Use|English Grammar in Use",
  libTitles.join("|"),
);
await page.locator(".libtitle a", { hasText: "English Grammar in Use" }).click();

// ---------- Flow 1: book landing + first open defaults ----------
await page.waitForSelector(".homecover", { timeout: 30000 });
ok("F1 landing cover", await page.locator(".homecover").isVisible());
ok("F1 landing url is #/blue", /#\/blue$/.test(page.url()), page.url());
await page.locator(".homecta").click();
await page.waitForSelector(".pagecanvas", { timeout: 30000 });
await sleep(1500);
ok("F1 url is #/blue/u1", /#\/blue\/u1$/.test(page.url()));
ok("F1 pdf pages rendered", (await page.locator(".pagecanvas").count()) >= 1);
ok("F1 sidebar collapsed card", (await page.locator(".sidebar.collapsed").count()) === 1);
ok("F1 right pane exercises", await page.locator(".rightpane .exercise").first().isVisible());
ok(
  "F1 no page errors",
  !results.some((r) => r[1] === "F1 pageerror"),
);

// ---------- Flow 2: answer a gap, check, feedback appears ----------
// deliberate wrong answer: the check pipeline must mark it and show variants
const gap = page.locator(".exercise textarea.gap, .exercise .gap").first();
await gap.fill("qqq");
await page.locator('[data-shortcut="check"]').first().click();
await page.waitForFunction(
  () => {
    const el = document.querySelector(".exercise textarea.gap, .exercise .gap");
    return el && /(^| )bad( |$)/.test(el.getAttribute("class") ?? "");
  },
  { timeout: 5000 },
);
ok("F2 wrong gap marked bad", true);
ok("F2 variants shown", await page.locator(".exercise .variants").first().isVisible());

// ---------- Flow 3: sidebar expand + collapse ----------
await page.locator(".sidebartoggle").click();
await page.waitForFunction(
  () => !!document.querySelector(".sidebar:not(.collapsed)"),
  { timeout: 5000 },
);
ok("F3 sidebar expanded", true);
ok("F3 active unit highlighted", await page.locator(".unitlink.active").first().isVisible());
await page.locator(".sidebartoggle").click();
await page.waitForFunction(
  () => !!document.querySelector(".sidebar.collapsed"),
  { timeout: 5000 },
);
ok("F3 sidebar collapsed card", true);

// ---------- Flow 4: navigation via sidebar link + bottom pager ----------
await page.locator(".sidebartoggle").click();
await sleep(500);
await page.locator(".sidebar .unitlink", { hasText: /^2$/ }).first().click();
await page.waitForURL(/#\/blue\/u2/, { timeout: 30000 });
await page.waitForFunction(
  () => document.querySelector(".unitheading")?.textContent?.includes("Unit 2"),
  { timeout: 10000 },
);
ok("F4 sidebar nav to unit 2", /#\/blue\/u2$/.test(page.url()));
ok(
  "F4 heading shows unit 2",
  /Unit 2/.test((await page.locator(".unitheading").first().textContent()) ?? ""),
);
await page.locator(".unitnavbtn.next").click();
await page.waitForURL(/#\/blue\/u3/, { timeout: 30000 });
ok("F4 pager next to unit 3", /#\/blue\/u3$/.test(page.url()));
await page.locator(".unitnavbtn.prev").click();
await page.waitForURL(/#\/blue\/u2/, { timeout: 30000 });
ok("F4 pager prev back to unit 2", /#\/blue\/u2$/.test(page.url()));

// ---------- Flow 5: zoom buttons zoom in and back out ----------
// baseline = settled label before touching the buttons
const zoomText = () => page.locator(".zoomlabel").textContent();
await page.waitForFunction(() => {
  const c = document.querySelector(".pagecanvas");
  return c && c.width > 10;
}, { timeout: 30000 });
const z0 = (await zoomText()).trim();
await page.locator('button[aria-label="Zoom in"]').click();
await page.waitForFunction(
  (prev) => document.querySelector(".zoomlabel")?.textContent?.trim() !== prev,
  z0,
  { timeout: 5000 },
);
await sleep(400); // let the eased zoom animation settle before the next step
const z1 = (await zoomText()).trim();
ok("F5 zoom in changes label", true, `${z0} -> ${z1}`);
await page.locator('button[aria-label="Zoom out"]').click();
await page.waitForFunction(
  (prev) => document.querySelector(".zoomlabel")?.textContent?.trim() === prev,
  z0,
  { timeout: 5000 },
);
ok("F5 zoom out returns", true, `${z1} -> ${(await zoomText()).trim()}`);

// ---------- Flow 6: progress modal ----------
await page.locator('button[aria-label^="Progress"]').click();
await page.waitForSelector('.modal[aria-label="Progress"]', { timeout: 30000 });
ok("F6 progress modal opens", await page.locator('.modal h2:text("Progress")').isVisible());
ok(
  "F6 modal has export/share actions",
  (await page.locator(".modal-actions button").count()) >= 2,
);
await page.locator('.modal button[aria-label="Close"]').click();
await sleep(300);
ok("F6 modal closes", (await page.locator('.modal[aria-label="Progress"]').count()) === 0);

// ---------- Flow 9: Shift+I opens the progress window with hint keys ----------
// The window opened this way underlines the trigger letter of each control
// (I / E / S, and the "a" of "answer") and a plain letter clicks that control.
await page.keyboard.press("Shift+KeyI");
await page.waitForSelector('.modal[aria-label="Progress"]', { timeout: 10000 });
const hintLetters = await page.locator(".modal .hintkey").allTextContents();
ok("F9 Shift+I opens with hint letters", hintLetters.join("") === "aIES", hintLetters.join(""));
ok(
  "F9 hint letters sit on their controls",
  (await page.locator(".modal [data-modal-key]").evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-modal-key")),
  )).join("") === "AIES",
);
// the "a" belongs to "answer", and no flex gap splits the label around it
const hintGap = await page.locator('[data-modal-key="I"] .hintkey').evaluate((el) => {
  const self = el.getBoundingClientRect();
  const r = document.createRange();
  r.setStart(el.nextSibling, 0);
  r.setEnd(el.nextSibling, 1);
  return r.getBoundingClientRect().left - self.right;
});
ok("F9 no gap inside the hinted label", hintGap < 2, `${hintGap}px`);

const answersBox = page.locator('.modal input[type="checkbox"]');
const wasChecked = await answersBox.isChecked();
await page.keyboard.press("KeyA");
await sleep(150);
ok("F9 A toggles Include answer texts", (await answersBox.isChecked()) !== wasChecked);
await page.keyboard.press("KeyA");
await sleep(150);
ok("F9 A toggles it back", (await answersBox.isChecked()) === wasChecked);
ok("F9 the window stays open", (await page.locator('.modal[aria-label="Progress"]').count()) === 1);

// E exports: the download is the observable effect
const [file] = await Promise.all([
  page.waitForEvent("download", { timeout: 8000 }),
  page.keyboard.press("KeyE"),
]);
ok("F9 E downloads the progress file", /murrnglish-blue-progress-.*\.json$/.test(file.suggestedFilename()), file.suggestedFilename());

// S copies the share link and the confirmation wiggles
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
const shakeFrames = page.evaluate(
  () =>
    new Promise((resolve) => {
      const seen = new Set();
      const opacity = new Set();
      const names = new Set();
      const t0 = performance.now();
      const tick = () => {
        const el = document.querySelector(".modal-msg .msgtext");
        if (el) {
          const cs = getComputedStyle(el);
          seen.add(cs.transform);
          opacity.add(cs.opacity);
          names.add(cs.animationName);
        }
        if (performance.now() - t0 > 900) resolve({ seen: [...seen], opacity: [...opacity], names: [...names] });
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
);
await page.keyboard.press("KeyS");
const frames = await shakeFrames;
ok(
  "F9 S copies the share link",
  (await page.evaluate(() => navigator.clipboard.readText())).includes("#/blue/p="),
);
ok("F9 the copied notice shakes", frames.seen.length > 2, `${frames.seen.length} distinct frames`);
ok("F9 the copied notice fades in", frames.opacity.length > 2 && frames.opacity.includes("0"),
  `${frames.opacity.length} opacity steps`);
ok("F9 the notice runs both animations",
  frames.names.join(",").includes("msg-in") && frames.names.join(",").includes("msg-shake"),
  frames.names.join(","));

// the notice fades back out on its own and is then dropped from the DOM.
// Watch the node's own state from before the press: the .leaving window is
// only ~0.18s, too short to race with a polling selector.
const clearWatch = page.evaluate(
  () =>
    new Promise((resolve) => {
      const seen = [];
      const t0 = performance.now();
      const tick = () => {
        const el = document.querySelector(".modal-msg .msgtext");
        const state = el
          ? { cls: el.className, anim: getComputedStyle(el).animationName, opacity: getComputedStyle(el).opacity }
          : null;
        const last = seen[seen.length - 1];
        const changed = JSON.stringify(state) !== JSON.stringify(last);
        if (changed) seen.push(state);
        if (!el && seen.length) resolve(seen);
        else if (performance.now() - t0 > 10000) resolve(seen);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
);
await page.keyboard.press("KeyS");
const cycle = await clearWatch;
const leavingFrames = cycle.filter((s) => s && /leaving/.test(s.cls));
ok("F9 the notice fades out when it clears", leavingFrames.every((s) => s.anim === "msg-out"),
  JSON.stringify(leavingFrames.map((s) => s.anim)));
const opacities = leavingFrames.map((s) => Number(s.opacity));
ok("F9 the fade ends faded out",
  opacities.length > 1 && Math.min(...opacities) < 0.2 && opacities[0] > Math.min(...opacities),
  `opacity ${opacities[0]} -> ${Math.min(...opacities)} over ${opacities.length} frames`);
ok("F9 the notice is dropped after the fade", cycle[cycle.length - 1] === null,
  `${cycle.length} states, last=${JSON.stringify(cycle[cycle.length - 1])}`);

// Shift+I again must not double-fire Import: modifiers are not hint keys
await page.keyboard.press("Shift+KeyI");
await sleep(300);
ok("F9 Shift+I does not act as the Import hint", (await page.locator('.modal[aria-label="Progress"]').count()) === 1);

// reopening from the topbar button drops the hints
await page.keyboard.press("Escape");
await sleep(350);
await page.locator('button[aria-label^="Progress"]').click();
await page.waitForSelector('.modal[aria-label="Progress"]', { timeout: 10000 });
ok("F9 button open has no hints", (await page.locator(".modal .hintkey").count()) === 0);
const plainBefore = await answersBox.isChecked();
await page.keyboard.press("KeyA");
await sleep(200);
ok("F9 plain letters are inert without hints", (await answersBox.isChecked()) === plainBefore);
await page.keyboard.press("Escape");
await sleep(350);
ok("F9 Esc closes the window", (await page.locator('.modal[aria-label="Progress"]').count()) === 0);

// ---------- Flow 10: unit loading placeholder + parallel page start ----------
// With the unit JSON held, the exercises pane shows the placeholder and the
// book pages are already mounted from index.json — that is the whole point of
// the change: the 14 MB PDF load no longer waits for the unit JSON.
const UNIT13_TITLE =
  "Unit 13 — " + (await (await fetch(BASE + "/books/blue/data/index.json")).json()).exercises.u13.title;
{
  // fresh context: an empty HTTP cache, so book.pdf is a real network load
  // and the resource timings below describe a first visit
  const octx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const slow = await octx.newPage();
  await slow.route("**/data/units/unit-013.json", async (route) => {
    await sleep(2500);
    await route.continue();
  });
  await slow.goto(BASE + "/#/blue/u13", { waitUntil: "domcontentloaded" });
  await slow.waitForSelector(".unitloading .skel-card", { timeout: 30000 });
  const held = await slow.evaluate(() => ({
    skelCards: document.querySelectorAll(".unitloading .skel-card").length,
    skelRows: document.querySelectorAll(".unitloading .skel-item").length,
    label: document.querySelector(".unitloading")?.getAttribute("aria-label"),
    liveCards: document.querySelectorAll(".rightpane .exercise:not(.skel-card)").length,
    pageboxes: document.querySelectorAll(".leftpane .pagebox").length,
    heading: document.querySelector(".unitloading .skel-heading")?.textContent ?? "",
  }));
  ok("F10 placeholder while unit JSON is in flight", held.skelCards === 2 && held.liveCards === 0);
  ok("F10 placeholder mirrors the card shape", held.skelRows === 8, JSON.stringify(held));
  ok("F10 placeholder is announced as loading", held.label === "Loading exercises", held.label ?? "none");
  ok("F10 placeholder shows the real title, not a bar", held.heading === UNIT13_TITLE, held.heading);
  ok("F10 book pages mount before the unit JSON", held.pageboxes === 2, `${held.pageboxes} pages`);
  await slow.waitForSelector(".rightpane .exercise:not(.skel-card)", { timeout: 30000 });
  // The claim is that the PDF no longer waits for the unit JSON. Before the
  // change the stack mounted on the unit object, so book.pdf could not start
  // until that JSON resolved; now it starts alongside. Resource timing is the
  // observable: pdf.start < json.end holds only in the parallel case.
  const timings = await slow.evaluate(() => {
    const entries = performance.getEntriesByType("resource");
    const pick = (re) => {
      const e = entries.find((x) => re.test(x.name));
      return e ? { start: Math.round(e.startTime), end: Math.round(e.startTime + e.duration) } : null;
    };
    return { pdf: pick(/book\.pdf/), json: pick(/unit-013\.json/) };
  });
  ok(
    "F10 book.pdf starts before the unit JSON resolves",
    !!timings.pdf && !!timings.json && timings.pdf.start < timings.json.end,
    JSON.stringify(timings),
  );
  const landed = await slow.evaluate(() => ({
    skel: document.querySelectorAll(".unitloading").length,
    liveCards: document.querySelectorAll(".rightpane .exercise").length,
    heading: document.querySelector(".unitheading")?.textContent?.trim() ?? "",
  }));
  ok("F10 placeholder clears when the unit arrives", landed.skel === 0 && landed.liveCards > 0);
  // same string the placeholder showed: the title never swaps, only the cards
  // under it do
  ok("F10 heading is identical before and after the unit lands",
    landed.heading === held.heading.trim(), JSON.stringify({ before: held.heading, after: landed.heading }));
  await octx.close();
}

// ---------- Flow 7: keyboard shortcuts modal ----------
await page.locator('button[aria-label="Keyboard shortcuts"]').click();
await page.waitForSelector(".helpcard", { timeout: 30000 });
ok("F7 shortcuts modal opens", await page.locator(".helpcard h3").isVisible());
ok(
  "F7 help documents Shift+I and its hint letters",
  /Progress window/.test(await page.locator(".helpcard").innerText()),
);
await page.keyboard.press("Escape");
await sleep(300);
ok("F7 shortcuts modal closes", (await page.locator(".helpcard").count()) === 0);

// ---------- Flow 8: phone layout (390x844) ----------
const mctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
const mp = await mctx.newPage();
mp.on("pageerror", (e) => results.push(["FAIL", "F8 pageerror", String(e).slice(0, 140)]));
await mp.goto(BASE + "/#/blue/u1", { waitUntil: "load" });
await mp.waitForSelector(".exercise textarea", { timeout: 30000, state: "attached" });
await sleep(1500);

// default tab = book: left pane visible, right pane hidden
ok("F8 book tab default", await mp.locator(".leftpane .pagebox").first().isVisible());
ok(
  "F8 exercises hidden on book tab",
  await mp.locator(".rightpane .exercise").first().evaluate((el) => el.offsetParent === null),
);

// switch to exercises
await mp.locator('.tabswitch button:has-text("Exercises")').click();
ok("F8 exercises tab shows rightpane", await mp.locator(".rightpane .exercise").first().isVisible());
ok(
  "F8 book hidden on exercises tab",
  await mp.locator(".leftpane .pagebox").first().evaluate((el) => el.offsetParent === null),
);

// counters hidden, no horizontal overflow
ok("F8 topstats hidden", await mp.locator(".topstats").evaluate((el) => el.offsetParent === null));
ok(
  "F8 no horizontal overflow",
  await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
);

// drawer: open via hamburger; the backdrop is always mounted and inert —
// closing happens through the drawer's own chrome (toggle, topbar title),
// never through a backdrop tap: the full-width drawer covers it anyway
await mp.locator(".sidebartoggle").click();
ok("F8 drawer opens", await mp.locator(".sidebar.mobile-open").isVisible());
ok(
  "F8 backdrop mounted, enabled and inert",
  (await mp.locator(".sidebar-backdrop.enabled").count()) === 1 &&
    (await mp
      .locator(".sidebar-backdrop")
      .evaluate((el) => getComputedStyle(el).interactivity === "inert")),
);
await mp.locator(".sidebartoggle").click();
await sleep(300);
ok("F8 sidebartoggle closes drawer", (await mp.locator(".sidebar.mobile-open").count()) === 0);

// drawer: unit tap navigates and closes
await mp.locator(".sidebartoggle").click();
await mp.locator('.sidebar .unitlink:has-text("2")').first().click();
await sleep(600);

ok("F8 drawer closes on nav", (await mp.locator(".sidebar.mobile-open").count()) === 0);
await mp.waitForSelector(".rightpane .exercise textarea", { timeout: 30000 });
ok("F8 navigated to unit 2", /#\/blue\/u2/.test(mp.url()));

// drawer: the topbar title also closes the drawer (goes home from there)
await mp.locator(".sidebartoggle").click();
await sleep(300);
ok("F8 drawer reopens", (await mp.locator(".sidebar.mobile-open").count()) === 1);
await mp.locator(".topbar-home").click();
await sleep(300);
ok("F8 topbar title closes drawer", (await mp.locator(".sidebar.mobile-open").count()) === 0);
ok("F8 topbar title goes home", /#\/blue$/.test(mp.url()));
// back on a unit for the pinch-zoom test (the topbar title left us at home
// on the Exercises tab; the hash change doesn't reload, so re-pick Book)
await mp.goto(BASE + "/#/blue/u2", { waitUntil: "load" });
await mp.locator('.tabswitch button:has-text("Book")').click();
await mp.waitForSelector(".zoomlabel", { timeout: 30000 });

// pinch zoom: synthetic two-finger gesture changes the zoom label
const z00 = await mp.locator(".zoomlabel").textContent();
await mp.locator('.tabswitch button:has-text("Book")').click();
await mp.evaluate(() => {
  const el = document.querySelector(".pageviewer");
  const mk = (id, x, y) =>
    new Touch({ identifier: id, target: el, clientX: x, clientY: y, radiusX: 2, radiusY: 2, rotationAngle: 0, force: 1 });
  const fire = (type, touches) =>
    el.dispatchEvent(new TouchEvent(type, { touches, cancelable: true, bubbles: true }));
  fire("touchstart", [mk(1, 150, 300), mk(2, 250, 300)]);
  fire("touchmove", [mk(1, 120, 300), mk(2, 280, 300)]);
  fire("touchend", [mk(1, 120, 300)]);
});
await sleep(200);
const zr = await mp.locator(".zoomlabel").textContent();
ok("F8 pinch zoom changes zoom", z00 !== zr, `${z00} -> ${zr}`);

// phone chrome: the topbar keeps the title alone — progress, download and
// theme are labelled rows at the top of the drawer, ruled off above the
// progress bars and the unit list
ok("F8 phone topbar has no action buttons", (await mp.locator(".topbar-actions").count()) === 0);
await mp.locator(".sidebartoggle").click();
await sleep(350);
ok(
  "F8 drawer leads with the labelled controls",
  (await mp.locator('.draweractions .draweraction:has-text("Progress & share")').count()) === 1 &&
    (await mp.locator('.draweractions .themebtn:has-text("Theme:")').count()) === 1,
);
ok(
  "F8 controls sit above the progress bars and the unit list",
  (await mp.evaluate(() => document.querySelector(".draweractions + .drawerstats") !== null)) &&
    (await mp.evaluate(
      () =>
        document.querySelector(".draweractions").getBoundingClientRect().bottom <=
        document.querySelector(".sidebar .unitlink").getBoundingClientRect().top,
    )),
);

// drawer gestures: a leftward swipe over the drawer pushes it back, a
// rightward one pulls it in — but a drag that starts on the book pages
// belongs to the reader and never summons the drawer
const swipe = (sel, dx) =>
  mp.evaluate(
    ([sel, dx]) => {
      const el = document.querySelector(sel);
      const mk = (x, y) =>
        new Touch({ identifier: 1, target: el, clientX: x, clientY: y, radiusX: 2, radiusY: 2, force: 1 });
      const fire = (type, touches) =>
        el.dispatchEvent(new TouchEvent(type, { touches, cancelable: true, bubbles: true }));
      fire("touchstart", [mk(120, 200)]);
      for (let i = 1; i <= 4; i++) fire("touchmove", [mk(120 + (dx * i) / 4, 200)]);
      fire("touchend", []);
    },
    [sel, dx],
  );
await swipe(".sidebar-inner", -90);
await sleep(400);
ok("F8 swipe left closes the drawer", (await mp.locator(".sidebar.mobile-open").count()) === 0);
await swipe(".pagecanvas", 90);
await sleep(400);
ok(
  "F8 swipe on the book pages leaves the drawer shut",
  (await mp.locator(".sidebar.mobile-open").count()) === 0,
);
await mp.locator('.tabswitch button:has-text("Exercises")').click();
await mp.waitForSelector(".rightpane .unitheading", { timeout: 30000 });
await swipe(".unitheading", 90);
await sleep(400);
ok("F8 swipe right opens the drawer", (await mp.locator(".sidebar.mobile-open").count()) === 1);

// ---------- Flow 11: Shift+E on the landing opens the unit list ----------
// The landing has no active unit, so there is nothing for the shortcut to
// focus the old way; the key must still reveal the collapsed card and land
// on the first unit, and Esc must bring the focus back to the landing.
// A bare hash change keeps the previous document (state and focus), so the
// landing gets a real reload — with the default collapsed card restored.
await page.evaluate(() =>
  localStorage.setItem("murrnglish.sidebar-collapsed", "1"),
);
await page.goto(BASE + "/#/blue", { waitUntil: "load" });
await page.reload({ waitUntil: "load" });
await page.waitForSelector("nav.sidebar .unitlink", { state: "attached", timeout: 30000 });
await sleep(400);
ok(
  "F11 landing shows the collapsed card",
  (await page.locator(".sidebar.collapsed").count()) === 1,
);
await page.keyboard.press("Shift+KeyE");
await sleep(500);
const f11 = await page.evaluate(() => {
  const el = document.activeElement;
  const card = document.querySelector("nav.sidebar.collapsed");
  return {
    inList: el?.closest("nav.sidebar") !== null,
    text: el?.textContent?.trim() ?? "",
    opacity: card ? getComputedStyle(card).opacity : null,
  };
});
ok("F11 Shift+E focuses the first unit", f11.inList && f11.text === "1", JSON.stringify(f11));
ok("F11 the hidden card is revealed", f11.opacity === "1", String(f11.opacity));
await page.keyboard.press("Escape");
await sleep(300);
ok(
  "F11 Esc returns to the landing CTA",
  await page.evaluate(() => document.activeElement?.classList.contains("homecta") === true),
);
ok(
  "F11 the card hides again",
  await page.evaluate(
    () => getComputedStyle(document.querySelector("nav.sidebar")).opacity === "0",
  ),
);

// ---------- Flow 12: download the course, go offline, keep learning ----------
// The service worker registers in a real build only (import.meta.env.PROD), so
// this flow runs against `vite preview` and is skipped on the dev server.
if (BASE.includes("4173")) {
  // a browser tab is not an installed app: there is no download button at all
  ok(
    "F12 offline button hidden in a browser tab",
    (await page.locator('[aria-label="Offline: download books"]').count()) === 0,
  );

  // standalone is emulated — installing for real is a browser-chrome action.
  // Only display-mode matchMedia is stubbed: App also listens to
  // (max-width: 768px) through addEventListener, and Object.create keeps the
  // original MediaQueryList prototype chain on the stub while .matches is
  // overridden. The stub is only ever read, never subscribed to.
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx2.addInitScript(() => {
    const orig = window.matchMedia.bind(window);
    window.matchMedia = (q) =>
      /display-mode/.test(q) ? Object.create(orig(q), { matches: { value: true } }) : orig(q);
  });
  const p2 = await ctx2.newPage();
  p2.on("pageerror", (e) => results.push(["FAIL", "F12 pageerror", String(e).slice(0, 140)]));
  await p2.goto(BASE + "/#/blue", { waitUntil: "load" });
  // the download fills Cache Storage from the page, but the offline reload
  // afterwards needs the page to be under this worker's control
  await p2.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise((r) =>
      navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }),
    );
  });
  ok(
    "F12 installed app shows the offline button",
    await p2.locator('[aria-label="Offline: download books"]').isVisible(),
  );

  // Installed, the app pulls the open book into the cache by itself — nothing is
  // pressed here. On desktop the button is that run's status: green fills it
  // from the top down and stays full when the course is cached.
  await p2.locator(".dlbtn.done").waitFor({ timeout: 180000 });
  ok("F12 the download starts by itself and finishes green", true);

  const cached = await p2.evaluate(async () => {
    const c = await caches.open("murrnglish-book-blue-v1");
    const has = async (u) => (await c.match(u, { ignoreVary: true })) !== undefined;
    const shell = await caches.open("murrnglish-shell-v1");
    return {
      index: await has("/books/blue/data/index.json"),
      bundle: await has("/books/blue/data/course.json"),
      perUnit: await has("/books/blue/data/units/unit-005.json"),
      book: await has("/books/blue/book.pdf"),
      shell: (await shell.match("/", { ignoreVary: true })) !== undefined,
      otherBook: await caches.has("murrnglish-book-red-v1"),
    };
  });
  ok(
    "F12 the course arrives as one packed file, not per unit",
    cached.index && cached.bundle && cached.book && cached.shell && !cached.perUnit,
    JSON.stringify(cached),
  );

  await p2.locator('[aria-label="Offline: download books"]').click();
  const blueRow = p2.locator(".dlrow", { hasText: "English Grammar in Use" });
  const redRow = p2.locator(".dlrow", { hasText: "Essential Grammar in Use" });
  await blueRow.getByRole("button", { name: "Remove the downloaded English Grammar in Use" }).waitFor({ timeout: 30000 });
  ok("F12 download finishes and offers a remove action", true);
  ok(
    "F12 only the open book was downloaded",
    !cached.otherBook && (await redRow.getByRole("button", { name: "Download", exact: true }).isVisible()),
    JSON.stringify(cached),
  );

  // offline now. The hash step is same-document, so the only request left is
  // the reload — a real navigation the service worker has to answer from the
  // cache, followed by the unit JSON, the book and the pdf.js chunks.
  await ctx2.setOffline(true);
  await p2.evaluate(() => {
    location.hash = "#/blue/u5";
  });
  await p2.reload({ waitUntil: "load" });
  await p2.waitForSelector(".pagecanvas", { timeout: 60000 });
  ok("F12 offline unit renders the book", (await p2.locator(".pagecanvas").count()) >= 1);
  await p2.waitForSelector(".rightpane .exercise", { timeout: 60000 });
  ok("F12 offline exercises render", await p2.locator(".rightpane .exercise").first().isVisible());
  ok("F12 no errors while offline", !results.some((r) => r[1] === "F12 pageerror"));

  // the way back out: removing drops the cache and the flag, and the panel
  // offers the download again
  await p2.locator('[aria-label="Offline: download books"]').click();
  await blueRow.getByRole("button", { name: "Remove the downloaded English Grammar in Use" }).click();
  await blueRow.getByRole("button", { name: "Download", exact: true }).waitFor({ timeout: 30000 });
  const removed = await p2.evaluate(async () => {
    return {
      book: (await caches.match("/books/blue/book.pdf", { ignoreVary: true })) !== undefined,
      flag: localStorage.getItem("murrnglish.blue.offline-v1"),
      shell: (await caches.match("/", { ignoreVary: true })) !== undefined,
    };
  });
  ok(
    "F12 removing the book clears its cache and flag, the app shell stays",
    !removed.book && removed.flag === null && removed.shell,
    JSON.stringify(removed),
  );

  // back online: a book that was deleted on purpose must not come back by
  // themselves (the background start checks the removal marker first)
  await ctx2.setOffline(false);
  await sleep(7000);
  const back = await p2.evaluate(async () => {
    return (await caches.match("/books/blue/book.pdf", { ignoreVary: true })) !== undefined;
  });
  ok("F12 a removed download is not fetched again on its own", !back);

  // phone: the topbar has no download button at all (it is a drawer row), so a
  // run in flight shows up as a chip beside the title. Throttled, or the whole
  // course would land before the chip could be seen; the service worker is
  // blocked because CDP throttling applies to the page target alone, and the
  // download is page-side either way.
  const ctx3 = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  await ctx3.addInitScript(() => {
    const orig = window.matchMedia.bind(window);
    window.matchMedia = (q) =>
      /display-mode/.test(q) ? Object.create(orig(q), { matches: { value: true } }) : orig(q);
  });
  const p3 = await ctx3.newPage();
  const cdp3 = await ctx3.newCDPSession(p3);
  await cdp3.send("Network.enable");
  await cdp3.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 40,
    downloadThroughput: 200 * 1024,
    uploadThroughput: 200 * 1024,
  });
  await p3.goto(BASE + "/#/blue", { waitUntil: "load" });
  await p3.locator(".dlchip").waitFor({ timeout: 60000 });
  ok(
    "F12 phone shows the running download as a chip, not a topbar button",
    (await p3.locator(".dlbtn").count()) === 0,
  );
  const chip = await p3.evaluate(() => {
    const c = document.querySelector(".dlchip");
    return { text: c.textContent.trim(), p: getComputedStyle(c).getPropertyValue("--p").trim() };
  });
  ok("F12 the chip carries the percentage", /^\d+%$/.test(chip.text), JSON.stringify(chip));
  await ctx3.close();
  await ctx2.close();
}

// ---------- Flow 13: the red book, its own progress, the library crumb ----------
await page.goto(BASE + "/#/", { waitUntil: "load" });
await page.waitForSelector(".libcard", { timeout: 30000 });
const blueCard = page.locator(".libcard", { hasText: "English Grammar in Use" });
ok(
  "F13 the blue card resumes after the checked unit",
  /Continue with Unit 2/.test((await blueCard.locator(".libcta").textContent()) ?? ""),
  (await blueCard.locator(".libcta").textContent()) ?? "",
);
await page.locator(".libcard", { hasText: "Essential Grammar in Use" }).locator(".libcta").click();
await page.waitForURL(/#\/red\/u1$/, { timeout: 30000 });
await page.waitForSelector(".pagecanvas", { timeout: 60000 });
await page.waitForSelector(".rightpane .exercise", { timeout: 30000 });
ok("F13 red unit 1 renders", /Unit 1/.test((await page.locator(".unitheading").first().textContent()) ?? ""));
ok("F13 the topbar names the red book", (await page.locator(".topbar h1").textContent()) === "Essential Grammar in Use");
ok(
  "F13 red starts with no progress of its own",
  await page.evaluate(() => {
    const red = JSON.parse(localStorage.getItem("murrnglish.red.progress-v1") ?? "null");
    const blue = JSON.parse(localStorage.getItem("murrnglish.blue.progress-v1") ?? "null");
    return (!red || Object.keys(red.results).length === 0) && Object.keys(blue?.results ?? {}).length > 0;
  }),
);
ok(
  "F13 red's unit list has 115 units",
  (await page.locator("nav.sidebar .unitlink").count()) === 115 + 35,
  String(await page.locator("nav.sidebar .unitlink").count()),
);
await page.locator(".topbar-lib").click();
await page.waitForSelector(".libcard", { timeout: 30000 });
ok("F13 the crumb returns to the library", /#\/$/.test(page.url()));
// a bare "/" resumes the book that has progress, not the one glanced at last
await page.goto(BASE + "/", { waitUntil: "load" });
await page.waitForURL(/#\/blue\/u\d+$/, { timeout: 30000 });
ok("F13 bare / resumes the book with progress", /#\/blue\/u\d+$/.test(page.url()), page.url());

// ---------- Flow 14: the rules compendium ----------
{
  const rctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const rp = await rctx.newPage();
  rp.on("pageerror", (e) => results.push(["FAIL", "F14 pageerror", String(e).slice(0, 140)]));
  await rp.goto(BASE + "/#/rules/blue/u12", { waitUntil: "load" });
  await rp.waitForSelector(".rulesheet .rulesection", { timeout: 30000 });
  ok(
    "F14 a unit's rule opens as text",
    /Unit 12/.test((await rp.locator(".ruletoolbar .ruleheading").textContent()) ?? "") &&
      /We use for and since/.test(await rp.locator(".rulesheet").innerText()),
  );
  ok("F14 the unit list marks the open unit", /for and since/.test((await rp.locator(".rulerow.active").textContent()) ?? ""));
  await rp.fill(".searchbox input", "used to");
  await rp.waitForSelector(".rulerow.hit", { timeout: 5000 });
  const hits = await rp.locator(".rulerow.hit .ruletitle").allTextContents();
  ok(
    "F14 search finds the rule in both books",
    hits.some((h) => /^I used to/.test(h)) && hits.some((h) => /^used to \(do\)/.test(h)),
    hits.slice(0, 4).join(" | "),
  );
  await rp.locator(".rulerow.hit", { hasText: "used to (do)" }).click();
  await rp.waitForURL(/#\/rules\/blue\/u18$/, { timeout: 10000 });
  await rp.waitForSelector(".rulesheet .hlmark", { timeout: 10000 });
  ok("F14 a search hit opens its rule with the words marked", true);
  await rp.locator(".ruletools a", { hasText: "Exercises" }).click();
  await rp.waitForURL(/#\/blue\/u18$/, { timeout: 10000 });
  ok("F14 the rule links to its exercises", true);
  await rp.waitForSelector(".unitstudy", { timeout: 30000 });
  await rp.locator(".unitstudy a", { hasText: "Rule" }).click();
  await rp.waitForURL(/#\/rules\/blue\/u18$/, { timeout: 10000 });
  ok("F14 the unit links back to its rule", true);
  // a book without rule text shows the rule page itself
  await rp.goto(BASE + "/#/rules/red/u5", { waitUntil: "load" });
  await rp.waitForSelector(".rulepages .pagecanvas", { timeout: 60000 });
  ok("F14 red's rule opens as the book page", (await rp.locator(".rulesheet").count()) === 0);
  ok("F14 no page errors", !results.some((r) => r[1] === "F14 pageerror"));
  await rctx.close();

  // phone: the list, then the rule with a way back
  const rm = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const rmp = await rm.newPage();
  await rmp.goto(BASE + "/#/rules/blue", { waitUntil: "load" });
  await rmp.waitForSelector(".rulerow", { timeout: 30000 });
  await rmp.locator(".rulerow", { hasText: "Present perfect 1" }).click();
  await rmp.waitForSelector(".rulesheet", { timeout: 30000 });
  ok(
    "F14 phone: the rule replaces the list, no sideways scroll",
    (await rmp.locator(".rulesnav").count()) === 0 &&
      (await rmp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)),
  );
  await rmp.locator(".ruleback").click();
  await rmp.waitForSelector(".rulesnav .rulerow", { timeout: 10000 });
  ok("F14 phone: back to the list", /#\/rules\/blue$/.test(rmp.url()));
  await rm.close();
}

// ---------- Flow 15: adding words to the dictionary ----------
// the lookup sources are mocked: the flow must not depend on external APIs
async function mockLookups(c, { fail = false } = {}) {
  const cors = { "access-control-allow-origin": "*" };
  await c.route("**/api.dictionaryapi.dev/**", (r) =>
    fail
      ? r.fulfill({ status: 522, body: "error code: 522", headers: cors })
      : r.fulfill({
          headers: cors,
          json: [
            {
              word: "sensible",
              phonetic: "/ˈsɛnsɪbl̩/",
              phonetics: [{ text: "/ˈsɛnsɪbl̩/", audio: "" }],
              meanings: [{ partOfSpeech: "adjective", definitions: [{ definition: "Acting with or showing good sense." }] }],
            },
          ],
        }),
  );
  await c.route("**/en.wiktionary.org/**", (r) =>
    fail
      ? r.abort()
      : r.fulfill({
          headers: cors,
          json: {
            parse: {
              wikitext:
                "==English==\n===Adjective===\n====Translations====\n{{trans-top|acting with or showing good sense}}\n* Russian: {{t+|ru|разу́мный}}, {{t+|ru|благоразу́мный}}\n{{trans-bottom}}\n{{trans-top|perceptible by the senses}}\n* Russian: {{t|ru|ощути́мый}}\n{{trans-bottom}}\n",
            },
          },
        }),
  );
  await c.route("**/api.mymemory.translated.net/**", (r) =>
    r.fulfill({
      headers: cors,
      json: fail
        ? { responseStatus: 429, responseData: { translatedText: "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY" } }
        : { responseStatus: 200, responseData: { translatedText: "разумный" }, matches: [] },
    }),
  );
}
const wctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
{
  await mockLookups(wctx);
  const wp = await wctx.newPage();
  wp.on("pageerror", (e) => results.push(["FAIL", "F15 pageerror", String(e).slice(0, 140)]));
  await wp.goto(BASE + "/#/dictionary", { waitUntil: "load" });
  await wp.waitForSelector(".addbar input", { timeout: 30000 });
  ok("F15 an empty dictionary explains itself", await wp.locator(".emptysheet").isVisible());
  await wp.fill(".addbar input", "sensible");
  await wp.keyboard.press("Enter");
  await wp.waitForSelector(".wordmodal .transchip", { timeout: 10000 });
  ok(
    "F15 the lookup fills translation, IPA and definitions",
    (await wp.inputValue("#word-translation")) === "разумный, благоразумный" &&
      /sɛnsɪbl/.test((await wp.locator(".wordmodal .ipa").textContent()) ?? "") &&
      /good sense/.test(await wp.locator(".wordmodal .senses").innerText()),
    await wp.inputValue("#word-translation"),
  );
  await wp.locator(".transchip", { hasText: "ощутимый" }).click();
  ok("F15 a candidate chip adds itself to the translation", /ощутимый$/.test(await wp.inputValue("#word-translation")));
  await wp.fill("#word-notes", "a sensible decision");
  await wp.locator(".wordmodal .primary").click();
  await wp.waitForSelector(".wordrow", { timeout: 5000 });
  const saved = await wp.evaluate(() => JSON.parse(localStorage.getItem("murrnglish.words-v1")).words);
  ok(
    "F15 the word is saved with what the lookup found",
    saved.length === 1 && saved[0].word === "sensible" && !!saved[0].ipa && saved[0].senses?.length === 1 && saved[0].reverse,
    JSON.stringify(saved[0]).slice(0, 160),
  );
  ok("F15 the list shows it as new", /new/.test((await wp.locator(".wordrow .statepill").textContent()) ?? ""));

  // every source failing: the word is still saved with a typed translation
  const fctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await mockLookups(fctx, { fail: true });
  const fp = await fctx.newPage();
  await fp.goto(BASE + "/#/dictionary", { waitUntil: "load" });
  await fp.waitForSelector(".addbar input", { timeout: 30000 });
  await fp.fill(".addbar input", "look after");
  await fp.keyboard.press("Enter");
  await fp.waitForSelector(".wordmodal .lookupstatus.warn", { timeout: 20000 });
  ok(
    "F15 failed lookups say so and leave the form usable",
    /type the translation yourself/i.test((await fp.locator(".wordmodal .lookupstatus").textContent()) ?? ""),
    (await fp.locator(".wordmodal .lookupstatus").textContent()) ?? "",
  );
  await fp.fill("#word-translation", "присматривать");
  await fp.keyboard.press("Control+Enter");
  await fp.waitForSelector(".wordrow", { timeout: 5000 });
  ok("F15 Ctrl+Enter saves the typed translation", /присматривать/.test(await fp.locator(".wordrow").innerText()));
  await fctx.close();

  // picked from an exercise: the sentence and the unit come along
  await wp.goto(BASE + "/#/blue/u12", { waitUntil: "load" });
  await wp.waitForSelector(".rightpane .exercise .item", { timeout: 30000 });
  await wp.evaluate(() => {
    const w = document.createTreeWalker(document.querySelector(".rightpane .exercise"), NodeFilter.SHOW_TEXT);
    let t;
    while ((t = w.nextNode())) if (/Brazil/.test(t.textContent)) break;
    const i = t.textContent.indexOf("Brazil");
    const r = document.createRange();
    r.setStart(t, i);
    r.setEnd(t, i + 6);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await wp.waitForSelector(".pickword", { timeout: 5000 });
  ok("F15 selecting a word offers to add it", /Brazil/.test((await wp.locator(".pickword").textContent()) ?? ""));
  await wp.locator(".pickword").click();
  await wp.waitForSelector(".wordmodal .wordcontext", { timeout: 10000 });
  ok("F15 the sentence comes along", /Paul has lived in Brazil/.test(await wp.locator(".wordmodal .wordcontext").innerText()));
  await wp.locator(".wordmodal .primary").click();
  const picked = await wp.evaluate(() =>
    JSON.parse(localStorage.getItem("murrnglish.words-v1")).words.find((w) => w.word === "Brazil"),
  );
  ok("F15 the word remembers its unit", picked?.source?.book === "blue" && picked?.source?.unit === 12, JSON.stringify(picked?.source));
  ok("F15 no page errors", !results.some((r) => r[1] === "F15 pageerror"));
}

// ---------- Flow 16: reviewing cards ----------
{
  const sp = await wctx.newPage();
  sp.on("pageerror", (e) => results.push(["FAIL", "F16 pageerror", String(e).slice(0, 140)]));
  await sp.goto(BASE + "/#/cards/blue/u12", { waitUntil: "load" });
  await sp.waitForSelector(".studycard .gap", { timeout: 30000 });
  const fresh0 = Number(await sp.locator(".studyhead .count.fresh").textContent());
  ok("F16 a unit deck opens on its first card", /Paul has lived in Brazil/.test(await sp.locator(".studycard").innerText()));
  await sp.keyboard.type("for");
  await sp.keyboard.press("Enter");
  await sp.waitForSelector(".ratebtns", { timeout: 5000 });
  ok(
    "F16 a right typed answer is checked and Good is suggested",
    (await sp.locator(".studycard .gap.ok").count()) === 1 &&
      /Good/.test((await sp.locator(".ratebtn.suggest").textContent()) ?? ""),
  );
  ok(
    "F16 the buttons show their intervals",
    (await sp.locator(".ratebtn .rateivl").allTextContents()).join(" ") === "1m 6m 10m 4d",
    (await sp.locator(".ratebtn .rateivl").allTextContents()).join(" "),
  );
  await sp.keyboard.press("Space");
  await sp.waitForFunction(() => !document.querySelector(".ratebtns"), null, { timeout: 5000 });
  const st = await sp.evaluate(() => JSON.parse(localStorage.getItem("murrnglish.srs-v1")).states["blue:12.1:2"]);
  ok(
    "F16 Space answers Good: the card is learning, due in 10 minutes",
    st?.kind === "learning" && Math.abs(st.due - st.last - 600000) < 1000,
    JSON.stringify(st),
  );
  ok("F16 the new count goes down", Number(await sp.locator(".studyhead .count.fresh").textContent()) === fresh0 - 1);
  await sp.waitForSelector(".studycard .gap", { timeout: 5000 });
  await sp.keyboard.type("qqq");
  await sp.keyboard.press("Enter");
  await sp.waitForSelector(".ratebtns", { timeout: 5000 });
  ok(
    "F16 a wrong answer is marked and Again is suggested",
    (await sp.locator(".studycard .gap.bad").count()) >= 1 && /Again/.test((await sp.locator(".ratebtn.suggest").textContent()) ?? ""),
  );
  await sp.keyboard.press("Digit1");
  await sp.waitForFunction(() => !document.querySelector(".ratebtns"), null, { timeout: 5000 });
  const before = await sp.locator(".studycard").innerText();
  await sp.keyboard.press("Control+z");
  await sp.waitForFunction((b) => document.querySelector(".studycard")?.innerText !== b, before, { timeout: 5000 });
  const undone = await sp.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("murrnglish.srs-v1")).states));
  ok("F16 Ctrl+Z takes the last answer back", undone.length === 1, undone.join(","));
  await sp.keyboard.press("Shift+?");
  await sp.waitForSelector(".helpcard", { timeout: 5000 });
  ok("F16 Shift+? shows the review keys", /Again, Hard, Good, Easy/.test(await sp.locator(".helpcard").innerText()));
  await sp.keyboard.press("Escape");

  // a choice card: a number key picks the option
  await sp.goto(BASE + "/#/cards/blue/u11", { waitUntil: "load" });
  await sp.waitForSelector(".choiceopt", { timeout: 30000 });
  await sp.keyboard.press("Digit1");
  await sp.waitForSelector(".choiceopt.ok", { timeout: 5000 });
  ok("F16 a number picks an option and turns the card", (await sp.locator(".ratebtns").count()) === 1);

  // the deck list: the started unit is in "everything", with its counts
  await sp.goto(BASE + "/#/cards", { waitUntil: "load" });
  await sp.waitForSelector(".deckgroup", { timeout: 30000 });
  const today = await sp.locator(".todaysheet .counts").innerText();
  ok(
    "F16 everything due counts the started units and the words",
    Number((today.match(/\d+/) ?? ["0"])[0]) > 0,
    today.replace(/\s+/g, " "),
  );
  ok("F16 each book lists its groups", (await sp.locator(".booksheet").count()) === 2);
  await sp.locator(".todaycta").click();
  await sp.waitForURL(/#\/cards\/all$/, { timeout: 5000 });
  await sp.waitForSelector(".studycard", { timeout: 30000 });
  ok("F16 study everything opens a card", true);

  // the words deck: word -> translation
  await sp.goto(BASE + "/#/cards/words", { waitUntil: "load" });
  await sp.waitForSelector(".studycard .wordbig", { timeout: 30000 });
  await sp.keyboard.press("Space");
  await sp.waitForSelector(".ratebtns", { timeout: 5000 });
  ok("F16 a word card turns to its translation", /разумный/.test(await sp.locator(".studycard").innerText()));

  // the library shows what is due once a card is
  await sp.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("murrnglish.srs-v1"));
    const day = 864e5;
    s.states["blue:12.1:3"] = { kind: "review", due: Date.now() - day, ivl: 3, ease: 2.5, step: 0, reps: 3, lapses: 0, last: Date.now() - 4 * day };
    localStorage.setItem("murrnglish.srs-v1", JSON.stringify(s));
  });
  await sp.goto(BASE + "/#/", { waitUntil: "load" });
  await sp.reload({ waitUntil: "load" });
  await sp.waitForSelector(".studygrid", { timeout: 30000 });
  ok("F16 the library shows the due count", Number(await sp.locator(".studytile .duebadge").textContent()) >= 1);

  // backup: export here, import into a browser that has nothing
  await sp.goto(BASE + "/#/dictionary", { waitUntil: "load" });
  await sp.waitForSelector(".backup", { timeout: 30000 });
  const [dl] = await Promise.all([sp.waitForEvent("download"), sp.locator(".backup button", { hasText: "Export" }).click()]);
  ok("F16 the backup downloads", /^murrnglish-study-.*\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  const file = await dl.path();
  const ictx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const ip = await ictx.newPage();
  await ip.goto(BASE + "/#/dictionary", { waitUntil: "load" });
  await ip.waitForSelector(".backup", { timeout: 30000 });
  await ip.locator('.backup input[type="file"]').setInputFiles(file);
  await ip.waitForSelector(".wordrow", { timeout: 5000 });
  ok(
    "F16 importing the backup brings the words and reviews",
    (await ip.locator(".wordrow").count()) === 2 &&
      (await ip.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("murrnglish.srs-v1")).states).length)) >= 2,
    (await ip.locator(".backup .modal-msg").innerText()).trim(),
  );
  await ictx.close();
  ok("F16 no page errors", !results.some((r) => r[1] === "F16 pageerror"));

  // phone: the review screen fits
  const sm = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const smp = await sm.newPage();
  await smp.goto(BASE + "/#/cards/blue/u12", { waitUntil: "load" });
  await smp.waitForSelector(".showbtn", { timeout: 30000 });
  await smp.locator(".showbtn").tap();
  await smp.waitForSelector(".ratebtns", { timeout: 5000 });
  ok(
    "F16 phone: four answer buttons in one row, no sideways scroll",
    (await smp.evaluate(() => new Set([...document.querySelectorAll(".ratebtn")].map((b) => Math.round(b.getBoundingClientRect().top))).size)) === 1 &&
      (await smp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)),
  );
  await sm.close();
}
await wctx.close();

// ---------- Flow 17: reviewing and the dictionary offline ----------
if (BASE.includes("4173")) {
  const octx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const op = await octx2.newPage();
  op.on("pageerror", (e) => results.push(["FAIL", "F17 pageerror", String(e).slice(0, 140)]));
  await op.goto(BASE + "/#/cards/blue/u12", { waitUntil: "load" });
  await op.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }));
  });
  // once more under the worker, so it keeps what the session loads
  await op.reload({ waitUntil: "load" });
  await op.waitForSelector(".studycard", { timeout: 30000 });
  await sleep(1500);
  await octx2.setOffline(true);
  await op.reload({ waitUntil: "load" });
  await op.waitForSelector(".studycard .gap", { timeout: 30000 });
  await op.keyboard.type("for");
  await op.keyboard.press("Enter");
  await op.waitForSelector(".ratebtns", { timeout: 5000 });
  await op.keyboard.press("Digit3");
  await op.waitForFunction(() => !document.querySelector(".ratebtns"), null, { timeout: 5000 });
  ok(
    "F17 offline: a unit deck is reviewed",
    await op.evaluate(() => !!JSON.parse(localStorage.getItem("murrnglish.srs-v1")).states["blue:12.1:2"]),
  );
  await op.goto(BASE + "/#/dictionary", { waitUntil: "load" });
  await op.waitForSelector(".addbar input", { timeout: 30000 });
  await op.fill(".addbar input", "offline");
  await op.keyboard.press("Enter");
  await op.waitForSelector(".wordmodal .lookupstatus.warn", { timeout: 10000 });
  ok("F17 offline: the lookup says it is offline", /Offline/.test((await op.locator(".wordmodal .lookupstatus").textContent()) ?? ""));
  await op.fill("#word-translation", "вне сети");
  await op.locator(".wordmodal .primary").click();
  await op.waitForSelector(".wordrow", { timeout: 5000 });
  ok("F17 offline: the word is saved anyway", /вне сети/.test(await op.locator(".wordrow").innerText()));
  ok("F17 no page errors", !results.some((r) => r[1] === "F17 pageerror"));
  await octx2.close();
}

// ---------- Flow 18: word packs and choosing what to study ----------
{
  const vctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const vp = await vctx.newPage();
  vp.on("pageerror", (e) => results.push(["FAIL", "F18 pageerror", String(e).slice(0, 140)]));
  await vp.goto(BASE + "/#/cards", { waitUntil: "load" });
  await vp.waitForSelector(".packrow", { timeout: 30000 });
  const todayNew = async () => Number(((await vp.locator(".todaysheet .count.fresh").innerText()).match(/\d+/) ?? ["0"])[0]);
  ok("F18 a fresh learner has nothing due", (await todayNew()) === 0);
  const blue = vp.locator(".booksheet", { hasText: "English Grammar in Use" });
  await blue.locator(".packrow", { hasText: "Irregular verbs" }).locator(".pickbox").check();
  ok("F18 ticking a pack puts it in daily study", (await todayNew()) > 0);
  // a group's tick takes its units without opening the group
  const red = vp.locator(".booksheet", { hasText: "Essential Grammar in Use" });
  const group = red.locator(".deckgroup").first();
  await group.locator("summary .pickbox").check();
  ok("F18 a group's tick leaves the group folded", !(await group.evaluate((d) => d.open)));
  ok("F18 the book says how much of it is in", /10 of 115 units/.test(await red.locator(".decksummary").innerText()));
  await red.locator(".bookswitch").click();
  ok("F18 a book switched off hides its decks", (await red.locator(".deckgroup").count()) === 0);
  const include = await vp.evaluate(() => JSON.parse(localStorage.getItem("murrnglish.srs-settings-v1")).include);
  ok("F18 the choice is saved", include.red === false && include["blue/pack-irregular-verbs"] === true && include["red/u1"] === true);

  // a forms card: both forms typed, checked
  await vp.goto(BASE + "/#/cards/blue/pack-irregular-verbs", { waitUntil: "load" });
  await vp.waitForSelector(".formsrow input", { timeout: 30000 });
  await vp.keyboard.type("was");
  await vp.keyboard.press("Enter");
  await vp.keyboard.type("been");
  await vp.keyboard.press("Enter");
  await vp.waitForSelector(".ratebtns", { timeout: 5000 });
  ok("F18 right forms suggest Good", /Good/.test(await vp.locator(".ratebtn.suggest").innerText()));
  await vp.keyboard.press("Digit3");
  await vp.waitForFunction(() => !document.querySelector(".ratebtns"), null, { timeout: 5000 });
  ok(
    "F18 the pack card is scheduled",
    await vp.evaluate(() => !!JSON.parse(localStorage.getItem("murrnglish.srs-v1")).states["v:blue:irregular-verbs:be"]),
  );

  // the dictionary: a pack opens from its link, and the search reads the packs
  await vp.goto(BASE + "/#/dictionary/blue/pack-phrasal-verbs", { waitUntil: "load" });
  await vp.waitForSelector(".packfold[open] .packentries li", { timeout: 30000 });
  ok("F18 the pack's words open in the dictionary", /Phrasal verbs/.test(await vp.locator(".packfold[open]").innerText()));
  await vp.fill(".addbar input", "look after");
  await vp.waitForSelector(".packhits li", { timeout: 5000 });
  ok("F18 the search finds pack entries", /присматривать/.test(await vp.locator(".packhits").innerText()));
  ok("F18 no page errors", !results.some((r) => r[1] === "F18 pageerror"));
  await vctx.close();
}

await mctx.close();
await ctx.close();
await browser.close();

let failed = 0;
for (const [status, name, extra] of results) {
  if (status === "FAIL") failed++;
  console.log(`${status}  ${name}${extra ? "  — " + extra : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
