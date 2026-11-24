import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = path.join(ROOT, "test");
const CONTENT_PATH = path.join(ROOT, "content.js");
const BRIDGE_PATH = path.join(TEST_DIR, "helpers", "shadow-root-bridge.js");
const SYNTHETIC_PROFILE = {
  firstName: "Deniz",
  lastName: "Kaya",
  email: "deniz.kaya@example.com",
  phone: "05550000000",
  linkedin: "https://linkedin.example.invalid/profile",
  github: "https://github.example.invalid/user",
  portfolio: "https://portfolio.example.invalid",
  university: "Örnek Üniversitesi",
  department: "Örnek Program",
  gpa: "3.4",
  dob: "2000-01-01",
  gender: "Kadın",
  experience: "QA Experience",
  location: "QA Location",
  educationLevel: "QA Education Level",
  grade: "QA Grade",
  gradYear: "2029",
  languages: ["QA Language A", "QA Language B"],
  technologies: ["QA Tool Alpha", "QA Tool Beta"],
  skills: ["QA Skill Alpha", "QA Skill Beta"]
};
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.EDGE_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean);
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function discoverTests() {
  const filter = process.env.QA_TEST_FILTER?.toLocaleLowerCase("en-US");
  return fs.readdirSync(TEST_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase("en-US").endsWith(".html") && (!filter || entry.name.toLocaleLowerCase("en-US").includes(filter)))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));
}

