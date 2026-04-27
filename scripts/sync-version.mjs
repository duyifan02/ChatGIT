import { readFileSync, writeFileSync } from "node:fs";

const packagePath = "package.json";

const manifestPaths = [
  "src/manifests/manifest.chrome.json",
  "src/manifests/manifest.firefox.json"
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const pkg = readJson(packagePath);
const version = pkg.version;

if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Invalid package version: ${version}`);
  process.exit(1);
}

for (const path of manifestPaths) {
  const manifest = readJson(path);
  manifest.version = version;
  writeJson(path, manifest);
  console.log(`Synced ${path} -> ${version}`);
}
