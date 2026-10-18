// The drawings of the live view (docs/spec.md, p.24): the display DOT made from Graphviz's own
// reading of `workflow.dot`, its picture, and the dot drawing for a terminal that shows no
// pictures. Graphviz and resvg are the WebAssembly builds in `vendor/`, so nothing is installed.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// @ts-ignore: vendored build, no types
import { Graphviz } from "../vendor/graphviz/graphviz.js";
// @ts-ignore: vendored build, no types
import { initWasm, Resvg } from "../vendor/resvg/resvg.mjs";

/** The arrow just taken into a node: the node it left and the outcome it routed on. */
export type Arrow = { from: string; outcome: string };
export type Style = "node" | "here" | "edge" | "taken" | "label" | "taken-label";
export type Span = { text: string; style: Style };

const HERE = "#ffd43b";
const TAKEN = "#e8590c";

// Attributes that only change the look (runspore spec/dot.md §3): the display keeps these and
// drops the ones with meaning, which no renderer knows.
const RENDER = new Set(
  "label xlabel shape style color fillcolor fontcolor fontname fontsize penwidth peripheries width height fixedsize arrowhead arrowtail dir weight constraint tooltip rankdir splines nodesep ranksep bgcolor".split(
    " ",
  ),
);

/**
 * The part of the graph the live view shows: the nodes `shown` within its depth of the current
 * node, and the nodes just past them, `folded`, each with how many nodes it hides beyond it.
 */
export type Fold = { depth: number; shown: Set<string>; folded: Map<string, number> };

/**
 * The fold of a graph at `depth` arrows around `here`, arrows followed either way, so the view shows
 * where the run came from as well as where it can go; null when that depth shows every node.
 * `whole` is the least depth that does.
 */
export function around(graph: Graph, here: string | null, depth: number): { fold: Fold | null; whole: number } {
  if (!here || !graph.nodes.includes(here)) return { fold: null, whole: 0 };
  const near = new Map<string, Set<string>>(graph.nodes.map((node) => [node, new Set<string>()]));
  for (const edge of graph.edges) {
    near.get(edge.from)?.add(edge.to);
    near.get(edge.to)?.add(edge.from);
  }
  const distance = new Map([[here, 0]]);
  for (let queue = [here]; queue.length; ) {
    const next: string[] = [];
    for (const node of queue) {
      for (const other of near.get(node) ?? []) {
        if (distance.has(other)) continue;
        distance.set(other, distance.get(node)! + 1);
        next.push(other);
      }
    }
    queue = next;
  }
  // Nodes the current one does not reach at all show only with the whole graph, one past the farthest.
  const farthest = Math.max(...distance.values());
  const whole = distance.size === graph.nodes.length ? farthest : farthest + 1;
  if (depth >= whole) return { fold: null, whole };
  const shown = new Set(graph.nodes.filter((node) => (distance.get(node) ?? Infinity) <= depth));
  const folded = new Map<string, number>();
  for (const node of graph.nodes) {
    if (distance.get(node) !== depth + 1) continue;
    // What lies past it: the nodes beyond the fold it reaches without coming back into view.
    const seen = new Set([node]);
    for (let queue = [node]; queue.length; ) {
      const next: string[] = [];
      for (const at of queue) {
        for (const other of near.get(at) ?? []) {
          if (seen.has(other) || shown.has(other) || distance.get(other) === depth + 1) continue;
          seen.add(other);
          next.push(other);
        }
      }
      queue = next;
    }
    folded.set(node, seen.size - 1);
  }
  return { fold: { depth, shown, folded }, whole };
}

/** How tight a dot drawing is laid out: labels wrapped to `wrap` columns, boxes `nodesep` inches apart. */
export type Cells = { wrap: number; nodesep: number };

/**
 * The dot drawing's layouts, roomiest first: the live view draws the first whose width fits its
 * pane. Each step makes a 20-node workflow 10 to 20 columns narrower and a few rows taller.
 */
export const CELLS: Cells[] = [
  { wrap: 24, nodesep: 0.25 },
  { wrap: 18, nodesep: 0.15 },
  { wrap: 14, nodesep: 0.1 },
  { wrap: 10, nodesep: 0.05 },
];

// What would size a box or a label off the dot drawing's character cells.
const CELL_SIZED = ["fontname", "fontsize", "width", "height", "fixedsize", "peripheries", "penwidth"];

