// Atlassian Document Format <-> markdown.
//
// Jira Cloud's v3 API refuses plain strings for descriptions and comments: they
// must be an ADF document tree. Hand-building that tree at every call site is
// where this integration usually goes wrong, so the conversion lives here and
// the CLI speaks markdown everywhere.
//
// The mapping is deliberately partial. ADF can express panels, media, mentions,
// and expand blocks; markdown cannot. Reading renders those as readable
// placeholders rather than dropping them silently, and writing sticks to the
// node types that round-trip cleanly.

export interface AdfNode {
  type: string;
  content?: AdfNode[];
  text?: string;
  marks?: { type: string; attrs?: any }[];
  attrs?: Record<string, any>;
}

export interface AdfDoc {
  type: "doc";
  version: 1;
  content: AdfNode[];
}

// ---------------------------------------------------------------- markdown → ADF

const INLINE_PATTERNS: { re: RegExp; build: (m: RegExpExecArray) => AdfNode }[] = [
  // Order matters: ** before *, and code before everything so `**x**` inside
  // backticks stays literal.
  {
    re: /`([^`]+)`/,
    build: (m) => ({ type: "text", text: m[1], marks: [{ type: "code" }] }),
  },
  {
    re: /\[([^\]]+)\]\(([^)\s]+)\)/,
    build: (m) => ({ type: "text", text: m[1], marks: [{ type: "link", attrs: { href: m[2] } }] }),
  },
  {
    re: /\*\*([^*]+)\*\*/,
    build: (m) => ({ type: "text", text: m[1], marks: [{ type: "strong" }] }),
  },
  {
    re: /(?<![\w*])\*([^*\n]+)\*(?![\w*])/,
    build: (m) => ({ type: "text", text: m[1], marks: [{ type: "em" }] }),
  },
  {
    re: /(?<![\w_])_([^_\n]+)_(?![\w_])/,
    build: (m) => ({ type: "text", text: m[1], marks: [{ type: "em" }] }),
  },
  {
    re: /~~([^~]+)~~/,
    build: (m) => ({ type: "text", text: m[1], marks: [{ type: "strike" }] }),
  },
];

function inlineNodes(text: string): AdfNode[] {
  if (!text) return [];
  let earliest: { index: number; match: RegExpExecArray; build: (m: RegExpExecArray) => AdfNode } | null = null;

  for (const { re, build } of INLINE_PATTERNS) {
    const m = new RegExp(re.source, re.flags.replace("g", "")).exec(text);
    if (m && (earliest === null || m.index < earliest.index)) earliest = { index: m.index, match: m, build };
  }
  if (!earliest) return [{ type: "text", text }];

  const { index, match, build } = earliest;
  const out: AdfNode[] = [];
  if (index > 0) out.push({ type: "text", text: text.slice(0, index) });
  out.push(build(match));
  out.push(...inlineNodes(text.slice(index + match[0].length)));
  return out.filter((n) => n.type !== "text" || n.text);
}

function paragraph(text: string): AdfNode {
  const content = inlineNodes(text);
  return { type: "paragraph", content: content.length ? content : [] };
}

interface Line {
  raw: string;
  indent: number;
  body: string;
}

function scan(md: string): Line[] {
  return md.replace(/\r\n?/g, "\n").split("\n").map((raw) => {
    const m = /^(\s*)(.*)$/.exec(raw)!;
    return { raw, indent: m[1].replace(/\t/g, "  ").length, body: m[2] };
  });
}

const BULLET = /^[-*+]\s+(.*)$/;
const ORDERED = /^\d+[.)]\s+(.*)$/;

/** Consume a run of list items at `indent` or deeper, recursing for nested lists. */
function parseList(lines: Line[], start: number, indent: number, ordered: boolean): { node: AdfNode; next: number } {
  const items: AdfNode[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.body.trim()) {
      // A blank line ends the list unless the next non-blank line continues it.
      const nextReal = lines.slice(i + 1).find((l) => l.body.trim());
      if (!nextReal || nextReal.indent < indent || !(BULLET.test(nextReal.body) || ORDERED.test(nextReal.body))) break;
      i++;
      continue;
    }
    if (line.indent < indent) break;
    const m = (ordered ? ORDERED : BULLET).exec(line.body) ?? (ordered ? BULLET : ORDERED).exec(line.body);
    if (!m) break;

    const itemContent: AdfNode[] = [paragraph(m[1])];
    i++;

    // Anything indented further belongs to this item — a nested list, typically.
    while (i < lines.length && lines[i].body.trim() && lines[i].indent > indent) {
      const nested = lines[i];
      if (BULLET.test(nested.body) || ORDERED.test(nested.body)) {
        const sub = parseList(lines, i, nested.indent, ORDERED.test(nested.body));
        itemContent.push(sub.node);
        i = sub.next;
      } else {
        itemContent.push(paragraph(nested.body.trim()));
        i++;
      }
    }
    items.push({ type: "listItem", content: itemContent });
  }

  return { node: { type: ordered ? "orderedList" : "bulletList", content: items }, next: i };
}

export function markdownToAdf(md: string): AdfDoc {
  const lines = scan(md);
  const content: AdfNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const { body, indent } = lines[i];
    const trimmed = body.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    const fence = /^```(\w+)?\s*$/.exec(trimmed);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].body.trim())) {
        code.push(lines[i].raw);
        i++;
      }
      i++; // closing fence
      content.push({
        type: "codeBlock",
        attrs: fence[1] ? { language: fence[1] } : {},
        content: code.length ? [{ type: "text", text: code.join("\n") }] : [],
      });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      content.push({
        type: "heading",
        attrs: { level: heading[1].length },
        content: inlineNodes(heading[2]),
      });
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      content.push({ type: "rule" });
      i++;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].body.trim())) {
        quoted.push(lines[i].body.trim().replace(/^>\s?/, ""));
        i++;
      }
      content.push({ type: "blockquote", content: [paragraph(quoted.join(" "))] });
      continue;
    }

    if (trimmed.startsWith("|") && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].body.trim())) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].body.trim().startsWith("|")) {
        const cells = lines[i].body.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!/^[\s:|-]+$/.test(cells.join("|"))) rows.push(cells);
        i++;
      }
      content.push(table(rows));
      continue;
    }

    if (BULLET.test(trimmed) || ORDERED.test(trimmed)) {
      const { node, next } = parseList(lines, i, indent, ORDERED.test(trimmed));
      content.push(node);
      i = next;
      continue;
    }

    // Plain paragraph: fold soft-wrapped lines together until a blank line or a
    // line that starts a different block.
    const para: string[] = [];
    while (i < lines.length) {
      const t = lines[i].body.trim();
      if (!t || /^```/.test(t) || /^#{1,6}\s/.test(t) || /^>/.test(t) || BULLET.test(t) || ORDERED.test(t)) break;
      para.push(t);
      i++;
    }
    content.push(paragraph(para.join(" ")));
  }

  return { type: "doc", version: 1, content: content.length ? content : [paragraph("")] };
}

function table(rows: string[][]): AdfNode {
  const [head, ...body] = rows;
  const cell = (text: string, header: boolean): AdfNode => ({
    type: header ? "tableHeader" : "tableCell",
    attrs: {},
    content: [paragraph(text)],
  });
  return {
    type: "table",
    attrs: { isNumberColumnEnabled: false, layout: "default" },
    content: [
      { type: "tableRow", content: head.map((c) => cell(c, true)) },
      ...body.map((r) => ({ type: "tableRow", content: r.map((c) => cell(c, false)) })),
    ],
  };
}

// ---------------------------------------------------------------- ADF → markdown

function applyMarks(text: string, marks: AdfNode["marks"]): string {
  let out = text;
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case "code":
        out = `\`${out}\``;
        break;
      case "strong":
        out = `**${out}**`;
        break;
      case "em":
        out = `*${out}*`;
        break;
      case "strike":
        out = `~~${out}~~`;
        break;
      case "link":
        out = `[${out}](${mark.attrs?.href ?? ""})`;
        break;
    }
  }
  return out;
}

