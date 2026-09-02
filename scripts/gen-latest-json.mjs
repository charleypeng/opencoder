#!/usr/bin/env node
// Updater metadata generation (TASK-M10-04). Scans a directory of release
// assets for the Tauri updater artifacts (signed bundles + their .sig files)
// and writes latest.json in the schema consumed by tauri-plugin-updater
// (TASK-M8-09):
//   { version, notes, pub_date, platforms: { "<os>-<arch>": {
//       signature, url } } }
// URLs point at the PUBLIC GitHub download endpoint
// (releases/download/<tag>/<asset>) so the updater never touches the
// rate-limited api.github.com (tauri-action's own uploadUpdaterJson writes
// API asset URLs — disabled here for that reason).
//
// Usage:
//   node scripts/gen-latest-json.mjs <assets-dir> <tag> \
//     [--notes-file <file>] [--require <os-arch>,...] [--out <file>] \
//     [--repo <owner/name>]
//
// Platform mapping mirrors tauri-action's uploadUpdaterJson (the maintained
// reference implementation): every signature gets a "{os}-{arch}-{bundle}"
// key (new updater format, resolved against the installed bundle type) and
// the highest-priority signature per "{os}-{arch}" also gets the plain key
// (legacy format). Priorities per platform:
//   darwin:  *.app.tar.gz.sig
//   windows: *-setup.nsis.zip.sig > *_en-US.msi.zip.sig > -setup.exe.sig
//            > .msi.sig
//   linux:   *.AppImage.tar.gz.sig > *.AppImage.sig > *.deb.sig
// The .zip / .tar.gz variants only exist in v1-compatible mode
// (bundle.createUpdaterArtifacts = "v1Compatible"): with the v2 setting
// (true) the bundler treats Windows .exe/.msi and Linux .AppImage/.deb as
// self-contained updater payloads and signs them directly, so only macOS
// produces an archive (app.tar.gz). Callers must therefore have the bare
// installers next to their .sig files, otherwise the platform is dropped.
// A universal macOS artifact maps to BOTH darwin-aarch64 and darwin-x86_64.
// Exits 1 when no updater artifacts are found or a --require key is missing.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const dir = args[0];
const tag = args[1];

