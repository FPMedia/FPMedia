#!/usr/bin/env node
// Builds the "By the numbers" stat tiles (assets/stats/*-light.svg and *-dark.svg) and rewrites the
// stats block in README.md (between <!-- stats:start --> and <!-- stats:end -->), including alt text.
//
// Run by hand, no CI and no token:
//   node scripts/build-cards.mjs                        # re-render from data/stats.json
//   node scripts/build-cards.mjs /path/to/stats.json    # first import aggregates from collect-stats.sh output
//
// Only aggregate numbers are ever read or written. The importer copies a fixed list of numeric fields
// and refuses anything else, so repo names can't end up in this repo or in the SVGs.
// Text is drawn as outlines from scripts/glyphs.json (Bricolage Grotesque + JetBrains Mono, SIL OFL 1.1),
// so the SVGs load no fonts and reference nothing external. No dependencies beyond Node 18+.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data", "stats.json");
const OUT = join(ROOT, "assets", "stats");
const README = join(ROOT, "README.md");
const GLYPHS = JSON.parse(readFileSync(join(ROOT, "scripts", "glyphs.json"), "utf8")).faces;

// Erzo brand tokens (taken from the Erzo website's CSS custom properties)
const T = { paper: "#F7F2ED", tile: "#EDE5DF", ink: "#1E1616", cocoa: "#472F2F", mauve: "#816969", mauveText: "#6B5555", mauveLight: "#C7B4B0", apricot: "#F2A76E", clay: "#A4492A" };
const THEMES = {
  light: { bg: T.tile, border: null, label: T.mauveText, number: T.ink, sub: T.cocoa, accent: T.apricot, bars: [T.ink, T.clay, T.mauve, T.apricot, T.mauveLight] },
  dark: { bg: T.ink, border: T.cocoa, label: T.apricot, number: T.paper, sub: T.mauveLight, accent: T.apricot, bars: [T.paper, T.apricot, T.mauveLight, T.mauve, T.mauveText] },
};

