const config = {
  testDir: 'test/e2e',
  timeout: 30 * 1000,
  use: {
    headless: true,
  },
  webServer: {
    command: 'npm run build && npx http-server ./dist -p 8080',
    port: 8080,
    reuseExistingServer: !process.env.CI,
  },
  reporter: [["list"], ["html", { open: 'never' }]]
};

module.exports = config