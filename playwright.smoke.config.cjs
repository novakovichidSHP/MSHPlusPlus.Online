module.exports = {
  testDir: "tests/smoke",
  timeout: 180000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node tests/server.cjs",
    port: 4173,
    reuseExistingServer: true,
    timeout: 120000
  }
};
