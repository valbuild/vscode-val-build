import assert from "assert";
import { levenshtein } from "./levenshtein";

describe("levenshtein", () => {
  it("should calculate distance between identical strings", () => {
    assert.strictEqual(levenshtein("hello", "hello"), 0);
  });

  it("should calculate distance for completely different strings", () => {
    assert.strictEqual(levenshtein("abc", "xyz"), 3);
  });

  it("should calculate distance for similar strings", () => {
    assert.strictEqual(levenshtein("kitten", "sitting"), 3);
  });

  it("should handle empty strings", () => {
    assert.strictEqual(levenshtein("", "test"), 4);
    assert.strictEqual(levenshtein("test", ""), 4);
    assert.strictEqual(levenshtein("", ""), 0);
  });
});