function makeStaticServer() {
  return http.createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    let decoded;
    try { decoded = decodeURIComponent(requestUrl.pathname); } catch {
      response.writeHead(400).end("Bad request");
      return;
    }
    const relative = decoded.replace(/^\/+/, "") || "index.html";
    const filePath = path.resolve(ROOT, relative);
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    fs.readFile(filePath, (error, contents) => {
      if (error) {
        response.writeHead(404).end("Not found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(contents);
    });
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

function findBrowser() {
  return CHROME_CANDIDATES.find((candidate) => candidate && fs.existsSync(candidate));
}

async function installQaBridge(page, useClosedShadowBridge) {
  if (useClosedShadowBridge) await page.addInitScript({ path: BRIDGE_PATH });
  await page.addInitScript((profile) => {
    const store = { profile, learnedFields: {}, autoLearnEnabled: false, neverAskLearn: false };
    const local = {
      get(keys, callback) {
        const requested = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(store);
        const values = Object.fromEntries(requested.map((key) => [key, store[key]]));
        if (typeof callback === "function") queueMicrotask(() => callback(values));
        return Promise.resolve(values);
      },
      set(values, callback) {
        Object.assign(store, values);
        if (typeof callback === "function") queueMicrotask(callback);
        return Promise.resolve();
      },
      clear(callback) {
        for (const key of Object.keys(store)) delete store[key];
        if (typeof callback === "function") queueMicrotask(callback);
        return Promise.resolve();
      }
    };
    try {
      if (!globalThis.chrome) Object.defineProperty(globalThis, "chrome", { configurable: true, value: {} });
      Object.defineProperty(globalThis.chrome, "storage", { configurable: true, value: { local } });
    } catch {
      try { globalThis.chrome.storage = { local }; } catch {}
    }
    globalThis.__QA_EXTENSION_STORAGE__ = store;
  }, SYNTHETIC_PROFILE);
}

async function formStateSnapshot(page) {
  return page.evaluate(() => {
    const controls = [];
    const visit = (root) => {
      for (const element of root.querySelectorAll("input, textarea, select, [contenteditable='true']")) {
        if (element.matches("input[type='radio'], input[type='checkbox']")) {
          controls.push({ type: element.type, value: element.checked ? element.value : "" });
        } else {
          controls.push({ type: element.tagName.toLowerCase(), value: element.isContentEditable ? element.textContent.trim() : String(element.value || "").trim() });
        }
        if (element.shadowRoot) visit(element.shadowRoot);
      }
      for (const host of root.querySelectorAll("*")) if (host.shadowRoot) visit(host.shadowRoot);
    };
    visit(document);
    return controls;
  });
}

async function createFillController(context, targetPage, baseUrl, file, logs) {
  const popupPage = await context.newPage();
  popupPage.on("console", (message) => logs.push("popup console." + message.type() + ": " + message.text()));
  popupPage.on("pageerror", (error) => logs.push("popup pageerror: " + error.message));
  await popupPage.exposeFunction("qaInjectContent", async () => {
    await targetPage.addScriptTag({ path: CONTENT_PATH });
    return true;
  });
  await popupPage.addInitScript(({ profile, fixtureUrl }) => {
    const store = { profile, learnedFields: {}, autoLearnEnabled: false, neverAskLearn: false };
    const local = {
      get(keys, callback) {
        const requested = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(store);
        const values = Object.fromEntries(requested.map((key) => [key, store[key]]));
        if (typeof callback === "function") queueMicrotask(() => callback(values));
        return Promise.resolve(values);
      }
    };
    const api = {
      storage: { local },
      tabs: { query: async () => [{ id: 1, url: fixtureUrl }] },
      scripting: {
        executeScript: async (request) => {
          if (!request?.files?.includes("content.js")) throw new Error("Popup requested an unexpected script.");
          await globalThis.qaInjectContent();
          return [{}];
        }
      },
      runtime: { openOptionsPage: () => Promise.resolve() }
    };
    try {
      if (!globalThis.chrome) Object.defineProperty(globalThis, "chrome", { configurable: true, value: {} });
      for (const [key, value] of Object.entries(api)) Object.defineProperty(globalThis.chrome, key, { configurable: true, value });
    } catch {
      try { Object.assign(globalThis.chrome, api); } catch {}
    }
  }, { profile: SYNTHETIC_PROFILE, fixtureUrl: baseUrl + "/test/" + encodeURIComponent(file) });
  await popupPage.goto(baseUrl + "/popup.html", { waitUntil: "load", timeout: 10000 });
  await popupPage.waitForFunction(() => {
    const button = document.querySelector("#fillButton");
    return Boolean(button && !button.disabled);
  }, null, { timeout: 3000 });
  return {
    async fill() {
      const button = popupPage.locator("#fillButton");
      await popupPage.waitForFunction(() => {
        const action = document.querySelector("#actionStatus");
        const button = document.querySelector("#fillButton");
        return Boolean(button && !button.disabled && (!action || !action.textContent.trim() || action.textContent.includes("Doldurma denemesi tamamlandı")));
      }, null, { timeout: 5000 });
      await button.click();
      await popupPage.waitForFunction(() => {
        const status = document.querySelector("#actionStatus")?.textContent.trim() || "";
        const button = document.querySelector("#fillButton");
        return Boolean(button && !button.disabled && status && !status.includes("kontrol ediliyor"));
      }, null, { timeout: 5000 });
      const status = await popupPage.locator("#actionStatus").textContent();
      if (!status?.includes("Doldurma denemesi tamamlandı")) throw new Error("Popup fill action failed: " + status);
    },
    async close() { await popupPage.close().catch(() => {}); }
  };
}
async function clickActionByText(page, pattern) {
  const clicked = await page.evaluate((source) => {
    const normalizeText = (value) => String(value || "").toLocaleLowerCase("tr-TR").replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ş/g, "s").replace(/ç/g, "c").replace(/ö/g, "o").replace(/ü/g, "u");
    const needles = source.split("|").map(normalizeText);
    const roots = [];
    const visit = (root) => {
      roots.push(root);
      for (const host of root.querySelectorAll("*")) if (host.shadowRoot) visit(host.shadowRoot);
    };
    visit(document);
    const candidates = roots.flatMap((root) => Array.from(root.querySelectorAll("*")))
      .filter((element) => {
        const text = String(element.innerText || element.textContent || element.value || "").trim();
        const normalized = normalizeText(text);
        return text && needles.some((needle) => normalized.includes(needle)) && element.getClientRects().length;
      })
      .sort((a, b) => {
        const actionable = "button, input[type='submit'], [role='button'], a, [onclick]";
        const rank = (element) => element.matches(actionable) ? 0 : getComputedStyle(element).cursor === "pointer" ? 1 : 2;
        const actionRank = rank(a) - rank(b);
        if (actionRank) return actionRank;
        return String(a.innerText || a.textContent || a.value || "").trim().length - String(b.innerText || b.textContent || b.value || "").trim().length;
      });
    const target = candidates[0];
    if (!target) return false;
    const clickedTarget = { tag: target.tagName, text: String(target.innerText || target.textContent || target.value || "").trim(), type: target.type || "" };
    const rect = target.getBoundingClientRect();
    const eventInit = { bubbles: true, cancelable: true, composed: true, button: 0, buttons: 1, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    try { target.dispatchEvent(new PointerEvent("pointerdown", { ...eventInit, pointerId: 1, pointerType: "mouse", isPrimary: true })); } catch {}
    target.dispatchEvent(new MouseEvent("mousedown", eventInit));
    try { target.dispatchEvent(new PointerEvent("pointerup", { ...eventInit, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true })); } catch {}
    target.dispatchEvent(new MouseEvent("mouseup", { ...eventInit, buttons: 0 }));
    target.click();
    return clickedTarget;  }, pattern);
  if (!clicked) throw new Error("Could not find a visible form action matching /" + pattern + "/i.");
}

async function waitForProfileFill(page, timeout = 5000) {
  await page.waitForFunction(() => {
    const rootList = [];
    const visit = (root) => {
      rootList.push(root);
      for (const host of root.querySelectorAll("*")) if (host.shadowRoot) visit(host.shadowRoot);
    };
    visit(document);
    const controls = rootList.flatMap((root) => Array.from(root.querySelectorAll("input, textarea, select, [contenteditable='true']")));
    return controls.some((element) => element.isContentEditable ? Boolean(element.textContent.trim()) : Boolean(String(element.value || "").trim()));
  }, null, { timeout });
}

async function readDiagnostics(page, logs, reason) {
  let snapshot = {};
  try {
    snapshot = await page.evaluate(() => {
      const debugSelectors = ["#log", "[data-lg]", "[data-tr]", "#out", "[data-rs]"];
      const roots = [];
      const visit = (root) => {
        roots.push(root);
        for (const host of root.querySelectorAll("*")) if (host.shadowRoot) visit(host.shadowRoot);
      };
      visit(document);
      const debug = {};
      for (const selector of debugSelectors) {
        debug[selector] = roots.flatMap((root) => Array.from(root.querySelectorAll(selector)))
          .map((element) => element.innerText || element.textContent || "").join("\n");
      }      return {
        result: window.__QA_RESULT__ ?? null,
        honeypot: window.__QA_HONEYPOT__ ?? null,
        debug
      };
    });
  } catch (error) {
    snapshot = { diagnosticReadError: String(error) };
  }
  return [
    "  Reason: " + reason,
    "  window.__QA_RESULT__: " + JSON.stringify(snapshot.result),
    "  window.__QA_HONEYPOT__: " + JSON.stringify(snapshot.honeypot),
    "  Console/page errors:\n" + (logs.length ? logs.map((entry) => "    " + entry).join("\n") : "    (none)"),
    "  On-page debug text:\n" + JSON.stringify(snapshot.debug, null, 2)
  ].join("\n");
}

function validateQaResult(result, honeypot) {
  if (!result || typeof result !== "object" || Array.isArray(result) || Object.keys(result).length === 0) {
    return "window.__QA_RESULT__ is missing or empty.";
  }
  const emptyFields = [];
  const inspect = (value, keyPath) => {
    if (keyPath.toLocaleLowerCase("en-US").includes("honeypot")) return;
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
      emptyFields.push(keyPath || "<root>");
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => inspect(entry, keyPath + "[" + index + "]"));
      return;
    }
    if (typeof value === "object") {
      for (const [key, child] of Object.entries(value)) inspect(child, keyPath ? keyPath + "." + key : key);
    }
  };
  inspect(result, "");
  if (emptyFields.length) return "Result has empty/null target fields: " + emptyFields.join(", ");

  const inspectForbiddenEntries = (value) => {
    if (!value || typeof value !== "object") return null;
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLocaleLowerCase("en-US");
      const populated = child === true
        || (typeof child === "string" && Boolean(child.trim()))
        || (Array.isArray(child) && child.length > 0)
        || (child && typeof child === "object" && Object.keys(child).length > 0);
      if ((normalized.includes("wiped") || normalized.includes("desyncignored")) && populated) {
        return normalized.includes("wiped") ? "Result contains wiped fields." : "Result contains desyncIgnored entries.";
      }
      const nested = inspectForbiddenEntries(child);
      if (nested) return nested;
    }
    return null;
  };
  const forbidden = inspectForbiddenEntries(result);
  if (forbidden) return forbidden;
  if (result.honeypotTripped === true) return "Result reports honeypotTripped=true.";
  if (honeypot?.tripped === true || honeypot === true) return "window.__QA_HONEYPOT__ reports a trip.";
  return null;
}