type Attrs = Record<string, unknown>;
type GvNode = Attrs & { _gvid: number; name: string };
type GvEdge = Attrs & { _gvid: number; tail: number; head: number };
type GvGraph = Attrs & { objects?: GvNode[]; edges?: GvEdge[] };

/** One node and one arrow of the graph, as the display draws them. */
export type Graph = {
  nodes: string[];
  edges: { from: string; to: string; on: string; label: string }[];
  dot: string;
  /** Each node's label on one line, its ID when it has none. */
  labels: Record<string, string>;
  /** The graph's `start` node, when it names one of its nodes. */
  start: string | null;
};

let graphviz: any;
async function gv(): Promise<any> {
  graphviz ??= await Graphviz.load();
  return graphviz;
}

/**
 * The display DOT of `workflow.dot`: each arrow labelled with its `label`, else its `on`; end nodes
 * with a double outline; the current node and the arrow just taken highlighted when given.
 * Throws when Graphviz cannot read the file.
 */
export async function display(source: string, here: string | null = null, taken: Arrow | null = null, cells: Cells | null = null, fold: Fold | null = null): Promise<Graph> {
  const read: GvGraph = JSON.parse((await gv()).layout(source, "dot_json", "dot"));
  const byId = new Map<number, GvNode>();
  for (const node of read.objects ?? []) byId.set(node._gvid, node);
  // The dot drawing's layout is in character cells: 12-point Courier is 0.1 inch a column and 0.2
  // a row, and a box's margin is two columns and one row. A pane is narrow and scrolls down, so it
  // always runs top to bottom, whatever the workflow's own `rankdir`.
  const graphAttrs = pick(read);
  if (cells) for (const name of ["rankdir", "nodesep", "ranksep"]) delete graphAttrs[name];
  const lines = [
    "digraph display {",
    `  graph [${attrs({ bgcolor: "white", pad: "0.15", ...graphAttrs, ...(cells ? { nodesep: String(cells.nodesep), ranksep: "0.6" } : {}) })}];`,
    cells ? '  node [shape=box, style=rounded, fontname="Courier", fontsize=12, margin="0.2,0.2", width=0, height=0];' : '  node [shape=box, style=rounded, fontname="Helvetica", fontsize=12];',
    cells ? '  edge [fontname="Courier", fontsize=12];' : '  edge [fontname="Helvetica", fontsize=10];',
  ];
  const nodes: string[] = [];
  const labels: Record<string, string> = {};
  for (const node of read.objects ?? []) {
    if (fold && !fold.shown.has(node.name) && !fold.folded.has(node.name)) continue;
    nodes.push(node.name);
    const own = pick(node);
    // A folded node stands for itself and what lies past it: dashed, with how many more it hides.
    const hidden = fold?.folded.get(node.name);
    if (hidden !== undefined) {
      own.label = `${own.label ?? node.name}${hidden ? `\\n+${hidden} more` : ""}`;
      own.style = "rounded,dashed";
    }
    if (cells) {
      for (const name of CELL_SIZED) delete own[name];
      own.label = wrapLabel(own.label ?? node.name, cells.wrap);
    }
    labels[node.name] = own.label ? own.label.replace(/\\[nlr]/g, " ").replace(/\s+/g, " ").trim() || node.name : node.name;
    if (!cells && (node.kind === "complete" || node.kind === "fail")) own.peripheries = "2";
    if (node.name === here) {
      own.style = own.style ? `${own.style},filled,bold` : "rounded,filled,bold";
      own.fillcolor = HERE;
      own.penwidth = "2";
    }
    lines.push(`  ${quote(node.name)} [${attrs(own)}];`);
  }
  const edges: Graph["edges"] = [];
  for (const edge of [...(read.edges ?? [])].sort((a, b) => a._gvid - b._gvid)) {
    const from = byId.get(edge.tail)?.name;
    const to = byId.get(edge.head)?.name;
    if (from === undefined || to === undefined) continue;
    // Folded, an arrow shows when it has a shown end and its other end is drawn too.
    if (fold && (!(fold.shown.has(from) || fold.shown.has(to)) || !nodes.includes(from) || !nodes.includes(to))) continue;
    const on = typeof edge.on === "string" ? edge.on : "ok";
    const own = pick(edge);
    if (cells) for (const name of CELL_SIZED) delete own[name];
    const label = typeof own.label === "string" && own.label ? own.label : typeof edge.on === "string" ? edge.on : "";
    own.label = label;
    if (taken && taken.from === from && to === here && taken.outcome === on) Object.assign(own, { color: TAKEN, fontcolor: TAKEN, penwidth: "3" });
    edges.push({ from, to, on, label });
    lines.push(`  ${quote(from)} -> ${quote(to)} [${attrs(own)}];`);
  }
  lines.push("}");
  const start = typeof read.start === "string" && nodes.includes(read.start) ? read.start : null;
  return { nodes, edges, dot: lines.join("\n") + "\n", labels, start };
}

