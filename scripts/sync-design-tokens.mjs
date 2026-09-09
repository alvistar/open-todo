#!/usr/bin/env node
/*
 * src/theme/tokens.css is the single source of truth for the palette.
 * DESIGN.md's front matter is DERIVED from it, the same way package.json's
 * version is derived from VERSION — so the gstack design skills can read the
 * open DESIGN.md format without the file becoming a second, drifting copy.
 *
 *   node scripts/sync-design-tokens.mjs          rewrite DESIGN.md front matter
 *   node scripts/sync-design-tokens.mjs --check  exit 1 if it has drifted
 *
 * Only the front matter is touched; every prose section is left alone.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokensPath = join(root, "src/theme/tokens.css");
const designPath = join(root, "DESIGN.md");

const css = readFileSync(tokensPath, "utf8");

/** Declarations inside the first `:root { ... }` block (the light palette). */
function lightBlock() {
  const start = css.indexOf(":root {");
  if (start === -1) throw new Error("no bare :root block in tokens.css");
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

/** Declarations inside `:root[data-theme="dark"] { ... }` (the toggle block). */
function darkBlock() {
  const start = css.indexOf(':root[data-theme="dark"] {');
  if (start === -1) throw new Error('no :root[data-theme="dark"] block in tokens.css');
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

function declarations(block) {
  const out = new Map();
  for (const [, name, value] of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    out.set(name, value.trim());
  }
  return out;
}

const light = declarations(lightBlock());
const dark = declarations(darkBlock());

const quote = (v) => `"${v.replace(/"/g, '\\"')}"`;

/**
 * Colour roles, light and dark. Names are ours, not gstack's palette
 * vocabulary: gstack's flattener takes whatever we give it (verified), and our
 * roles carry meaning its zinc-N scheme has no slot for.
 */
const colorLines = [];
for (const [name, value] of light) {
  if (
    !/^(bg|text|divider|border|accent|on-accent|selected|priority|schedule|hover|overlay)/.test(
      name,
    )
  )
    continue;
  if (name.startsWith("shadow")) continue;
  colorLines.push(`  ${name}-light: ${quote(value)}`);
  const darkValue = dark.get(name);
  if (darkValue && darkValue !== value) {
    colorLines.push(`  ${name}-dark: ${quote(darkValue)}`);
  }
}

const roundedLines = [...light]
  .filter(([n]) => n.startsWith("radius-"))
  .map(([n, v]) => `  ${n.replace("radius-", "")}: ${v}`);

const fontSans = light.get("font-sans") ?? "system-ui";
const fontSize = light.get("font-size-base") ?? "13px";

const existing = readFileSync(designPath, "utf8");
const match = /^---\n[\s\S]*?\n---/.exec(existing);
if (!match) {
  console.error("DESIGN.md has no front matter block to sync.");
  process.exit(1);
}

/*
 * gstack's `gstack-design-md mark` writes a marker line into the front matter
 * to record the one-time format choice. Regenerating the block must carry it
 * through, or every sync would silently un-mark the file.
 */
const marker = /^#\s*gstack:\s*design-md-format=.*$/m.exec(match[0]);
const markerLine = marker ? `${marker[0]}\n` : "";

const frontMatter = `---
${markerLine}# GENERATED from src/theme/tokens.css by scripts/sync-design-tokens.mjs.
# Do not hand-edit this block: run \`pnpm design:sync\`. Prose below is authored.
name: open-todo
typography:
  display:
    fontFamily: ${fontSans}
  body:
    fontFamily: ${fontSans}
    fontSize: ${fontSize}
  label:
    fontFamily: ${fontSans}
  mono:
    fontFamily: ui-monospace, SFMono-Regular, Menlo, monospace
colors:
${colorLines.join("\n")}
spacing:
  hairline: 1px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 22px
  2xl: 30px
  gutter: 55px
rounded:
${roundedLines.join("\n")}
---`;

const updated = existing.replace(match[0], frontMatter);
const check = process.argv.includes("--check");

if (updated === existing) {
  if (check) console.log("design tokens ok: DESIGN.md matches src/theme/tokens.css");
  process.exit(0);
}

if (check) {
  console.error(
    "design token drift: DESIGN.md front matter does not match src/theme/tokens.css.\n" +
      'Run "pnpm design:sync" (edit tokens.css, never the front matter).',
  );
  process.exit(1);
}

writeFileSync(designPath, updated);
console.log("DESIGN.md front matter synced from src/theme/tokens.css");
