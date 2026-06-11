const { test, expect } = require("@playwright/test");
const { validCases: validCodeCases, invalidCases: invalidCodeCases } = require("./fixtures/editor-code-cases.cjs");

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

function base64UrlEncodeUtf8(text) {
  return Buffer.from(text, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function openSnapshot(page, snapshot, shareId = `share-${Date.now()}`, { editorMode } = {}) {
  const payloadJson = JSON.stringify(snapshot);
  const payload = `u.${base64UrlEncodeUtf8(payloadJson)}`;
  const query = new URLSearchParams({ p: payload });
  if (editorMode) {
    query.set("editor", editorMode);
  }
  await page.goto(`/#/s/${shareId}?${query.toString()}`);
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

async function getEditorValue(page) {
  return page.evaluate(() => {
    const editor = document.querySelector("#editor");
    return editor ? editor.value : "";
  });
}

async function isCm6Mode(page) {
  return page.evaluate(() => {
    const wrap = document.querySelector(".editor-wrap");
    return Boolean(wrap && wrap.classList.contains("cm6-mode"));
  });
}

async function getEditorInteractionLocator(page, { scroll = false } = {}) {
  if (await isCm6Mode(page)) {
    if (scroll) {
      return page.locator(".cm6-editor-host .cm-scroller");
    }
    return page.locator(".cm6-editor-host .cm-content");
  }
  return page.locator("#editor");
}

async function focusEditor(page) {
  if (await isCm6Mode(page)) {
    await page.evaluate(() => {
      const target = document.querySelector(".cm6-editor-host .cm-content");
      if (target) {
        target.focus();
      }
    });
    return;
  }
  await page.locator("#editor").click();
}

async function getEditorInteractionBox(page) {
  return page.evaluate(() => {
    const cm6Mode = document.querySelector(".editor-wrap")?.classList.contains("cm6-mode");
    const target = cm6Mode
      ? document.querySelector(".cm6-editor-host .cm-content")
      : document.querySelector("#editor");
    if (!target) {
      return null;
    }
    const rect = target.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
}

async function setEditorScroll(page, { top = 0, left = 0 }) {
  await page.evaluate(({ nextTop, nextLeft }) => {
    const cmScroller = document.querySelector(".cm6-editor-host .cm-scroller");
    const editor = document.querySelector("#editor");
    const target = cmScroller || editor;
    if (!target) {
      return;
    }
    target.scrollTop = Number(nextTop) || 0;
    target.scrollLeft = Number(nextLeft) || 0;
    target.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, { nextTop: top, nextLeft: left });
}

async function scrollEditorToBottom(page) {
  await page.evaluate(() => {
    const cmScroller = document.querySelector(".cm6-editor-host .cm-scroller");
    const editor = document.querySelector("#editor");
    const target = cmScroller || editor;
    if (!target) {
      return;
    }
    target.scrollTop = target.scrollHeight;
    target.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}

async function selectAllEditor(page) {
  await focusEditor(page);
  const shortcut = process.platform === "darwin" ? "Meta+a" : "Control+a";
  await page.keyboard.press(shortcut);
  const selected = await page.evaluate(() => {
    const editor = document.querySelector("#editor");
    return Boolean(editor && editor.selectionEnd > editor.selectionStart);
  });
  if (!selected) {
    await page.evaluate(() => {
      const editor = document.querySelector("#editor");
      if (!editor) {
        return;
      }
      editor.selectionStart = 0;
      editor.selectionEnd = editor.value.length;
      editor.dispatchEvent(new Event("select", { bubbles: true }));
    });
  }
}

async function ensureEditorHasSelection(page) {
  const hasSelection = await page.evaluate(() => {
    const editor = document.querySelector("#editor");
    return Boolean(editor && editor.selectionEnd > editor.selectionStart);
  });
  if (hasSelection) {
    return;
  }
  await focusEditor(page);
  await page.keyboard.down("Shift");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Shift");
}

async function runCode(page, code) {
  await setEditorText(page, code);
  await page.click("#run-btn");
  await page.waitForTimeout(500);
}

async function runCodeExpectError(page, code, pattern) {
  await setEditorText(page, code);
  await page.click("#run-btn");
  await expect(page.locator("#run-status")).toHaveText("Ошибка", { timeout: 15000 });
  if (pattern) {
    await expect(page.locator("#console-output")).toContainText(pattern);
  }
  await expect(page.locator("#console-output .console-error")).toHaveCount(1);
}

async function runCodeExpectDone(page, code, outputPattern) {
  await setEditorText(page, code);
  await page.click("#run-btn");
  await expect(page.locator("#run-status")).toHaveText("Готово", { timeout: 15000 });
  if (outputPattern) {
    await expect(page.locator("#console-output")).toContainText(outputPattern);
  }
}

async function waitForTurtleCanvasReady(page) {
  await page.waitForFunction(() => !document.querySelector("#turtle-pane")?.classList.contains("hidden"));
  await page.waitForFunction(() => {
    const host = document.querySelector("#turtle-canvas");
    const canvas = document.querySelector("#turtle-canvas canvas");
    if (!host || !canvas) {
      return false;
    }
    const rect = host.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

async function runTurtleCodeExpectDone(page, code, outputPattern) {
  await runCodeExpectDone(page, code, outputPattern);
  await waitForTurtleCanvasReady(page);
}

async function isTurtlePaneVisible(page) {
  return page.evaluate(() => !document.querySelector("#turtle-pane")?.classList.contains("hidden"));
}

async function getTurtleCanvasHash(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("#turtle-canvas canvas");
    if (!canvas) {
      return null;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (let i = 0; i < data.length; i += 1) {
      hash ^= data[i];
      hash = Math.imul(hash, 16777619);
    }
    hash ^= canvas.width;
    hash = Math.imul(hash, 16777619);
    hash ^= canvas.height;
    return (hash >>> 0).toString(16);
  });
}

function extractLastLineNumber(text) {
  const matches = [...String(text || "").matchAll(/\bline\s+(\d+)\b/gi)];
  if (!matches.length) {
    return null;
  }
  return Number(matches[matches.length - 1][1]);
}

async function getEditorSyncMetrics(page, { scrollToBottom = true } = {}) {
  return page.evaluate(async ({ scrollToBottom: shouldScroll }) => {
    const editor = document.querySelector("#editor");
    const highlight = document.querySelector("#editor-highlight");
    const numbers = document.querySelector("#line-numbers");
    const numbersContent = document.querySelector("#line-numbers .line-numbers-content");
    const cm6Mode = document.querySelector(".editor-wrap")?.classList.contains("cm6-mode");
    const cmContent = document.querySelector(".cm6-editor-host .cm-content");
    const cmGutters = document.querySelector(".cm6-editor-host .cm-gutters");
    const cmScroller = document.querySelector(".cm6-editor-host .cm-scroller");
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
    const editorStyle = getComputedStyle(cm6Mode && cmContent ? cmContent : editor);
    const highlightStyle = getComputedStyle(cm6Mode && cmContent ? cmContent : highlight);
    const highlightShift = readTranslate(highlight);
    const numbersShift = readTranslate(numbersContent || numbers);
    const editorRect = (cm6Mode && cmScroller ? cmScroller : editor).getBoundingClientRect();
    const highlightRect = (cm6Mode && cmContent ? cmContent : highlight).getBoundingClientRect();
    const canonicalScrollTop = cm6Mode && cmScroller ? cmScroller.scrollTop : editor.scrollTop;
    const canonicalScrollLeft = cm6Mode && cmScroller ? cmScroller.scrollLeft : editor.scrollLeft;
    const virtualNumbersScroll = cm6Mode && cmScroller ? cmScroller.scrollTop : -numbersShift.y;
    const virtualHighlightScrollTop = cm6Mode && cmScroller ? cmScroller.scrollTop : -highlightShift.y;
    const virtualHighlightScrollLeft = cm6Mode && cmScroller ? cmScroller.scrollLeft : -highlightShift.x;
    return {
      cm6Mode,
      editorScrollTop: canonicalScrollTop,
      highlightScrollTop: virtualHighlightScrollTop,
      numbersScrollTop: virtualNumbersScroll,
      editorScrollLeft: canonicalScrollLeft,
      highlightScrollLeft: virtualHighlightScrollLeft,
      editorLineHeight: editorStyle.lineHeight,
      highlightLineHeight: highlightStyle.lineHeight,
      editorWhiteSpace: editorStyle.whiteSpace,
      highlightWhiteSpace: highlightStyle.whiteSpace,
      scrollHeightDelta: Math.abs(editor.scrollHeight - highlight.scrollHeight),
      selectionStart: editor.selectionStart,
      selectionEnd: editor.selectionEnd,
      editorHeight: editorRect.height,
      highlightHeight: highlightRect.height,
      editorToHighlightTopDelta: Math.abs(editorRect.top - highlightRect.top),
      editorToHighlightLeftDelta: Math.abs(editorRect.left - highlightRect.left)
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

async function getEditorModeToggleLabel(page) {
  return page.locator("#editor-mode-toggle").innerText();
}

async function getEditorFontMetrics(page) {
  return page.evaluate(() => {
    const editor = document.querySelector("#editor");
    const highlight = document.querySelector("#editor-highlight");
    const numbers = document.querySelector("#line-numbers");
    const cm6Mode = document.querySelector(".editor-wrap")?.classList.contains("cm6-mode");
    const cmContent = document.querySelector(".cm6-editor-host .cm-content");
    const cmGutters = document.querySelector(".cm6-editor-host .cm-gutters");
    if (!editor || !highlight || !numbers) {
      return null;
    }
    const editorStyle = getComputedStyle(cm6Mode && cmContent ? cmContent : editor);
    const highlightStyle = getComputedStyle(cm6Mode && cmContent ? cmContent : highlight);
    const numbersStyle = getComputedStyle(cm6Mode && cmGutters ? cmGutters : numbers);
    return {
      cm6Mode,
      editorFontSize: Number.parseFloat(editorStyle.fontSize),
      highlightFontSize: Number.parseFloat(highlightStyle.fontSize),
      numbersFontSize: Number.parseFloat(numbersStyle.fontSize),
      editorLineHeight: editorStyle.lineHeight,
      highlightLineHeight: highlightStyle.lineHeight,
      numbersLineHeight: numbersStyle.lineHeight
    };
  });
}

async function getVisibleIdeCards(page) {
  return page.evaluate(() => {
    const cards = [
      { key: "modules", el: document.querySelector("#sidebar") },
      { key: "editor", el: document.querySelector("#editor-pane") },
      { key: "console", el: document.querySelector("#console-pane") },
      { key: "turtle", el: document.querySelector("#turtle-pane") }
    ];
    return cards
      .filter(({ el }) => {
        if (!el || el.classList.contains("hidden")) {
          return false;
        }
        const style = getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden";
      })
      .map(({ key }) => key);
  });
}

test.describe.configure({ mode: "serial" });

test("stdin works via console input", async ({ page }) => {
  await openProject(page, `stdin-${Date.now()}`);
  const code = [
    'name = input("Name? ")',
    'print("Hello,", name)'
  ].join("\n");
  await setEditorText(page, code);
  await page.click("#run-btn");
  await page.waitForFunction(() => document.querySelector("#console-input").disabled === false);
  await page.fill("#console-input", "Vasya");
  await page.click("#console-send");
  await page.waitForFunction(() => document.querySelector("#console-output")?.textContent?.includes("Hello, Vasya"));
  const output = await page.textContent("#console-output");
  expect(output).toContain("Hello, Vasya");
  expect(output).not.toContain("WebAssembly stack switching not supported");
});

test("line numbers match editor metrics", async ({ page }) => {
  await openProject(page, `lines-${Date.now()}`);
  const lines = Array.from({ length: 35 }, (_, i) => `print(${i + 1})`).join("\n");
  await setEditorText(page, lines);
  const metrics = await page.evaluate(() => {
    const editor = document.querySelector("#editor");
    const numbers = document.querySelector("#line-numbers");
    const cm6Mode = document.querySelector(".editor-wrap")?.classList.contains("cm6-mode");
    const cmNumbers = Array.from(document.querySelectorAll(".cm6-editor-host .cm-gutterElement"))
      .map((el) => Number((el.textContent || "").trim()))
      .filter((value) => Number.isFinite(value) && value > 0);
    const editorStyle = window.getComputedStyle(editor);
    const numberStyle = window.getComputedStyle(cm6Mode ? document.querySelector(".cm6-editor-host .cm-gutters") : numbers);
    const lineCount = (editor.value || "").split("\n").length;
    const numberLines = (numbers.textContent || "").split("\n").length;
    return {
      cm6Mode,
      lineCount,
      numberLines,
      cmVisibleNumbers: cmNumbers.length,
      cmHasLineOne: cmNumbers.includes(1),
      editorFontSize: editorStyle.fontSize,
      numbersFontSize: numberStyle.fontSize,
      editorLineHeight: editorStyle.lineHeight,
      numbersLineHeight: numberStyle.lineHeight
    };
  });
  if (metrics.cm6Mode) {
    expect(metrics.cmVisibleNumbers).toBeGreaterThan(0);
    expect(metrics.cmHasLineOne).toBe(true);
  } else {
    expect(metrics.numberLines).toBe(metrics.lineCount);
  }
  expect(metrics.numbersFontSize).toBe(metrics.editorFontSize);
  expect(metrics.numbersLineHeight).toBe(metrics.editorLineHeight);
});

test("line number gutter keeps minimum readable width in cm6", async ({ page }) => {
  await openProject(page, `gutter-width-cm6-${Date.now()}`);
  const cm6Metrics = await page.evaluate(() => {
    const gutters = document.querySelector(".cm6-editor-host .cm-gutters");
    const lineNumbers = document.querySelector(".cm6-editor-host .cm-lineNumbers");
    if (!gutters || !lineNumbers) {
      return null;
    }
    const guttersStyle = window.getComputedStyle(gutters);
    const lineNumbersStyle = window.getComputedStyle(lineNumbers);
    return {
      guttersMinWidth: Number.parseFloat(guttersStyle.minWidth),
      lineNumbersMinWidth: Number.parseFloat(lineNumbersStyle.minWidth),
      guttersWidth: gutters.getBoundingClientRect().width
    };
  });
  expect(cm6Metrics).not.toBeNull();
  expect(cm6Metrics.guttersMinWidth).toBeGreaterThanOrEqual(44);
  expect(cm6Metrics.lineNumbersMinWidth).toBeGreaterThanOrEqual(44);
  expect(cm6Metrics.guttersWidth).toBeGreaterThanOrEqual(44);
});

test("editor font controls change font size and keep layers aligned", async ({ page }) => {
  await openProject(page, `font-controls-${Date.now()}`);
  await expect(page.locator("#font-dec-btn")).toBeVisible();
  await expect(page.locator("#font-inc-btn")).toBeVisible();
  const base = await getEditorFontMetrics(page);
  expect(base).not.toBeNull();

  await page.click("#font-inc-btn");
  const afterInc = await getEditorFontMetrics(page);
  expect(afterInc.editorFontSize).toBe(base.editorFontSize + 1);
  expect(afterInc.highlightFontSize).toBe(afterInc.editorFontSize);
  expect(afterInc.numbersFontSize).toBe(afterInc.editorFontSize);
  expect(afterInc.highlightLineHeight).toBe(afterInc.editorLineHeight);
  expect(afterInc.numbersLineHeight).toBe(afterInc.editorLineHeight);

  await page.click("#font-dec-btn");
  const afterDec = await getEditorFontMetrics(page);
  expect(afterDec.editorFontSize).toBe(base.editorFontSize);
  expect(afterDec.highlightFontSize).toBe(afterDec.editorFontSize);
  expect(afterDec.numbersFontSize).toBe(afterDec.editorFontSize);

  const sync = await getEditorSyncMetrics(page);
  expectEditorLayersInSync(sync);
});

test("editor font size persists after reload", async ({ page }) => {
  await openProject(page, `font-persist-${Date.now()}`);
  const base = await getEditorFontMetrics(page);
  await page.click("#font-inc-btn");
  await page.reload();
  await page.waitForSelector("#editor", { state: "visible" });
  const afterReload = await getEditorFontMetrics(page);
  expect(afterReload.editorFontSize).toBe(base.editorFontSize + 1);
  expect(afterReload.highlightFontSize).toBe(afterReload.editorFontSize);
  expect(afterReload.numbersFontSize).toBe(afterReload.editorFontSize);
});

test("editor font controls respect bounds", async ({ page }) => {
  await openProject(page, `font-bounds-${Date.now()}`);
  for (let i = 0; i < 40; i += 1) {
    const isDisabled = await page.locator("#font-dec-btn").isDisabled();
    if (isDisabled) {
      break;
    }
    await page.click("#font-dec-btn");
  }
  let metrics = await getEditorFontMetrics(page);
  expect(metrics.editorFontSize).toBe(12);
  await expect(page.locator("#font-dec-btn")).toBeDisabled();

  for (let i = 0; i < 40; i += 1) {
    const isDisabled = await page.locator("#font-inc-btn").isDisabled();
    if (isDisabled) {
      break;
    }
    await page.click("#font-inc-btn");
  }
  metrics = await getEditorFontMetrics(page);
  expect(metrics.editorFontSize).toBe(20);
  await expect(page.locator("#font-inc-btn")).toBeDisabled();
});

test("cursor stays aligned on long content", async ({ page }) => {
  await openProject(page, `cursor-long-${Date.now()}`);
  const longChunk = "x".repeat(90);
  const code = Array.from(
    { length: 80 },
    (_, i) => `for item_${i} in range(3): print(item_${i}, "${longChunk}")`
  ).join("\n");
  await setEditorText(page, code);
  const metrics = await getEditorSyncMetrics(page);
  expectEditorLayersInSync(metrics);
});

test("cursor stays aligned after viewport shrink", async ({ page }) => {
  await page.setViewportSize({ width: 920, height: 820 });
  await openProject(page, `cursor-shrink-${Date.now()}`);
  const longChunk = "very_long_token_".repeat(18);
  const code = Array.from(
    { length: 50 },
    (_, i) => `print("line_${i}", "${longChunk}")`
  ).join("\n");
  await setEditorText(page, code);
  await page.setViewportSize({ width: 700, height: 820 });
  await page.waitForTimeout(150);
  const metrics = await getEditorSyncMetrics(page);
  expectEditorLayersInSync(metrics);
});

test("editor mode defaults to cm6 without storage/query", async ({ page }) => {
  await page.goto("/#/");
  await page.evaluate(() => localStorage.removeItem("shp-editor-mode"));
  await openProject(page, `mode-default-${Date.now()}`);
  await expect(page.locator("#editor-mode-toggle")).toContainText("CM6");
});

test("editor mode toggle persists to localStorage", async ({ page }) => {
  await openProject(page, `mode-persist-${Date.now()}`);
  await page.click("#editor-mode-toggle");
  await expect(page.locator("#editor-mode-toggle")).toContainText("Legacy");
  await openProject(page, `mode-persist-next-${Date.now()}`);
  await expect(page.locator("#editor-mode-toggle")).toContainText("Legacy");
});

test("toggle roundtrip keeps editor content intact", async ({ page }) => {
  await openProject(page, `mode-roundtrip-${Date.now()}`);
  const code = "print('cm6-legacy-roundtrip')\nfor i in range(3):\n    print(i)";
  await setEditorText(page, code);
  await page.click("#editor-mode-toggle");
  await expect(page.locator("#editor-mode-toggle")).toContainText("Legacy");
  await page.click("#editor-mode-toggle");
  await expect(page.locator("#editor-mode-toggle")).toContainText("CM6");
  await expect.poll(() => getEditorValue(page)).toBe(code);
});

test("toggle keeps active file and run state stable", async ({ page }) => {
  await openProject(page, `mode-active-file-${Date.now()}`);
  await page.click("#file-duplicate");
  await expect(page.locator("#file-list .file-item")).toHaveCount(2);
  await page.locator("#file-list .file-item").nth(1).click();
  await setEditorText(page, 'print("mode toggle run")');
  await page.click("#run-btn");
  await expect(page.locator("#run-status")).toHaveText("Готово", { timeout: 15000 });
  const activeBefore = await page.locator("#file-list .file-item.active span").innerText();
  await page.click("#editor-mode-toggle");
  await page.click("#editor-mode-toggle");
  const activeAfter = await page.locator("#file-list .file-item.active span").innerText();
  expect(activeAfter).toBe(activeBefore);
  await expect(page.locator("#run-status")).toHaveText("Готово");
});

test.describe("editor interaction regressions", () => {
  test("[editor-regression] slow wheel scroll keeps layer sync", async ({ page }) => {
    await openFreshProjectWithLongCode(page, "editor-wheel-slow");
    await focusEditor(page);
    for (let i = 0; i < 10; i += 1) {
      await page.mouse.wheel(0, 80);
      await page.waitForTimeout(20);
    }
    const metrics = await getEditorSyncMetrics(page, { scrollToBottom: false });
    expect(metrics.editorScrollTop).toBeGreaterThan(0);
    expectEditorLayersInSync(metrics);
  });

  test("[editor-regression] fast wheel down keeps layer sync", async ({ page }) => {
    await openFreshProjectWithLongCode(page, "editor-wheel-fast");
    await focusEditor(page);
    for (let i = 0; i < 5; i += 1) {
      await page.mouse.wheel(0, 420);
    }
    const metrics = await getEditorSyncMetrics(page, { scrollToBottom: false });
    expect(metrics.editorScrollTop).toBeGreaterThan(300);
    expectEditorLayersInSync(metrics);
  });

  test("[editor-regression] fast wheel up after deep scroll keeps sync", async ({ page }) => {
    await openFreshProjectWithLongCode(page, "editor-wheel-up");
    await scrollEditorToBottom(page);
    await focusEditor(page);
    for (let i = 0; i < 6; i += 1) {
      await page.mouse.wheel(0, -340);
    }
    const metrics = await getEditorSyncMetrics(page, { scrollToBottom: false });
    expect(metrics.editorScrollTop).toBeGreaterThanOrEqual(0);
    expectEditorLayersInSync(metrics);
  });

  test("[editor-regression] drag-select down with autoscroll keeps sync", async ({ page }) => {
    await openFreshProjectWithLongCode(page, "editor-drag-down");
    const box = await getEditorInteractionBox(page);
    await page.mouse.move(box.x + 120, box.y + 24);
    await page.mouse.down();
    for (let i = 0; i < 10; i += 1) {
      await page.mouse.move(box.x + 180, box.y + box.height - 6, { steps: 3 });
      await page.mouse.wheel(0, 210);
    }
    await page.mouse.up();
    await ensureEditorHasSelection(page);
    const metrics = await getEditorSyncMetrics(page, { scrollToBottom: false });
    expect(metrics.selectionEnd).toBeGreaterThan(metrics.selectionStart);
    expectEditorLayersInSync(metrics);
  });

  test("[editor-regression] drag-select up with autoscroll keeps sync", async ({ page }) => {
    await openFreshProjectWithLongCode(page, "editor-drag-up");
    await scrollEditorToBottom(page);
    const box = await getEditorInteractionBox(page);
    await page.mouse.move(box.x + 140, box.y + box.height - 12);
    await page.mouse.down();
    for (let i = 0; i < 10; i += 1) {
      await page.mouse.move(box.x + 120, box.y + 12, { steps: 3 });
      await page.mouse.wheel(0, -210);
    }
    await page.mouse.up();
    await ensureEditorHasSelection(page);
    const metrics = await getEditorSyncMetrics(page, { scrollToBottom: false });
    expect(metrics.selectionEnd).toBeGreaterThan(metrics.selectionStart);
    expectEditorLayersInSync(metrics);
  });

  test("[editor-regression] shift+arrow selection after scroll keeps sync", async ({ page }) => {
    await openFreshProjectWithLongCode(page, "editor-shift-arrows");
    await setEditorScroll(page, { top: 800 });
    await page.evaluate(() => {
      const editor = document.querySelector("#editor");
      if (!editor) {
        return;
      }
      editor.selectionStart = editor.selectionEnd = Math.min(editor.value.length, 4000);
      editor.focus();
    });
    await page.keyboard.down("Shift");
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press("ArrowDown");
    }
    await page.keyboard.up("Shift");
    await ensureEditorHasSelection(page);
    const metrics = await getEditorSyncMetrics(page, { scrollToBottom: false });
    expect(metrics.selectionEnd).toBeGreaterThan(metrics.selectionStart);
    expectEditorLayersInSync(metrics);
  });

  test("[editor-regression] Ctrl+L line selection after scroll keeps sync", async ({ page }) => {
    await openFreshProjectWithLongCode(page, "editor-ctrl-l");
    await focusEditor(page);
    await page.mouse.wheel(0, 900);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+l" : "Control+l");
    await ensureEditorHasSelection(page);
    const metrics = await getEditorSyncMetrics(page, { scrollToBottom: false });
    expect(metrics.selectionEnd).toBeGreaterThan(metrics.selectionStart);
    expectEditorLayersInSync(metrics);
  });

  test("[editor-regression] horizontal scroll and selection keep sync", async ({ page }) => {
    await openProject(page, `editor-horizontal-${Date.now()}`);
    const longLine = `print("${"horizontal_scroll_".repeat(120)}")`;
    const code = Array.from({ length: 35 }, () => longLine).join("\n");
    await setEditorText(page, code);
    await page.evaluate(() => {
      const editor = document.querySelector("#editor");
      editor.scrollLeft = 900;
      editor.selectionStart = 10;
      editor.selectionEnd = 180;
      editor.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    const metrics = await getEditorSyncMetrics(page, { scrollToBottom: false });
    expect(metrics.editorScrollLeft).toBeGreaterThan(0);
    expect(metrics.selectionEnd).toBeGreaterThan(metrics.selectionStart);
    expectEditorLayersInSync(metrics);
  });

  test("[editor-regression] resize during deep scroll keeps sync", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 860 });
    await openFreshProjectWithLongCode(page, "editor-resize-during-scroll");
    await scrollEditorToBottom(page);
    await page.setViewportSize({ width: 980, height: 760 });
    await page.waitForTimeout(140);
    await page.setViewportSize({ width: 1160, height: 860 });
    const metrics = await getEditorSyncMetrics(page, { scrollToBottom: false });
    expectEditorLayersInSync(metrics);
  });

  test("[editor-regression] font change + scroll + selection stays aligned", async ({ page }) => {
    await openFreshProjectWithLongCode(page, "editor-font-scroll");
    await page.click("#font-inc-btn");
    await page.click("#font-inc-btn");
    await focusEditor(page);
    await page.mouse.wheel(0, 700);
    await selectAllEditor(page);
    await ensureEditorHasSelection(page);
    const metrics = await getEditorSyncMetrics(page, { scrollToBottom: false });
    expect(metrics.selectionEnd).toBeGreaterThan(metrics.selectionStart);
    expectEditorLayersInSync(metrics);
  });

  test("[editor-regression] switch file and return keeps editor layers in sync", async ({ page }) => {
    await openFreshProjectWithLongCode(page, "editor-file-switch");
    await page.click("#file-duplicate");
    await expect(page.locator("#file-list .file-item")).toHaveCount(2);
    await page.locator("#file-list .file-item").nth(1).click();
    await page.locator("#file-list .file-item").nth(0).click();
    await focusEditor(page);
    await page.mouse.wheel(0, 500);
    const metrics = await getEditorSyncMetrics(page, { scrollToBottom: false });
    expectEditorLayersInSync(metrics);
  });

  test("[editor-regression] mobile editor card roundtrip keeps sync", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFreshProjectWithLongCode(page, "editor-mobile-roundtrip");
    await page.mouse.wheel(0, 500);
    await page.click('#mobile-nav [data-card="console"]');
    await page.click('#mobile-nav [data-card="editor"]');
    const metrics = await getEditorSyncMetrics(page, { scrollToBottom: false });
    expectEditorLayersInSync(metrics);
  });

  test("[editor-regression] tablet layout with selection keeps line alignment", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openFreshProjectWithLongCode(page, "editor-tablet");
    await focusEditor(page);
    await page.mouse.wheel(0, 620);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+l" : "Control+l");
    await ensureEditorHasSelection(page);
    const metrics = await getEditorSyncMetrics(page, { scrollToBottom: false });
    expect(metrics.selectionEnd).toBeGreaterThan(metrics.selectionStart);
    expectEditorLayersInSync(metrics);
  });

  test("[editor-regression] large paste and immediate selection do not desync layers", async ({ page }) => {
    await openProject(page, `editor-large-paste-${Date.now()}`);
    const hugeCode = makeLongCode({ lines: 260, token: "paste_block", extraWidth: 22 });
    await setEditorText(page, hugeCode);
    await selectAllEditor(page);
    await ensureEditorHasSelection(page);
    const metrics = await getEditorSyncMetrics(page, { scrollToBottom: false });
    expect(metrics.selectionStart).toBe(0);
    expect(metrics.selectionEnd).toBe(hugeCode.length);
    expectEditorLayersInSync(metrics);
  });

  test("[editor-regression] repeated scroll/select cycles avoid drift accumulation", async ({ page }) => {
    await openFreshProjectWithLongCode(page, "editor-stress-cycles");
    for (let i = 0; i < 8; i += 1) {
      await focusEditor(page);
      await page.mouse.wheel(0, i % 2 === 0 ? 300 : -240);
      await page.keyboard.press(process.platform === "darwin" ? "Meta+l" : "Control+l");
      await page.keyboard.down("Shift");
      await page.keyboard.press(i % 2 === 0 ? "ArrowDown" : "ArrowUp");
      await page.keyboard.up("Shift");
      const metrics = await getEditorSyncMetrics(page, { scrollToBottom: false });
      expectEditorLayersInSync(metrics);
    }
  });
});

test("tablet layout prioritizes editor/console/turtle", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openProject(page, `tablet-layout-${Date.now()}`);
  await runCode(page, 'import turtle\n\nturtle.shape("turtle")\n');
  await page.waitForTimeout(300);
  const metrics = await page.evaluate(() => {
    const sidebar = document.querySelector("#sidebar");
    const editor = document.querySelector("#editor-pane");
    const turtle = document.querySelector("#turtle-pane");
    const consolePane = document.querySelector("#console-pane");
    const actionBtn = document.querySelector(".top-actions .btn");
    const panelActionBtn = document.querySelector(".panel-actions .btn");
    if (!sidebar || !editor || !turtle || !consolePane || !actionBtn || !panelActionBtn) {
      return null;
    }
    const sb = sidebar.getBoundingClientRect();
    const ed = editor.getBoundingClientRect();
    const tt = turtle.getBoundingClientRect();
    const cp = consolePane.getBoundingClientRect();
    return {
      editorWidth: ed.width,
      sidebarWidth: sb.width,
      turtleHeight: tt.height,
      consoleHeight: cp.height,
      topActionFontSize: Number.parseFloat(getComputedStyle(actionBtn).fontSize),
      panelActionFontSize: Number.parseFloat(getComputedStyle(panelActionBtn).fontSize)
    };
  });
  expect(metrics).not.toBeNull();
  expect(metrics.editorWidth).toBeGreaterThan(metrics.sidebarWidth);
  expect(metrics.turtleHeight).toBeGreaterThan(140);
  expect(metrics.consoleHeight).toBeGreaterThan(120);
  expect(metrics.topActionFontSize).toBeLessThanOrEqual(11.5);
  expect(metrics.panelActionFontSize).toBeLessThanOrEqual(11.5);
});

test("tablet module action buttons keep readable text", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openProject(page, `tablet-actions-${Date.now()}`);
  const readability = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll(".panel-actions-files .btn.small"));
    if (!buttons.length) {
      return null;
    }
    return buttons.map((button) => ({
      text: button.textContent.trim(),
      whiteSpace: getComputedStyle(button).whiteSpace,
      textOverflow: getComputedStyle(button).textOverflow,
      overflowX: getComputedStyle(button).overflowX
    }));
  });
  expect(readability).not.toBeNull();
  expect(readability.every((entry) => entry.text.length > 0)).toBe(true);
  expect(readability.every((entry) => entry.whiteSpace !== "nowrap")).toBe(true);
  expect(readability.every((entry) => entry.textOverflow !== "ellipsis")).toBe(true);
  expect(readability.every((entry) => entry.overflowX !== "hidden")).toBe(true);
});

test("tablet hides hotkeys and uses compact console input hint", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openProject(page, `tablet-hint-hotkeys-${Date.now()}`);
  await expect(page.locator("#hotkeys-btn")).toBeHidden();
  await expect(page.locator("#console-input")).toHaveAttribute(
    "placeholder",
    "Введите input и нажмите «Отправить»"
  );
});

test("mobile default card is editor", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openProject(page, `mobile-default-${Date.now()}`);
  await expect(page.locator("#mobile-nav")).toBeVisible();
  const visibleCards = await getVisibleIdeCards(page);
  expect(visibleCards).toEqual(["editor"]);
  await expect(page.locator('#mobile-nav [data-card="editor"]')).toHaveAttribute("aria-pressed", "true");
});

test("mobile header is compact and uses icon actions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openProject(page, `mobile-header-${Date.now()}`);
  await expect(page.locator("#share-btn")).toHaveText("🔗");
  await expect(page.locator("#export-btn")).toHaveText("⬆️");
  await expect(page.locator("#import-btn")).toHaveText("⬇️");
  await expect(page.locator("#restart-ide-inline")).toBeVisible();
  await expect(page.locator(".restart-ide-floating-left")).toBeHidden();
  const hiddenMeta = await page.evaluate(() => {
    const mode = document.querySelector("#project-mode");
    const save = document.querySelector("#save-indicator");
    const rename = document.querySelector("#rename-btn");
    if (!mode || !save || !rename) {
      return false;
    }
    const hidden = (el) => getComputedStyle(el).display === "none";
    return hidden(mode) && hidden(save) && hidden(rename);
  });
  expect(hiddenMeta).toBe(true);
});

test("mobile shows one card at a time with bottom nav", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openProject(page, `mobile-cards-${Date.now()}`);
  await expect(page.locator("#mobile-nav")).toBeVisible();
  await page.click('#mobile-nav [data-card="modules"]');
  let visibleCards = await getVisibleIdeCards(page);
  expect(visibleCards).toEqual(["modules"]);

  await page.click('#mobile-nav [data-card="console"]');
  visibleCards = await getVisibleIdeCards(page);
  expect(visibleCards).toEqual(["console"]);

  await page.click('#mobile-nav [data-card="editor"]');
  visibleCards = await getVisibleIdeCards(page);
  expect(visibleCards).toEqual(["editor"]);
});

test("mobile turtle card preserves canvas usability", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openProject(page, `mobile-turtle-${Date.now()}`);
  await runCode(page, 'import turtle\n\nturtle.shape("classic")\n');
  await expect(page.locator('#mobile-nav [data-card="turtle"]')).toBeEnabled();
  await page.click('#mobile-nav [data-card="turtle"]');
  await expect(page.locator("#turtle-pane")).toBeVisible();
  await page.waitForFunction(() => {
    const host = document.querySelector("#turtle-canvas");
    const canvas = document.querySelector("#turtle-canvas canvas");
    if (!host || !canvas) {
      return false;
    }
    const rect = host.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
});

test("mobile run opens turtle card when turtle is used", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openProject(page, `mobile-run-turtle-${Date.now()}`);
  await runCode(page, 'import turtle\n\nturtle.shape("classic")\n');
  const visibleCards = await getVisibleIdeCards(page);
  expect(visibleCards).toEqual(["turtle"]);
});

test("mobile run opens console card and input request keeps console priority", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openProject(page, `mobile-run-console-${Date.now()}`);
  await runCode(page, 'print("ok")\n');
  let visibleCards = await getVisibleIdeCards(page);
  expect(visibleCards).toEqual(["console"]);

  await page.click('#mobile-nav [data-card="editor"]');
  await setEditorText(page, 'import turtle\nname = input("name? ")\nprint(name)\n');
  await page.click("#run-btn");
  await expect(page.locator("#console-input")).toBeEnabled();
  visibleCards = await getVisibleIdeCards(page);
  expect(visibleCards).toEqual(["console"]);
});

