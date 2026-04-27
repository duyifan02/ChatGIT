import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const srcDir = join(rootDir, "src");
const distDir = join(rootDir, "dist");
const assetsDir = join(srcDir, "assets");
const manifestsDir = join(srcDir, "manifests");
const logoFile = join(rootDir, "logo.svg");
const iconSizes = [16, 32, 48, 128];

const browsers = [
  { name: "chrome", manifestFile: "manifest.chrome.json" },
  { name: "firefox", manifestFile: "manifest.firefox.json" }
];

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
  rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
}

function copyIfExists(from, to) {
  if (!existsSync(from)) return false;
  ensureDir(dirname(to));
  cpSync(from, to, { recursive: true });
  return true;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function generateIcons(logoSvg, iconsOutDir) {
  ensureDir(iconsOutDir);
  copyIfExists(logoSvg, join(iconsOutDir, "logo.svg"));

  const svg = readFileSync(logoSvg, "utf8");
  for (const size of iconSizes) {
    const resvg = new Resvg(svg, {
      fitTo: {
        mode: "width",
        value: size
      }
    });
    const pngData = resvg.render().asPng();
    writeFileSync(join(iconsOutDir, `icon${size}.png`), pngData);
  }
}

function buildBrowser(browser) {
  const outDir = join(distDir, browser.name);
  cleanDir(outDir);

  copyIfExists(join(srcDir, "content.js"), join(outDir, "content.js"));
  copyIfExists(join(srcDir, "content.css"), join(outDir, "content.css"));

  if (existsSync(assetsDir)) {
    cpSync(assetsDir, outDir, { recursive: true });
  }

  generateIcons(logoFile, join(outDir, "icons"));

  const manifest = readJson(join(manifestsDir, browser.manifestFile));
  writeJson(join(outDir, "manifest.json"), manifest);
}

function main() {
  if (!existsSync(logoFile)) {
    throw new Error(`Missing logo source file: ${logoFile}`);
  }
  ensureDir(distDir);
  for (const browser of browsers) {
    buildBrowser(browser);
  }
  console.log("Built extension targets:", browsers.map(item => item.name).join(", "));
}

main();
