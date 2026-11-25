// Startup file for cPanel's "Setup Node.js App" (Phusion Passenger), which loads CommonJS.
// It reads an optional .env next to this file, then starts the built ES module server.
const path = require('node:path')

try {
  process.loadEnvFile(path.join(__dirname, '.env'))
} catch {
  // No .env file: the variables come from cPanel's environment settings instead.
}

import('./dist/server.js')
