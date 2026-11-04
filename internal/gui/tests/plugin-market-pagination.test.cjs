// Run with Node's test runner and Playwright on the module path; see README.md.
// Discover can hold more cards than a reader can scan: every list has pages
// of its own, and Settings -> General picks their size. The pager says the
// page, disables its ends, keeps other sections where they were, and returns
// a filtered list to page one. Every language, both engines; the API is
// faked here.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { chromium, webkit } = require("playwright");
const GH = require("./fixtures/plugins-github-31.json");

const assets = path.resolve(__dirname, "../assets");
const LISTINGS = [
  ...Array.from({ length: 13 }, (_, i) => ({
    package: `@magpie-community/opencode-page-plan-${i}`, name: `Plan ${i}`, community: true,
    providers: [`page-plan-${i}`], summary: { en: `Plan ${i}` }, npm: { version: "1.0.0", weekly: i },
  })),
  ...Array.from({ length: 13 }, (_, i) => ({
    package: `@magpie-community/middleware-page-${i}`, name: `Middleware ${i}`, kind: "middleware", community: true,
    summary: { en: `Middleware ${i}` }, npm: { version: "1.0.0", weekly: i },
  })),
  ...Array.from({ length: 13 }, (_, i) => ({
    package: `@magpie-community/tools-page-${i}`, name: `Tools ${i}`, kind: "tools", community: true,
    summary: { en: `Tools ${i}` }, npm: { version: "1.0.0", weekly: i },
  })),
  ...Array.from({ length: 13 }, (_, i) => ({
    package: `@magpie-community/agent-page-${i}`, name: `Agent ${i}`, kind: "agent", community: true,
    summary: { en: `Agent ${i}` }, npm: { version: "1.0.0", weekly: i },
  })),
  ...Array.from({ length: 13 }, (_, i) => ({
    package: `@magpie-community/window-page-${i}`, name: `Page ${i}`, kind: "page", community: true,
    summary: { en: `Page ${i}` }, npm: { version: "1.0.0", weekly: i },
  })),
];
const HITS = Array.from({ length: 13 }, (_, i) => ({
  package: `npm-pagination-only-${i}`, version: "1.0.0", description: `Pagination result ${i}`,
}));

function server(lang, posted) {
  const state = { bun: true, bunVersion: "1.4.2", plugins: [], picker: false };
  const settings = { lang, theme: "light", pluginPageSize: 12 };
  const json = (route, data) => route.fulfill({ json: data });
  return async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/boot.js") {
      return route.fulfill({ contentType: "text/javascript", body: `window.bootPrefs = {lang:"${lang}",theme:"light",pluginPageSize:${settings.pluginPageSize},web:false};` });
    }
    if (url.pathname === "/wails/runtime.js") return route.fulfill({ contentType: "text/javascript", body: "export const Window = {};" });
    if (url.pathname === "/api/state") return json(route, { agents: [], profiles: [], settings });
    if (url.pathname === "/api/settings") {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        posted.push(body);
        Object.assign(settings, body);
      }
      return json(route, settings);
    }
    if (url.pathname === "/api/providers") return json(route, { providers: [], presets: [], excluded: [], gateway: { running: true, window: true }, plugins: [] });
    if (url.pathname === "/api/groups") return json(route, { groups: [], pools: [] });
    if (url.pathname === "/api/gateway/trace") return json(route, { routes: [] });
    if (url.pathname === "/api/plugins") return json(route, state);
    if (url.pathname === "/api/plugins/listings") return json(route, { listings: LISTINGS });
    if (url.pathname === "/api/plugins/github") return json(route, GH);
    if (url.pathname === "/api/plugins/npm") return json(route, { npm: {} });
    if (url.pathname === "/api/plugins/search") return json(route, { hits: HITS });
    if (url.pathname.startsWith("/api/")) return json(route, {});
    if (url.host !== "magpie.test" || !/^\/[\w./-]*$/.test(url.pathname)) return route.fulfill({ status: 404, body: "" });
    const file = path.join(assets, url.pathname === "/" ? "index.html" : url.pathname);
    const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)];
    try { await route.fulfill({ body: await fs.readFile(file), contentType }); } catch { await route.fulfill({ status: 404, body: "" }); }
  };
}

