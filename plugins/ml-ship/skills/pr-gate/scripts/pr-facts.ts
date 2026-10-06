#!/usr/bin/env bun
// pr-facts — one read-only pass over a pull request or merge request: what it changes,
// what the repo's merge rules are, and which checks are green, red, or still running.
//
//   pr-facts.ts github [--wait] [PR]     number or URL
//   pr-facts.ts gitlab [--wait] [MR]     number, URL or source branch
//   pr-facts.ts [--wait] [PR]            forge taken from the URL, else from the origin remote
//
// With no PR it resolves the current branch's. Exit 2 means it could not, and printed the
// open ones to ask the user about; exit 3 means the repo has none open.
//
// --wait polls until CI on the head commit settles, then prints the facts and exits 0
// (green), 10 (failed or canceled), 11 (nothing ran, or CI is waiting on a person) or
// 12 (still running after WAIT_TIMEOUT seconds, 3600 by default).
//
// Run it before forming any opinion — guessing at a repo's merge conventions is how
// trailers get eaten and unvalidated code lands.

import { github } from "./lib/github";
import { gitlab } from "./lib/gitlab";
import { exec, text } from "./lib/shared";

const FORGES = { github, gitlab };
type Forge = keyof typeof FORGES;

function usage(): never {
  console.error("usage: pr-facts.ts [github|gitlab] [--wait] [PR_OR_MR]");
  process.exit(1);
}

function detectForge(target: string): Forge {
  if (target.includes("/merge_requests/") || target.startsWith("!")) return "gitlab";
  if (target.includes("/pull/")) return "github";
  const remote = text("git", ["remote", "get-url", "origin"]);
  if (/github/i.test(remote)) return "github";
  if (/gitlab/i.test(remote)) return "gitlab";
  // A self-hosted forge under its own domain: ask each CLI whether the checkout is its.
  if (exec("gh", ["repo", "view", "--json", "name"]).status === 0) return "github";
  if (exec("glab", ["api", "projects/:fullpath"]).status === 0) return "gitlab";
  console.error("Could not tell GitHub from GitLab here. Name the forge: pr-facts.ts github|gitlab [PR_OR_MR]");
  process.exit(1);
}

const args = process.argv.slice(2);
const named = Object.hasOwn(FORGES, args[0] ?? "") ? (args.shift() as Forge) : undefined;
const wait = args.includes("--wait");
const rest = args.filter((a) => a !== "--wait");
if (rest.length > 1 || rest[0]?.startsWith("-")) usage();
const target = rest[0] ?? "";

process.exit(FORGES[named ?? detectForge(target)](target, wait));
