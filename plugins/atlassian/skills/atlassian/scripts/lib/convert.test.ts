// bun test scripts/lib/convert.test.ts
//
// The converters are the part of this skill that can silently corrupt a real
// page or issue, so they get tests: a bad ADF tree is rejected loudly by Jira,
// but bad storage XHTML posts fine and quietly mangles the page.

import { expect, test, describe } from "bun:test";
import { markdownToAdf, adfToMarkdown, markdownToWiki } from "./adf";
import { markdownToStorage, storageToMarkdown } from "./storage";

describe("markdown → ADF", () => {
  test("headings, paragraphs and inline marks", () => {
    const doc = markdownToAdf("# Title\n\nSome **bold** and *italic* and `code`.");
    expect(doc.type).toBe("doc");
    expect(doc.version).toBe(1);
    expect(doc.content[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
    const marks = doc.content[1].content!.flatMap((n) => n.marks?.map((m) => m.type) ?? []);
    expect(marks).toEqual(["strong", "em", "code"]);
  });

  test("links keep their href", () => {
    const doc = markdownToAdf("See [the docs](https://example.com/x).");
    const link = doc.content[0].content!.find((n) => n.marks?.some((m) => m.type === "link"));
    expect(link?.marks?.[0].attrs.href).toBe("https://example.com/x");
    expect(link?.text).toBe("the docs");
  });

  test("code fences keep language and raw content", () => {
    const doc = markdownToAdf("```ts\nconst a = 1 * 2;\n```");
    expect(doc.content[0].type).toBe("codeBlock");
    expect(doc.content[0].attrs).toEqual({ language: "ts" });
    expect(doc.content[0].content![0].text).toBe("const a = 1 * 2;");
  });

  test("preserves indentation inside code blocks", () => {
    const doc = markdownToAdf("```yaml\nroot:\n  child: 1\n```");
    expect(doc.content[0].content![0].text).toBe("root:\n  child: 1");
  });

  test("nested lists nest as listItem > list", () => {
    const doc = markdownToAdf("- one\n  - inner\n- two");
    const list = doc.content[0];
    expect(list.type).toBe("bulletList");
    expect(list.content).toHaveLength(2);
    expect(list.content![0].content![1].type).toBe("bulletList");
  });

  test("tables become table > tableRow > tableHeader", () => {
    const doc = markdownToAdf("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(doc.content[0].type).toBe("table");
    expect(doc.content[0].content![0].content![0].type).toBe("tableHeader");
    expect(doc.content[0].content![1].content![0].type).toBe("tableCell");
  });

  test("an empty document is still a valid doc", () => {
    // Jira rejects { type: "doc", content: [] } outright.
    const doc = markdownToAdf("");
    expect(doc.content.length).toBeGreaterThan(0);
  });
});

describe("ADF → markdown", () => {
  test("round-trips the constructs we generate", () => {
    const md = [
      "# Heading",
      "",
      "Paragraph with **bold**, *em* and `code`.",
      "",
      "- one",
      "- two",
      "",
      "```js",
      "x();",
      "```",
    ].join("\n");
    expect(adfToMarkdown(markdownToAdf(md))).toBe(md);
  });

  test("renders mentions and status without dropping them", () => {
    const doc = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: { text: "@Dana", id: "123" } },
            { type: "text", text: " please review " },
            { type: "status", attrs: { text: "IN PROGRESS" } },
          ],
        },
      ],
    };
    expect(adfToMarkdown(doc)).toBe("@Dana please review [IN PROGRESS]");
  });

  test("plain strings pass through — Data Center returns them", () => {
    expect(adfToMarkdown("h1. Server text")).toBe("h1. Server text");
    expect(adfToMarkdown(null)).toBe("");
  });
});

describe("markdown → wiki markup", () => {
  test("headings, lists, links and code", () => {
    const wiki = markdownToWiki("## Two\n\n- a\n  - b\n\n[link](http://x)\n\n```js\nvar a = 1;\n```");
    expect(wiki).toContain("h2. Two");
    expect(wiki).toContain("* a");
    expect(wiki).toContain("** b");
    expect(wiki).toContain("[link|http://x]");
    expect(wiki).toContain("{code:js}");
  });

  test("does not translate inside a fence", () => {
    const wiki = markdownToWiki("```\n# not a heading\n```");
    expect(wiki).toContain("# not a heading");
  });
});

