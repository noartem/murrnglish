// E2E flows against the Vite dev server (127.0.0.1:5173, `npm run dev`).
// Playwright resolves from the npx cache (`npx playwright` has been run
// before); no package.json dependency.
// Run: node e2e.mjs
import { createRequire } from "node:module";
import path from "node:path";
import { readFile } from "node:fs/promises";
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

// The data window opens from the header on a desktop (on a phone, from the
// drawer), and nowhere else.
async function openData(p) {
  await p.locator('.topbar button[aria-label^="Progress and data"]').click();
  await p.waitForSelector('.modal[aria-label="Progress and data"]', { timeout: 10000 });
}

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
  libTitles.join("|") === "English Grammar: Foundations|English Grammar: Progress",
  libTitles.join("|"),
);
await page.locator(".libtitle a", { hasText: "English Grammar: Progress" }).click();

// ---------- Flow 1: book landing + first open defaults ----------
await page.waitForSelector(".homecover", { timeout: 30000 });
ok("F1 landing cover", await page.locator(".homecover").isVisible());
ok("F1 landing url is #/blue", /#\/blue$/.test(page.url()), page.url());
const pdfRequests = [];
page.on("request", (r) => /\.pdf$/.test(new URL(r.url()).pathname) && pdfRequests.push(r.url()));
await page.locator(".homecta").click();
await page.waitForSelector(".lesson .lsection", { timeout: 30000 });
await sleep(800);
ok("F1 url is #/blue/u1", /#\/blue\/u1$/.test(page.url()));
ok("F1 the unit opens on its lesson", await page.locator(".lessonhead .lessonsticker").isVisible());
ok("F1 the lesson has its lettered sections", (await page.locator(".lsection .lletter").count()) >= 2);
ok("F1 no book page anywhere", (await page.locator(".pageviewer, .pagecanvas").count()) === 0 && pdfRequests.length === 0,
  pdfRequests.join(" "));
ok("F1 sidebar collapsed card", (await page.locator(".sidebar.collapsed").count()) === 1);
ok("F1 exercises under the lesson", (await page.locator(".coursepane .practicediv ~ .exercise").count()) > 0);
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
// the panel settles as the fixed hover card, whichever way it was closed
await page.waitForFunction(
  () => !!document.querySelector(".sidebar.collapsed"),
  undefined,
  { timeout: 5000 },
);
ok("F3 sidebar collapses again", true);
// and the left-edge zone brings it back over the page
await page.mouse.move(4, 400);
await page.waitForFunction(
  () => getComputedStyle(document.querySelector("nav.sidebar")).opacity === "1",
  undefined,
  { timeout: 5000 },
);
ok("F3 collapsed card comes back on the left edge", true);
await page.mouse.move(900, 700);
await sleep(400);
ok(
  "F3 it hides again when the pointer leaves",
  await page.evaluate(
    () => getComputedStyle(document.querySelector("nav.sidebar")).opacity === "0",
  ),
);

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

// ---------- Flow 5: the jump bar and Shift+S between lesson and exercises ----------
await page.waitForSelector(".unitjumps .jumpchip", { timeout: 30000 });
const paneTop = () =>
  page.evaluate(() => document.querySelector(".coursepane [data-overlayscrollbars-viewport]").scrollTop);
// the chip is marked by the pane's scroll listener, so it settles a frame
// after the page paints — wait for it rather than racing it
await page.waitForFunction(
  () => document.querySelector(".jumpchip.on")?.textContent?.trim() === "Lesson",
  null,
  { timeout: 5000 },
);
ok("F5 the jump bar starts on the lesson", true);
await page.locator(".jumpchip", { hasText: /^2\.3$/ }).click();
await page.waitForFunction(() => document.querySelector(".jumpchip.on")?.textContent?.trim() === "2.3", null, {
  timeout: 5000,
});
ok("F5 a chip scrolls to its exercise and lights up", true);
ok(
  "F5 the bar stays at the top of the pane",
  await page.evaluate(() => {
    const bar = document.querySelector(".unitjumps").getBoundingClientRect();
    const vp = document.querySelector(".coursepane [data-overlayscrollbars-viewport]").getBoundingClientRect();
    return Math.abs(bar.top - vp.top) < 2;
  }),
);
await page.locator(".jumpchip", { hasText: "Lesson" }).click();
await page.waitForFunction(
  () => document.querySelector(".coursepane [data-overlayscrollbars-viewport]").scrollTop < 2,
  null,
  { timeout: 5000 },
);
ok("F5 the lesson chip goes back to the top", true);
await page.keyboard.press("Shift+KeyS");
await page
  .waitForFunction(
    () =>
      document.activeElement?.closest(".exercise") !== null &&
      // the smooth scroll has landed: the divider sits under the jump bar
      document.getElementById("practice").getBoundingClientRect().top -
        document.querySelector(".coursepane [data-overlayscrollbars-viewport]").getBoundingClientRect().top <
        80,
    null,
    { timeout: 5000 },
  )
  .catch(() => {});
ok(
  "F5 Shift+S goes down to the first exercise",
  (await paneTop()) > 300 && (await page.evaluate(() => document.activeElement?.closest(".exercise") !== null)),
  `scrollTop ${await paneTop()}`,
);
await page.keyboard.press("Shift+KeyS");
await page.waitForFunction(
  () => document.querySelector(".coursepane [data-overlayscrollbars-viewport]").scrollTop < 2,
  null,
  { timeout: 5000 },
);
ok("F5 Shift+S again goes back up to the lesson", await page.evaluate(() => document.activeElement?.id === "lesson"));

// ---------- Flow 6: the progress and data window ----------
// One window for both: it leads with every book's progress, then the data
// that moves it. The panel's own button and Alt+D / Shift+I open the same
// thing.
await openData(page);
ok("F6 the window opens", await page.locator('.modal h2:text("Progress and data")').isVisible());
await page.waitForSelector(".modal .unitsq", { timeout: 30000 });
// a mosaic per book, both books' units in all
ok("F6 both books carry a unit mosaic",
  (await page.locator(".modal .unitgrid").count()) === 2 &&
    (await page.locator(".modal .unitsq").count()) === 115 + 35 + 145 + 41,
  `${await page.locator(".modal .unitgrid").count()} grids, ${await page.locator(".modal .unitsq").count()} squares`);
await page.locator('.modal button[aria-label="Close"]').click();
await sleep(300);
ok("F6 the window closes", (await page.locator('.modal[aria-label="Progress and data"]').count()) === 0);

// ---------- Flow 9: Shift+I opens the data window with hint keys ----------
// The window opened this way underlines the access letter of each control
// (F / P / C / D / A, and the I / E / S / L of the four buttons) and a plain
// letter clicks that control.
await page.keyboard.press("Shift+KeyI");
await page.waitForSelector('.modal[aria-label="Progress and data"]', { timeout: 10000 });
const hintLetters = await page.locator(".modal .hintkey").allTextContents();
// one letter per control, in the order they render: the F of "Foundations",
// the P of "Progress", C, D, the "a" of "answer", L, then I / E / S (in
// "Copy share link" the marked S is the one in "share")
ok(
  "F9 Shift+I opens with one hint letter per control",
  hintLetters.length === 9 && hintLetters.join("") === "FPCDaLIEs",
  hintLetters.join(""),
);
ok(
  "F9 hint letters sit on their controls",
  (await page.locator(".modal [data-modal-key]").evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-modal-key")),
  )).join("") === "KeyFKeyPKeyCKeyDKeyAKeyLKeyIKeyEKeyS",
);
// the "a" belongs to "answer", and no flex gap splits the label around it
const hintGap = await page.locator('[data-modal-key="KeyI"] .hintkey').evaluate((el) => {
  const self = el.getBoundingClientRect();
  const r = document.createRange();
  r.setStart(el.nextSibling, 0);
  r.setEnd(el.nextSibling, 1);
  return r.getBoundingClientRect().left - self.right;
});
ok("F9 no gap inside the hinted label", hintGap < 2, `${hintGap}px`);

// a book ticks from its own letter, the cards and the dictionary from theirs
const redBox = page.locator('[data-modal-key="KeyF"] input[type="checkbox"]');
const cardsBox = page.locator('[data-modal-key="KeyC"] input[type="checkbox"]');
await page.keyboard.press("KeyF");
await page.keyboard.press("KeyC");
await sleep(150);
ok("F9 F and C tick the red book and the cards", await redBox.isChecked() && await cardsBox.isChecked());
await page.keyboard.press("KeyF");
await page.keyboard.press("KeyC");
await sleep(150);
ok("F9 and untick them again", !(await redBox.isChecked()) && !(await cardsBox.isChecked()));

// the books with progress start ticked, so the window has something to write
// from the first frame; with nothing ticked there is no progress to share
const blueBox = page.locator('.modal-opt', { hasText: "English Grammar: Progress" }).locator("input");
const redRow = page.locator('.modal-opt', { hasText: "English Grammar: Foundations" });
ok(
  "F9 the book with progress starts ticked, the untouched one does not",
  (await blueBox.isChecked()) && !(await redRow.locator("input").isChecked()),
);
await blueBox.uncheck();
await sleep(150);
ok(
  "F9 share is disabled with no book ticked",
  await page.locator('[data-modal-key="KeyS"]').isDisabled(),
);
await blueBox.check();
ok("F9 share is enabled with one book ticked", !(await page.locator('[data-modal-key="KeyS"]').isDisabled()));
// a link carries one book: with both ticked it carries the one in view
await redRow.locator("input").check();
ok(
  "F9 share stays enabled with both books ticked",
  !(await page.locator('[data-modal-key="KeyS"]').isDisabled()) &&
    /Progress/.test(await page.locator('[data-modal-key="KeyS"]').getAttribute("title")),
);
await redRow.locator("input").uncheck();

const answersBox = page.locator('[data-modal-key="KeyA"] input[type="checkbox"]');
const wasChecked = await answersBox.isChecked();
await page.keyboard.press("KeyA");
await sleep(150);
ok("F9 A toggles Include answer texts", (await answersBox.isChecked()) !== wasChecked);
await page.keyboard.press("KeyA");
await sleep(150);
ok("F9 A toggles it back", (await answersBox.isChecked()) === wasChecked);
ok("F9 the window stays open", (await page.locator('.modal[aria-label="Progress and data"]').count()) === 1);

// E exports: the download is the observable effect
const [file] = await Promise.all([
  page.waitForEvent("download", { timeout: 8000 }),
  page.keyboard.press("KeyE"),
]);
ok("F9 E downloads the data file", /^murrnglish-data-.*\.json$/.test(file.suggestedFilename()), file.suggestedFilename());
const exported = JSON.parse(await (await import("node:fs/promises")).readFile(await file.path(), "utf8"));
ok(
  "F9 the file names its format, version and the ticked book",
  exported.format === "murrnglish-data" &&
    exported.version === 3 &&
    Object.keys(exported.books).join("") === "blue" &&
    exported.cards === null,
  JSON.stringify({ format: exported.format, version: exported.version, books: Object.keys(exported.books) }),
);
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
ok("F9 Shift+I does not act as the Import hint", (await page.locator('.modal[aria-label="Progress and data"]').count()) === 1);

// reopening from the panel's button drops the hints
await page.keyboard.press("Escape");
await sleep(350);
await openData(page);
ok("F9 button open has no hints", (await page.locator(".modal .hintkey").count()) === 0);
const plainBefore = await answersBox.isChecked();
await page.keyboard.press("KeyA");
await sleep(200);
ok("F9 plain letters are inert without hints", (await answersBox.isChecked()) === plainBefore);
await page.keyboard.press("Escape");
await sleep(350);
ok("F9 Esc closes the window", (await page.locator('.modal[aria-label="Progress and data"]').count()) === 0);

// ---------- Flow 9b: an incoming share link previews in the same window ----------
// The link copied above carries one book's progress. Opened where that
// progress is gone, the window previews it — the summary and that book's
// mosaic — and writes nothing until Apply.
{
  const code = /#\/blue\/p=(.+)$/.exec(await page.evaluate(() => navigator.clipboard.readText()))?.[1];
  ok("F9b the clipboard holds a share link", Boolean(code), String(code));
  await page.evaluate(() => localStorage.removeItem("murrnglish.blue.progress-v1"));
  await page.goto(`${BASE}/#/blue/p=${code}`, { waitUntil: "load" });
  await page.waitForSelector('.modal[aria-label="Progress and data"]', { timeout: 30000 });
  await page.waitForSelector(".modal .unitsq", { timeout: 30000 });
  const incoming = (await page.locator(".modal-summary").last().innerText()).trim();
  ok("F9b the link opens the window with its progress previewed",
    /Incoming from a link: English Grammar: Progress/.test(incoming), incoming);
  ok("F9b the preview reaches that book's mosaic",
    (await page.locator(".modal .databook").nth(1).locator(".unitsq.done").count()) > 0);
  ok("F9b nothing is written before Apply",
    (await page.evaluate(() => localStorage.getItem("murrnglish.blue.progress-v1"))) === null);
  await page.locator('.modal button:text("Apply")').click();
  await sleep(300);
  const applied = (await page.locator(".modal-msg").innerText()).trim();
  const restored = await page.evaluate(
    () => Object.keys(JSON.parse(localStorage.getItem("murrnglish.blue.progress-v1") ?? "{}").results ?? {}),
  );
  ok("F9b Apply writes the link's progress into that book",
    applied === "Applied to English Grammar: Progress" && restored.length > 0,
    `${applied} / ${restored.length} results`);
  await page.keyboard.press("Escape");
  await sleep(350);
  ok("F9b Esc leaves the course with nothing pending",
    (await page.locator(".modal-overlay").count()) === 0);
}

// ---------- Flow 10: unit loading placeholder ----------
// With the unit JSON held, the pane shows the placeholder under the unit's
// real heading (index.json knows the title), and the heading does not change
// when the unit lands.
const UNIT13_TITLE =
  "Unit 13 — " + (await (await fetch(BASE + "/books/blue/data/index.json")).json()).exercises.u13.title;
{
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
    liveCards: document.querySelectorAll(".coursepane .exercise:not(.skel-card)").length,
    heading: document.querySelector(".unitloading .unitheading")?.textContent ?? "",
  }));
  ok("F10 placeholder while unit JSON is in flight", held.skelCards === 2 && held.liveCards === 0);
  ok("F10 placeholder mirrors the card shape", held.skelRows === 8, JSON.stringify(held));
  ok("F10 placeholder is announced as loading", held.label === "Loading", held.label ?? "none");
  ok("F10 placeholder shows the real title, not a bar", held.heading === UNIT13_TITLE, held.heading);
  await slow.waitForSelector(".coursepane .exercise:not(.skel-card)", { timeout: 30000 });
  const landed = await slow.evaluate(() => ({
    skel: document.querySelectorAll(".unitloading").length,
    liveCards: document.querySelectorAll(".coursepane .exercise").length,
    heading: document.querySelector(".unitheading")?.textContent?.trim() ?? "",
  }));
  ok("F10 placeholder clears when the unit arrives", landed.skel === 0 && landed.liveCards > 0);
  // same string the placeholder showed: the title never swaps, only the cards
  // under it do
  ok("F10 heading is identical before and after the unit lands",
    landed.heading === held.heading.trim(), JSON.stringify({ before: held.heading, after: landed.heading }));
  await octx.close();
}

