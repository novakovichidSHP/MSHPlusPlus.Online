module.exports = {
  use: {
    baseURL: "http://127.0.0.1:8000",
    headless: true
  },
  webServer: {
    command: "./serve.sh",
    port: 8000,
    reuseExistingServer: true,
    timeout: 120000
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" }
    },
    {
      name: "firefox",
      use: { browserName: "firefox" }
    },
    {
      name: "webkit",
      use: { browserName: "webkit" }
    }
  ]
};