test("mobile console hides desktop layout toggle and uses mobile input hint", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openProject(page, `mobile-console-ui-${Date.now()}`);
  await page.click('#mobile-nav [data-card="console"]');
  await expect(page.locator("#console-layout-toggle")).toBeHidden();
  await expect(page.locator("#console-input")).toHaveAttribute(
    "placeholder",
    "Введите input и нажмите «Отправить»"
  );
});

test("mobile modules card is full-height and uses touch-friendly buttons", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openProject(page, `mobile-modules-touch-${Date.now()}`);
  await page.click('#mobile-nav [data-card="modules"]');
  const metrics = await page.evaluate(() => {
    const sidebar = document.querySelector("#sidebar");
    const panel = document.querySelector("#sidebar .panel");
    const moduleButtons = Array.from(document.querySelectorAll(".panel-actions-files .btn.small"));
    const navButton = document.querySelector('#mobile-nav [data-card="modules"]');
    if (!sidebar || !panel || !moduleButtons.length || !navButton) {
      return null;
    }
    const sidebarRect = sidebar.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const moduleButtonHeights = moduleButtons.map((btn) => btn.getBoundingClientRect().height);
    return {
      fillRatio: panelRect.height / Math.max(1, sidebarRect.height),
      moduleButtonHeights,
      navButtonHeight: navButton.getBoundingClientRect().height
    };
  });
  expect(metrics).not.toBeNull();
  expect(metrics.fillRatio).toBeGreaterThan(0.9);
  expect(metrics.moduleButtonHeights.every((h) => h >= 44)).toBe(true);
  expect(metrics.navButtonHeight).toBeGreaterThanOrEqual(44);
});

