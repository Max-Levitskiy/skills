import manifest from "../.claude-plugin/plugin.json";

// The plugin's version is the helper's: the mod compares the two to catch a session that loaded
// an older plugin than the one now installed (docs/spec.md, p.5).
export const VERSION: string = manifest.version;

const USAGE = `usage: claude-spore --version

The ml-workflow helper. Its subcommands arrive with the parts of docs/spec.md that need them.`;

export async function main(argv: string[]): Promise<number> {
  const [command] = argv;
  if (command === "--version") {
    console.log(VERSION);
    return 0;
  }
  if (command === "--help" || command === "-h") {
    console.log(USAGE);
    return 0;
  }
  console.error(command === undefined ? USAGE : `claude-spore: unknown command "${command}"\n\n${USAGE}`);
  return 2;
}
