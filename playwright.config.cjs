/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: 'test/e2e',
  timeout: 30 * 1000,
  retries: 0,
  use: {
    headless: true,
    // Enable experimental web platform features so OPFS/File System Access APIs are available
    launchOptions: {
      args: [
        '--enable-experimental-web-platform-features',
        '--enable-blink-features=FileSystemAccessAPI,OriginPrivateFileSystem',
        '--enable-features=OriginPrivateFileSystem,FileSystemAccessAPI,NativeFileSystemAPI',
        '--unsafely-treat-insecure-origin-as-secure=http://localhost:8080',
        '--no-sandbox'
      ]
    },
  },
  webServer: {
    command: 'npm run build && npx http-server ./examples/dist -p 8080',
    port: 8080,
    reuseExistingServer: !process.env.CI,
  },
}

module.exports = config