test("mobile landing hero code block keeps stable height while typing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/");
  const firstHeight = await page.locator(".hero-card").evaluate((el) => el.getBoundingClientRect().height);
  await page.waitForTimeout(1500);
  const secondHeight = await page.locator(".hero-card").evaluate((el) => el.getBoundingClientRect().height);
  expect(Math.abs(secondHeight - firstHeight)).toBeLessThanOrEqual(2);
});

test("mobile editor card keeps caret alignment", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openProject(page, `mobile-caret-${Date.now()}`);
  const code = Array.from({ length: 60 }, (_, i) => `print(${i})`).join("\n");
  await setEditorText(page, code);
  await page.click('#mobile-nav [data-card="console"]');
  await page.click('#mobile-nav [data-card="editor"]');
  const sync = await getEditorSyncMetrics(page);
  expectEditorLayersInSync(sync);
});

test("turtle shape changes canvas output", async ({ page }) => {
  await openProject(page, `turtle-${Date.now()}`);
  await runCode(page, 'import turtle\n\nturtle.shape("classic")\n');
  const classicHash = await page.evaluate(() => {
    const canvas = document.querySelector("#turtle-canvas canvas");
    if (!canvas) {
      return null;
    }
    const ctx = canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 0;
    for (let i = 0; i < data.length; i += 4) {
      hash = (hash + data[i] * 3 + data[i + 1] * 5 + data[i + 2] * 7 + data[i + 3]) % 1000000007;
    }
    return hash;
  });
  await runCode(page, 'import turtle\n\nturtle.shape("circle")\n');
  await page.waitForFunction((prev) => {
    const canvas = document.querySelector("#turtle-canvas canvas");
    if (!canvas) {
      return false;
    }
    const ctx = canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 0;
    for (let i = 0; i < data.length; i += 4) {
      hash = (hash + data[i] * 3 + data[i + 1] * 5 + data[i + 2] * 7 + data[i + 3]) % 1000000007;
    }
    return hash !== prev;
  }, classicHash);
  const circleHash = await page.evaluate(() => {
    const canvas = document.querySelector("#turtle-canvas canvas");
    if (!canvas) {
      return null;
    }
    const ctx = canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 0;
    for (let i = 0; i < data.length; i += 4) {
      hash = (hash + data[i] * 3 + data[i + 1] * 5 + data[i + 2] * 7 + data[i + 3]) % 1000000007;
    }
    return hash;
  });
  expect(circleHash).not.toBe(classicHash);
});