// ---------- Flow 7: the shortcuts window ----------
// Opened from every view, and it now documents the whole app: the keys that
// work anywhere, the ones a book owns, and the two session-specific groups.
await page.locator('button[aria-label="Keyboard shortcuts"]').click();
await page.waitForSelector(".helpcard", { timeout: 30000 });
ok("F7 the help window opens", await page.locator(".helpcard h3").isVisible());
const helpText = await page.locator(".helpcard").innerText();
ok(
  "F7 help groups the keys by where they work",
  /Anywhere/.test(helpText) && /In a book/.test(helpText),
  helpText.slice(0, 120),
);
ok(
  "F7 help names the merged window and every hint letter",
  /Progress and data window/.test(helpText) && /F, P, C, D, A, I, E, S/.test(helpText),
  helpText.slice(0, 160),
);
ok("F7 help lists every group", (await page.locator(".helpcard .helpsection").count()) === 4);
await page.keyboard.press("Escape");
await sleep(300);

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

// one column: the lesson first, the exercises under it, no tabs
ok("F8 lesson first", await mp.locator(".lesson .lsection").first().isVisible());
ok("F8 no Book | Exercises tabs", (await mp.locator(".tabswitch").count()) === 0);
ok(
  "F8 lesson tables fit the screen",
  await mp.evaluate(() =>
    [...document.querySelectorAll(".lsection")].every((el) => el.getBoundingClientRect().right <= window.innerWidth + 1),
  ),
);

