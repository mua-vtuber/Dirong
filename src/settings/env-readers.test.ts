import assert from "node:assert/strict";
import test from "node:test";
import {
  readBooleanEnv,
  readNonNegativeNumberEnv,
  readOptionalStringEnv,
  readPositiveNumberEnv,
} from "./env-readers.js";

test("readOptionalStringEnv trims values and returns null for blanks", () => {
  assert.equal(readOptionalStringEnv({ DIRONG_KEY: " value " }, "DIRONG_KEY"), "value");
  assert.equal(readOptionalStringEnv({ DIRONG_KEY: "   " }, "DIRONG_KEY"), null);
  assert.equal(readOptionalStringEnv({}, "DIRONG_KEY"), null);
});

test("readBooleanEnv accepts common boolean spellings", () => {
  assert.equal(readBooleanEnv({ DIRONG_KEY: "yes" }, "DIRONG_KEY", false), true);
  assert.equal(readBooleanEnv({ DIRONG_KEY: "0" }, "DIRONG_KEY", true), false);
  assert.equal(readBooleanEnv({}, "DIRONG_KEY", true), true);
});

test("readBooleanEnv falls back and reports invalid values", () => {
  const invalidValues: string[] = [];

  const value = readBooleanEnv({ DIRONG_KEY: "maybe" }, "DIRONG_KEY", true, {
    onInvalid: (raw) => invalidValues.push(raw),
  });

  assert.equal(value, true);
  assert.deepEqual(invalidValues, ["maybe"]);
});

test("readPositiveNumberEnv reads positive numbers and can require integers", () => {
  assert.equal(readPositiveNumberEnv({ DIRONG_KEY: "1.5" }, "DIRONG_KEY", 1), 1.5);
  assert.equal(
    readPositiveNumberEnv(
      { DIRONG_KEY: "2" },
      "DIRONG_KEY",
      1,
      { integer: true },
    ),
    2,
  );
  assert.throws(
    () =>
      readPositiveNumberEnv(
        { DIRONG_KEY: "1.5" },
        "DIRONG_KEY",
        1,
        { integer: true },
      ),
    /1 이상의 숫자/,
  );
});

test("readNonNegativeNumberEnv accepts zero and rejects negatives", () => {
  assert.equal(readNonNegativeNumberEnv({ DIRONG_KEY: "0" }, "DIRONG_KEY", 1), 0);
  assert.throws(
    () => readNonNegativeNumberEnv({ DIRONG_KEY: "-1" }, "DIRONG_KEY", 1),
    /0 이상의 숫자/,
  );
});
