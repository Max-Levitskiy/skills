// Git-style wildcards for context filters: `*` stays inside one path segment, `**` crosses them,
// `?` is one character other than `/`, `[...]` is a character class.
//
// No Node here: the hooks module imports this file too.

export interface GlobOptions {
  /** `path` patterns expand a leading `~`, get an any-depth prefix unless rooted, and read a trailing slash as everything under it; `remote` patterns match the whole remote as written. */
  anchored: "path" | "remote";
  ignoreCase?: boolean;
  /** What `~` stands for in a `path` pattern. */
  home?: string;
}

const escapeChar = (c: string): string => c.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

/** Turns a glob into the source of a regular expression body, without anchors. */
function toRegexSource(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**/` also matches nothing, so `a/**/b` reaches `a/b`.
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (c === "[") {
      const close = glob.indexOf("]", i + 2);
      if (close === -1) {
        out += "\\[";
      } else {
        let body = glob.slice(i + 1, close);
        if (body.startsWith("!")) body = `^${body.slice(1)}`;
        out += `[${body.replace(/\\/g, "\\\\")}]`;
        i = close;
      }
    } else {
      out += escapeChar(c);
    }
  }
  return out;
}

function pathPattern(pattern: string, home: string | undefined): string {
  let p = pattern;
  if (p.startsWith("~/")) p = `${(home ?? "").replace(/\/+$/, "")}${p.slice(1)}`;
  else if (!p.startsWith("./") && !p.startsWith("/")) p = `**/${p}`;
  if (p.endsWith("/")) p += "**";
  return p;
}

/** Compiles a glob into a predicate over a whole subject: the pattern has to match all of it. */
export function compileGlob(pattern: string, opts: GlobOptions): (subject: string) => boolean {
  const glob = opts.anchored === "path" ? pathPattern(pattern, opts.home) : pattern;
  const re = new RegExp(`^${toRegexSource(glob)}$`, opts.ignoreCase ? "i" : "");
  return (subject) => re.test(subject);
}
