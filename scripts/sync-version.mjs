#!/usr/bin/env node
// VERSION at the repo root is the single source of truth for every web and
// desktop version claim. The package and native metadata are derived from it.
//
//   node scripts/sync-version.mjs          write VERSION into metadata
//   node scripts/sync-version.mjs --check  exit 1 if any metadata disagrees
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const versionPath = join(root, "VERSION");
const packagePath = join(root, "package.json");
const tauriConfigPath = join(root, "src-tauri", "tauri.conf.json");
const cargoPath = join(root, "src-tauri", "Cargo.toml");
const cargoLockPath = join(root, "src-tauri", "Cargo.lock");

const version = readFileSync(versionPath, "utf8").trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`VERSION must be 3-segment semver, got: ${JSON.stringify(version)}`);
  process.exit(1);
}

const check = process.argv.includes("--check");
const mismatches = [];

function checkJsonVersion(path, label) {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  if (parsed.version !== version) mismatches.push(`${label} is ${parsed.version}`);
  if (check) return;
  if (parsed.version === version) return;
  const updated = raw.replace(
    /("version"\s*:\s*")[^"]*(")/,
    (_match, prefix, suffix) => `${prefix}${version}${suffix}`,
  );
  writeFileSync(path, updated);
  console.log(`${label} ${parsed.version} -> ${version}`);
}

function checkCargoLockVersion(path) {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf8");
  const match = raw.match(/(\[\[package\]\]\nname = "open-todo"\nversion = ")([^"]+)(")/);
  if (!match) {
    console.error(`Could not find the open-todo package in ${path}`);
    process.exit(1);
  }
  const current = match[2];
  if (current !== version) mismatches.push(`src-tauri/Cargo.lock is ${current}`);
  if (check || current === version) return;
  writeFileSync(path, raw.replace(match[0], `${match[1]}${version}${match[3]}`));
  console.log(`src-tauri/Cargo.lock ${current} -> ${version}`);
}

function checkCargoVersion(path) {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf8");
  const match = raw.match(/(^\[package\][\s\S]*?^version\s*=\s*")([^"]+)(")/m);
  if (!match) {
    console.error(`Could not find the [package] version in ${path}`);
    process.exit(1);
  }
  const current = match[2];
  if (current !== version) mismatches.push(`src-tauri/Cargo.toml is ${current}`);
  if (check || current === version) return;
  writeFileSync(path, raw.replace(match[0], `${match[1]}${version}${match[3]}`));
  console.log(`src-tauri/Cargo.toml ${current} -> ${version}`);
}

checkJsonVersion(packagePath, "package.json version");
checkJsonVersion(tauriConfigPath, "src-tauri/tauri.conf.json version");
checkCargoVersion(cargoPath);
checkCargoLockVersion(cargoLockPath);

if (check && mismatches.length > 0) {
  console.error(
    `version drift: VERSION is ${version}, but ${mismatches.join("; ")}.\n` +
      'Run "pnpm version:sync" (edit VERSION, never generated metadata).',
  );
  process.exit(1);
}

if (check) console.log(`version ok: ${version}`);