// counters live in the panel now, no horizontal overflow
ok("F8 no topstats in the topbar", (await mp.locator(".topbar .topstats").count()) === 0);
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
await mp.waitForSelector(".coursepane .exercise textarea", { timeout: 30000 });
ok("F8 navigated to unit 2", /#\/blue\/u2/.test(mp.url()));

// drawer: the topbar title also closes the drawer (goes home from there)
await mp.locator(".sidebartoggle").click();
await sleep(300);
ok("F8 drawer reopens", (await mp.locator(".sidebar.mobile-open").count()) === 1);
await mp.locator(".topbar-home").click();
await sleep(300);
ok("F8 topbar title closes drawer", (await mp.locator(".sidebar.mobile-open").count()) === 0);
ok("F8 topbar title goes home", /#\/blue$/.test(mp.url()));
await mp.goto(BASE + "/#/blue/u2", { waitUntil: "load" });
await mp.waitForSelector(".lesson .lsection", { timeout: 30000 });

// phone chrome: the topbar keeps the page's title and the hamburger alone —
// every app-wide control is a row of the drawer, which is the same panel the
// desktop column shows
ok(
  "F8 phone topbar carries the title and the burger only",
  (await mp.locator(".topbar-actions button").count()) === 0 &&
    (await mp.locator('.topbar-lib:visible').count()) === 0 &&
    (await mp.locator(".topbar-brand svg:visible").count()) === 0 &&
    (await mp.locator(".topbar-home h1, .topbar h1").first().isVisible()),
);
ok(
  "F8 the drawer leads with the app's controls, in order",
  await mp.evaluate(
    () =>
      [...document.querySelectorAll(".navtools > *")]
        .map((el) => (el.getAttribute("aria-label") ?? "").split(" ")[0])
        .join("|") === "Search|Keyboard|Progress|Theme:",
  ),
  await mp.evaluate(() =>
    [...document.querySelectorAll(".navtools > *")]
      .map((el) => (el.getAttribute("aria-label") ?? "").split(" ")[0])
      .join("|"),
  ),
);
ok(
  "F8 the panel runs tools, sections, then books with the book's own progress",
  await mp.evaluate(() => {
    const blocks = [...document.querySelectorAll(".sidebar-inner > .navblock")];
    const at = (sel) => blocks.findIndex((b) => b.querySelector(sel));
    return (
      blocks.length === 3 &&
      at(".navtile") === 0 &&
      at('a.navtile[href^="#/cards"]') === 1 &&
      at('a.navtile[href="#/red"]') === 2 &&
      blocks[2].querySelector(".bookstats") !== null
    );
  }),
);
ok(
  "F8 the books block carries the progress above the unit list",
  await mp.evaluate(() => {
    const stats = document.querySelector(".sidebar .bookstats");
    const unit = document.querySelector(".sidebar .unitlink");
    return (
      stats !== null && unit !== null && stats.getBoundingClientRect().bottom <= unit.getBoundingClientRect().top
    );
  }),
);

// drawer gestures: a leftward swipe over the drawer pushes it back, a
// rightward one pulls it in — but a drag that starts on a lesson table (it
// scrolls sideways) never summons the drawer
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
await swipe(".lformtables", 90);
await sleep(400);
ok(
  "F8 swipe on a lesson table leaves the drawer shut",
  (await mp.locator(".sidebar.mobile-open").count()) === 0,
);
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

// Choosing a tile out of the card Shift+E pulled out of the edge ends that
// trip: the panel goes back where it was, on Enter as on a click
await page.keyboard.press("Shift+KeyE");
await sleep(400);
await page.keyboard.press("Enter");
await page.waitForURL(/#\/blue\/u1/, { timeout: 30000 });
await sleep(500);
ok(
  "F11 Enter on the focused tile opens the unit",
  /#\/blue\/u1$/.test(page.url()),
  page.url(),
);
ok(
  "F11 the card goes back to the edge after the pick",
  await page.evaluate(
    () => getComputedStyle(document.querySelector("nav.sidebar")).opacity === "0",
  ),
);
ok(
  "F11 the pick hands the focus to the page it opened",
  await page.evaluate(() => document.activeElement?.closest("nav.sidebar") === null),
);
await page.keyboard.press("Shift+KeyE");
await sleep(400);
ok(
  "F11 Shift+E brings the card back on the unit page",
  await page.evaluate(
    () => getComputedStyle(document.querySelector("nav.sidebar")).opacity === "1",
  ),
);
await page.locator('nav.sidebar .navtile[href="#/cards"]').click();
await page.waitForURL(/#\/cards/, { timeout: 30000 });
await sleep(500);
ok(
  "F11 a click on a tile opens it too",
  /#\/cards$/.test(page.url()),
  page.url(),
);
ok(
  "F11 the card goes back to the edge after a click",
  await page.evaluate(
    () => getComputedStyle(document.querySelector("nav.sidebar")).opacity === "0",
  ),
);
// a panel the learner brought out by hand stays out: Alt+Shift+E shows it,
// and a pick inside it must not slide it back
await page.keyboard.press("Alt+Shift+KeyE");
await sleep(500);
await page.locator('nav.sidebar .navtile[href="#/dictionary"]').click();
await page.waitForURL(/#\/dictionary/, { timeout: 30000 });
await sleep(400);
ok(
  "F11 a pick leaves an expanded panel alone",
  (await page.locator(".sidebar:not(.collapsed)").count()) === 1,
);
// back to the edge, the state the flow after this one starts from
await page.keyboard.press("Alt+Shift+KeyE");
await sleep(500);

// ---------- Flow 11b: the panel's own keys, on every page ----------
// The panel is the app's map, so Alt+Shift+E and Shift+E belong to the shell
// and mean the same thing everywhere: the first hides the panel, the second
// focuses the tile that stands for the page you are on, and the arrows walk
// the panel's controls — not only a book's units.
await page.keyboard.press("Alt+Shift+KeyE");
await page.waitForFunction(
  () => !!document.querySelector(".sidebar:not(.collapsed)"),
  undefined,
  { timeout: 5000 },
);
ok("F11b Alt+Shift+E shows the panel on a book landing", true);
await page.keyboard.press("Alt+Shift+KeyE");
await page.waitForFunction(
  () => !!document.querySelector(".sidebar.collapsed"),
  undefined,
  { timeout: 5000 },
);
ok("F11b Alt+Shift+E hides it again", true);

// the header carries the app-wide controls on a desktop, in the app's own
// order, and the panel below them is left with the places only
ok(
  "F11b the header holds the controls, in order",
  await page.evaluate(
    () =>
      [...document.querySelectorAll(".topbar-actions button")]
        .map((b) => (b.getAttribute("aria-label") ?? "").split(" ")[0])
        .join("|") === "Search|Keyboard|Progress|Theme:",
  ),
  await page.evaluate(() =>
    [...document.querySelectorAll(".topbar-actions button")]
      .map((b) => (b.getAttribute("aria-label") ?? "").split(" ")[0])
      .join("|"),
  ),
);
ok(
  "F11b the panel keeps only the places on a desktop",
  await page.evaluate(
    () =>
      // gone from the page, not merely hidden
      document.querySelector(".navtools") === null &&
      document.querySelectorAll('.sidebar .navtile[aria-label^="Search"]').length === 0 &&
      document.querySelectorAll('a.navtile[href^="#/cards"]').length === 1,
  ),
);

// Esc from the panel gives the page its focus back — on a page that had none
// of its own (the dictionary focuses its search field), not only in a book
await page.goto(BASE + "/#/dictionary", { waitUntil: "load" });
await page.waitForSelector("nav.sidebar", { timeout: 30000 });
await sleep(400);
await page.keyboard.press("Shift+KeyE");
await sleep(300);
await page.keyboard.press("Escape");
await sleep(300);
ok(
  "F11b Esc leaves the panel for the page",
  await page.evaluate(() => {
    const a = document.activeElement;
    return a.closest("nav.sidebar") === null && a.tagName === "INPUT";
  }),
);

const panelKeys = async (hash, label) => {
  await page.goto(BASE + "/" + hash, { waitUntil: "load" });
  await page.waitForSelector("nav.sidebar", { timeout: 30000 });
  await sleep(400);
  await page.keyboard.press("Shift+KeyE");
  await sleep(400);
  return page.evaluate((l) => {
    const el = document.activeElement;
    const card = document.querySelector("nav.sidebar.collapsed");
    return {
      label: l,
      inPanel: el?.closest("nav.sidebar") !== null,
      text: (el?.getAttribute("aria-label") ?? el?.textContent ?? "").trim(),
      revealed: card ? getComputedStyle(card).opacity === "1" : null,
    };
  }, label);
};
ok(
  "F11b Shift+E on the cards focuses the Cards tile",
  await panelKeys("#/cards", "Cards").then((r) => r.inPanel && r.text.startsWith("Cards") && r.revealed),
);
ok(
  "F11b Shift+E on the dictionary focuses the Dictionary tile",
  await panelKeys("#/dictionary", "Dictionary").then(
    (r) => r.inPanel && r.text.startsWith("Dictionary") && r.revealed,
  ),
);
ok(
  "F11b Shift+E on the library focuses the panel's first tile",
  await panelKeys("#/", "Library").then((r) => r.inPanel && r.text.startsWith("Cards")),
);

// the arrows walk every control of the panel, in reading order: from the
// Cards tile sideways onto the Dictionary tile and down onto the books
await page.goto(BASE + "/#/cards", { waitUntil: "load" });
await page.waitForSelector("nav.sidebar", { timeout: 30000 });
await sleep(400);
await page.keyboard.press("Shift+KeyE");
await sleep(300);
const arrowWalk = [];
for (const key of ["ArrowRight", "ArrowDown"]) {
  await page.keyboard.press(key);
  await sleep(200);
  arrowWalk.push(
    await page.evaluate(
      () => (document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? "").trim(),
    ),
  );
}
ok(
  "F11b the arrows walk the panel's own controls",
  arrowWalk[0].startsWith("Dictionary") && arrowWalk[1].startsWith("English Grammar"),
  JSON.stringify(arrowWalk),
);
// a field the learner types into keeps the key
await page.goto(BASE + "/#/dictionary", { waitUntil: "load" });
await page.waitForSelector('input[type="search"]', { timeout: 30000 });
await sleep(400);
await page.locator('input[type="search"]').focus();
await page.keyboard.press("Shift+KeyE");
await sleep(200);
ok(
  "F11b Shift+E leaves a text field to the learner",
  await page.evaluate(() => document.activeElement?.type === "search"),
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
    await p2.locator(".topbar .dlbtn").first().isVisible(),
  );

  // pressed here. On desktop the header button is that run's status: green
  // fills it from the top down and stays full when the course is cached.
  await p2.locator(".topbar .dlbtn.done").waitFor({ timeout: 180000 });
  ok("F12 the download starts by itself and finishes green", true);

  const cached = await p2.evaluate(async () => {
    const c = await caches.open("murrnglish-book-blue-v2");
    const has = async (u) => (await c.match(u, { ignoreVary: true })) !== undefined;
    const shell = await caches.open("murrnglish-shell-v2");
    return {
      index: await has("/books/blue/data/index.json"),
      bundle: await has("/books/blue/data/course.json"),
      perUnit: await has("/books/blue/data/units/unit-005.json"),
      pdf: (await c.keys()).some((r) => r.url.endsWith(".pdf")),
      shell: (await shell.match("/", { ignoreVary: true })) !== undefined,
      otherBook: await caches.has("murrnglish-book-red-v2"),
    };
  });
  ok(
    "F12 the course arrives as one packed file, not per unit, and no PDF",
    cached.index && cached.bundle && cached.shell && !cached.perUnit && !cached.pdf,
    JSON.stringify(cached),
  );

  await p2.locator(".topbar .dlbtn").first().click();
  const blueRow = p2.locator(".dlrow", { hasText: "English Grammar: Progress" });
  const redRow = p2.locator(".dlrow", { hasText: "English Grammar: Foundations" });
  await blueRow.getByRole("button", { name: "Remove the downloaded English Grammar: Progress" }).waitFor({ timeout: 30000 });
  ok("F12 download finishes and offers a remove action", true);
  ok(
    "F12 only the open book was downloaded",
    !cached.otherBook && (await redRow.getByRole("button", { name: "Download", exact: true }).isVisible()),
    JSON.stringify(cached),
  );

  // offline now. The hash step is same-document, so the only request left is
  // the reload — a real navigation the service worker has to answer from the
  // cache, followed by the unit JSON (out of the packed course).
  await ctx2.setOffline(true);
  await p2.evaluate(() => {
    location.hash = "#/blue/u5";
  });
  await p2.reload({ waitUntil: "load" });
  await p2.waitForSelector(".lesson .lsection", { timeout: 60000 });
  ok("F12 offline unit renders its lesson", (await p2.locator(".lesson .lsection").count()) >= 2);
  await p2.waitForSelector(".coursepane .exercise", { timeout: 60000 });
  ok("F12 offline exercises render", await p2.locator(".coursepane .exercise").first().isVisible());
  ok("F12 no errors while offline", !results.some((r) => r[1] === "F12 pageerror"));

  // the way back out: removing drops the cache and the flag, and the panel
  // offers the download again
  await p2.locator(".topbar .dlbtn").first().click();
  await blueRow.getByRole("button", { name: "Remove the downloaded English Grammar: Progress" }).click();
  await blueRow.getByRole("button", { name: "Download", exact: true }).waitFor({ timeout: 30000 });
  const removed = await p2.evaluate(async () => {
    return {
      book: (await caches.match("/books/blue/data/course.json", { ignoreVary: true })) !== undefined,
      flag: localStorage.getItem("murrnglish.blue.offline-v2"),
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
    return (await caches.match("/books/blue/data/course.json", { ignoreVary: true })) !== undefined;
  });
  ok("F12 a removed download is not fetched again on its own", !back);

  // phone: the topbar carries no controls at all — the download is one of the
  // panel's tools, and it fills while the book streams in. Throttled, or the
  // whole course would land before the fill could be seen; the service worker
  // is blocked because CDP throttling applies to the page target alone, and
  // the download is page-side either way.
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
  await p3.locator(".dlbtn.running").waitFor({ timeout: 60000 });
  ok(
    "F12 the phone download is a panel tool, never a topbar button",
    (await p3.locator(".topbar .dlbtn").count()) === 0 &&
      (await p3.locator(".sidebar .dlbtn").count()) === 1,
  );

  const chip = await p3.evaluate(() => {
    const c = document.querySelector(".dlbtn.running");
    return { title: c.title, p: getComputedStyle(c).getPropertyValue("--p").trim() };
  });
  ok(
    "F12 the control carries the percentage",
    /downloading \d+%/.test(chip.title) && /^\d+%$/.test(chip.p),
    JSON.stringify(chip),
  );

  // every page of the installed app carries the download, the sections
  // included — the cards and the dictionary open the same panel as the library
  await p3.goto(BASE + "/#/dictionary", { waitUntil: "load" });
  await p3.waitForSelector(".addbar input", { timeout: 30000 });
  ok(
    "F12 a section page carries the download too",
    (await p3.locator(".sidebar .dlbtn").count()) === 1,
  );
  // five tools: three abreast above, the last pair half the row each. The row
  // counts six tracks under a 6px gap, so a tile is its tracks plus the gaps
  // between them — the widths are read off that, not off a plain third/half.
  const tools = await p3.evaluate(() => {
    const row = document.querySelector(".navtools");
    const cs = getComputedStyle(row);
    const gap = parseFloat(cs.columnGap) || 0;
    const track = (row.getBoundingClientRect().width - gap * 5) / 6;
    const w = (el) => el.getBoundingClientRect().width;
    return {
      count: row.children.length,
      third: 2 * track + gap,
      half: 3 * track + 2 * gap,
      tiles: [...row.children].map(w),
    };
  });
  const near = (a, b) => Math.abs(a - b) <= Math.max(1, b * 0.01);
  ok(
    "F12 five tool tiles: three above, the last two half the row each",
    tools.count === 5 &&
      near(tools.tiles[0], tools.third) &&
      near(tools.tiles[1], tools.third) &&
      near(tools.tiles[2], tools.third) &&
      near(tools.tiles[3], tools.half) &&
      near(tools.tiles[4], tools.half),
    JSON.stringify(tools),
  );
  await p3.locator(".sidebartoggle").click();
  await sleep(600);
  await p3.locator(".sidebar .dlbtn").click();
  await p3.waitForSelector(".dlrow", { timeout: 10000 });
  ok(
    "F12 the drawer's download opens the panel from a section",
    (await p3.locator(".dlrow").count()) >= 2,
  );
}

// ---------- Flow 13: the red book, its own progress, the library crumb ----------
await page.goto(BASE + "/#/", { waitUntil: "load" });
await page.waitForSelector(".libcard", { timeout: 30000 });
const blueCard = page.locator(".libcard", { hasText: "English Grammar: Progress" });
ok(
  "F13 the blue card resumes after the checked unit",
  /Continue with Unit 2/.test((await blueCard.locator(".libcta").textContent()) ?? ""),
  (await blueCard.locator(".libcta").textContent()) ?? "",
);
await page.locator(".libcard", { hasText: "English Grammar: Foundations" }).locator(".libcta").click();
await page.waitForURL(/#\/red\/u1$/, { timeout: 30000 });
await page.waitForSelector(".coursepane .exercise", { timeout: 30000 });
ok("F13 red unit 1 renders", /Урок 1 —/.test((await page.locator(".unitheading").first().textContent()) ?? ""));
ok("F13 red's lesson is in Russian", /В этом уроке/.test((await page.locator(".lessongoals").textContent()) ?? ""));
ok("F13 the topbar names the red book", (await page.locator(".topbar h1").textContent()) === "English Grammar: Foundations");
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

// ---------- Flow 13b: one key system for the whole app ----------
// The jumps work from every view, not only from inside a book: the sections
// from the library, the books from the deck list.
{
  const nctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const np = await nctx.newPage();
  np.on("pageerror", (e) => results.push(["FAIL", "F13b pageerror", String(e).slice(0, 140)]));

  await np.goto(BASE + "/#/dictionary", { waitUntil: "load" });
  await np.waitForSelector(".addbar input", { timeout: 30000 });

  // Alt+1 opens the first book from the dictionary
  await np.keyboard.press("Alt+Digit1");
  await np.waitForURL(/#\/red$/, { timeout: 10000 });
  ok("F13b Alt+1 opens the first book", /#\/red$/.test(np.url()), np.url());


  // the section jumps, from inside a book
  await np.keyboard.press("Shift+KeyD");
  await np.waitForURL(/#\/dictionary$/, { timeout: 10000 });
  ok("F13b Shift+D goes to the dictionary", /#\/dictionary$/.test(np.url()), np.url());
  await np.keyboard.press("Shift+KeyC");
  await np.waitForURL(/#\/cards$/, { timeout: 10000 });
  ok("F13b Shift+C goes to the cards", /#\/cards$/.test(np.url()), np.url());
  await np.keyboard.press("Shift+KeyL");
  await np.waitForURL(/#\/$/, { timeout: 10000 });
  ok("F13b Shift+L goes to the library", /#\/$/.test(np.url()), np.url());

  // Shift+Z walks the app's own history back, and lands on the app's opening
  // page rather than leaving it when there is nothing of the app behind
  await np.keyboard.press("Shift+KeyZ");
  await np.waitForURL(/#\/cards$/, { timeout: 10000 });
  ok("F13b Shift+Z steps back through the app", /#\/cards$/.test(np.url()), np.url());
  await np.keyboard.press("Shift+KeyZ");
  await np.waitForURL(/#\/dictionary$/, { timeout: 10000 });
  ok("F13b Shift+Z again goes on back", /#\/dictionary$/.test(np.url()), np.url());
  for (let i = 0; i < 6; i++) {
    await np.keyboard.press("Shift+KeyZ");
    await sleep(400);
    // still inside the app, on its own opening page
    if (!/^http:\/\/127\.0\.0\.1:\d+\/#/.test(np.url())) break;
  }
  ok("F13b Shift+Z stops at the app's opening page", /#\//.test(np.url()), np.url());
  await np.keyboard.press("Shift+L");
  await np.waitForURL(/#\/$/, { timeout: 10000 });

  // Alt+D opens the window from the library: every book's progress and every
  // target, none of it scoped to the view it was opened from
  await np.keyboard.press("Alt+KeyD");
  await np.waitForSelector('.modal[aria-label="Progress and data"]', { timeout: 10000 });
  ok("F13b Alt+D opens the data window everywhere",
    (await np.locator('.modal-opt input[type="checkbox"]').count()) === 6);
  await np.waitForSelector(".modal .unitsq", { timeout: 30000 });
  ok("F13b it shows both books' progress from the library",
    (await np.locator(".modal .unitgrid").count()) === 2);
  ok("F13b no page errors", !results.some((r) => r[1] === "F13b pageerror"));
  await nctx.close();
}

// ---------- Flow 14: the rules are the lessons now ----------
{
  const rctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const rp = await rctx.newPage();
  rp.on("pageerror", (e) => results.push(["FAIL", "F14 pageerror", String(e).slice(0, 140)]));
  // an old link to the rules compendium opens the unit, with its address
  await rp.goto(BASE + "/#/rules/blue/u3", { waitUntil: "load" });
  await rp.waitForSelector(".lesson .lsection", { timeout: 30000 });
  ok("F14 an old rules link opens the unit's lesson", /#\/blue\/u3$/.test(rp.url()), rp.url());
  await rp.goto(BASE + "/#/rules", { waitUntil: "load" });
  await rp.waitForSelector(".libcard", { timeout: 30000 });
  ok("F14 the old rules page is the library", /#\/$/.test(rp.url()), rp.url());
  ok("F14 no Rules tile in the library", (await rp.locator(".studytile", { hasText: "Rules" }).count()) === 0);
  // a quiz answer shows on a tap, a unit link goes to that unit
  await rp.goto(BASE + "/#/blue/u1", { waitUntil: "load" });
  await rp.waitForSelector(".lquiz .lshow", { timeout: 30000 });
  await rp.locator(".lquiz .lshow").first().click();
  ok("F14 a quiz answer shows on a tap", /knocking/.test((await rp.locator(".lquiz .la").first().textContent()) ?? ""));
  await rp.locator(".lseechip", { hasText: "Present simple" }).first().click();
  await rp.waitForURL(/#\/blue\/u2$/, { timeout: 10000 });
  ok("F14 see-also chips open their unit", true);
  // every unit of both books carries a lesson now, so a late one opens on it
  await rp.goto(BASE + "/#/blue/u140", { waitUntil: "load" });
  await rp.waitForSelector(".lesson .lsection", { timeout: 30000 });
  ok(
    "F14 a late unit opens on its lesson",
    (await rp.locator(".lessonsoon").count()) === 0 && (await rp.locator(".lesson").count()) === 1,
  );
  // exercises that had a picture carry it as text
  await rp.goto(BASE + "/#/red/u3", { waitUntil: "load" });
  await rp.waitForSelector("#ex-3\\.1 .itemcue", { timeout: 30000 });
  ok("F14 a picture exercise shows its cues", (await rp.locator("#ex-3\\.1 .itemcue").count()) === 8);
  ok(
    "F14 its example shows the answer the page used to",
    /He’s hot\./.test((await rp.locator("#ex-3\\.1 .exampleitem").textContent()) ?? ""),
  );
  ok("F14 no page errors", !results.some((r) => r[1] === "F14 pageerror"));
  await rctx.close();
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
  await wp.waitForSelector(".coursepane .exercise .item", { timeout: 30000 });
  await wp.evaluate(() => {
    const w = document.createTreeWalker(document.querySelector(".coursepane .exercise"), NodeFilter.SHOW_TEXT);
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
  await sp.goto(BASE + "/#/cards/present-perfect-past", { waitUntil: "load" });
  await sp.waitForSelector(".studycard .gap", { timeout: 30000 });
  const fresh0 = Number(await sp.locator(".studyhead .count.fresh").textContent());
  const first = await sp.locator(".studycard").innerText();
  ok("F16 a deck opens on its first card, hint and translation", /my keys/.test(first) && /\(lose\)/.test(first) && /потерял/.test(first));
  await sp.keyboard.type("have lost");
  await sp.keyboard.press("Enter");
  await sp.waitForSelector(".ratebtns", { timeout: 5000 });
  ok(
    "F16 a right typed answer is checked and Good is suggested",
    (await sp.locator(".studycard .gap.ok").count()) === 1 &&
      /Good/.test((await sp.locator(".ratebtn.suggest").textContent()) ?? ""),
  );
  ok("F16 the answer side explains why", /Present perfect/.test(await sp.locator(".studycard .cardback").innerText()));
  ok(
    "F16 the buttons show their intervals",
    /^1m 6m 10m [45]d$/.test((await sp.locator(".ratebtn .rateivl").allTextContents()).join(" ")),
    (await sp.locator(".ratebtn .rateivl").allTextContents()).join(" "),
  );
  await sp.keyboard.press("Space");
  await sp.waitForFunction(() => !document.querySelector(".ratebtns"), null, { timeout: 5000 });
  const st = await sp.evaluate(() => JSON.parse(localStorage.getItem("murrnglish.srs-v1")).states["d:present-perfect-past:lost-keys"]);
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
    "F16 a wrong answer is marked, the right one shown, Again suggested",
    (await sp.locator(".studycard .gap.bad").count()) >= 1 &&
      (await sp.locator(".studycard .gapfill.missed").count()) >= 1 &&
      /Again/.test((await sp.locator(".ratebtn.suggest").textContent()) ?? ""),
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

  // a choice card: a number key picks the option shown under it
  await sp.goto(BASE + "/#/cards/confusables", { waitUntil: "load" });
  await sp.waitForSelector(".choiceopt", { timeout: 30000 });
  const firstOpt = (await sp.locator(".choiceopt .opttext").first().textContent()) ?? "";
  await sp.keyboard.press("Digit1");
  await sp.waitForSelector(".choiceopt.ok", { timeout: 5000 });
  ok("F16 a number picks an option and turns the card", (await sp.locator(".ratebtns").count()) === 1);
  ok(
    "F16 the pick is marked right or wrong",
    firstOpt === "lend" ? (await sp.locator(".choiceopt.bad").count()) === 0 : (await sp.locator(".choiceopt.bad").count()) === 1,
    firstOpt,
  );

  // the deck list: the started decks are in "everything", with their counts
  await sp.goto(BASE + "/#/cards", { waitUntil: "load" });
  await sp.waitForSelector(".decksection", { timeout: 30000 });
  const today = await sp.locator(".todaysheet .counts").innerText();
  ok(
    "F16 everything due counts the started decks and the words",
    Number((today.match(/\d+/) ?? ["0"])[0]) > 0,
    today.replace(/\s+/g, " "),
  );
  ok("F16 the decks come in two sections", (await sp.locator(".decksection").count()) === 2);
  ok(
    "F16 a started deck is ticked and its group open",
    await sp.locator(".deckgroup[open] .deckline", { hasText: "Present perfect or past simple" }).locator(".pickbox").isChecked(),
  );
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
    s.states["d:present-perfect-past:ever-been"] = { kind: "review", due: Date.now() - day, ivl: 3, ease: 2.5, step: 0, reps: 3, lapses: 0, last: Date.now() - 4 * day };
    localStorage.setItem("murrnglish.srs-v1", JSON.stringify(s));
  });
  await sp.goto(BASE + "/#/", { waitUntil: "load" });
  await sp.reload({ waitUntil: "load" });
  await sp.waitForSelector(".studygrid", { timeout: 30000 });
  // data window: export the words and the reviews here, import them into a
  // browser that has nothing
  await sp.goto(BASE + "/#/dictionary", { waitUntil: "load" });
  await sp.waitForSelector(".addbar input", { timeout: 30000 });
  await openData(sp);
  await sp.locator(".modal-opt", { hasText: "Cards — which cards are learned" }).locator("input").check();
  await sp.locator(".modal-opt", { hasText: "Dictionary — your words" }).locator("input").check();
  await sp.locator(".modal-opt", { hasText: "Learning state —" }).locator("input").check();
  const [dl] = await Promise.all([
    sp.waitForEvent("download"),
    sp.locator('[data-modal-key="KeyE"]').click(),
  ]);
  ok("F16 the data file downloads", /^murrnglish-data-.*\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  const file = await dl.path();
  const exported = JSON.parse(await readFile(file, "utf8"));
  ok(
    "F16 the ticked learning report rides in the data file",
    exported.learning?.format === "murrnglish-learning" && typeof exported.learning.totals.cards === "number",
    JSON.stringify(exported.learning?.totals ?? null),
  );
  ok(
    "F16 the learning report is the only thing ticked that carries nothing else",
    exported.cards !== null && exported.dictionary !== null && exported.version === 3,
    `version=${exported.version}`,
  );
  const ictx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const ip = await ictx.newPage();
  await ip.goto(BASE + "/#/dictionary", { waitUntil: "load" });
  await ip.waitForSelector(".addbar input", { timeout: 30000 });
  await openData(ip);
  await ip.locator('.modal input[type="file"]').setInputFiles(file);
  // the file is only summarised until Apply: nothing is written yet
  await ip.waitForSelector('.modal button:text("Apply")', { timeout: 10000 });
  const incoming = (await ip.locator(".modal-summary").last().innerText()).trim();
  ok("F16 the incoming file is summarised, not applied", /Dictionary: 2 words/.test(incoming), incoming);
  ok("F16 the summary names the learning report it carries", /Learning report: \d+ cards/.test(incoming), incoming);
  ok("F16 nothing is written before Apply",
    (await ip.locator(".wordrow").count()) === 0);
  await ip.locator('.modal button:text("Apply")').click();
  await ip.keyboard.press("Escape");
  await sleep(350);
  await ip.waitForSelector(".wordrow", { timeout: 5000 });
  ok(
    "F16 applying the data file brings the words and reviews",
    (await ip.locator(".wordrow").count()) === 2 &&
      (await ip.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("murrnglish.srs-v1")).states).length)) >= 2,
    (await ip.locator(".modal-msg").count()) ? (await ip.locator(".modal-msg").innerText()).trim() : "",
  );
  await ictx.close();
  ok("F16 no page errors", !results.some((r) => r[1] === "F16 pageerror"));

  // phone: the review screen fits
  const sm = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const smp = await sm.newPage();
  await smp.goto(BASE + "/#/cards/present-perfect-past", { waitUntil: "load" });
  await smp.waitForSelector(".showbtn", { timeout: 30000 });
  await smp.locator(".showbtn").tap();
  await smp.waitForSelector(".ratebtns", { timeout: 5000 });
  ok(
    "F16 phone: four answer buttons in one row, no sideways scroll",
    (await smp.evaluate(() => new Set([...document.querySelectorAll(".ratebtn")].map((b) => Math.round(b.getBoundingClientRect().top))).size)) === 1 &&
      (await smp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)),
  );
  await smp.goto(BASE + "/#/cards", { waitUntil: "load" });
  await smp.waitForSelector(".decksection", { timeout: 30000 });
  await smp.locator(".deckgroup summary").first().tap();
  ok(
    "F16 phone: the deck list has no sideways scroll",
    await smp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  );
  await sm.close();
}
await wctx.close();

// ---------- Flow 17: reviewing and the dictionary offline ----------
if (BASE.includes("4173")) {
  const octx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const op = await octx2.newPage();
  op.on("pageerror", (e) => results.push(["FAIL", "F17 pageerror", String(e).slice(0, 140)]));
  await op.goto(BASE + "/#/cards/present-perfect-past", { waitUntil: "load" });
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
  await op.keyboard.type("have lost");
  await op.keyboard.press("Enter");
  await op.waitForSelector(".ratebtns", { timeout: 5000 });
  await op.keyboard.press("Digit3");
  await op.waitForFunction(() => !document.querySelector(".ratebtns"), null, { timeout: 5000 });
  ok(
    "F17 offline: a deck is reviewed",
    await op.evaluate(() => !!JSON.parse(localStorage.getItem("murrnglish.srs-v1")).states["d:present-perfect-past:lost-keys"]),
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

// ---------- Flow 18: vocabulary decks and choosing what to study ----------
{
  const vctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const vp = await vctx.newPage();
  vp.on("pageerror", (e) => results.push(["FAIL", "F18 pageerror", String(e).slice(0, 140)]));
  // a learner of the book-made cards: their pack history moves, the rest goes
  await vp.goto(BASE + "/#/", { waitUntil: "load" });
  await vp.evaluate(() => {
    const st = { kind: "review", due: Date.now() + 864e5, ivl: 3, ease: 2.5, step: 0, reps: 3, lapses: 0, last: Date.now() - 864e5 };
    localStorage.setItem("murrnglish.srs-v1", JSON.stringify({ states: { "v:blue:irregular-verbs:go": st, "blue:12.1:2": st }, suspended: [] }));
    localStorage.setItem("murrnglish.srs-settings-v1", JSON.stringify({ newPerDay: 500, reviewsPerDay: 200, typeAnswers: true, include: { red: false, "blue/u12": true } }));
  });
  await vp.goto(BASE + "/#/cards", { waitUntil: "load" });
  await vp.reload({ waitUntil: "load" }); // the store is read at load
  await vp.waitForSelector(".decksection", { timeout: 30000 });
  await sleep(300);
  const moved = await vp.evaluate(() => ({
    states: Object.keys(JSON.parse(localStorage.getItem("murrnglish.srs-v1")).states),
    include: JSON.parse(localStorage.getItem("murrnglish.srs-settings-v1")).include,
  }));
  ok(
    "F18 the old pack history moves to its deck, the rest is dropped",
    moved.states.join() === "d:irregular-verbs:go" && Object.keys(moved.include).length === 0,
    JSON.stringify(moved),
  );
  const todayNew = async () => Number(((await vp.locator(".todaysheet .count.fresh").innerText()).match(/\d+/) ?? ["0"])[0]);
  const verbsNew = await todayNew();
  ok("F18 the moved deck is in daily study", verbsNew > 0);
  const vocab = vp.locator(".decksection", { hasText: "Vocabulary" });
  await vocab.locator(".deckgroup summary", { hasText: "Meaning" }).click();
  await vocab.locator(".deckline", { hasText: "Everyday idioms" }).locator(".pickbox").check();
  ok("F18 ticking a deck puts it in daily study", (await todayNew()) > verbsNew);
  // a group's tick takes its decks without opening the group
  const grammar = vp.locator(".decksection", { hasText: "Grammar" });
  const group = grammar.locator(".deckgroup", { hasText: "Modal verbs" });
  await group.locator("summary .pickbox").check();
  ok("F18 a group's tick leaves the group folded", !(await group.evaluate((d) => d.open)));
  ok("F18 the section says how much of it is in", /4 in daily study/i.test(await grammar.locator(".libkicker").innerText()));
  await grammar.locator(".decksubacts button", { hasText: "None" }).click();
  ok("F18 None takes the section out", /none in daily study/i.test(await grammar.locator(".libkicker").innerText()));
  const include = await vp.evaluate(() => JSON.parse(localStorage.getItem("murrnglish.srs-settings-v1")).include);
  ok("F18 the choice is saved", include.idioms === true && include.deduction === false && include["present-perfect-past"] === false);

  // a forms card: both forms typed, checked
  await vp.goto(BASE + "/#/cards/irregular-verbs", { waitUntil: "load" });
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
    "F18 the verb card is scheduled",
    await vp.evaluate(() => !!JSON.parse(localStorage.getItem("murrnglish.srs-v1")).states["d:irregular-verbs:be"]),
  );

  // a meaning card: the idiom, then what it means
  await vp.goto(BASE + "/#/cards/idioms", { waitUntil: "load" });
  await vp.waitForSelector(".studycard .wordbig", { timeout: 30000 });
  await vp.keyboard.press("Space");
  await vp.waitForSelector(".ratebtns", { timeout: 5000 });
  ok("F18 an idiom turns to its meaning", /проще простого/.test(await vp.locator(".studycard .cardback").innerText()));

  // the dictionary: a deck opens from its link, and the search reads the decks
  await vp.goto(BASE + "/#/dictionary/phrasal-verbs", { waitUntil: "load" });
  await vp.waitForSelector(".packfold[open] .packentries li", { timeout: 30000 });
  ok("F18 the deck's words open in the dictionary", /Phrasal verbs/.test(await vp.locator(".packfold[open]").innerText()));
  await vp.fill(".addbar input", "look after");
  await vp.waitForSelector(".packhits li", { timeout: 5000 });
  ok("F18 the search finds deck entries", /присматривать/.test(await vp.locator(".packhits").innerText()));
  ok("F18 no page errors", !results.some((r) => r[1] === "F18 pageerror"));
  await vctx.close();
}

// ---------- Flow 19: looking through a deck's cards ----------
{
  const bctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const bp = await bctx.newPage();
  bp.on("pageerror", (e) => results.push(["FAIL", "F19 pageerror", String(e).slice(0, 140)]));
  await bp.goto(BASE + "/#/cards", { waitUntil: "load" });
  await bp.waitForSelector(".decksection", { timeout: 30000 });
  await bp.locator(".deckgroup summary .deckname", { hasText: "Present and past" }).click();
  await bp.locator('.iconlink[aria-label^="Present perfect or past simple"]').click();
  await bp.waitForURL(/#\/cards\/present-perfect-past\/browse$/, { timeout: 5000 });
  await bp.waitForSelector(".browselist .wordrow", { timeout: 30000 });
  const all = await bp.locator(".browselist .wordrow").count();
  ok("F19 a deck opens into its cards, all new", all > 5 && (await bp.locator(".browselist .statepill.new").count()) === all, String(all));
  await bp.fill(".browsetools input", "keys");
  await bp.waitForFunction((n) => document.querySelectorAll(".browselist .wordrow").length < n, all, { timeout: 5000 });
  ok("F19 the search narrows the list", /потерял/.test(await bp.locator(".browselist").innerText()));
  await bp.locator('.browselist [data-entry="lost-keys"]').click();
  await bp.waitForURL(/\/browse\/lost-keys$/, { timeout: 5000 });
  await bp.waitForSelector(".cardinfo", { timeout: 5000 });
  ok("F19 a card opens turned over", /have lost/.test(await bp.locator(".studycard").innerText()));
  ok("F19 a new card says it is not studied yet", /Not studied yet/.test(await bp.locator(".cardinfo").innerText()));
  await bp.locator(".studytools button", { hasText: "Suspend" }).click();
  await bp.waitForSelector(".cardinfo .statepill.off", { timeout: 5000 });
  const susp = await bp.evaluate(() => JSON.parse(localStorage.getItem("murrnglish.srs-v1")).suspended);
  ok("F19 Suspend suspends the card", susp.includes("d:present-perfect-past:lost-keys"), JSON.stringify(susp));
  await bp.locator(".studytools button", { hasText: "Resume" }).click();
  await bp.waitForSelector(".cardinfo .statepill.new", { timeout: 5000 });
  await bp.keyboard.press("Escape");
  await bp.waitForURL(/\/browse$/, { timeout: 5000 });
  await bp.waitForSelector(".browselist", { timeout: 5000 });
  ok("F19 Esc goes back to the list, the search kept", (await bp.locator(".browsetools input").inputValue()) === "keys");

  // a card studied: its history, reached from the session
  await bp.goto(BASE + "/#/cards/present-perfect-past", { waitUntil: "load" });
  await bp.waitForSelector(".studycard .gap", { timeout: 30000 });
  await bp.keyboard.type("have lost");
  await bp.keyboard.press("Enter");
  await bp.waitForSelector(".ratebtns", { timeout: 5000 });
  await bp.keyboard.press("Space");
  await bp.waitForFunction(() => !document.querySelector(".ratebtns"), null, { timeout: 5000 });
  await bp.goto(BASE + "/#/cards/present-perfect-past/browse/lost-keys", { waitUntil: "load" });
  await bp.waitForSelector(".cardstats", { timeout: 30000 });
  const stats = await bp.locator(".cardstats").innerText();
  ok("F19 a studied card shows its stage and reviews", /Learning/.test(stats) && /Reviews\s+1/.test(stats), stats.replace(/\s+/g, " "));
  await bp.keyboard.press("ArrowRight");
  await bp.waitForFunction(() => !location.hash.endsWith("/lost-keys"), null, { timeout: 5000 });
  ok("F19 → opens the next card", /\/browse\/[a-z0-9-]+$/.test(bp.url()), bp.url());
  await bp.goto(BASE + "/#/cards/present-perfect-past/browse", { waitUntil: "load" });
  await bp.waitForSelector(".browselist", { timeout: 30000 });
  await bp.locator(".browsefilters button", { hasText: "Learning" }).click();
  ok("F19 the Learning filter shows the card studied", (await bp.locator(".browselist .wordrow").count()) === 1);
  ok("F19 no page errors", !results.some((r) => r[1] === "F19 pageerror"));
  await bctx.close();
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