async function runOne(context, baseUrl, file) {
  const page = await context.newPage();
  let fillController;
  const logs = [];
  page.on("console", (message) => logs.push("console." + message.type() + ": " + message.text()));
  page.on("pageerror", (error) => logs.push("pageerror: " + error.message));
  let failure = null;
  try {
    await installQaBridge(page, file === "test1.html");
    await page.goto(baseUrl + "/test/" + encodeURIComponent(file), { waitUntil: "load", timeout: 15000 });
    await page.waitForTimeout(100);
    const untouched = await formStateSnapshot(page);
    const prefilled = untouched.filter((field) => field.value);
    if (prefilled.length) throw new Error("Fixture was not inert before explicit fill: " + JSON.stringify(prefilled));

    fillController = await createFillController(context, page, baseUrl, file, logs);
    await fillController.fill();
    await waitForProfileFill(page, file === "test2.html" ? 6500 : 4500);
    if (file === "test5.html") {
      await clickActionByText(page, "ileri|next");
      await page.waitForSelector("input[type='number']", { state: "attached", timeout: 5000 });
      await page.waitForTimeout(100);
      await fillController.fill();
      await page.waitForFunction(() => {
        const year = document.querySelector("input[type='number']");
        return Boolean(year && String(year.value || "").trim());
      }, null, { timeout: 5000 });
      await clickActionByText(page, "gönder|submit|apply");
    } else {
      await page.waitForTimeout(file === "test2.html" ? 1300 : 150);
      await clickActionByText(page, "gönder|yolla|submit|apply|tamam");
    }
    await page.waitForFunction(() => window.__QA_RESULT__ !== undefined, null, { timeout: 8000 });
    const qa = await page.evaluate(() => ({ result: window.__QA_RESULT__, honeypot: window.__QA_HONEYPOT__ ?? null }));
    const invalid = validateQaResult(qa.result, qa.honeypot);
    if (invalid) throw new Error(invalid);
    return { passed: true };
  } catch (error) {
    failure = error?.message || String(error);
    return { passed: false, reason: failure, diagnostics: await readDiagnostics(page, logs, failure) };
  } finally {
    await fillController?.close().catch(() => {});
    await page.close().catch(() => {});
  }
}