test.describe("turtle runtime coverage", () => {
  test("turtle: pane stays hidden for non-turtle run", async ({ page }) => {
    await openProject(page, `turtle-no-import-${Date.now()}`);
    await runCodeExpectDone(page, 'print("plain")\n', "plain");
    expect(await isTurtlePaneVisible(page)).toBe(false);
  });

  test("turtle: direct import creates visible canvas", async ({ page }) => {
    await openProject(page, `turtle-direct-${Date.now()}`);
    await runTurtleCodeExpectDone(page, "import turtle\nt=turtle.Turtle()\nt.forward(20)\n");
    expect(await isTurtlePaneVisible(page)).toBe(true);
    expect(await getTurtleCanvasHash(page)).not.toBeNull();
  });

  test("turtle: from-import path works", async ({ page }) => {
    await openProject(page, `turtle-from-${Date.now()}`);
    await runTurtleCodeExpectDone(page, "from turtle import Turtle\nt=Turtle()\nt.forward(15)\n");
    expect(await getTurtleCanvasHash(page)).not.toBeNull();
  });

  test("turtle: alias import path works", async ({ page }) => {
    await openProject(page, `turtle-alias-${Date.now()}`);
    await runTurtleCodeExpectDone(page, "import turtle as tr\nt=tr.Turtle()\nt.left(45)\nt.forward(18)\n");
    expect(await getTurtleCanvasHash(page)).not.toBeNull();
  });

  test("turtle: local imported module enables turtle pane", async ({ page }) => {
    await openSnapshot(page, {
      title: "Turtle local module",
      files: [
        { name: "main.py", content: "import shapes\nshapes.draw()\n" },
        { name: "shapes.py", content: "import turtle\ndef draw():\n    t=turtle.Turtle()\n    t.forward(20)\n" }
      ],
      lastActiveFile: "main.py"
    });
    await page.click("#run-btn");
    await expect(page.locator("#run-status")).toHaveText("Готово", { timeout: 15000 });
    await waitForTurtleCanvasReady(page);
  });

  test("turtle: transitive module chain enables turtle pane", async ({ page }) => {
    await openSnapshot(page, {
      title: "Turtle transitive module",
      files: [
        { name: "main.py", content: "import app\napp.run()\n" },
        { name: "app.py", content: "import drawlib\ndef run():\n    drawlib.draw()\n" },
        { name: "drawlib.py", content: "import turtle\ndef draw():\n    t=turtle.Turtle()\n    t.forward(22)\n" }
      ],
      lastActiveFile: "main.py"
    });
    await page.click("#run-btn");
    await expect(page.locator("#run-status")).toHaveText("Готово", { timeout: 15000 });
    await waitForTurtleCanvasReady(page);
  });

  test("turtle: unreachable turtle module does not enable pane", async ({ page }) => {
    await openSnapshot(page, {
      title: "Unreachable turtle module",
      files: [
        { name: "main.py", content: 'print("no turtle path")\n' },
        { name: "hidden_turtle.py", content: "import turtle\n" }
      ],
      lastActiveFile: "main.py"
    });
    await page.click("#run-btn");
    await expect(page.locator("#run-status")).toHaveText("Готово", { timeout: 15000 });
    expect(await isTurtlePaneVisible(page)).toBe(false);
  });

  test("turtle: turtle run keeps stdout output", async ({ page }) => {
    await openProject(page, `turtle-stdout-${Date.now()}`);
    await runTurtleCodeExpectDone(page, 'import turtle\nt=turtle.Turtle()\nt.forward(1)\nprint("turtle-ok")\n', "turtle-ok");
  });

  test("turtle: input flow works with turtle run", async ({ page }) => {
    await openProject(page, `turtle-input-${Date.now()}`);
    await setEditorText(page, 'import turtle\nname=input("n? ")\nt=turtle.Turtle()\nt.forward(12)\nprint(name)\n');
    await page.click("#run-btn");
    await expect(page.locator("#console-input")).toBeEnabled({ timeout: 15000 });
    await page.fill("#console-input", "Vasya");
    await page.click("#console-send");
    await expect(page.locator("#run-status")).toHaveText("Готово", { timeout: 15000 });
    await expect(page.locator("#console-output")).toContainText("Vasya");
    await waitForTurtleCanvasReady(page);
  });

  test("turtle: consecutive turtle runs update canvas output", async ({ page }) => {
    await openProject(page, `turtle-rerun-${Date.now()}`);
    await runTurtleCodeExpectDone(page, "import turtle\nt=turtle.Turtle()\nt.forward(30)\n");
    const firstHash = await getTurtleCanvasHash(page);
    await runTurtleCodeExpectDone(page, "import turtle\nt=turtle.Turtle()\nt.left(90)\nt.forward(30)\n");
    const secondHash = await getTurtleCanvasHash(page);
    expect(secondHash).not.toBe(firstHash);
  });

  test("turtle: non-turtle rerun hides pane after turtle run", async ({ page }) => {
    await openProject(page, `turtle-hide-after-${Date.now()}`);
    await runTurtleCodeExpectDone(page, "import turtle\nt=turtle.Turtle()\nt.forward(10)\n");
    expect(await isTurtlePaneVisible(page)).toBe(true);
    await runCodeExpectDone(page, 'print("done")\n', "done");
    expect(await isTurtlePaneVisible(page)).toBe(false);
  });

  test("turtle: clear button resets turtle canvas state", async ({ page }) => {
    await openProject(page, `turtle-clear-${Date.now()}`);
    await runTurtleCodeExpectDone(page, "import turtle\nt=turtle.Turtle()\nfor _ in range(5):\n    t.forward(25)\n    t.left(72)\n");
    const beforeClear = await getTurtleCanvasHash(page);
    await page.click("#turtle-clear");
    await page.waitForTimeout(120);
    const afterClear = await getTurtleCanvasHash(page);
    expect(afterClear).not.toBe(beforeClear);
  });

  test("turtle: square drawing commands execute successfully", async ({ page }) => {
    await openProject(page, `turtle-square-${Date.now()}`);
    await runTurtleCodeExpectDone(
      page,
      'import turtle\nt=turtle.Turtle()\nfor _ in range(4):\n    t.forward(30)\n    t.right(90)\nprint("square-done")\n',
      "square-done"
    );
  });

  test("turtle: goto command executes successfully", async ({ page }) => {
    await openProject(page, `turtle-goto-${Date.now()}`);
    await runTurtleCodeExpectDone(page, 'import turtle\nt=turtle.Turtle()\nt.goto(40, 20)\nprint("goto-done")\n', "goto-done");
  });

  test("turtle: heading and rotation commands execute successfully", async ({ page }) => {
    await openProject(page, `turtle-heading-${Date.now()}`);
    await runTurtleCodeExpectDone(
      page,
      'import turtle\nt=turtle.Turtle()\nt.setheading(90)\nt.forward(20)\nt.right(45)\nt.forward(10)\nprint("heading-done")\n',
      "heading-done"
    );
  });

  test("turtle: circle command executes successfully", async ({ page }) => {
    await openProject(page, `turtle-circle-${Date.now()}`);
    await runTurtleCodeExpectDone(page, 'import turtle\nt=turtle.Turtle()\nt.circle(35)\nprint("circle-done")\n', "circle-done");
  });

  test("turtle: dot command executes successfully", async ({ page }) => {
    await openProject(page, `turtle-dot-${Date.now()}`);
    await runTurtleCodeExpectDone(page, 'import turtle\nt=turtle.Turtle()\nt.dot(20, "red")\nprint("dot-done")\n', "dot-done");
  });

  test("turtle: style commands (color/pensize/fill) execute successfully", async ({ page }) => {
    await openProject(page, `turtle-style-${Date.now()}`);
    await runTurtleCodeExpectDone(
      page,
      'import turtle\nt=turtle.Turtle()\nt.color("blue")\nt.pensize(4)\nt.begin_fill()\nfor _ in range(3):\n    t.forward(25)\n    t.left(120)\nt.end_fill()\nprint("style-done")\n',
      "style-done"
    );
  });

  test("turtle: multiple turtles execute in one run", async ({ page }) => {
    await openProject(page, `turtle-multi-${Date.now()}`);
    await runTurtleCodeExpectDone(
      page,
      'import turtle\nt1=turtle.Turtle()\nt2=turtle.Turtle()\nt2.color("green")\nt1.forward(20)\nt2.left(90)\nt2.forward(20)\nprint("multi-done")\n',
      "multi-done"
    );
  });

  test("turtle: runtime error still reports and keeps turtle pane visible", async ({ page }) => {
    await openProject(page, `turtle-runtime-error-${Date.now()}`);
    await runCodeExpectError(page, "import turtle\nprint(undefined_name)\n", "NameError");
    expect(await isTurtlePaneVisible(page)).toBe(true);
  });
});

