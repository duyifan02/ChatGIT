import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const srcDir = join(rootDir, "src");
const distDir = join(rootDir, "dist");
const assetsDir = join(srcDir, "assets");
const manifestsDir = join(srcDir, "manifests");
const launcherLogoSvgPath = join(assetsDir, "icons", "logo-source.svg");
const launcherSvgDeclaration = "const INJECTED_LAUNCHER_SVG = null;";

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

function readText(path) {
  return readFileSync(path, "utf8");
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeSvg(svgSource) {
  return svgSource
    .replace(/^\uFEFF/, "")
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!doctype[\s\S]*?>/gi, "")
    .trim()
    .replace(/>\s+</g, "><");
}

function getLauncherSvgMarkup() {
  if (!existsSync(launcherLogoSvgPath)) return null;
  return normalizeSvg(readText(launcherLogoSvgPath));
}

function buildContentScript() {
  const contentScriptSource = readText(join(srcDir, "content.js"));
  const launcherSvg = getLauncherSvgMarkup();
  if (!launcherSvg) return contentScriptSource;
  const nextContentScript = contentScriptSource.replace(
    launcherSvgDeclaration,
    `const INJECTED_LAUNCHER_SVG = ${JSON.stringify(launcherSvg)};`
  );
  return nextContentScript.includes(launcherSvgDeclaration) ? contentScriptSource : nextContentScript;
}

function buildBrowser(browser) {
  const outDir = join(distDir, browser.name);
  cleanDir(outDir);

  writeFileSync(join(outDir, "content.js"), buildContentScript(), "utf8");
  copyIfExists(join(srcDir, "content.css"), join(outDir, "content.css"));

  if (existsSync(assetsDir)) {
    cpSync(assetsDir, outDir, { recursive: true });
  }

  const manifest = readJson(join(manifestsDir, browser.manifestFile));
  writeJson(join(outDir, "manifest.json"), manifest);
}

function main() {
  ensureDir(distDir);
  for (const browser of browsers) {
    buildBrowser(browser);
  }
  console.log("Built extension targets:", browsers.map(item => item.name).join(", "));
}

main();
