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

// ---------- Flow 7: keyboard shortcuts modal ----------
await page.locator('button[aria-label="Keyboard shortcuts"]').click();
await page.waitForSelector(".helpcard", { timeout: 30000 });
ok("F7 shortcuts modal opens", await page.locator(".helpcard h3").isVisible());
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

// drawer: open via hamburger, close via backdrop
await mp.locator(".sidebartoggle").click();
ok("F8 drawer opens", await mp.locator(".sidebar.mobile-open").isVisible());
await mp.locator(".sidebar-backdrop").click();
await sleep(300);
ok("F8 backdrop closes drawer", (await mp.locator(".sidebar.mobile-open").count()) === 0);

// drawer: unit tap navigates and closes
await mp.locator(".sidebartoggle").click();
await mp.locator('.sidebar .unitlink:has-text("2")').first().click();
await sleep(600);
ok("F8 drawer closes on nav", (await mp.locator(".sidebar.mobile-open").count()) === 0);
await mp.waitForSelector(".rightpane .exercise textarea", { timeout: 30000 });
ok("F8 navigated to unit 2", /#u2/.test(mp.url()));

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