describe("markdown → storage", () => {
  test("produces XHTML blocks", () => {
    const html = markdownToStorage("# T\n\nHello **world**\n\n- a\n- b");
    expect(html).toContain("<h1>T</h1>");
    expect(html).toContain("<p>Hello <strong>world</strong></p>");
    expect(html).toContain("<ul><li>a</li><li>b</li></ul>");
  });

  test("code becomes the code macro with CDATA", () => {
    const html = markdownToStorage("```python\nif a < b and c > d:\n    pass\n```");
    expect(html).toContain('ac:name="code"');
    expect(html).toContain('<ac:parameter ac:name="language">python</ac:parameter>');
    // CDATA means the angle brackets must NOT be entity-escaped.
    expect(html).toContain("if a < b and c > d:");
  });

  test("preserves indentation inside code blocks", () => {
    // Losing leading whitespace silently breaks Python, YAML, and every diff.
    const html = markdownToStorage("```python\nif a:\n    raise Err()\n```");
    expect(html).toContain("if a:\n    raise Err()");
  });

  test("escapes markup in prose so it cannot break the page", () => {
    const html = markdownToStorage("Use <script>alert(1)</script> & co");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; co");
  });

  test("code spans are not re-parsed for emphasis", () => {
    const html = markdownToStorage("Run `a * b * c` now");
    expect(html).toContain("<code>a * b * c</code>");
    expect(html).not.toContain("<em>");
  });

  test("tables use th for the header row", () => {
    const html = markdownToStorage("| h1 | h2 |\n| --- | --- |\n| v1 | v2 |");
    expect(html).toContain("<th>h1</th>");
    expect(html).toContain("<td>v1</td>");
  });
});

describe("storage → markdown", () => {
  test("unwraps headings, lists, links and inline marks", () => {
    const md = storageToMarkdown(
      "<h2>Section</h2><p>Some <strong>bold</strong> and <a href=\"http://x\">link</a>.</p><ul><li>one</li><li>two</li></ul>",
    );
    expect(md).toContain("## Section");
    expect(md).toContain("**bold**");
    expect(md).toContain("[link](http://x)");
    expect(md).toContain("- one");
  });

  test("list items are not separated by blank lines", () => {
    // A blank line between items makes markdown render each as its own
    // paragraph — visually a loose list, and noisier to read back.
    const md = storageToMarkdown("<ul><li>one</li><li>two</li><li>three</li></ul>");
    expect(md).toBe("- one\n- two\n- three");
  });

  test("nested lists indent under their parent item", () => {
    const md = storageToMarkdown("<ul><li>outer<ul><li>inner</li></ul></li><li>next</li></ul>");
    expect(md).toBe("- outer\n  - inner\n- next");
  });

  test("code macro becomes a fenced block with its language", () => {
    const md = storageToMarkdown(
      '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">bash</ac:parameter>' +
        "<ac:plain-text-body><![CDATA[echo <hi>]]></ac:plain-text-body></ac:structured-macro>",
    );
    expect(md).toBe("```bash\necho <hi>\n```");
  });

  test("info panels survive as blockquotes rather than vanishing", () => {
    const md = storageToMarkdown(
      '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>Heads up</p></ac:rich-text-body></ac:structured-macro>',
    );
    expect(md).toContain("Heads up");
    expect(md.startsWith(">")).toBe(true);
  });

  test("decodes entities and keeps table shape", () => {
    const md = storageToMarkdown("<table><tbody><tr><th>a &amp; b</th></tr><tr><td>1 &lt; 2</td></tr></tbody></table>");
    expect(md).toContain("| a & b |");
    expect(md).toContain("| 1 < 2 |");
  });

  test("task lists render as checkboxes", () => {
    const md = storageToMarkdown(
      "<ac:task-list><ac:task><ac:task-status>complete</ac:task-status><ac:task-body>done thing</ac:task-body></ac:task>" +
        "<ac:task><ac:task-status>incomplete</ac:task-status><ac:task-body>todo thing</ac:task-body></ac:task></ac:task-list>",
    );
    expect(md).toBe("- [x] done thing\n- [ ] todo thing");
  });

  test("internal ac:link keeps the target title", () => {
    const md = storageToMarkdown('<p>See <ac:link><ri:page ri:content-title="Runbook" /></ac:link></p>');
    expect(md).toContain("[[Runbook]]");
  });

  test("survives unclosed tags without losing text", () => {
    // Real page bodies are not always well-formed once macros are involved.
    const md = storageToMarkdown("<p>first<p>second");
    expect(md).toContain("first");
    expect(md).toContain("second");
  });
});

describe("storage round trip", () => {
  test("markdown → storage → markdown preserves the structure we care about", () => {
    const md = "# Title\n\nIntro **text**.\n\n- one\n- two\n\n```js\nfoo();\n```";
    const back = storageToMarkdown(markdownToStorage(md));
    expect(back).toContain("# Title");
    expect(back).toContain("Intro **text**.");
    expect(back).toContain("- one");
    expect(back).toContain("```js\nfoo();\n```");
  });
});
