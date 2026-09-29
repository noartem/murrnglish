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

// ---------- Flow 1: landing + first open defaults ----------
page.on("pageerror", (e) => results.push(["FAIL", "F1 pageerror", String(e).slice(0, 140)]));
await page.goto(BASE + "/", { waitUntil: "load" });
ok("F1 landing cover", await page.locator(".homecover").isVisible());
await page.locator(".homecta").click();
await page.waitForSelector(".pagecanvas", { timeout: 30000 });
await sleep(1500);
ok("F1 url is #u1", /#u1$/.test(page.url()));
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
await page.waitForURL(/#u2/, { timeout: 30000 });
await page.waitForFunction(
  () => document.querySelector(".unitheading")?.textContent?.includes("Unit 2"),
  { timeout: 10000 },
);
ok("F4 sidebar nav to unit 2", /#u2$/.test(page.url()));
ok(
  "F4 heading shows unit 2",
  /Unit 2/.test((await page.locator(".unitheading").first().textContent()) ?? ""),
);
await page.locator(".unitnavbtn.next").click();
await page.waitForURL(/#u3/, { timeout: 30000 });
ok("F4 pager next to unit 3", /#u3$/.test(page.url()));
await page.locator(".unitnavbtn.prev").click();
await page.waitForURL(/#u2/, { timeout: 30000 });
ok("F4 pager prev back to unit 2", /#u2$/.test(page.url()));

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
ok("F9 E downloads the progress file", /red-murphy-progress-.*\.json$/.test(file.suggestedFilename()), file.suggestedFilename());

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
  (await page.evaluate(() => navigator.clipboard.readText())).includes("#p="),
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
  "Unit 13 — " + (await (await fetch(BASE + "/data/index.json")).json()).exercises.u13.title;
{
  // fresh context: an empty HTTP cache, so book.pdf is a real network load
  // and the resource timings below describe a first visit
  const octx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const slow = await octx.newPage();
  await slow.route("**/data/units/unit-013.json", async (route) => {
    await sleep(2500);
    await route.continue();
  });
  await slow.goto(BASE + "/#u13", { waitUntil: "domcontentloaded" });
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
await mp.goto(BASE + "/#u1", { waitUntil: "load" });
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
ok("F8 navigated to unit 2", /#u2/.test(mp.url()));

// drawer: the topbar title also closes the drawer (goes home from there)
await mp.locator(".sidebartoggle").click();
await sleep(300);
ok("F8 drawer reopens", (await mp.locator(".sidebar.mobile-open").count()) === 1);
await mp.locator(".topbar-home").click();
await sleep(300);
ok("F8 topbar title closes drawer", (await mp.locator(".sidebar.mobile-open").count()) === 0);
ok("F8 topbar title goes home", /#home/.test(mp.url()));
// back on a unit for the pinch-zoom test (the topbar title left us at home
// on the Exercises tab; the hash change doesn't reload, so re-pick Book)
await mp.goto(BASE + "/#u2", { waitUntil: "load" });
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
  localStorage.setItem("red-murphy-sidebar-collapsed", "1"),
);
await page.goto(BASE + "/#home", { waitUntil: "load" });
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
    (await page.locator('[aria-label="Offline: download the course"]').count()) === 0,
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
  await p2.goto(BASE + "/", { waitUntil: "load" });
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
    await p2.locator('[aria-label="Offline: download the course"]').isVisible(),
  );
  await p2.locator('[aria-label="Offline: download the course"]').click();
  await p2.getByRole("button", { name: "Download course", exact: true }).click();
  ok("F12 progress bar appears", await p2.locator(".dlbar").isVisible());
  await p2.locator("text=Downloaded for offline use").waitFor({ timeout: 180000 });
  ok(
    "F12 download finishes and offers a remove action",
    await p2.getByRole("button", { name: "Remove downloaded files", exact: true }).isVisible(),
  );

  // offline now. The hash step is same-document, so the only request left is
  // the reload — a real navigation the service worker has to answer from the
  // cache, followed by the unit JSON, the book and the pdf.js chunks.
  await ctx2.setOffline(true);
  await p2.evaluate(() => {
    location.hash = "#u5";
  });
  await p2.reload({ waitUntil: "load" });
  await p2.waitForSelector(".pagecanvas", { timeout: 60000 });
  ok("F12 offline unit renders the book", (await p2.locator(".pagecanvas").count()) >= 1);
  await p2.waitForSelector(".rightpane .exercise", { timeout: 60000 });
  ok("F12 offline exercises render", await p2.locator(".rightpane .exercise").first().isVisible());
  ok("F12 no errors while offline", !results.some((r) => r[1] === "F12 pageerror"));

  // the way back out: removing drops the cache and the flag, and the panel
  // offers the download again
  await p2.locator('[aria-label="Offline: download the course"]').click();
  await p2.getByRole("button", { name: "Remove downloaded files", exact: true }).click();
  await p2.getByRole("button", { name: "Download course", exact: true }).waitFor({ timeout: 30000 });
  const removed = await p2.evaluate(async () => {
    const c = await caches.open("egu-course-offline-v1");
    return {
      book: (await c.match("/book.pdf", { ignoreVary: true })) !== undefined,
      flag: localStorage.getItem("egu-course-offline-v1"),
    };
  });
  ok(
    "F12 removing the download clears the cache and the flag",
    !removed.book && removed.flag === null,
    JSON.stringify(removed),
  );
  await ctx2.setOffline(false);
  await ctx2.close();
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
