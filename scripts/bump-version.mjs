import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: npm run bump -- 1.2.3 (or: node scripts/bump-version.mjs 1.2.3)");
  process.exit(1);
}

const files = [
  "package.json",
  "src/manifests/manifest.chrome.json",
  "src/manifests/manifest.firefox.json"
];

for (const file of files) {
  try {
    const raw = readFileSync(file, "utf8");
    let json;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      console.error(`Failed to parse JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }

    json.version = version;
    writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
    console.log(`Updated ${file} -> ${version}`);
  } catch (error) {
    console.error(`Failed to read/write ${file}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
