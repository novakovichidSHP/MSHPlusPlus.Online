module.exports = {
  use: {
    baseURL: "http://127.0.0.1:8000",
    browserName: "chromium",
    headless: true
  },
  webServer: {
    command: "./serve.sh",
    port: 8000,
    reuseExistingServer: true,
    timeout: 120000
  }
};
