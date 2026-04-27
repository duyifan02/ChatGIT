import { readFileSync } from "node:fs";

const packagePath = "package.json";

const manifestPaths = [
  "src/manifests/manifest.chrome.json",
  "src/manifests/manifest.firefox.json"
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const pkg = readJson(packagePath);
const packageVersion = pkg.version;

const errors = [];

if (!packageVersion) {
  errors.push("package.json is missing version");
}

for (const path of manifestPaths) {
  const manifest = readJson(path);

  if (!manifest.version) {
    errors.push(`${path} is missing version`);
    continue;
  }

  if (manifest.version !== packageVersion) {
    errors.push(
      `${path} version=${manifest.version} does not match package.json version=${packageVersion}`
    );
  }
}

const tag = process.env.GITHUB_REF_NAME;

if (tag && tag.startsWith("v")) {
  const tagVersion = tag.slice(1);

  if (tagVersion !== packageVersion) {
    errors.push(
      `Git tag ${tag} does not match package.json version=${packageVersion}`
    );
  }
}

if (errors.length > 0) {
  console.error("Version check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Version check passed: ${packageVersion}`);