function opt(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const out = opt("--out") ?? "latest.json";
const notesFile = opt("--notes-file");
const requireKeys = (opt("--require") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const repo = opt("--repo") ?? defaultRepo();

// Signature suffixes, ordered most-specific first (endsWith matching),
// with the bundle kind and the plain-key priority (higher wins).
const SIG_TABLE = [
  { suffix: ".app.tar.gz.sig", os: "darwin", bundle: "app", priority: 100 },
  { suffix: ".nsis.zip.sig", os: "windows", bundle: "nsis", priority: 100 },
  { suffix: ".msi.zip.sig", os: "windows", bundle: "msi", priority: 99 },
  {
    suffix: ".AppImage.tar.gz.sig",
    os: "linux",
    bundle: "appimage",
    priority: 100,
  },
  { suffix: ".AppImage.sig", os: "linux", bundle: "appimage", priority: 90 },
  { suffix: ".exe.sig", os: "windows", bundle: "nsis", priority: 80 },
  { suffix: ".msi.sig", os: "windows", bundle: "msi", priority: 79 },
  { suffix: ".deb.sig", os: "linux", bundle: "deb", priority: 70 },
];

// Arch markers in asset names, ordered so longer/earlier markers win
// (arm64 before arm, x86_64 before x86).
const ARCH_MARKERS = [
  ["aarch64", "aarch64"],
  ["arm64", "aarch64"],
  ["x86_64", "x86_64"],
  ["amd64", "x86_64"],
  ["x64", "x86_64"],
  ["i686", "i686"],
  ["i386", "i686"],
  ["x86", "i686"],
  ["armv7", "armv7"],
  ["arm", "armv7"],
];

function defaultRepo() {
  try {
    const conf = JSON.parse(readFileSync(resolve(ROOT, "src-tauri/tauri.conf.json"), "utf8"));
    const endpoint = conf.plugins?.updater?.endpoints?.[0];
    const match = /github\.com\/([^/]+\/[^/]+)\//.exec(endpoint ?? "");
    if (match) return match[1];
  } catch {
    // Fall through to the default below.
  }
  return "charleypeng/opencoder";
}

function archFromName(name) {
  const lower = name.toLowerCase();
  for (const [marker, arch] of ARCH_MARKERS) {
    if (lower.includes(marker)) return arch;
  }
  return null;
}

if (!dir || !tag) {
  process.stderr.write(
    "usage: node scripts/gen-latest-json.mjs <assets-dir> <tag> " +
      "[--notes-file file] [--require os-arch,...] [--out file] " +
      "[--repo owner/name]\n",
  );
  process.exit(2);
}
let dirStat;
try {
  dirStat = statSync(dir);
} catch {
  process.stderr.write(`gen-latest-json: no such directory: ${dir}\n`);
  process.exit(2);
}
if (!dirStat.isDirectory()) {
  process.stderr.write(`gen-latest-json: not a directory: ${dir}\n`);
  process.exit(2);
}

const files = readdirSync(dir).filter((f) => statSync(resolve(dir, f)).isFile());

// Pair every .sig with its signed asset; drop unknown signatures (dmg.sig
// etc. are not updater artifacts).
const entries = [];
for (const sig of files.filter((f) => f.endsWith(".sig"))) {
  const assetName = sig.slice(0, -".sig".length);
  const table = SIG_TABLE.find((entry) => sig.endsWith(entry.suffix));
  if (!table) {
    process.stderr.write(`gen-latest-json: skipping non-updater signature: ${sig}\n`);
    continue;
  }
  if (!files.includes(assetName)) {
    process.stderr.write(`gen-latest-json: warning: signature without asset: ${sig}\n`);
    continue;
  }
  entries.push({
    assetName,
    signature: readFileSync(resolve(dir, sig), "utf8").trim(),
    os: table.os,
    bundle: table.bundle,
    priority: table.priority,
    arch: archFromName(assetName) ?? (table.os === "darwin" ? "universal" : "x86_64"),
  });
}

if (entries.length === 0) {
  process.stderr.write(`gen-latest-json: no updater artifacts found in ${dir}\n`);
  process.exit(1);
}

// Highest priority first (stable: same priority keeps name order), mirroring
// tauri-action's signature priority sort.
entries.sort((a, b) => b.priority - a.priority || a.assetName.localeCompare(b.assetName));

const urlBase = `https://github.com/${repo}/releases/download/${tag}`;
const platforms = {};
for (const entry of entries) {
  const archs = entry.arch === "universal" ? ["aarch64", "x86_64"] : [entry.arch];
  for (const arch of archs) {
    // New "{os}-{arch}-{bundle}" format: written per signature, last write
    // wins (plain installers come after their zip variants), matching
    // tauri-action's loop.
    platforms[`${entry.os}-${arch}-${entry.bundle}`] = {
      signature: entry.signature,
      url: `${urlBase}/${entry.assetName}`,
    };
  }
}

// Legacy "{os}-{arch}" keys: only the highest-priority signature per
// platform/arch gets the plain key.
const plainKeys = [];
for (const entry of entries) {
  const archs = entry.arch === "universal" ? ["aarch64", "x86_64"] : [entry.arch];
  for (const arch of archs) {
    const key = `${entry.os}-${arch}`;
    if (!platforms[key]) {
      platforms[key] = {
        signature: entry.signature,
        url: `${urlBase}/${entry.assetName}`,
      };
      plainKeys.push(key);
    }
  }
}

const missing = requireKeys.filter((key) => !platforms[key]);
if (missing.length > 0) {
  process.stderr.write(`gen-latest-json: required platform(s) missing: ${missing.join(", ")}\n`);
  process.exit(1);
}

const content = {
  version: tag.replace(/^v/, ""),
  notes: notesFile ? readFileSync(resolve(notesFile), "utf8").trim() : "",
  pub_date: new Date().toISOString(),
  platforms,
};
writeFileSync(resolve(out), `${JSON.stringify(content, null, 2)}\n`);
process.stdout.write(
  `gen-latest-json: wrote ${out} (${plainKeys.length} platform(s), tag ${tag})\n`,
);
