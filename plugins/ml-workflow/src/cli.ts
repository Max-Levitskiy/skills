import manifest from "../.claude-plugin/plugin.json";

// The plugin's version is the helper's: the mod compares the two to catch a session that loaded
// an older plugin than the one now installed (docs/spec.md, p.5).
export const VERSION: string = manifest.version;

const USAGE = `usage: claude-spore --version
       claude-spore check <folder> [--json]
       claude-spore run

The ml-workflow helper (docs/spec.md).
  check   checks the node parameters of every Claude step in a workflow folder
  run     a background Claude step; spore runs it, with the parameters on stdin`;

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
  if (command === "--help" || command === "-h") {
    console.log(USAGE);
    return 0;
  }
  console.error(command === undefined ? USAGE : `claude-spore: unknown command "${command}"\n\n${USAGE}`);
  return 2;
}