// The dot drawing's label, each line broken at its spaces to `wrap` columns, so a long label makes
// a taller box rather than a wider drawing.
function wrapLabel(label: string, wrap: number): string {
  const out: string[] = [];
  for (const line of label.split(/\\[nlr]/)) {
    let current = "";
    for (const word of line.trim().split(/\s+/)) {
      if (current && current.length + 1 + word.length > wrap) {
        out.push(current);
        current = word;
      } else current = current ? `${current} ${word}` : word;
    }
    if (current) out.push(current);
  }
  return out.join("\\n");
}

function pick(from: Attrs): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(from)) {
    if (!RENDER.has(name) || typeof value !== "string" || value === "") continue;
    // Graphviz writes its default node label, the node's own ID, as `\N`.
    if (name === "label" && value === "\\N") continue;
    out[name] = value;
  }
  return out;
}

function attrs(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([name, value]) => `${name}=${quote(value)}`)
    .join(", ");
}

// A DOT string: only `\"` is an escape when DOT reads it, so a backslash stays for the label's own
// escapes (`\n`); one at the very end would eat the closing quote and is doubled.
function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"').replace(/\\$/, "\\\\")}"`;
}

/** Graphviz's `plain` layout of a display DOT. */
export async function layout(dot: string): Promise<string> {
  return (await gv()).layout(dot, "plain", "dot");
}

// Font files resvg can draw labels with, the first found wins: WebAssembly sees no system fonts.
const FONTS = [
  "/System/Library/Fonts/Helvetica.ttc",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/Library/Fonts/Arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  "/usr/share/fonts/liberation-sans/LiberationSans-Regular.ttf",
  "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
  "/usr/share/fonts/noto/NotoSans-Regular.ttf",
];

/** The font files looked in: `CLAUDE_SPORE_FONTS` when set, for the specs, else the usual ones. */
export function fontFiles(): string[] {
  const set = process.env.CLAUDE_SPORE_FONTS;
  return set === undefined ? FONTS : set.split(":").filter(Boolean);
}

let resvgReady = false;

/** The PNG of a display DOT at twice its size on white, or null when no font is found. */
export async function picture(dot: string): Promise<Uint8Array | null> {
  const font = fontFiles().find((file) => existsSync(file));
  if (!font) return null;
  const svg: string = (await gv()).layout(dot, "svg", "dot");
  if (!resvgReady) {
    await initWasm(readFileSync(join(import.meta.dir, "..", "vendor", "resvg", "resvg.wasm")));
    resvgReady = true;
  }
  const resvg = new Resvg(svg, { fitTo: { mode: "zoom", value: 2 }, background: "white", font: { fontBuffers: [readFileSync(font)], loadSystemFonts: false } });
  return resvg.render().asPng();
}

/** A PNG's width and height in pixels, from its header. */
export function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Writes a file beside its name and renames it over, so a reader never sees half of it. */
export function writeWhole(file: string, data: string | Uint8Array) {
  mkdirSync(dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.partial`;
  writeFileSync(partial, data);
  renameSync(partial, file);
}

// ---------- the dot drawing ----------

type PlainNode = { id: string; x: number; y: number; lines: string[]; isFolded: boolean };
type PlainEdge = { from: string; to: string; points: [number, number][]; label?: string; lx?: number; ly?: number };

function tokens(line: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
  let match;
  // A label's line breaks (`\n`, `\l`, `\r`) stay as newlines.
  while ((match = re.exec(line))) out.push(match[1] !== undefined ? match[1].replace(/\\(.)/g, (_, c) => ("nlr".includes(c) ? "\n" : c)) : match[2]!);
  return out;
}

