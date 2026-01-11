import assert from "assert";
import ts from "typescript";
import { detectCompletionContext, isValFile } from "./completionContext";

describe("completionContext", () => {
  describe("isValFile", () => {
    it("should return true for .val.ts files", () => {
      assert.strictEqual(isValFile("/path/to/test.val.ts"), true);
    });

    it("should return true for .val.js files", () => {
      assert.strictEqual(isValFile("/path/to/test.val.js"), true);
    });

    it("should return false for regular .ts files", () => {
      assert.strictEqual(isValFile("/path/to/test.ts"), false);
    });

    it("should return false for other files", () => {
      assert.strictEqual(isValFile("/path/to/test.js"), false);
    });
  });

  describe("detectCompletionContext", () => {
    it("should detect unknown-string context in c.define content object", () => {
      const code = `export default c.define("/test.val.ts", s.object({route: s.route()}), {route: "/main"});`;
      const sourceFile = ts.createSourceFile(
        "test.val.ts",
        code,
        ts.ScriptTarget.Latest,
        true
      );

      // Position inside the "/main" string in the content object
      // Find where "/main" starts and position cursor inside it
      const mainIndex = code.indexOf('"/main"');
      const context = detectCompletionContext(sourceFile, {
        line: 0,
        character: mainIndex + 3, // Inside "/main" after "/ma"
      });

      assert.strictEqual(context.type, "unknown-string");
      assert.strictEqual(context.modulePath, "/test.val.ts");
      assert.ok(context.partialText?.startsWith("/m"));
    });

    it("should NOT detect route context in c.define path argument", () => {
      const code = `export default c.define("/test.val.ts", s.object({}), {});`;
      const sourceFile = ts.createSourceFile(
        "test.val.ts",
        code,
        ts.ScriptTarget.Latest,
        true
      );

      // Position inside the "/test.val.ts" string (first argument)
      const context = detectCompletionContext(sourceFile, {
        line: 0,
        character: 28,
      });

      // Should NOT be route context since it's the first argument (path), not content
      assert.strictEqual(context.type, "none");
    });

    it("should detect c.image context in c.image first argument", () => {
      const code = `const img = c.image("/path/to/image.png", { width: 100 });`;
      const sourceFile = ts.createSourceFile(
        "test.val.ts",
        code,
        ts.ScriptTarget.Latest,
        true
      );

      // Position inside the "/path/to/image.png" string
      // The string starts at 24, so 30 is after "/path/" (24=", 25=/, 26=p, 27=a, 28=t, 29=h, 30=/)
      const context = detectCompletionContext(sourceFile, {
        line: 0,
        character: 30,
      });

      assert.strictEqual(context.type, "c.image");
      assert.ok(context.partialText?.startsWith("/path"));
    });

    it("should detect c.file context in c.file first argument", () => {
      const code = `const file = c.file("/path/to/file.pdf");`;
      const sourceFile = ts.createSourceFile(
        "test.val.ts",
        code,
        ts.ScriptTarget.Latest,
        true
      );

      // Position inside the "/path/to/file.pdf" string
      const context = detectCompletionContext(sourceFile, {
        line: 0,
        character: 25,
      });

      assert.strictEqual(context.type, "c.file");
    });

    it("should return none context outside of special functions", () => {
      const code = `const text = "some string";`;
      const sourceFile = ts.createSourceFile(
        "test.val.ts",
        code,
        ts.ScriptTarget.Latest,
        true
      );

      // Position inside a regular string
      const context = detectCompletionContext(sourceFile, {
        line: 0,
        character: 20,
      });

      assert.strictEqual(context.type, "none");
    });

    it("should return none context when not in a string", () => {
      const code = `export default c.define("/route", schema, { title: "Test" });`;
      const sourceFile = ts.createSourceFile(
        "test.val.ts",
        code,
        ts.ScriptTarget.Latest,
        true
      );

      // Position outside of any string (line 0, character 10 = after "default ")
      const context = detectCompletionContext(sourceFile, {
        line: 0,
        character: 10,
      });

      assert.strictEqual(context.type, "none");
    });

    it("should not detect router context in second argument of c.define", () => {
      const code = `export default c.define("/route", "schema", { title: "Test" });`;
      const sourceFile = ts.createSourceFile(
        "test.val.ts",
        code,
        ts.ScriptTarget.Latest,
        true
      );

      // Position in the second argument (the "schema" string)
      const context = detectCompletionContext(sourceFile, {
        line: 0,
        character: 40,
      });

      // Should not be router context since it's not the first argument
      assert.strictEqual(context.type, "none");
    });
  });
});