for (const engine of (process.env.BROWSER ? [process.env.BROWSER] : ["chromium", "webkit"])) {
  test(engine + ": the plugin market pages each list and remembers the page size", async (t) => {
    const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chromium" }));
    t.after(() => browser.close());
    for (const lang of ["en", "zh", "zh-TW", "ja", "de"]) {
      await t.test(lang, async () => {
        const page = await (await browser.newContext({ viewport: { width: 980, height: 820 } })).newPage();
        page.setDefaultTimeout(7000);
        page.setDefaultNavigationTimeout(60000);
        const errors = [], posted = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route("**/*", server(lang, posted));
        const tr = (s, vars) => page.evaluate(([s, vars]) => t(s, vars), [s, vars || {}]);
        const pageText = async (at, pages) => tr("Page {page} of {pages}", { page: at, pages });

        await page.goto("http://magpie.test/?view=plugins");
        const view = page.locator("#view-plugins");
        const subs = view.locator('[data-page-key="subs"]');
        const mw = view.locator('[data-page-key="mw"]');
        const agents = view.locator('[data-page-key="agents"]');
        const tools = view.locator('[data-page-key="tools"]');
        const pages = view.locator('[data-page-key="pages"]');
        const gh = view.locator('[data-page-key="github"]');
        const q = view.locator(".pm-head .pm-find input");
        await subs.locator(".pm-card").first().waitFor();

        if (lang !== "en") {
          for (const s of ["Plugins per page", "How many plugin cards each section of Discover shows before its next page", "Previous page", "Next page", "Page {page} of {pages}", "Plugin pages"]) {
            assert.notEqual(await tr(s), s, `${s} in ${lang}`);
          }
        }

        // Twelve cards a page by default, each section on its own page.
        assert.equal(await subs.locator(".pm-card").count(), 12);
        assert.equal(await subs.locator(".pm-pager span").innerText(), await pageText(1, 2));
        assert.equal(await subs.locator(".pm-pager button").first().isDisabled(), true);
        assert.equal(await subs.locator(".pm-pager button").last().isDisabled(), false);
        assert.equal(await mw.locator(".pm-card").count(), 12);
        assert.equal(await mw.locator(".pm-pager span").innerText(), await pageText(1, 2));
        for (const box of [agents, tools, pages]) {
          assert.equal(await box.locator(".pm-card").count(), 12);
          assert.equal(await box.locator(".pm-pager span").innerText(), await pageText(1, 2));
        }

        await subs.locator(".pm-pager button").last().click();
        await page.waitForFunction((want) => document.querySelector('[data-page-key="subs"] .pm-pager span')?.textContent === want, await pageText(2, 2));
        assert.equal(await subs.locator(".pm-card").count(), 1);
        assert.equal(await subs.locator(".pm-pager button").last().isDisabled(), true);
        assert.equal(await mw.locator(".pm-pager span").innerText(), await pageText(1, 2), "another section moved with this one");
        await subs.locator(".pm-pager button").first().click();
        await page.waitForFunction((want) => document.querySelector('[data-page-key="subs"] .pm-pager span')?.textContent === want, await pageText(1, 2));
        assert.equal(await subs.locator(".pm-card").count(), 12);

        // A page search draws the matching listings as Suggested, with its
        // own pages, and clearing it puts the sections back at page one.
        await q.fill("Plan");
        const suggested = view.locator('[data-page-key="suggested"]');
        await page.waitForFunction((want) => document.querySelector('[data-page-key="suggested"] .pm-pager span')?.textContent === want, await pageText(1, 2));
        assert.equal(await suggested.locator(".pm-card").count(), 12);
        await q.fill("");
        await subs.locator(".pm-card").first().waitFor();

        // GitHub's 31 repositories are three pages; filtering goes back to one.
        await gh.locator(".pm-card").first().waitFor();
        assert.equal(await gh.locator(".pm-card").count(), 12);
        assert.equal(await gh.locator(".pm-pager span").innerText(), await pageText(1, 3));
        await gh.locator(".pm-pager button").last().click();
        await page.waitForFunction((want) => document.querySelector('[data-page-key="github"] .pm-pager span')?.textContent === want, await pageText(2, 3));
        assert.equal(await gh.locator(".pm-card").count(), 12);
        await gh.locator(".pm-ghfind input").fill("provider");
        await page.waitForFunction((want) => document.querySelector('[data-page-key="github"] .pm-pager span')?.textContent === want, await pageText(1, 2));
        assert.equal(await gh.locator(".pm-card").count(), 12);
        await gh.locator(".pm-ghfind input").fill("");
        await page.waitForFunction((want) => document.querySelector('[data-page-key="github"] .pm-pager span')?.textContent === want, await pageText(1, 3));

        // npm's search results page too.
        await q.fill("pagination-only");
        const npm = view.locator('[data-page-key="npm"]');
        await page.waitForFunction((want) => document.querySelector('[data-page-key="npm"] .pm-pager span')?.textContent === want, await pageText(1, 2));
        assert.equal(await npm.locator(".pm-card").count(), 12);
        await npm.locator(".pm-pager button").last().click();
        await page.waitForFunction((want) => document.querySelector('[data-page-key="npm"] .pm-pager span')?.textContent === want, await pageText(2, 2));
        assert.equal(await npm.locator(".pm-card").count(), 1);
        await q.fill("");
        await subs.locator(".pm-card").first().waitFor();

        // Settings -> General changes how many cards a page holds.
        await page.locator("#prefs").click();
        const sizes = page.locator("#pluginPageSizeSegs");
        await sizes.waitFor();
        assert.equal((await sizes.locator(".opt.on").innerText()).trim(), "12");
        await sizes.locator(".opt", { hasText: /^24$/ }).click();
        for (let i = 0; i < 100 && !posted.some((p) => p.pluginPageSize === 24); i++) await page.waitForTimeout(30);
        assert.ok(posted.some((p) => p.pluginPageSize === 24), `posted ${JSON.stringify(posted)}`);
        await page.locator('#nav button[data-view="plugins"]').click();
        await view.waitFor({ state: "visible" });
        await subs.locator(".pm-card").first().waitFor();
        assert.equal(await subs.locator(".pm-card").count(), 13, "13 fits on one 24-card page");
        assert.equal(await subs.locator(".pm-pager").count(), 0);
        await gh.locator(".pm-card").first().waitFor();
        assert.equal(await gh.locator(".pm-card").count(), 24);
        assert.equal(await gh.locator(".pm-pager span").innerText(), await pageText(1, 2));

        assert.deepEqual(errors, []);
      });
    }
  });
}
