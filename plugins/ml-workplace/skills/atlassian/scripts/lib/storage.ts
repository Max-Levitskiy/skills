// Confluence "storage format" <-> markdown.
//
// Storage format is XHTML with Confluence's own namespaced elements mixed in
// (<ac:structured-macro>, <ri:page>). Posting real HTML — or worse, markdown —
// into a page body produces either a 400 or a page that renders as escaped
// source, so every write goes through markdownToStorage().
//
// Reading uses a small XHTML parser rather than regex substitution. Macro bodies
// nest, and a regex that strips tags turns a code macro into unreadable soup.

// ---------------------------------------------------------------- parser

type Node =
  | { type: "text"; text: string }
  | { type: "el"; tag: string; attrs: Record<string, string>; children: Node[] };

const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link", "ri:page", "ri:attachment", "ri:user", "ri:url"]);

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function parseXhtml(input: string): Node[] {
  const root: Node[] = [];
  const stack: Node[] = [];
  let i = 0;

  const push = (n: Node) => {
    const parent = stack[stack.length - 1];
    if (parent && parent.type === "el") parent.children.push(n);
    else root.push(n);
  };

  while (i < input.length) {
    const lt = input.indexOf("<", i);
    if (lt === -1) {
      const text = input.slice(i);
      if (text) push({ type: "text", text: decodeEntities(text) });
      break;
    }
    if (lt > i) push({ type: "text", text: decodeEntities(input.slice(i, lt)) });

    if (input.startsWith("<!--", lt)) {
      const end = input.indexOf("-->", lt);
      i = end === -1 ? input.length : end + 3;
      continue;
    }
    if (input.startsWith("<![CDATA[", lt)) {
      const end = input.indexOf("]]>", lt);
      const text = input.slice(lt + 9, end === -1 ? input.length : end);
      push({ type: "text", text }); // CDATA is literal: no entity decoding
      i = end === -1 ? input.length : end + 3;
      continue;
    }
    if (input.startsWith("<?", lt) || input.startsWith("<!", lt)) {
      const end = input.indexOf(">", lt);
      i = end === -1 ? input.length : end + 1;
      continue;
    }

    const gt = findTagEnd(input, lt);
    if (gt === -1) {
      push({ type: "text", text: decodeEntities(input.slice(lt)) });
      break;
    }
    const inner = input.slice(lt + 1, gt);
    i = gt + 1;

    if (inner.startsWith("/")) {
      const tag = inner.slice(1).trim().toLowerCase();
      // Close the nearest matching open tag, tolerating unclosed children.
      for (let s = stack.length - 1; s >= 0; s--) {
        const el = stack[s];
        if (el.type === "el" && el.tag === tag) {
          stack.length = s;
          break;
        }
      }
      continue;
    }

    const selfClosing = inner.endsWith("/");
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const nameMatch = /^([\w:-]+)/.exec(body);
    if (!nameMatch) continue;
    const tag = nameMatch[1].toLowerCase();
    const attrs: Record<string, string> = {};
    const attrRe = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(body.slice(nameMatch[0].length)))) {
      attrs[(m[1] ?? m[3]).toLowerCase()] = decodeEntities(m[2] ?? m[4] ?? "");
    }

    const el: Node = { type: "el", tag, attrs, children: [] };
    push(el);
    if (!selfClosing && !VOID_TAGS.has(tag)) stack.push(el);
  }

  return root;
}