function parsePlain(plain: string) {
  let width = 0;
  let height = 0;
  const nodes: PlainNode[] = [];
  const edges: PlainEdge[] = [];
  for (const line of plain.split("\n")) {
    const t = tokens(line);
    if (t[0] === "graph") {
      width = Number(t[2]);
      height = Number(t[3]);
    } else if (t[0] === "node") {
      const lines = t[6]!.split("\n").map((l) => l.trim()).filter(Boolean);
      nodes.push({ id: t[1]!, x: Number(t[2]), y: Number(t[3]), lines: lines.length ? lines : [t[1]!], isFolded: /\bdashed\b/.test(t[7] ?? "") });
    } else if (t[0] === "edge") {
      const n = Number(t[3]);
      const points: [number, number][] = [];
      for (let i = 0; i < n; i++) points.push([Number(t[4 + 2 * i]), Number(t[5 + 2 * i])]);
      const rest = t.slice(4 + 2 * n);
      const edge: PlainEdge = { from: t[1]!, to: t[2]!, points };
      // With a label: label, x, y, style, colour; without: style, colour.
      if (rest.length >= 5) Object.assign(edge, { label: rest[0]!.replace(/\s+/g, " ").trim(), lx: Number(rest[1]), ly: Number(rest[2]) });
      edges.push(edge);
    }
  }
  return { width, height, nodes, edges };
}

function bezier(p: [number, number][], t: number): [number, number] {
  const u = 1 - t;
  return [
    u * u * u * p[0]![0] + 3 * u * u * t * p[1]![0] + 3 * u * t * t * p[2]![0] + t * t * t * p[3]![0],
    u * u * u * p[0]![1] + 3 * u * u * t * p[1]![1] + 3 * u * t * t * p[2]![1] + t * t * t * p[3]![1],
  ];
}

// The bit of each of a Braille cell's 2×4 dots, by column and row.
const DOT_BIT = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
];

/**
 * The dot drawing of a `plain` layout: one entry per row, each a list of styled runs. Curves are
 * Braille dots, boxes and labels real text; `here` is the current node, `taken` the arrow just
 * taken, matched by its ends and its label.
 */
export function dots(plain: string, graph: Graph, here: string | null, taken: Arrow | null): Span[][] {
  const { width, height, nodes, edges } = parsePlain(plain);
  // The layout is in cells already (display, cells): ten columns and five rows an inch.
  const sx = 10;
  const sy = 5;
  const cols = Math.ceil(width * sx) + 4;
  const rows = Math.ceil(height * sy) + 3;
  const bits = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  const hot = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const grid: Span[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ text: " ", style: "edge" as Style })));
  const px = (x: number) => (x * sx + 2) * 2;
  const py = (y: number) => ((height - y) * sy + 1.5) * 4;
  const takenLabel = taken && here ? graph.edges.find((e) => e.from === taken.from && e.to === here && e.on === taken.outcome)?.label : undefined;
  const isTaken = (e: PlainEdge) => takenLabel !== undefined && e.from === taken!.from && e.to === here && (e.label ?? "") === takenLabel;
  const heads: { r: number; c: number; ch: string; hot: boolean }[] = [];
  for (const edge of edges) {
    const lit = isTaken(edge);
    let last: [number, number] | null = null;
    for (let s = 0; s + 3 < edge.points.length; s += 3) {
      const segment = edge.points.slice(s, s + 4);
      for (let i = 0; i <= 200; i++) {
        const [x, y] = bezier(segment, i / 200);
        const X = Math.floor(px(x));
        const Y = Math.floor(py(y));
        const r = Math.floor(Y / 4);
        const c = Math.floor(X / 2);
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
        bits[r]![c]! |= DOT_BIT[X % 2]![Y % 4]!;
        if (lit) hot[r]![c] = true;
        last = [X, Y];
      }
    }
    if (last && edge.points.length >= 2) {
      // Graphviz ends the curve where the arrowhead starts; point it the way the curve was going.
      const p0 = edge.points[Math.max(0, edge.points.length - 4)]!;
      const p1 = edge.points[edge.points.length - 1]!;
      const dx = px(p1[0]) - px(p0[0]);
      const dy = py(p1[1]) - py(p0[1]);
      const ch = Math.abs(dy) >= Math.abs(dx) / 2 ? (dy > 0 ? "▼" : "▲") : dx > 0 ? "▶" : "◀";
      heads.push({ r: Math.floor(last[1] / 4), c: Math.floor(last[0] / 2), ch, hot: lit });
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (bits[r]![c]) grid[r]![c] = { text: String.fromCharCode(0x2800 + bits[r]![c]!), style: hot[r]![c] ? "taken" : "edge" };
    }
  }
  for (const head of heads) if (grid[head.r]?.[head.c]) grid[head.r]![head.c] = { text: head.ch, style: head.hot ? "taken" : "edge" };
  for (const edge of edges) {
    if (!edge.label || edge.lx === undefined || edge.ly === undefined) continue;
    const r = Math.floor(py(edge.ly) / 4);
    const c0 = Math.floor(px(edge.lx) / 2) - Math.floor(edge.label.length / 2);
    const style: Style = isTaken(edge) ? "taken-label" : "label";
    [...edge.label].forEach((ch, i) => {
      if (grid[r]?.[c0 + i]) grid[r]![c0 + i] = { text: ch, style };
    });
  }
  for (const node of nodes) {
    const w = Math.max(...node.lines.map((l) => [...l].length)) + 4;
    const top = Math.floor(py(node.y) / 4) - Math.floor((node.lines.length + 2) / 2);
    const c0 = Math.max(0, Math.min(cols - w, Math.round(px(node.x) / 2 - w / 2)));
    const style: Style = node.id === here ? "here" : node.isFolded ? "label" : "node";
    const [line, side] = node.isFolded ? ["┄", "┆"] : ["─", "│"];
    const box = [`╭${line.repeat(w - 2)}╮`, ...node.lines.map((l) => `${side} ${l.padEnd(w - 4)} ${side}`), `╰${line.repeat(w - 2)}╯`];
    box.forEach((line, k) => {
      [...line].forEach((ch, i) => {
        if (grid[top + k]?.[c0 + i]) grid[top + k]![c0 + i] = { text: ch, style };
      });
    });
  }
  const blank = (row: Span[]) => row.every((cell) => cell.text === " ");
  while (grid.length && blank(grid[0]!)) grid.shift();
  while (grid.length && blank(grid[grid.length - 1]!)) grid.pop();
  return grid.map(runs);
}

