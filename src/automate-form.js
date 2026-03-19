const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth");
const path = require("path");
const fs = require("fs");

chromium.use(stealth());

const BASE_URL = "https://sixmo.ru";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Generate realistic human-like telemetry for a set of fields.
 */
function buildTelemetry(fieldNames) {
  const keyCount = 30 + Math.floor(Math.random() * 40);
  const keyIntervals = Array.from({ length: keyCount }, () =>
    Math.round(55 + Math.random() * 185)
  );
  const avg = keyIntervals.reduce((a, b) => a + b, 0) / keyIntervals.length;
  const variance =
    keyIntervals.reduce((s, v) => s + (v - avg) ** 2, 0) / keyIntervals.length;

  return {
    dwellMs: 8000 + Math.floor(Math.random() * 15000),
    keyIntervals,
    averageKeyInterval: Math.round(avg),
    intervalVariance: Math.round(variance),
    mouseMoves: 40 + Math.floor(Math.random() * 100),
    scrollCount: 2 + Math.floor(Math.random() * 6),
    clicks: fieldNames.length + 1 + Math.floor(Math.random() * 4),
    displayedFields: fieldNames,
    fieldSequence: fieldNames,
    focusSequence: fieldNames,
    userAgent: UA,
    webdriver: false,
    hasPlaywrightBinding: false,
  };
}

/**
 * Create a default upload file if none provided.
 */
function ensureUploadFile() {
  const fp = path.join(__dirname, "..", "upload-file.txt");
  if (!fs.existsSync(fp)) {
    fs.writeFileSync(fp, "Test file for Adaptive Flow Challenge.\n");
  }
  return fp;
}

/**
 * Pick a sensible default value for a field by its name.
 */
function defaultValueFor(fieldName) {
  const n = fieldName.toLowerCase();
  const map = {
    first_name: "Иван", firstname: "Иван",
    last_name: "Петров", lastname: "Петров",
    name: "Иван Петров",
    email: "ivan.petrov@example.com",
    phone: "+79001234567",
    city: "Москва",
    address: "ул. Пушкина 10",
    country: "Россия",
    company: "ООО Тест",
    position: "Инженер",
    age: "30",
    comment: "Тестовый комментарий",
    message: "Тестовое сообщение",
    username: "ivan_petrov",
    password: "SecurePass123",
    zip: "101000", postal: "101000",
    website: "https://example.com",
    bio: "Опытный специалист",
    title: "Тестовое задание",
    description: "Описание задания",
  };
  for (const [key, val] of Object.entries(map)) {
    if (n.includes(key)) return val;
  }
  return "Тестовое значение";
}

/**
 * Automate the multi-step form at sixmo.ru.
 *
 * @param {Object} opts
 * @param {Object}  [opts.formData={}]   - field_name→value overrides
 * @param {string}  [opts.filePath]      - file to upload (.txt/.md/.json)
 * @param {boolean} [opts.headless=true] - headless browser
 * @param {number}  [opts.timeout=90000] - overall timeout ms
 * @returns {Promise<{identifier:string, flowId:string, completedAt:string, url:string, pageText:string}>}
 */
