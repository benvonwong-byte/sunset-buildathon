#!/usr/bin/env node
// The language gate for everything this repo publishes. It reads the group
// blurbs in data/orgs.json, the category blurbs, the page copy and the docs,
// and fails on em dashes, the verb "carry" in any form, and the stock words
// that mark machine-written prose. Same house rules as dearcrisis.com.
//
// Adding a new prose field to data/orgs.json? Add its name to ORG_FIELDS in
// the same commit, or the gate will never read it.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORG_FIELDS = ["what", "plugIn"];
const DOMAIN_FIELDS = ["label", "blurb"];

const RULES = [
  { re: /—/, why: "em dash (use a comma, colon or full stop)" },
  { re: /\s--\s/, why: "double hyphen used as a dash" },
  // A word in quotes is a mention, not a use: the rule docs have to name it.
  { re: /(?<!")\bcarr(y|ies|ied|ying)\b(?!")/i, why: 'the verb "carry" (say has, holds, states or brings)' },
  {
    re: /\b(delve|delves|tapestry|vibrant|thriving|bustling|beloved|iconic|nestled|boasts|boasting|myriad|plethora|pivotal|seamless(ly)?|robust|unlock(s|ing)?|game[- ]changer|cutting[- ]edge|world[- ]class|state[- ]of[- ]the[- ]art|testament to|realm|leverag(e|es|ing)|underscore(s|d)?)\b/i,
    why: "stock machine-writing word",
  },
  { re: /\bdedicated to\b/i, why: '"dedicated to" (say what they do)' },
  { re: /\b(hidden gem|a must[- ]see|one[- ]stop)\b/i, why: "hype phrase" },
];

const problems = [];
function check(where, text) {
  if (typeof text !== "string" || !text) return;
  for (const { re, why } of RULES) {
    const m = text.match(re);
    if (m) problems.push(`${where}: ${why}: "...${text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)}..."`);
  }
}

// 1. Data prose
const orgs = JSON.parse(readFileSync(join(ROOT, "data/orgs.json"), "utf8"));
for (const o of orgs) for (const f of ORG_FIELDS) check(`data/orgs.json ${o.id}.${f}`, o[f]);
const domains = JSON.parse(readFileSync(join(ROOT, "data/domains.json"), "utf8"));
for (const d of domains) for (const f of DOMAIN_FIELDS) check(`data/domains.json ${d.id}.${f}`, d[f]);

// 2. Page copy, scripts and docs (comments included: they are read by people too)
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "data"]);
const TEXT_EXT = /\.(html|js|mjs|css|md|yml|yaml)$/;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p);
    } else if (TEXT_EXT.test(name)) {
      const lines = readFileSync(p, "utf8").split("\n");
      lines.forEach((line, i) => {
        // The rule list above has to name the words it bans.
        if (p.endsWith("check-voice.mjs")) return;
        check(`${relative(ROOT, p)}:${i + 1}`, line);
      });
    }
  }
}
walk(ROOT);

if (problems.length) {
  console.error(`check-voice: ${problems.length} problem(s)\n` + problems.map((p) => "  " + p).join("\n"));
  process.exit(1);
}
console.log(`check-voice: clean (${orgs.length} groups, ${domains.length} categories, site, scripts and docs)`);
