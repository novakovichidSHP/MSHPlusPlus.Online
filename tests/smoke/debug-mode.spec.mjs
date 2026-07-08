import { expect, test } from "@playwright/test";

const DEBUG_ARRAYS_CODE = `#include <iostream>
using namespace std;
int main() {
  int a, b, c[1000] = {};
  cin >> a >> b;
  cout << a + b << " " << c[0];
}
`;

const WARNING_CODE = `int main() {
  int unused = 1;
  return 0;
}
`;

async function waitForReady(page) {
  await page.goto("/");
  await expect(page.locator("#guard")).toBeHidden({ timeout: 120000 });
}

async function createProject(page) {
  await page.locator("#new-project").click();
  await page.locator("#modal button.btn.primary").click();
  await expect(page.locator("#view-ide")).toBeVisible();
}

async function setTheme(page, theme) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await page.evaluate(() => document.body.dataset.theme || "light");
    if (current === theme) return;
    await page.locator("#theme-toggle").click();
  }
  await expect(page.locator("body")).toHaveAttribute("data-theme", theme);
}

async function setEditorCode(page, code) {
  await page.locator("#editor").fill(code);
  await expect(page.locator("#editor")).toHaveValue(code);
}

async function consoleText(page) {
  return page.locator("#console-output").textContent();
}

for (const theme of ["light", "dark"]) {
  test(`debug mode handles arrays and live stdin in ${theme} theme`, async ({ page }) => {
    await waitForReady(page);
    await createProject(page);
    await setTheme(page, theme);
    await setEditorCode(page, DEBUG_ARRAYS_CODE);

    await page.locator("#debug-step-start-btn").click();
    await expect(page.locator("#run-status")).toHaveAttribute("data-state", "debugpaused", { timeout: 120000 });
    await expect(page.locator("#debug-status")).toHaveText("paused");
    await expect(page.locator("#debug-frame")).toContainText("main.cpp:4");

    await page.locator("#debug-continue-btn").click();
    await page.locator("#console-input").fill("2 3");
    await page.locator("#console-input").press("Enter");

    await expect(page.locator("#run-status")).toHaveAttribute("data-state", "debugdone", { timeout: 120000 });
    await expect(page.locator("#debug-status")).toHaveText("idle");
    await expect.poll(() => consoleText(page)).toContain("5 0");
    await expect.poll(() => consoleText(page)).not.toContain("error:");
  });
}

test("run mode surfaces warning diagnostics without blocking execution", async ({ page }) => {
  await waitForReady(page);
  await createProject(page);
  await setEditorCode(page, WARNING_CODE);

  await page.locator("#run-btn").click();

  await expect(page.locator("#run-status")).toHaveAttribute("data-state", "done", { timeout: 120000 });
  await expect.poll(() => consoleText(page)).toContain("warning:");
  await expect.poll(() => consoleText(page)).toContain("Программа завершена с кодом 0");
});