async function automateForm({
  formData = {},
  filePath,
  headless = true,
  timeout = 90000,
} = {}) {
  if (filePath && !fs.existsSync(filePath)) {
    throw new Error(`Upload file not found: ${filePath}`);
  }

  // ── Launch browser ──────────────────────────────────────────────
  const browser = await chromium.launch({
    headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1366, height: 768 },
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    deviceScaleFactor: 1,
  });

  // ── Anti-bot patches (runs before every page navigation) ───────
  await context.addInitScript(() => {
    // Hide webdriver flag
    Object.defineProperty(navigator, "webdriver", { get: () => false });

    // Remove Playwright bindings
    delete window.__playwright__binding__;
    delete window.__pwInitScripts;
    Object.defineProperty(window, "__playwright__binding__", {
      get: () => undefined,
      set: () => {},
      configurable: true,
    });
    Object.defineProperty(window, "__pwInitScripts", {
      get: () => undefined,
      set: () => {},
      configurable: true,
    });

    // Spoof chrome runtime
    if (!window.chrome) {
      window.chrome = {};
    }
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        connect: () => {},
        sendMessage: () => {},
        id: "mocked",
      };
    }

    // Notification permission
    if (typeof Notification !== "undefined") {
      Object.defineProperty(Notification, "permission", {
        get: () => "default",
        configurable: true,
      });
    }

    // ── Telemetry interception ─────────────────────────────────
    // We monkey-patch fetch ONCE here. Before each submit the
    // automation will write the desired telemetry into a hidden
    // element that this interceptor reads.
    const _origFetch = window.fetch;
    window.fetch = async function (...args) {
      if (args[1] && args[1].body instanceof FormData) {
        const fd = args[1].body;
        if (fd.has("telemetry")) {
          const el = document.getElementById("__pw_telemetry__");
          if (el && el.textContent) {
            fd.set("telemetry", el.textContent);
          }
        }
      }
      return _origFetch.apply(this, args);
    };
  });

  const page = await context.newPage();

  // Abort image/font/media loads for speed (optional in headed mode)
  if (headless) {
    await page.route(/\.(png|jpg|jpeg|gif|svg|woff2?|ttf|eot)$/i, (r) =>
      r.abort()
    );
  }

  // Overall timeout guard
  const deadline = Date.now() + timeout;
  const checkDeadline = () => {
    if (Date.now() > deadline) throw new Error("Overall timeout exceeded");
  };

  let result = null;

  try {
    // ── Landing page ──────────────────────────────────────────────
    log("Navigating to", BASE_URL);
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait for SPA to render
    await page.waitForSelector("button", { timeout: 15000 });
    await sleep(600 + rand(800));

    // Small mouse wiggle
    await mouseSway(page);

    // Click "Начать задание"
    const startBtn = page.locator("button").filter({ hasText: /начать|start/i });
    await startBtn.waitFor({ state: "visible", timeout: 10000 });
    await sleep(300 + rand(400));
    await startBtn.click();
    log("Clicked start");

    // ── Step loop ─────────────────────────────────────────────────
    let prevFieldNames = null; // track previous step's fields to detect new step

    for (let step = 1; step <= 10; step++) {
      checkDeadline();
      log(`\n── Step ${step} ──`);

      // Wait for step to be ready:
      // - The "подготавливается" (preparing) loading screen must disappear
      // - New [data-field-key] elements must appear (different from previous step)
      // - OR the result page text must appear
      const loaded = await waitForStepReady(page, prevFieldNames, 45000);

      if (loaded === "result") {
        log("Reached result page");
        break;
      }

      // Extra pause for all fields to render
      await sleep(600 + rand(500));
      checkDeadline();

      // ── Discover fields ───────────────────────────────────────
      const fieldEls = await page.locator("[data-field-key]").all();
      const fields = [];
      for (const el of fieldEls) {
        const name = await el.getAttribute("data-field-key");
        const isFile = (await el.locator('input[type="file"]').count()) > 0;
        const isSelect = (await el.locator("select").count()) > 0;
        fields.push({ name, type: isFile ? "file" : isSelect ? "select" : "text", el });
      }
      log("Fields:", fields.map((f) => `${f.name}(${f.type})`).join(", "));

      // Mouse movement between fields
      await mouseSway(page);

      // ── Fill fields ───────────────────────────────────────────
      for (const f of fields) {
        await sleep(200 + rand(400));

        if (f.type === "file") {
          const fp = filePath || ensureUploadFile();
          log(`  ↑ Upload "${path.basename(fp)}" → ${f.name}`);
          await f.el.locator('input[type="file"]').setInputFiles(fp);
          await sleep(400 + rand(300));

        } else if (f.type === "select") {
          const select = f.el.locator("select");
          // Wait for options to be populated
          await select.waitFor({ state: "visible", timeout: 5000 });
          await sleep(200 + rand(150));

          const opts = await select
            .locator("option")
            .evaluateAll((os) =>
              os.map((o) => ({ v: o.value, t: o.textContent.trim() })).filter((o) => o.v)
            );

          if (opts.length === 0) {
            log(`  ▼ No options for ${f.name}, skipping`);
          } else {
            const userVal = formData[f.name];
            let pick = opts[0].v;
            if (userVal) {
              const m = opts.find(
                (o) => o.v === userVal || o.t.toLowerCase().includes(userVal.toLowerCase())
              );
              if (m) pick = m.v;
            }
            log(`  ▼ Select "${pick}" → ${f.name} (${opts.length} options)`);
            await select.selectOption(pick);
          }
          await sleep(200 + rand(200));

        } else {
          const input = f.el.locator("input, textarea").first();
          const val = formData[f.name] || defaultValueFor(f.name);
          log(`  ✎ Type "${val}" → ${f.name}`);
          await input.click();
          await sleep(80 + rand(150));
          await input.fill("");
          await input.pressSequentially(val, { delay: 45 + rand(60) });
          await sleep(150 + rand(200));
        }

        // Occasional mouse wiggle between fields
        if (Math.random() > 0.5) await mouseSway(page);
      }

      // ── Inject telemetry ──────────────────────────────────────
      const telemetry = buildTelemetry(fields.map((f) => f.name));
      await page.evaluate((json) => {
        let el = document.getElementById("__pw_telemetry__");
        if (!el) {
          el = document.createElement("div");
          el.id = "__pw_telemetry__";
          el.style.display = "none";
          document.body.appendChild(el);
        }
        el.textContent = json;
      }, JSON.stringify(telemetry));

      await sleep(600 + rand(1200));

      // ── Submit ────────────────────────────────────────────────
      const submitBtn = page
        .locator('button[type="submit"]')
        .or(page.locator("button").filter({ hasText: /продолжить|зафиксировать|submit|next/i }))
        .first();
      await submitBtn.waitFor({ state: "visible", timeout: 5000 });

      // Hover over button
      const box = await submitBtn.boundingBox();
      if (box) {
        await page.mouse.move(
          box.x + box.width * (0.3 + Math.random() * 0.4),
          box.y + box.height * (0.3 + Math.random() * 0.4),
          { steps: 4 + Math.floor(Math.random() * 4) }
        );
        await sleep(150 + rand(200));
      }

      // Remember this step's field names so we can detect when the next step loads
      prevFieldNames = fields.map((f) => f.name);

      // Capture current URL before submit to detect navigation
      const urlBefore = page.url();

      await submitBtn.click();
      log("  → Submitted");

      // Wait for URL to change (navigation to next step or result)
      await page.waitForFunction(
        (prev) => window.location.href !== prev,
        urlBefore,
        { timeout: 30000 }
      );
      log("  → Navigated to", page.url());

      // Give React a moment to start unmounting / show loading state
      await sleep(500 + rand(400));
    }

    // ── Extract result ────────────────────────────────────────────
    checkDeadline();

    // Make sure we're on the result page
    await page.waitForSelector("text=Прохождение завершено", { timeout: 20000 }).catch(() => {});
    await sleep(1000 + rand(500));

    result = await page.evaluate(() => {
      const text = document.body.innerText;
      return { pageText: text, url: window.location.href };
    });

    // Parse structured data from the result
    result.identifier = extractBetween(result.pageText, "ИДЕНТИФИКАТОР\n", "\n");
    result.flowId = extractBetween(result.pageText, "ПОТОК", "\n");
    result.completedAt = extractBetween(result.pageText, "ЗАВЕРШЕНО", "\n");

    log("\n═══ RESULT ═══");
    log("Identifier:", result.identifier);
    log("Flow:", result.flowId);
    log("Completed:", result.completedAt);
    log("URL:", result.url);

  } catch (err) {
    const ssPath = path.join(__dirname, "..", "error-screenshot.png");
    await page.screenshot({ path: ssPath, fullPage: true }).catch(() => {});
    log("Screenshot saved:", ssPath);
    throw err;
  } finally {
    await browser.close();
  }

  return result;
}

