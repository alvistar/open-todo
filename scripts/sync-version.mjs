#!/usr/bin/env node
// VERSION at the repo root is the single source of truth for the app version.
// package.json's "version" is derived from it and must never be hand-edited.
//
//   node scripts/sync-version.mjs          write VERSION into package.json
//   node scripts/sync-version.mjs --check  exit 1 if they disagree
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const versionPath = join(root, "VERSION");
const pkgPath = join(root, "package.json");

const version = readFileSync(versionPath, "utf8").trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`VERSION must be 3-segment semver, got: ${JSON.stringify(version)}`);
  process.exit(1);
}

const raw = readFileSync(pkgPath, "utf8");
const pkg = JSON.parse(raw);
const check = process.argv.includes("--check");

if (pkg.version === version) {
  if (check) console.log(`version ok: ${version}`);
  process.exit(0);
}

if (check) {
  console.error(
    `version drift: VERSION is ${version} but package.json is ${pkg.version}.\n` +
      `Run "pnpm version:sync" (edit VERSION, never package.json).`,
  );
  process.exit(1);
}

// Rewrite in place so the key order and formatting of package.json survive.
const updated = raw.replace(
  /("version"\s*:\s*")[^"]*(")/,
  (_m, a, b) => `${a}${version}${b}`,
);
writeFileSync(pkgPath, updated);
console.log(`package.json version ${pkg.version} -> ${version}`);
