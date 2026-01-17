import assert from "assert";
import { stackToLine } from "./stackToLine";

describe("stackToLine", () => {
  it("should return the first line of the stack", () => {
    const stack =
      "    at <anonymous> (/home/freekh/Code/blank/blankno-v2/web/content/aboutUs.val.ts:15)\n";
    assert.deepStrictEqual(
      stackToLine(
        "/home/freekh/Code/blank/blankno-v2/web/content/aboutUs.val.ts",
        stack,
      ),
      15,
    );
  });
});
