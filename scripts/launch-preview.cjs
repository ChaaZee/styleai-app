// Loads .env into process.env then starts the built server.
// Used by .claude/launch.json so the preview tool can manage the process.
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
process.env.NODE_ENV = process.env.NODE_ENV || "production";
require(path.join(__dirname, "..", "dist", "index.cjs"));
