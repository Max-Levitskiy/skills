#!/usr/bin/env bun
// Adds the questions skill to the context whenever an interview skill starts, whether the
// person typed it (/grill-me …) or Claude called it through the Skill tool.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const INTERVIEW_SKILLS = ["grilling", "grill-me", "grill-with-docs", "grill-with-ui", "wayfinder", "wayfinder-herdr"];
const names = INTERVIEW_SKILLS.join("|");
const typed = new RegExp(`^\\s*/(?:[\\w-]+:)?(?:${names})(?:\\s|$)`);
const called = new RegExp(`^(?:[\\w-]+:)?(?:${names})$`);

const event = JSON.parse(await Bun.stdin.text());
const hit =
  event.hook_event_name === "UserPromptSubmit"
    ? typed.test(event.prompt ?? "")
    : called.test(String(event.tool_input?.skill ?? ""));
if (!hit) process.exit(0);

const root = process.env.CLAUDE_PLUGIN_ROOT ?? join(import.meta.dir, "..");
const rules = readFileSync(join(root, "skills/questions/SKILL.md"), "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: event.hook_event_name,
      additionalContext: `The ml-grilling:questions rules apply to every question in this interview:\n${rules}`,
    },
  }),
);