/** Find the `>` closing a tag, skipping any inside quoted attribute values. */
function findTagEnd(input: string, from: number): number {
  let quote: string | null = null;
  for (let i = from + 1; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------- storage → markdown

const PANEL_MACROS: Record<string, string> = {
  info: "ℹ️ Info",
  note: "📝 Note",
  warning: "⚠️ Warning",
  tip: "💡 Tip",
  panel: "Panel",
};

function textOf(nodes: Node[]): string {
  return nodes
    .map((n) => (n.type === "text" ? n.text : textOf(n.children)))
    .join("");
}

function macroParam(el: Extract<Node, { type: "el" }>, name: string): string | undefined {
  for (const c of el.children) {
    if (c.type === "el" && c.tag === "ac:parameter" && c.attrs["ac:name"] === name) return textOf(c.children).trim();
  }
  return undefined;
}

function macroBody(el: Extract<Node, { type: "el" }>): Node[] {
  for (const c of el.children) {
    if (c.type === "el" && (c.tag === "ac:plain-text-body" || c.tag === "ac:rich-text-body")) return c.children;
  }
  return [];
}

function renderInline(nodes: Node[]): string {
  return nodes
    .map((n) => {
      if (n.type === "text") return n.text.replace(/\s+/g, " ");
      switch (n.tag) {
        case "strong":
        case "b":
          return `**${renderInline(n.children).trim()}**`;
        case "em":
        case "i":
          return `*${renderInline(n.children).trim()}*`;
        case "code":
          return `\`${textOf(n.children)}\``;
        case "del":
        case "s":
        case "strike":
          return `~~${renderInline(n.children).trim()}~~`;
        case "br":
          return "\n";
        case "a":
          return `[${renderInline(n.children).trim()}](${n.attrs.href ?? ""})`;
        case "img":
          return `![${n.attrs.alt ?? ""}](${n.attrs.src ?? ""})`;
        case "ac:link": {
          // Internal link: the target is a child <ri:*> element, the label an optional body.
          const target = n.children.find((c): c is Extract<Node, { type: "el" }> => c.type === "el" && c.tag.startsWith("ri:"));
          const title = target?.attrs["ri:content-title"] ?? target?.attrs["ri:filename"] ?? target?.attrs["ri:value"] ?? "";
          const label = renderInline(n.children.filter((c) => c.type !== "el" || !c.tag.startsWith("ri:"))).trim();
          return label ? `[${label}](${title})` : `[[${title}]]`;
        }
        case "ac:emoticon":
          return n.attrs["ac:emoji-fallback"] ?? n.attrs["ac:name"] ?? "";
        case "time":
          return n.attrs.datetime ?? "";
        default:
          return renderInline(n.children);
      }
    })
    .join("");
}

function renderBlocks(nodes: Node[], depth = 0): string[] {
  const out: string[] = [];
  let inlineRun: Node[] = [];

  const flush = () => {
    if (!inlineRun.length) return;
    const text = renderInline(inlineRun).trim();
    if (text) out.push(text);
    inlineRun = [];
  };

  for (const n of nodes) {
    if (n.type === "text") {
      if (n.text.trim()) inlineRun.push(n);
      continue;
    }
    switch (n.tag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        flush();
        out.push(`${"#".repeat(Number(n.tag[1]))} ${renderInline(n.children).trim()}`);
        break;
      case "p":
        flush();
        {
          const t = renderInline(n.children).trim();
          if (t) out.push(t);
        }
        break;
      case "ul":
      case "ol": {
        flush();
        const ordered = n.tag === "ol";
        const items = n.children.filter((c): c is Extract<Node, { type: "el" }> => c.type === "el" && c.tag === "li");
        const pad = "  ".repeat(depth);
        // The whole list is one block. Pushing each item separately would put a
        // blank line between them once blocks are joined with "\n\n", turning
        // every list into a loose one.
        const lines: string[] = [];
        items.forEach((li, idx) => {
          const nested = li.children.filter((c) => c.type === "el" && (c.tag === "ul" || c.tag === "ol"));
          const own = li.children.filter((c) => !(c.type === "el" && (c.tag === "ul" || c.tag === "ol")));
          lines.push(`${pad}${ordered ? `${idx + 1}.` : "-"} ${renderBlocks(own, depth).join(" ").trim()}`);
          for (const sub of nested) lines.push(...renderBlocks([sub], depth + 1));
        });
        if (lines.length) out.push(lines.join("\n"));
        break;
      }
      case "blockquote":
        flush();
        out.push(
          renderBlocks(n.children, depth)
            .join("\n")
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n"),
        );
        break;
      case "hr":
        flush();
        out.push("---");
        break;
      case "table":
        flush();
        out.push(renderTable(n));
        break;
      case "ac:structured-macro": {
        flush();
        const name = n.attrs["ac:name"] ?? "";
        if (name === "code") {
          const lang = macroParam(n, "language") ?? "";
          out.push(`\`\`\`${lang}\n${textOf(macroBody(n)).replace(/^\n|\n$/g, "")}\n\`\`\``);
        } else if (name in PANEL_MACROS) {
          const inner = renderBlocks(macroBody(n), depth).join("\n");
          out.push([`> **${PANEL_MACROS[name]}**`, ...inner.split("\n").map((l) => `> ${l}`)].join("\n"));
        } else if (name === "expand") {
          const title = macroParam(n, "title") ?? "Details";
          out.push(`**${title}**`, ...renderBlocks(macroBody(n), depth));
        } else if (name === "toc") {
          out.push("_[table of contents]_");
        } else if (name === "jira") {
          const key = macroParam(n, "key");
          out.push(key ? `_[Jira: ${key}]_` : "_[Jira issues macro]_");
        } else {
          const inner = renderBlocks(macroBody(n), depth).join("\n").trim();
          out.push(inner ? `_[macro: ${name}]_\n${inner}` : `_[macro: ${name}]_`);
        }
        break;
      }
      case "ac:task-list": {
        flush();
        const tasks: string[] = [];
        for (const task of n.children) {
          if (task.type !== "el") continue;
          const status = task.children.find((c) => c.type === "el" && c.tag === "ac:task-status");
          const bodyNode = task.children.find((c) => c.type === "el" && c.tag === "ac:task-body");
          const done = status && status.type === "el" && textOf(status.children).trim() === "complete";
          tasks.push(`- [${done ? "x" : " "}] ${bodyNode && bodyNode.type === "el" ? renderInline(bodyNode.children).trim() : ""}`);
        }
        if (tasks.length) out.push(tasks.join("\n"));
        break;
      }
      case "ac:image":
        flush();
        {
          const target = n.children.find((c): c is Extract<Node, { type: "el" }> => c.type === "el" && c.tag.startsWith("ri:"));
          out.push(`_[image: ${target?.attrs["ri:filename"] ?? target?.attrs["ri:value"] ?? "attachment"}]_`);
        }
        break;
      case "div":
      case "section":
      case "span":
      case "body":
      case "html":
        out.push(...renderBlocks(n.children, depth));
        break;
      default:
        inlineRun.push(n);
    }
  }
  flush();
  return out.filter((s) => s.trim());
}

function renderTable(el: Extract<Node, { type: "el" }>): string {
  const rows: string[][] = [];
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      if (n.type !== "el") continue;
      if (n.tag === "tr") {
        rows.push(
          n.children
            .filter((c): c is Extract<Node, { type: "el" }> => c.type === "el" && (c.tag === "td" || c.tag === "th"))
            .map((c) => renderBlocks(c.children).join(" ").replace(/\|/g, "\\|").trim()),
        );
      } else {
        walk(n.children);
      }
    }
  };
  walk(el.children);
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill("")]);
  const [head, ...body] = norm;
  return [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...body.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

export function storageToMarkdown(storage: string): string {
  if (!storage) return "";
  return renderBlocks(parseXhtml(storage)).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------- markdown → storage

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineToStorage(text: string): string {
  // Placeholder-protect code spans first: their contents must not be re-parsed
  // for emphasis, or `a * b` inside backticks becomes an <em>.
  const codes: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_, c: string) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });

  s = escapeXml(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => `<a href="${href.replace(/"/g, "&quot;")}">${label}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, "<em>$1</em>");
  s = s.replace(/(?<![\w_])_([^_\n]+)_(?![\w_])/g, "<em>$1</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${escapeXml(codes[Number(i)])}</code>`);
  return s;
}

