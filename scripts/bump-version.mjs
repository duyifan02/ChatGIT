import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: node scripts/bump-version.mjs 1.2.3");
  process.exit(1);
}

const files = [
  "package.json",
  "src/manifests/manifest.chrome.json",
  "src/manifests/manifest.firefox.json"
];

for (const file of files) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  json.version = version;
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
  console.log(`Updated ${file} -> ${version}`);
}
