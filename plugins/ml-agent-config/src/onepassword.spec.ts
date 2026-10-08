// The CLI's tests run under `bun test src`. They are `.spec.ts` because `claude plugin test` loads
// every `*.test.ts` in the plugin as a hooks module test, where `bun:test` and Node are not there.
//
// The 1Password listing runs a fake `op` from PATH: it checks what each call prints, and that a
// field's value, which `op item get` returns, never does.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as onePassword from "./onepassword";

const SECRET = "value-that-must-not-leak";
let dir: string;
let path: string | undefined;

const FAKE_OP = `#!/usr/bin/env bun
const args = process.argv.slice(2);
const at = (flag) => args[args.indexOf(flag) + 1];
const account = args.includes("--account") ? at("--account") : null;
// Written synchronously: process.exit would cut an asynchronous write to a pipe short.
const say = (value) => { require("fs").writeSync(1, JSON.stringify(value)); process.exit(0); };
if (args[0] === "account") say([
  { account_uuid: "A1", email: "me@example.com", url: "https://work.1password.com" },
  { account_uuid: "A2", email: "me@example.com", url: "https://my.1password.com" },
]);
if (args[0] === "item" && args[1] === "list" && account === "BIG") {
  say(Array.from({ length: 6000 }, (_, n) => ({ id: "I" + n, title: "Item " + n + " " + "x".repeat(200), category: "LOGIN", vault: { id: "V1", name: "Private" } })));
}
if (args[0] === "item" && args[1] === "list") {
  if (account === "A2") { process.stderr.write("locked"); process.exit(1); }
  say([
    { id: "I2", title: "Zed", category: "LOGIN", vault: { id: "V1", name: "Private" }, additional_information: "user" },
    { id: "I1", title: "Alpha", category: "API_CREDENTIAL", vault: { id: "V1", name: "Private" } },
  ]);
}
if (args[0] === "item" && args[1] === "get") say({ fields: [
  { id: "username", label: "username", type: "STRING", value: "me", reference: "op://V1/I1/username" },
  { id: "credential", label: "credential", type: "CONCEALED", value: "${SECRET}", reference: "op://V1/I1/credential", section: { label: "API" } },
  { id: "notesPlain", type: "STRING", value: "no reference" },
] });
process.exit(2);
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "op-fake-"));
  writeFileSync(join(dir, "op"), FAKE_OP);
  chmodSync(join(dir, "op"), 0o755);
  path = process.env.PATH;
  process.env.PATH = `${dir}:${path}`;
});

afterAll(() => {
  process.env.PATH = path;
  rmSync(dir, { recursive: true, force: true });
});

describe("1Password listing", () => {
  test("a short account name from the sign-in address, the email on my.1password.com", () => {
    expect(onePassword.accounts().map((one) => one.short)).toEqual(["work", "me@example.com"]);
  });

  test("every account's items, sorted, with a refusing account reported and the rest listed", () => {
    const found = onePassword.everything();
    expect(found.items.map((item) => item.title)).toEqual(["Alpha", "Zed"]);
    expect(found.items[0]).toEqual({ id: "I1", title: "Alpha", category: "API_CREDENTIAL", vault: { id: "V1", name: "Private" }, account: "A1" });
    expect(found.problems).toHaveLength(1);
    expect(found.problems[0]).toContain("locked");
  });

  test("a listing past the default 1 MB of output still reads", () => {
    expect(onePassword.everything("BIG").items).toHaveLength(6000);
  });

  test("one vault with no account is looked for in every account, by id or name", () => {
    const byName = onePassword.vaultItems("Private");
    expect(byName.items.map((item) => item.title)).toEqual(["Alpha", "Zed"]);
    expect(byName.problems).toHaveLength(1);
    expect(onePassword.vaultItems("V1").items).toHaveLength(2);
    expect(onePassword.vaultItems("Elsewhere").items).toEqual([]);
  });

  test("one account that refuses is an error", () => {
    expect(() => onePassword.everything("A2")).toThrow("locked");
  });

  test("fields carry their reference and never their value", () => {
    const fields = onePassword.fields("V1", "I1");
    expect(fields.map((field) => field.reference)).toEqual(["op://V1/I1/username", "op://V1/I1/credential"]);
    expect(fields[1]!.section).toBe("API");
    expect(JSON.stringify(fields)).not.toContain(SECRET);
  });
});