interface MdLine {
  indent: number;
  body: string;
  /** The untouched line. Code blocks need it: `body` has had its indent stripped. */
  raw: string;
}

export function markdownToStorage(md: string): string {
  const lines: MdLine[] = md
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((raw) => {
      const m = /^(\s*)(.*)$/.exec(raw)!;
      return { indent: m[1].replace(/\t/g, "  ").length, body: m[2], raw };
    });

  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const { body } = lines[i];
    const t = body.trim();
    if (!t) {
      i++;
      continue;
    }

    const fence = /^```(\w+)?\s*$/.exec(t);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].body.trim())) {
        // raw, not body: indentation is meaningful in every language worth pasting.
        code.push(lines[i].raw);
        i++;
      }
      i++;
      const lang = fence[1] ? `<ac:parameter ac:name="language">${fence[1]}</ac:parameter>` : "";
      // CDATA keeps the source literal; a ]]> inside the snippet would close it early.
      const safe = code.join("\n").replace(/]]>/g, "]]]]><![CDATA[>");
      out.push(
        `<ac:structured-macro ac:name="code">${lang}<ac:plain-text-body><![CDATA[${safe}]]></ac:plain-text-body></ac:structured-macro>`,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(t);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inlineToStorage(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      out.push("<hr />");
      i++;
      continue;
    }

    if (/^>\s?/.test(t)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].body.trim())) {
        quoted.push(lines[i].body.trim().replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote><p>${inlineToStorage(quoted.join(" "))}</p></blockquote>`);
      continue;
    }

    if (t.startsWith("|") && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].body.trim())) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].body.trim().startsWith("|")) {
        const cells = lines[i].body.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!/^[\s:|-]+$/.test(cells.join("|"))) rows.push(cells);
        i++;
      }
      const [head, ...rest] = rows;
      out.push(
        "<table><tbody>" +
          `<tr>${head.map((c) => `<th>${inlineToStorage(c)}</th>`).join("")}</tr>` +
          rest.map((r) => `<tr>${r.map((c) => `<td>${inlineToStorage(c)}</td>`).join("")}</tr>`).join("") +
          "</tbody></table>",
      );
      continue;
    }

    if (/^[-*+]\s+/.test(t) || /^\d+[.)]\s+/.test(t)) {
      const { html, next } = listToStorage(lines, i, lines[i].indent);
      out.push(html);
      i = next;
      continue;
    }

    const para: string[] = [];
    while (i < lines.length) {
      const line = lines[i].body.trim();
      if (
        !line ||
        /^```/.test(line) ||
        /^#{1,6}\s/.test(line) ||
        /^>/.test(line) ||
        /^[-*+]\s+/.test(line) ||
        /^\d+[.)]\s+/.test(line)
      )
        break;
      para.push(line);
      i++;
    }
    out.push(`<p>${inlineToStorage(para.join(" "))}</p>`);
  }

  return out.join("\n");
}

function listToStorage(lines: MdLine[], start: number, indent: number): { html: string; next: number } {
  const ordered = /^\d+[.)]\s+/.test(lines[start].body.trim());
  const items: string[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    const t = line.body.trim();
    if (!t) {
      const nextReal = lines.slice(i + 1).find((l) => l.body.trim());
      if (!nextReal || nextReal.indent < indent || !/^([-*+]|\d+[.)])\s+/.test(nextReal.body.trim())) break;
      i++;
      continue;
    }
    if (line.indent < indent) break;
    const m = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(t);
    if (!m) break;

    let item = inlineToStorage(m[1]);
    i++;
    while (i < lines.length && lines[i].body.trim() && lines[i].indent > indent) {
      if (/^([-*+]|\d+[.)])\s+/.test(lines[i].body.trim())) {
        const sub = listToStorage(lines, i, lines[i].indent);
        item += sub.html;
        i = sub.next;
      } else {
        item += ` ${inlineToStorage(lines[i].body.trim())}`;
        i++;
      }
    }
    items.push(`<li>${item}</li>`);
  }

  const tag = ordered ? "ol" : "ul";
  return { html: `<${tag}>${items.join("")}</${tag}>`, next: i };
}