// Neighbouring cells of one style joined into one run, trailing blanks dropped. An empty cell joins
// the run before it, unless that is the current node's, whose background would spill.
function runs(row: Span[]): Span[] {
  const out: Span[] = [];
  for (const cell of row) {
    const before = out[out.length - 1]?.style;
    const isEmpty = cell.text === " " && cell.style === "edge";
    const style = isEmpty && before && before !== "here" ? before : cell.style;
    const last = out[out.length - 1];
    if (last && last.style === style) last.text += cell.text;
    else out.push({ text: cell.text, style });
  }
  const last = out[out.length - 1];
  if (last) {
    last.text = last.text.trimEnd();
    if (!last.text) out.pop();
  }
  return out;
}

/**
 * The compact tree of the graph, one row per arrow, as `argo watch` prints a workflow: the start
 * node first, then each node under the arrow into it, `─ <label> ─▶` when the arrow has a label. A
 * node already in the tree is named again after `↻` and not followed, so a loop ends there; nodes
 * the start does not reach follow as trees of their own. Styled as the dot drawing.
 */
export function tree(graph: Graph, here: string | null, taken: Arrow | null): Span[][] {
  const out: Span[][] = [];
  const seen = new Set<string>();
  const nodeSpans = (id: string, again: boolean): Span[] =>
    again ? [{ text: `↻ ${graph.labels[id] ?? id}`, style: "label" }] : [{ text: graph.labels[id] ?? id, style: id === here ? "here" : "node" }];
  const walk = (id: string, indent: string) => {
    graph.edges
      .filter((edge) => edge.from === id)
      .forEach((edge, i, all) => {
        const isLast = i === all.length - 1;
        const isTaken = taken !== null && edge.from === taken.from && edge.to === here && edge.on === taken.outcome;
        const again = seen.has(edge.to);
        seen.add(edge.to);
        const row: Span[] = [{ text: `${indent}${isLast ? "└" : "├"}`, style: "edge" }];
        if (edge.label) row.push({ text: "─ ", style: isTaken ? "taken" : "edge" }, { text: edge.label, style: isTaken ? "taken-label" : "label" }, { text: " ─▶ ", style: isTaken ? "taken" : "edge" });
        else row.push({ text: "─▶ ", style: isTaken ? "taken" : "edge" });
        out.push([...row, ...nodeSpans(edge.to, again)]);
        if (!again) walk(edge.to, `${indent}${isLast ? "    " : "│   "}`);
      });
  };
  const roots = graph.start ? [graph.start, ...graph.nodes] : graph.nodes;
  for (const root of roots) {
    if (seen.has(root)) continue;
    seen.add(root);
    out.push(nodeSpans(root, false));
    walk(root, "");
  }
  return out;
}

/** The dot drawing as plain text, one line per row. */
export function plainText(rows: Span[][]): string {
  return rows.map((row) => row.map((span) => span.text).join("")).join("\n");
}