// ---------- 1. optional import from collect-stats.sh output (aggregates only) ----------
function importStats(path) {
  const s = JSON.parse(readFileSync(path, "utf8"));
  const num = (v, name) => { if (!Number.isInteger(v) || v < 0) throw new Error(`Expected a count for ${name}, got ${JSON.stringify(v)}`); return v; };
  const asOf = new Date(s.generated_at);
  if (Number.isNaN(asOf.getTime())) throw new Error("generated_at missing or invalid");
  const langs = {};
  for (const [k, v] of Object.entries(s.primary_language_repo_counts_active_last_12_months ?? {})) {
    if (!/^[A-Za-z0-9#+. ]{1,24}$/.test(k)) throw new Error(`Unexpected language key ${JSON.stringify(k)}`);
    langs[k] = num(v, `language ${k}`);
  }
  const fw = s.frameworks_repo_counts_active_last_12_months ?? {};
  const out = {
    as_of: asOf.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" }), // YYYY-MM-DD, SAST
    repos_total: num(s.repos.total, "repos.total"),
    repos_private: num(s.repos.private, "repos.private"),
    repos_public: num(s.repos.public, "repos.public"),
    active_90d: num(s.repos.active_last_90_days.total, "active_90d"),
    active_12m: num(s.repos.active_last_12_months.total, "active_12m"),
    new_12m: num(s.repos.created_last_12_months.total, "new_12m"),
    contributions_12m: num(s.contributions_last_12_months.calendar_total_contributions, "contributions"),
    private_contributions_12m: num(s.contributions_last_12_months.restricted_contributions_count, "private contributions"),
    commits_default_branch_12m: num(s.commits_default_branches_last_12_months.authored_by_account, "commits"),
    active_days_12m: num(s.contributions_last_12_months.active_days, "active days"),
    nextjs_repos_12m: num(fw["Next.js"] ?? 0, "Next.js repos"),
    nextjs16_repos_12m: num(s.nextjs_major_versions_active_last_12_months?.["next@16"] ?? 0, "Next.js 16 repos"),
    main_language_12m: langs,
  };
  mkdirSync(dirname(DATA), { recursive: true });
  writeFileSync(DATA, JSON.stringify(out, null, 2) + "\n");
  console.log(`Imported aggregates into ${DATA}`);
}

// ---------- 2. text as outlines ----------
const r1 = (n) => { const v = Math.round(n * 10) / 10; return Object.is(v, -0) ? "0" : String(v); };
function measure(face, text, size, tracking = 0) {
  const F = GLYPHS[face], s = size / F.upem; let x = 0;
  const chars = [...text];
  chars.forEach((ch, i) => {
    const g = F.glyphs[ch] ?? F.glyphs["?"];
    x += g.a + (F.kern[ch + (chars[i + 1] ?? "")] ?? 0) + (i < chars.length - 1 ? tracking * F.upem : 0);
  });
  return x * s;
}
function textPath(face, text, size, x0, y0, { tracking = 0, anchor = "start" } = {}) {
  const F = GLYPHS[face], s = size / F.upem;
  if (anchor === "end") x0 -= measure(face, text, size, tracking);
  if (anchor === "middle") x0 -= measure(face, text, size, tracking) / 2;
  let pen = 0, d = "";
  const chars = [...text];
  chars.forEach((ch, i) => {
    const g = F.glyphs[ch] ?? F.glyphs["?"];
    for (const [op, ...v] of g.p) {
      const pts = [];
      for (let j = 0; j < v.length; j += 2) pts.push(`${r1(x0 + (pen + v[j]) * s)} ${r1(y0 - v[j + 1] * s)}`);
      d += op + pts.join(" ");
    }
    pen += g.a + (F.kern[ch + (chars[i + 1] ?? "")] ?? 0) + tracking * F.upem;
  });
  return d;
}
function wrap(face, text, size, maxW) {
  const lines = []; let cur = "";
  for (const w of text.split(" ")) {
    const t = cur ? `${cur} ${w}` : w;
    if (!cur || measure(face, t, size) <= maxW) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>\n`;
const card = (w, h, th) => `<rect x="${th.border ? 0.75 : 0}" y="${th.border ? 0.75 : 0}" width="${th.border ? w - 1.5 : w}" height="${th.border ? h - 1.5 : h}" rx="6" fill="${th.bg}"${th.border ? ` stroke="${th.border}" stroke-width="1.5"` : ""}/>`;
const fmt = (n) => n.toLocaleString("en-US");

// ---------- 3. tiles ----------
const TW = 260, TH = 204, PAD = 20;
function statTile(th, { label, value, sub }) {
  let body = card(TW, TH, th);
  if (measure("mono", label, 21) > TW - PAD * 2) throw new Error(`Tile label too long: ${label}`);
  body += `<path fill="${th.label}" d="${textPath("mono", label, 21, PAD, 46)}"/>`;
  body += `<path fill="${th.number}" d="${textPath("display", value, 64, PAD - 2, 118, { tracking: -0.02 })}"/>`;
  body += `<rect x="${PAD}" y="132" width="30" height="5" rx="2.5" fill="${th.accent}"/>`;
  // Sub text: prefer breaking at " · ", then wrap by words; shrink slightly if it still needs a third line.
  let size = 22, lines;
  for (; size >= 20; size -= 1) {
    const parts = sub.split(" · ");
    lines = parts.length === 2 && parts.every((x) => measure("label", x, size) <= TW - PAD * 2) ? parts : wrap("label", sub, size, TW - PAD * 2);
    if (lines.length <= 2) break;
  }
  if (lines.length > 2) throw new Error(`Tile text too long: ${sub}`);
  body += `<path fill="${th.sub}" d="${lines.map((l, i) => textPath("label", l, size, PAD, 165 + i * 27)).join("")}"/>`;
  return svg(TW, TH, body);
}
function languagesTile(th, langs, W = 830) {
  // W = 830 for desktop; a narrow 400-wide variant is served to small screens via <source media="(max-width: 600px)">.
  const P = 28;
  const known = Object.entries(langs).filter(([k]) => k !== "None").sort((a, b) => b[1] - a[1]);
  const total = Object.values(langs).reduce((a, b) => a + b, 0);
  const top = known.slice(0, 4), rest = known.slice(4).reduce((a, [, v]) => a + v, 0);
  const items = rest ? [...top, ["Other", rest]] : top;
  const withLang = items.reduce((a, [, v]) => a + v, 0);
  let body = "";
  const label = `Main language · ${total} repos worked on in the last 12 months`;
  const labelLines = measure("mono", label, 23) <= W - P * 2 ? [label] : ["Main language", `${total} repos, last 12 months`];
  labelLines.forEach((l, i) => { body += `<path fill="${th.label}" d="${textPath("mono", l, 23, P, 50 + i * 32)}"/>`; });
  const barY = 72 + (labelLines.length - 1) * 32;
  const bw = W - P * 2, gap = 4; let x = P;
  items.forEach(([, v], i) => {
    const w = (bw - gap * (items.length - 1)) * (v / withLang);
    body += `<rect x="${r1(x)}" y="${barY}" width="${r1(w)}" height="30" rx="4" fill="${th.bars[i % th.bars.length]}"/>`;
    x += w + gap;
  });
  // Legend: one row if it fits, otherwise a tidy grid (ceil(n/2) columns on desktop, 2 on the narrow variant).
  const widths = items.map(([n, v]) => 32 + measure("label", `${n} ${v}`, 24));
  const oneRow = widths.reduce((a, b) => a + b, 0) + 24 * (items.length - 1) <= W - P * 2;
  const top0 = barY + 78;
  let ly = top0;
  if (W < 600) {
    // Narrow variant: a single-column list with counts right-aligned.
    items.forEach(([name, v], i) => {
      ly = top0 + i * 40;
      body += `<rect x="${P}" y="${ly - 20}" width="22" height="22" rx="4" fill="${th.bars[i % th.bars.length]}"/>`;
      body += `<path fill="${th.number}" d="${textPath("label", name, 24, P + 32, ly)}${textPath("label", String(v), 24, W - P, ly, { anchor: "end" })}"/>`;
    });
    const H = ly + 34;
    return { svg: svg(W, H, card(W, H, th) + body), items, total };
  }
  const cols = oneRow ? items.length : Math.ceil(items.length / 2), colW = (W - P * 2) / cols;
  items.forEach(([name, v], i) => {
    const c = i % cols, row = Math.floor(i / cols);
    const lx = oneRow ? P + widths.slice(0, i).reduce((a, b) => a + b + 24, 0) : P + c * colW;
    ly = top0 + row * 40;
    body += `<rect x="${r1(lx)}" y="${ly - 20}" width="22" height="22" rx="4" fill="${th.bars[i % th.bars.length]}"/>`;
    body += `<path fill="${th.number}" d="${textPath("label", `${name} ${v}`, 24, lx + 32, ly)}"/>`;
  });
  const H = ly + 34;
  return { svg: svg(W, H, card(W, H, th) + body), items, total };
}

// ---------- 4. main ----------
if (process.argv[2]) importStats(process.argv[2]);
const S = JSON.parse(readFileSync(DATA, "utf8"));
const tiles = [
  { id: "repos", label: "Repositories", value: fmt(S.repos_total), sub: `${fmt(S.repos_private)} private · ${fmt(S.repos_public)} public`,
    alt: `${fmt(S.repos_total)} repositories: ${fmt(S.repos_private)} private and ${fmt(S.repos_public)} public` },
  { id: "active", label: "Active repos", value: fmt(S.active_90d), sub: `in the last 90 days · ${fmt(S.active_12m)} in a year, ${fmt(S.new_12m)} new`,
    alt: `${fmt(S.active_90d)} repos active in the last 90 days; ${fmt(S.active_12m)} worked on in the last 12 months, of which ${fmt(S.new_12m)} are new` },
  { id: "contributions", label: "Contributions", value: fmt(S.contributions_12m), sub: `in the last 12 months · ${fmt(S.private_contributions_12m)} in private repos`,
    alt: `${fmt(S.contributions_12m)} contributions in the last 12 months, ${fmt(S.private_contributions_12m)} of them in private repos` },
  { id: "commits", label: "Commits", value: fmt(S.commits_default_branch_12m), sub: "on main branches · in the last 12 months",
    alt: `${fmt(S.commits_default_branch_12m)} commits on main branches in the last 12 months` },
  { id: "days", label: "Active days", value: fmt(S.active_days_12m), sub: "with activity · in the last 12 months",
    alt: `${fmt(S.active_days_12m)} days with activity in the last 12 months` },
  { id: "nextjs", label: "Next.js repos", value: fmt(S.nextjs_repos_12m), sub: `in the last 12 months · ${fmt(S.nextjs16_repos_12m)} on Next.js 16`,
    alt: `${fmt(S.nextjs_repos_12m)} repos on Next.js in the last 12 months, ${fmt(S.nextjs16_repos_12m)} of them on Next.js 16` },
];
mkdirSync(OUT, { recursive: true });
for (const [mode, th] of Object.entries(THEMES)) {
  for (const t of tiles) writeFileSync(join(OUT, `${t.id}-${mode}.svg`), statTile(th, t));
}
const L = { light: languagesTile(THEMES.light, S.main_language_12m), dark: languagesTile(THEMES.dark, S.main_language_12m) };
writeFileSync(join(OUT, "languages-light.svg"), L.light.svg);
writeFileSync(join(OUT, "languages-dark.svg"), L.dark.svg);
writeFileSync(join(OUT, "languages-narrow-light.svg"), languagesTile(THEMES.light, S.main_language_12m, 400).svg);
writeFileSync(join(OUT, "languages-narrow-dark.svg"), languagesTile(THEMES.dark, S.main_language_12m, 400).svg);
const langAlt = `Main language of the ${L.light.total} repos worked on in the last 12 months: ` + L.light.items.map(([n, v]) => `${n} ${v}`).join(", ");

const date = new Date(`${S.as_of}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
// Responsive art direction: small screens get the narrow variant, and each variant has light and dark.
const picNarrow = (id, alt) => `<picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="assets/stats/${id}-narrow-dark.svg"><source media="(max-width: 600px)" srcset="assets/stats/${id}-narrow-light.svg"><source media="(prefers-color-scheme: dark)" srcset="assets/stats/${id}-dark.svg"><img src="assets/stats/${id}-light.svg" width="100%" alt="${alt.replace(/"/g, "&quot;")}"></picture>`;
const pic = (id, alt, width) => `<picture><source media="(prefers-color-scheme: dark)" srcset="assets/stats/${id}-dark.svg"><img src="assets/stats/${id}-light.svg" width="${width}" alt="${alt.replace(/"/g, "&quot;")}"></picture>`;
const block = [
  "<!-- stats:start (generated by scripts/build-cards.mjs, don't edit by hand) -->",
  `<p><em>As of ${date}, counting public and private repos.</em></p>`,
  "<p>",
  // Fixed 264px tiles: three to a row at GitHub's 830px width, wrapping to one per row on phones.
  ...tiles.map((t) => pic(t.id, t.alt, "264")),
  "</p>",
  `<p>${picNarrow("languages", langAlt)}</p>`,
  "<!-- stats:end -->",
].join("\n");
const readme = readFileSync(README, "utf8");
const re = /<!-- stats:start[\s\S]*?<!-- stats:end -->/;
if (!re.test(readme)) throw new Error("README.md has no <!-- stats:start --> … <!-- stats:end --> block");
writeFileSync(README, readme.replace(re, block));
console.log(`Wrote ${tiles.length * 2 + 4} SVGs to assets/stats and updated README.md (as of ${date}).`);
