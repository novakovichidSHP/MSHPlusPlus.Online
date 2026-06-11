const { test, expect } = require("@playwright/test");

async function openProject(page, id, { editorMode } = {}) {
  const params = new URLSearchParams();
  if (editorMode) {
    params.set("editor", editorMode);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  await page.goto(`/#/p/${id}${suffix}`);
  await page.waitForSelector("#editor", { state: "visible" });
  await page.waitForFunction(() => document.querySelector("#guard")?.classList.contains("hidden"), { timeout: 90000 });
}

async function setEditorText(page, code) {
  await page.evaluate((text) => {
    const editor = document.querySelector("#editor");
    if (!editor) {
      return;
    }
    editor.value = text;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }, code);
}

async function getEditorSyncMetrics(page, { scrollToBottom = true } = {}) {
  return page.evaluate(async ({ scrollToBottom: shouldScroll }) => {
    const editor = document.querySelector("#editor");
    const highlight = document.querySelector("#editor-highlight");
    const numbers = document.querySelector("#line-numbers");
    const numbersContent = document.querySelector("#line-numbers .line-numbers-content");
    if (!editor || !highlight || !numbers) {
      return null;
    }
    const readTranslate = (element) => {
      if (!element) {
        return { x: 0, y: 0 };
      }
      const transform = getComputedStyle(element).transform;
      if (!transform || transform === "none") {
        return { x: 0, y: 0 };
      }
      const matrix = new DOMMatrixReadOnly(transform);
      return { x: matrix.m41, y: matrix.m42 };
    };
    if (shouldScroll) {
      editor.scrollTop = editor.scrollHeight;
      editor.scrollLeft = Math.max(0, editor.scrollWidth - editor.clientWidth);
      editor.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
    await new Promise((resolve) => {
      const raf = typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (callback) => setTimeout(callback, 16);
      raf(() => raf(resolve));
    });
    const editorStyle = getComputedStyle(editor);
    const highlightStyle = getComputedStyle(highlight);
    const highlightShift = readTranslate(highlight);
    const numbersShift = readTranslate(numbersContent || numbers);
    return {
      editorScrollTop: editor.scrollTop,
      highlightScrollTop: -highlightShift.y,
      numbersScrollTop: -numbersShift.y,
      editorScrollLeft: editor.scrollLeft,
      highlightScrollLeft: -highlightShift.x,
      editorLineHeight: editorStyle.lineHeight,
      highlightLineHeight: highlightStyle.lineHeight,
      editorWhiteSpace: editorStyle.whiteSpace,
      highlightWhiteSpace: highlightStyle.whiteSpace,
      selectionStart: editor.selectionStart,
      selectionEnd: editor.selectionEnd
    };
  }, { scrollToBottom });
}

function expectEditorLayersInSync(metrics, tolerance = 1) {
  expect(metrics).not.toBeNull();
  expect(Math.abs(metrics.highlightScrollTop - metrics.editorScrollTop)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(metrics.numbersScrollTop - metrics.editorScrollTop)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(metrics.highlightScrollLeft - metrics.editorScrollLeft)).toBeLessThanOrEqual(tolerance);
  expect(metrics.editorLineHeight).toBe(metrics.highlightLineHeight);
  expect(metrics.editorWhiteSpace).toBe(metrics.highlightWhiteSpace);
}

function makeLongCode({ lines = 120, token = "long_token", extraWidth = 14 } = {}) {
  const chunk = `${token}_`.repeat(extraWidth);
  return Array.from(
    { length: lines },
    (_, i) => `for idx_${i} in range(2): print("line_${i}", "${chunk}")`
  ).join("\n");
}

async function openFreshProjectWithLongCode(page, label, options = {}) {
  await openProject(page, `${label}-${Date.now()}`, options);
  await setEditorText(page, makeLongCode(options));
}

test.describe.configure({ mode: "serial" });

test("query editor=legacy overrides stored cm6", async ({ page }) => {
  await page.goto("/#/");
  await page.evaluate(() => localStorage.setItem("shp-editor-mode", "cm6"));
  await openProject(page, `mode-query-legacy-${Date.now()}`, { editorMode: "legacy" });
  await expect(page.locator("#editor-mode-toggle")).toContainText("Legacy");
});

test("line number gutter keeps minimum readable width in legacy", async ({ page }) => {
  await openProject(page, `gutter-width-legacy-${Date.now()}`, { editorMode: "legacy" });
  const legacyMetrics = await page.evaluate(() => {
    const numbers = document.querySelector("#line-numbers");
    if (!numbers) {
      return null;
    }
    const style = window.getComputedStyle(numbers);
    return {
      minWidth: Number.parseFloat(style.minWidth),
      width: numbers.getBoundingClientRect().width
    };
  });
  expect(legacyMetrics).not.toBeNull();
  expect(legacyMetrics.minWidth).toBeGreaterThanOrEqual(44);
  expect(legacyMetrics.width).toBeGreaterThanOrEqual(44);
});

test.describe("legacy editor fallback sanity", () => {
  test("[legacy] slow/fast wheel sync", async ({ page }) => {
    await openFreshProjectWithLongCode(page, "legacy-wheel", { editorMode: "legacy" });
    await expect(page.locator("#editor-mode-toggle")).toContainText("Legacy");
    await page.locator("#editor").click();
    for (let i = 0; i < 4; i += 1) {
      await page.mouse.wheel(0, 320);
    }
    for (let i = 0; i < 3; i += 1) {
      await page.mouse.wheel(0, -240);
    }
    const metrics = await getEditorSyncMetrics(page, { scrollToBottom: false });
    expectEditorLayersInSync(metrics);
  });

  test("[legacy] selection with autoscroll", async ({ page }) => {
    await openFreshProjectWithLongCode(page, "legacy-selection", { editorMode: "legacy" });
    const editor = page.locator("#editor");
    const box = await editor.boundingBox();
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    for (let i = 0; i < 5; i += 1) {
      await page.mouse.move(box.x + 28, box.y + box.height - 8, { steps: 3 });
      await page.mouse.wheel(0, 180);
    }
    await page.mouse.up();
    const metrics = await getEditorSyncMetrics(page, { scrollToBottom: false });
    expect(metrics.selectionEnd).toBeGreaterThan(metrics.selectionStart);
    expectEditorLayersInSync(metrics);
  });

  test("[legacy] font change + selection remains aligned", async ({ page }) => {
    await openFreshProjectWithLongCode(page, "legacy-font", { editorMode: "legacy" });
    await page.click("#font-inc-btn");
    await page.locator("#editor").click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+a" : "Control+a");
    const metrics = await getEditorSyncMetrics(page, { scrollToBottom: false });
    expect(metrics.selectionEnd).toBeGreaterThan(metrics.selectionStart);
    expectEditorLayersInSync(metrics);
  });

  test("[legacy] repeated scroll/select cycles stay stable", async ({ page }) => {
    await openFreshProjectWithLongCode(page, "legacy-cycles", { editorMode: "legacy" });
    for (let i = 0; i < 4; i += 1) {
      await page.locator("#editor").click();
      await page.mouse.wheel(0, i % 2 === 0 ? 300 : -260);
      await page.keyboard.press(process.platform === "darwin" ? "Meta+l" : "Control+l");
      const metrics = await getEditorSyncMetrics(page, { scrollToBottom: false });
      expectEditorLayersInSync(metrics);
    }
  });
});
