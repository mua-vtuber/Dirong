import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCliArgs,
  readPositiveIntegerArg,
  readRequiredStringArg,
} from "./arg-parser.js";

test("parseCliArgs applies boolean and value flags in order", () => {
  const options = parseCliArgs(
    ["--debug", "--limit", "2", "--limit", "3"],
    { debug: false, limit: 1 },
    {
      "--debug": {
        kind: "boolean",
        apply: (target) => {
          target.debug = true;
        },
      },
      "--limit": {
        kind: "value",
        read: readPositiveIntegerArg,
        apply: (target, value) => {
          target.limit = value;
        },
      },
    },
    (flag) => `unknown ${flag}`,
  );

  assert.deepEqual(options, { debug: true, limit: 3 });
});

test("parseCliArgs reports unknown flags through the caller message", () => {
  assert.throws(
    () => parseCliArgs(["--bad"], {}, {}, (flag) => `unknown ${flag}`),
    /unknown --bad/,
  );
});

test("readRequiredStringArg rejects missing or blank values", () => {
  assert.equal(readRequiredStringArg(" value ", "--value required"), "value");
  assert.throws(() => readRequiredStringArg(undefined, "--value required"), /required/);
  assert.throws(() => readRequiredStringArg("   ", "--value required"), /required/);
});