test("remix from shared snapshot creates regular project via modal", async ({ page }) => {
  const baseline = 'print("base")\n';
  const draft = 'print("draft change")\n';
  await openSnapshot(page, {
    title: "Shared lesson",
    files: [{ name: "main.py", content: baseline }],
    lastActiveFile: "main.py"
  });

  await expect(page.locator("#project-mode")).toHaveText("Снимок");
  await expect(page.locator("#remix-btn")).toBeVisible();
  await expect(page.locator("#reset-btn")).toBeVisible();

  await setEditorText(page, draft);
  await page.click("#remix-btn");
  await expect(page.locator("#modal .modal-input")).toBeVisible();
  await expect(page.locator("#modal .modal-input")).toHaveValue("Shared lesson");
  await page.fill("#modal .modal-input", "Remixed lesson");
  await page.click('#modal [data-action="confirm"]');

  await page.waitForFunction(() => window.location.hash.startsWith("#/p/"));
  await expect(page.locator("#project-mode")).toHaveText("Проект");
  await expect(page.locator("#editor")).toHaveValue(draft);
  await expect(page.locator("#project-title")).toHaveText("Remixed lesson");
});

test("snapshot run prefers local config.py over skulpt stdlib stub", async ({ page }) => {
  await openSnapshot(page, {
    title: "Local config import",
    files: [
      {
        name: "main.py",
        content: "from config import WIDTH\nprint(WIDTH)\n"
      },
      {
        name: "config.py",
        content: "WIDTH = 600\n"
      }
    ],
    lastActiveFile: "main.py"
  });

  await page.click("#run-btn");
  await expect(page.locator("#run-status")).toHaveText("Готово", { timeout: 15000 });
  await expect(page.locator("#console-output")).toContainText("600");
});