function inlineToMarkdown(nodes: AdfNode[] = []): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
          return applyMarks(n.text ?? "", n.marks);
        case "hardBreak":
          return "\n";
        case "emoji":
          return n.attrs?.text ?? n.attrs?.shortName ?? "";
        case "mention":
          return `@${n.attrs?.text?.replace(/^@/, "") ?? n.attrs?.id ?? "unknown"}`;
        case "date":
          return n.attrs?.timestamp ? new Date(Number(n.attrs.timestamp)).toISOString().slice(0, 10) : "";
        case "status":
          return `[${n.attrs?.text ?? ""}]`;
        case "inlineCard":
        case "blockCard":
          return n.attrs?.url ?? "[card]";
        default:
          return inlineToMarkdown(n.content);
      }
    })
    .join("");
}

function blockToMarkdown(node: AdfNode, depth = 0): string {
  const pad = "  ".repeat(depth);
  switch (node.type) {
    case "paragraph":
      return inlineToMarkdown(node.content);
    case "heading":
      return `${"#".repeat(node.attrs?.level ?? 1)} ${inlineToMarkdown(node.content)}`;
    case "codeBlock": {
      const lang = node.attrs?.language ?? "";
      return `\`\`\`${lang}\n${inlineToMarkdown(node.content)}\n\`\`\``;
    }
    case "rule":
      return "---";
    case "blockquote":
      return (node.content ?? [])
        .map((c) => blockToMarkdown(c, depth))
        .join("\n")
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
    case "bulletList":
    case "orderedList": {
      const ordered = node.type === "orderedList";
      return (node.content ?? [])
        .map((item, idx) => {
          const marker = ordered ? `${idx + 1}.` : "-";
          const parts = (item.content ?? []).map((c) =>
            c.type === "bulletList" || c.type === "orderedList"
              ? blockToMarkdown(c, depth + 1)
              : blockToMarkdown(c, depth),
          );
          const [first, ...rest] = parts;
          return [`${pad}${marker} ${first ?? ""}`, ...rest].join("\n");
        })
        .join("\n");
    }
    case "table":
      return tableToMarkdown(node);
    case "mediaSingle":
    case "mediaGroup": {
      const names = (node.content ?? []).map((m) => m.attrs?.alt || m.attrs?.id || "attachment");
      return names.map((n) => `_[attachment: ${n}]_`).join("\n");
    }
    case "panel":
      return (node.content ?? [])
        .map((c) => blockToMarkdown(c, depth))
        .join("\n")
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
    case "expand":
    case "nestedExpand":
      return [`**${node.attrs?.title ?? "Details"}**`, ...(node.content ?? []).map((c) => blockToMarkdown(c, depth))].join(
        "\n",
      );
    case "taskList":
      return (node.content ?? [])
        .map((t) => `- [${t.attrs?.state === "DONE" ? "x" : " "}] ${inlineToMarkdown(t.content)}`)
        .join("\n");
    default:
      return node.content ? node.content.map((c) => blockToMarkdown(c, depth)).join("\n") : inlineToMarkdown([node]);
  }
}

