import { test } from "node:test";
import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { parseArgs } from "../lib/cli.js";

test("parseArgs: defaults", () => {
  deepStrictEqual(parseArgs([]), {
    input: undefined,
    output: undefined,
    verbose: false,
    split: false,
    mode: "html",
  });
});

test("parseArgs: --probe sets mode to probe", () => {
  strictEqual(parseArgs(["--probe"]).mode, "probe");
});

test("parseArgs: --inject sets mode to inject", () => {
  strictEqual(parseArgs(["--inject"]).mode, "inject");
});

test("parseArgs: --inject-dry-run sets mode to inject-dry-run", () => {
  strictEqual(parseArgs(["--inject-dry-run"]).mode, "inject-dry-run");
});

test("parseArgs: --probe + --inject is a conflict", () => {
  throws(() => parseArgs(["--probe", "--inject"]), /mutually exclusive/);
});

test("parseArgs: --split + --inject is a conflict", () => {
  throws(() => parseArgs(["--split", "--inject"]), /split.*only applies/i);
});

test("parseArgs: --output combines with --inject", () => {
  const args = parseArgs(["--inject", "--output", "x.js"]);
  strictEqual(args.mode, "inject");
  strictEqual(args.output, "x.js");
});
