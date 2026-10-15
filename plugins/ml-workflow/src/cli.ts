import manifest from "../.claude-plugin/plugin.json";

// The plugin's version is the helper's: the mod compares the two to catch a session that loaded
// an older plugin than the one now installed (docs/spec.md, p.5).
export const VERSION: string = manifest.version;

const USAGE = `usage: claude-spore --version
       claude-spore check <folder> [--json]
       claude-spore run
       claude-spore start | probe | watch | stop
       claude-spore report --attempt <n> --outcome <outcome>

The ml-workflow helper (docs/spec.md).
  check   checks the node parameters of every Claude step in a workflow folder
  run     a background Claude step; spore runs it, with the parameters on stdin
  start   an interactive Claude step in a herdr pane; prints its holder handle
  probe   answers whether the pane's Claude still runs, the handle on stdin
  watch   waits for the pane's answer and prints it, the handle on stdin
  stop    closes the pane, the handle on stdin
  report  hands in the answer of an interactive step, from its pane, on stdin`;

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "--version") {
    console.log(VERSION);
    return 0;
  }
  if (command === "check") {
    const { check } = await import("./check.ts");
    return check(rest);
  }
  if (command === "run") {
    const { run } = await import("./run.ts");
    return run();
  }
  if (command === "start" || command === "probe" || command === "watch" || command === "stop") {
    const interactive = await import("./interactive.ts");
    return interactive[command]();
  }
  if (command === "report") {
    const { report } = await import("./interactive.ts");
    return report(rest);
  }
  if (command === "--help" || command === "-h") {
    console.log(USAGE);
    return 0;
  }
  console.error(command === undefined ? USAGE : `claude-spore: unknown command "${command}"\n\n${USAGE}`);
  return 2;
}