function tableToMarkdown(node: AdfNode): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => (cell.content ?? []).map((c) => blockToMarkdown(c)).join(" ").replace(/\|/g, "\\|")),
  );
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => [...r, ...Array(width - r.length).fill("")]);
  const [head, ...body] = norm;
  return [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...body.map((r) => `| ${r.join(" | ")} |`)].join(
    "\n",
  );
}

/** Accepts an ADF doc, a plain string (server deployments), or null. */
export function adfToMarkdown(doc: any): string {
  if (!doc) return "";
  if (typeof doc === "string") return doc;
  const content: AdfNode[] = doc.content ?? [];
  return content
    .map((n) => blockToMarkdown(n))
    .filter((s) => s !== "")
    .join("\n\n")
    .trim();
}

/**
 * Cloud wants ADF; Data Center wants a plain string in wiki markup. Call sites
 * shouldn't have to remember which — they pass markdown and the deployment.
 */
export function renderBody(markdown: string, deployment: "cloud" | "server"): AdfDoc | string {
  return deployment === "cloud" ? markdownToAdf(markdown) : markdownToWiki(markdown);
}

/**
 * Minimal markdown → Jira wiki markup for Data Center. Only the constructs that
 * differ need translating; wiki markup passes plain prose through unchanged.
 */
export function markdownToWiki(md: string): string {
  const out: string[] = [];
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let inFence = false;

  for (const line of lines) {
    const fence = /^```(\w+)?\s*$/.exec(line.trim());
    if (fence) {
      out.push(inFence ? "{code}" : fence[1] ? `{code:${fence[1]}}` : "{code}");
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    let l = line;
    l = l.replace(/^(#{1,6})\s+(.*)$/, (_, h: string, t: string) => `h${h.length}. ${t}`);
    l = l.replace(/^(\s*)[-*+]\s+/, (_, s: string) => `${"*".repeat(Math.floor(s.length / 2) + 1)} `);
    l = l.replace(/^(\s*)\d+[.)]\s+/, (_, s: string) => `${"#".repeat(Math.floor(s.length / 2) + 1)} `);
    l = l.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "[$1|$2]");
    l = l.replace(/`([^`]+)`/g, "{{$1}}");
    l = l.replace(/\*\*([^*]+)\*\*/g, "*$1*");
    l = l.replace(/(?<![\w*])_([^_\n]+)_(?![\w_])/g, "_$1_");
    l = l.replace(/~~([^~]+)~~/g, "-$1-");
    out.push(l);
  }
  return out.join("\n");
}
