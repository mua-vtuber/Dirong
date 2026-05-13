import assert from "node:assert/strict";
import test from "node:test";
import {
  booleanArg,
  booleanOptionArg,
  parseCliArgs,
  positiveIntegerArg,
  positiveIntegerOptionArg,
  readRequiredStringArg,
  requiredStringArg,
  requiredStringOptionArg,
} from "./arg-parser.js";

test("parseCliArgs applies boolean and value flags in order", () => {
  const options = parseCliArgs(
    ["--debug", "--limit", "2", "--limit", "3"],
    { debug: false, limit: 1 },
    {
      "--debug": booleanArg((target) => {
        target.debug = true;
      }),
      "--limit": positiveIntegerArg((target, value) => {
        target.limit = value;
      }),
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

test("requiredStringArg applies trimmed values with caller messages", () => {
  const options = parseCliArgs(
    ["--name", "  Taniar  "],
    { name: "" },
    {
      "--name": requiredStringArg("--name required", (target, value) => {
        target.name = value;
      }),
    },
    (flag) => `unknown ${flag}`,
  );

  assert.deepEqual(options, { name: "Taniar" });
});

test("option arg helpers assign validated values by key", () => {
  const options = parseCliArgs(
    ["--debug", "--limit", "4", "--name", " dirong "],
    { debug: false, limit: 1, name: "" },
    {
      "--debug": booleanOptionArg("debug", true),
      "--limit": positiveIntegerOptionArg("limit"),
      "--name": requiredStringOptionArg("--name required", "name"),
    },
    (flag) => `unknown ${flag}`,
  );

  assert.deepEqual(options, { debug: true, limit: 4, name: "dirong" });
});
