import assert from "assert";
import { findSimilar } from "./findSimilar";

describe("findSimilar", () => {
  it("should find and sort similar strings by distance", () => {
    const result = findSimilar("/my-slug", [
      "/my-slug",
      "/my-slg",
      "/another-slug",
      "/completely-different",
    ]);

    assert.strictEqual(result[0].target, "/my-slug");
    assert.strictEqual(result[0].distance, 0);
    assert.strictEqual(result[1].target, "/my-slg");
    assert.ok(result[1].distance < result[2].distance);
  });

  it("should return empty array for empty targets", () => {
    const result = findSimilar("/my-slug", []);
    assert.strictEqual(result.length, 0);
  });

  it("should handle single target", () => {
    const result = findSimilar("test", ["test"]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].target, "test");
    assert.strictEqual(result[0].distance, 0);
  });

  it("should sort by increasing distance", () => {
    const result = findSimilar("abc", ["xyz", "xbc", "abc", "aaa"]);
    
    // abc -> abc = 0
    assert.strictEqual(result[0].target, "abc");
    assert.strictEqual(result[0].distance, 0);
    
    // Verify distances are increasing
    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i].distance >= result[i - 1].distance);
    }
  });
});
