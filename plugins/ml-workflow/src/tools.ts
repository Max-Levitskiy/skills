// The tool names a Claude step may list in `tools` (docs/spec.md, p.14): Claude Code's built-in
// tools, from its tools reference, and MCP tools by their `mcp__<server>__<tool>` name. `Task`,
// `BashOutput` and `KillShell` are older names Claude Code still answers to.
const BUILT_IN = new Set([
  "Agent",
  "AskUserQuestion",
  "Bash",
  "BashOutput",
  "CronCreate",
  "CronDelete",
  "CronList",
  "Edit",
  "EnterPlanMode",
  "EnterWorktree",
  "ExitPlanMode",
  "ExitWorktree",
  "Glob",
  "Grep",
  "KillShell",
  "LSP",
  "ListMcpResourcesTool",
  "Monitor",
  "NotebookEdit",
  "PowerShell",
  "Read",
  "ReadMcpResourceTool",
  "SendMessage",
  "Skill",
  "Task",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskOutput",
  "TaskStop",
  "TaskUpdate",
  "TeamCreate",
  "TeamDelete",
  "TodoWrite",
  "ToolSearch",
  "WebFetch",
  "WebSearch",
  "Write",
]);

const MCP_TOOL = /^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$/;

export function isToolName(name: string): boolean {
  return BUILT_IN.has(name) || MCP_TOOL.test(name);
}