async function main() {
  const files = discoverTests();
  if (!files.length) {
    console.error("No HTML fixtures found in ./test.");
    process.exitCode = 1;
    return;
  }
  const browserPath = findBrowser();
  if (!browserPath) {
    console.error("A headed Chrome or Edge installation is required. Set CHROME_PATH or EDGE_PATH to its executable.");
    process.exitCode = 1;
    return;
  }

  const server = makeStaticServer();
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), ".qa-browser-profile-"));
  let context;
  try {
    const port = await listen(server);
    context = await chromium.launchPersistentContext(profileDirectory, {
      headless: false,
      executablePath: browserPath,
      args: [
        "--disable-extensions-except=" + ROOT,
        "--load-extension=" + ROOT,
        "--no-first-run",
        "--no-default-browser-check"
      ]
    });
    const results = [];
    for (const file of files) {
      const result = await runOne(context, "http://127.0.0.1:" + port, file);
      results.push({ file, ...result });
      if (result.passed) console.log("[PASS] " + file);
      else {
        console.log("[FAIL] " + file);
        console.log(result.diagnostics);
      }
    }
    const passed = results.filter((result) => result.passed).length;
    const failed = results.length - passed;
    console.log("\n" + passed + " passed, " + failed + " failed");
    if (failed) process.exitCode = 1;
  } catch (error) {
    console.error("QA runner failed: " + (error?.stack || error));
    process.exitCode = 1;
  } finally {
    if (context) await context.close().catch(() => {});
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await fs.promises.rm(profileDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

await main();






