test("reset snapshot restores baseline with confirmation", async ({ page }) => {
  const baseline = 'print("original")\n';
  const changed = 'print("edited")\n';
  await openSnapshot(page, {
    title: "Reset source",
    files: [{ name: "main.py", content: baseline }],
    lastActiveFile: "main.py"
  });

  await setEditorText(page, changed);
  await expect(page.locator("#editor")).toHaveValue(changed);

  await page.click("#reset-btn");
  await expect(page.locator("#modal")).toBeVisible();
  await page.click('#modal [data-action="confirm"]');

  await expect(page.locator("#project-mode")).toHaveText("Снимок");
  await expect(page.locator("#editor")).toHaveValue(baseline);
});

test("remix cancel keeps snapshot and does not navigate", async ({ page }) => {
  const changed = 'print("keep draft")\n';
  await openSnapshot(page, {
    title: "Cancel source",
    files: [{ name: "main.py", content: 'print("start")\n' }],
    lastActiveFile: "main.py"
  });

  await setEditorText(page, changed);
  await page.click("#remix-btn");
  await expect(page.locator("#modal")).toBeVisible();
  await page.click('#modal [data-action="cancel"]');

  await expect(page).toHaveURL(/#\/s\//);
  await expect(page.locator("#project-mode")).toHaveText("Снимок");
  await expect(page.locator("#editor")).toHaveValue(changed);
});

test.describe("code input matrix", () => {
  for (const caseDef of validCodeCases) {
    test(`code matrix valid: ${caseDef.id}`, async ({ page }) => {
      await openProject(page, `matrix-valid-${caseDef.id}-${Date.now()}`);
      if (caseDef.inputLines && caseDef.inputLines.length) {
        await setEditorText(page, caseDef.code);
        await page.click("#run-btn");
        await expect(page.locator("#console-input")).toBeEnabled({ timeout: 15000 });
        await page.fill("#console-input", caseDef.inputLines.join("\n"));
        await page.click("#console-send");
        await expect(page.locator("#run-status")).toHaveText("Готово", { timeout: 15000 });
        if (caseDef.outputPattern) {
          await expect(page.locator("#console-output")).toContainText(caseDef.outputPattern);
        }
      } else {
        await runCodeExpectDone(page, caseDef.code, caseDef.outputPattern);
      }
      if (caseDef.expectTurtle) {
        await page.waitForFunction(() => !document.querySelector("#turtle-pane")?.classList.contains("hidden"));
      }
    });
  }

  for (const caseDef of invalidCodeCases) {
    test(`code matrix invalid: ${caseDef.id}`, async ({ page }) => {
      await openProject(page, `matrix-invalid-${caseDef.id}-${Date.now()}`);
      await runCodeExpectError(page, caseDef.code, new RegExp(caseDef.errorPattern, "i"));
    });
  }
});

test.describe("negative scenarios", () => {
  test("python syntax error is reported in console", async ({ page }) => {
    await openProject(page, `neg-syntax-${Date.now()}`);
    await runCodeExpectError(page, "def broken(:\n  pass\n", "SyntaxError");
  });

  test("python NameError is reported in console", async ({ page }) => {
    await openProject(page, `neg-name-${Date.now()}`);
    await runCodeExpectError(page, "print(undefined_name)\n", "NameError");
  });

  test("python ZeroDivisionError is reported in console", async ({ page }) => {
    await openProject(page, `neg-zero-${Date.now()}`);
    await runCodeExpectError(page, "print(1/0)\n", "ZeroDivisionError");
  });

  test("python import error for missing module is reported", async ({ page }) => {
    await openProject(page, `neg-import-${Date.now()}`);
    await runCodeExpectError(page, "import definitely_missing_module_xyz\n", /ImportError|ModuleNotFoundError|No module named/i);
  });

  test("python explicit raise ValueError is reported", async ({ page }) => {
    await openProject(page, `neg-raise-${Date.now()}`);
    await runCodeExpectError(page, 'raise ValueError("boom")\n', "ValueError");
  });

  test("python assertion failure is reported", async ({ page }) => {
    await openProject(page, `neg-assert-${Date.now()}`);
    await runCodeExpectError(page, 'assert False, "assertion broke"\n', "AssertionError");
  });

  test("EOF in multi-line statement reports correct payload line", async ({ page }) => {
    await openProject(page, `neg-eof-${Date.now()}`);
    const code = "print(1)\nvalue = (\n  1 + 2\n";
    await runCodeExpectError(page, code, /EOF|unexpected EOF|multi-line statement/i);
    const output = await page.textContent("#console-output");
    const line = extractLastLineNumber(output);
    expect(line).toBe(2);
  });

  test("EOF for unclosed print call points to unclosed delimiter line", async ({ page }) => {
    await openProject(page, `neg-eof-print-${Date.now()}`);
    const code = "a = int(input())\nb = int(input())\nprint(a+b";
    await runCodeExpectError(page, code, /EOF|unexpected EOF|multi-line statement/i);
    const output = await page.textContent("#console-output");
    const line = extractLastLineNumber(output);
    const expectedLine = code.replace(/\r\n?/g, "\n").split("\n").length;
    expect(line).toBe(expectedLine);
  });

  test("runtime sanitizes invisible and control chars before execution", async ({ page }) => {
    await openProject(page, `neg-invisible-${Date.now()}`);
    const code = "a = 1\u200B\r\nb = 2\u0007\r\nprint(a + b)\n";
    await runCode(page, code);
    await expect(page.locator("#run-status")).toHaveText("Готово", { timeout: 15000 });
    await expect(page.locator("#console-output")).toContainText("3");
  });

  test("snapshot route without payload redirects to landing", async ({ page }) => {
    await page.goto("/#/s/no-payload");
    await page.waitForSelector("#view-landing:not(.hidden)", { timeout: 15000 });
    await expect(page).toHaveURL(/#\/$/);
  });

  test("snapshot route with invalid payload redirects to landing", async ({ page }) => {
    await page.goto("/#/s/bad-payload?p=u.not-valid-base64-***");
    await page.waitForSelector("#view-landing:not(.hidden)", { timeout: 15000 });
    await expect(page).toHaveURL(/#\/$/);
  });
});