// ── Helpers ─────────────────────────────────────────────────────────

function rand(max) {
  return Math.floor(Math.random() * max);
}

function log(...args) {
  console.log("[sixmo]", ...args);
}

/**
 * Wait until the current step's form fields are fully loaded and different
 * from the previous step, or the result page appears.
 * Handles the "Этап N подготавливается" loading state.
 */
async function waitForStepReady(page, prevFieldNames, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Check if result page appeared
    const resultVisible = await page
      .locator("text=Прохождение завершено")
      .first()
      .isVisible()
      .catch(() => false);
    if (resultVisible) return "result";

    // Check if loading/preparing state is showing
    const preparing = await page
      .locator("text=подготавливается")
      .first()
      .isVisible()
      .catch(() => false);
    if (preparing) {
      log("  ⏳ Step is preparing, waiting...");
      await sleep(800 + rand(500));
      continue;
    }

    // Check if form fields are visible
    const fieldEls = await page.locator("[data-field-key]").all();
    if (fieldEls.length > 0) {
      // Get current field names
      const names = [];
      for (const el of fieldEls) {
        const n = await el.getAttribute("data-field-key");
        if (n) names.push(n);
      }

      // If we have previous field names, ensure they're different (new step)
      if (prevFieldNames) {
        const same = names.length === prevFieldNames.length &&
          names.every((n) => prevFieldNames.includes(n));
        if (same) {
          // Still showing old step's fields, wait more
          await sleep(400 + rand(300));
          continue;
        }
      }

      // New fields are visible and different from previous step
      return "form";
    }

    await sleep(300 + rand(200));
  }

  throw new Error("Timed out waiting for step to be ready");
}

/** Move mouse around randomly to look human. */
async function mouseSway(page) {
  const x = 200 + rand(800);
  const y = 150 + rand(400);
  await page.mouse.move(x, y, { steps: 3 + rand(5) });
  await sleep(50 + rand(100));
}

/** Extract text between two markers. */
function extractBetween(text, before, after) {
  const i = text.indexOf(before);
  if (i === -1) return null;
  const start = i + before.length;
  const j = text.indexOf(after, start);
  return j === -1 ? text.slice(start).trim() : text.slice(start, j).trim();
}

module.exports = { automateForm, buildTelemetry, defaultValueFor };
