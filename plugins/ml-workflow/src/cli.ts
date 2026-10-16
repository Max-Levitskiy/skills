import manifest from "../.claude-plugin/plugin.json";

// The plugin's version is the helper's: the mod compares the two to catch a session that loaded
// an older plugin than the one now installed (docs/spec.md, p.5).
export const VERSION: string = manifest.version;

const USAGE = `usage: claude-spore --version
       claude-spore doctor [--json] [--plugin-version <version>]
       claude-spore install-spore
       claude-spore launcher install | decline
       claude-spore check <folder> [--json]
       claude-spore example list [--json] | copy <name> <folder> [--watch <node>]...
       claude-spore unfinished [--json]
       claude-spore menu [--json]
       claude-spore run
       claude-spore start | probe | watch | stop
       claude-spore report --attempt <n> --outcome <outcome>
       claude-spore close-after <seconds> <agent> <pane>

The ml-workflow helper (docs/spec.md).
  doctor         checks that the spore on PATH is one ml-workflow drives
  install-spore  installs or updates spore from a signed release
  launcher       installs the claude-spore launcher in ~/.local/bin, or declines it
  check          checks the node parameters of every Claude step in a workflow folder
  example        lists the workflows the plugin ships, or copies one into a project
  unfinished     one line per unfinished run, for the start of a session
  menu           the rows of the menu pane: the runs and their actions, the workflows to start
  run            a background Claude step; spore runs it, with the parameters on stdin
  start          an interactive Claude step in a herdr pane; prints its holder handle
  probe          answers whether the pane's Claude still runs, the handle on stdin
  watch          waits for the pane's answer and prints it, the handle on stdin
  stop           closes the pane, the handle on stdin
  report         hands in the answer of an interactive step, from its pane, on stdin
  close-after    closes a finished step's pane after its keepSeconds; the watch runs it`;

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "--version") {
    console.log(VERSION);
    return 0;
  }
  if (command === "doctor") {
    const { doctor } = await import("./doctor.ts");
    return doctor(rest);
  }
  if (command === "install-spore") {
    const { installSpore } = await import("./install.ts");
    return installSpore(rest);
  }
  if (command === "launcher") {
    const { launcher } = await import("./launcher.ts");
    return launcher(rest);
  }
  if (command === "check") {
    const { check } = await import("./check.ts");
    return check(rest);
  }
  if (command === "example") {
    const { example } = await import("./example.ts");
    return example(rest);
  }
  if (command === "unfinished") {
    const { unfinished } = await import("./unfinished.ts");
    return unfinished(rest);
  }
  if (command === "menu") {
    const { menu } = await import("./menu.ts");
    return menu(rest);
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
  if (command === "close-after") {
    const { closeAfter } = await import("./interactive.ts");
    return closeAfter(rest);
  }
  if (command === "--help" || command === "-h") {
    console.log(USAGE);
    return 0;
  }
  console.error(command === undefined ? USAGE : `claude-spore: unknown command "${command}"\n\n${USAGE}`);
  return 2;
}
