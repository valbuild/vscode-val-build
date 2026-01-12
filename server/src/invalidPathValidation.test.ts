import assert from "assert";
import ts from "typescript";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node";

describe("Invalid Path Validation", () => {
  function validatePaths(code: string): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const sourceFile = ts.createSourceFile(
      "test.val.ts",
      code,
      ts.ScriptTarget.ES2015,
      true
    );

    function checkInvalidPaths(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        const obj = node.expression.expression;
        const method = node.expression.name;

        if (
          ts.isIdentifier(obj) &&
          obj.text === "c" &&
          ts.isIdentifier(method) &&
          (method.text === "image" || method.text === "file")
        ) {
          const firstArg = node.arguments[0];
          if (firstArg && ts.isStringLiteral(firstArg)) {
            const pathValue = firstArg.text;
            // Check if path is exactly "/public/val/" or ends with trailing slash (directory path)
            if (
              pathValue === "/public/val/" ||
              (pathValue.startsWith("/public/val/") && pathValue.endsWith("/"))
            ) {
              const start = sourceFile.getLineAndCharacterOfPosition(
                firstArg.getStart()
              );
              const end = sourceFile.getLineAndCharacterOfPosition(
                firstArg.getEnd()
              );

              const diagnostic: Diagnostic = {
                severity: DiagnosticSeverity.Error,
                range: {
                  start: { line: start.line, character: start.character },
                  end: { line: end.line, character: end.character },
                },
                code: "invalid-path",
                message: `Path "${pathValue}" is a directory path. You must provide a path to a specific file (e.g., "/public/val/image.png")`,
                source: "val",
              };
              diagnostics.push(diagnostic);
            }
          }
        }
      }

      ts.forEachChild(node, checkInvalidPaths);
    }

    checkInvalidPaths(sourceFile);
    return diagnostics;
  }

  it("should report error for c.image with /public/val/ (directory path)", () => {
    const code = `
import { c, s } from "@valbuild/core";
export default c.define("/test.val.ts", s.image(), c.image("/public/val/"));
    `;

    const diagnostics = validatePaths(code);

    assert.strictEqual(
      diagnostics.length,
      1,
      "Should have one diagnostic for directory path"
    );
    assert.strictEqual(diagnostics[0].code, "invalid-path");
    assert.ok(
      diagnostics[0].message.includes('"/public/val/"'),
      "Message should mention the path"
    );
    assert.ok(
      diagnostics[0].message.includes("directory path"),
      "Message should say it's a directory path"
    );
  });

  it("should report error for c.file with /public/val/ (directory path)", () => {
    const code = `
import { c, s } from "@valbuild/core";
export default c.define("/test.val.ts", s.file(), c.file("/public/val/"));
    `;

    const diagnostics = validatePaths(code);

    assert.strictEqual(
      diagnostics.length,
      1,
      "Should have one diagnostic for directory path"
    );
    assert.strictEqual(diagnostics[0].code, "invalid-path");
  });

  it("should report error for paths ending with trailing slash", () => {
    const code = `
import { c, s } from "@valbuild/core";
export default c.define("/test.val.ts", s.object({
  img1: s.image(),
  img2: s.image(),
}), {
  img1: c.image("/public/val/images/"),
  img2: c.image("/public/val/nested/deep/"),
});
    `;

    const diagnostics = validatePaths(code);

    assert.strictEqual(
      diagnostics.length,
      2,
      "Should have two diagnostics for both directory paths"
    );
    assert.ok(
      diagnostics[0].message.includes("/public/val/images/"),
      "First error should mention /public/val/images/"
    );
    assert.ok(
      diagnostics[1].message.includes("/public/val/nested/deep/"),
      "Second error should mention /public/val/nested/deep/"
    );
  });

  it("should NOT report error for valid file paths", () => {
    const code = `
import { c, s } from "@valbuild/core";
export default c.define("/test.val.ts", s.object({
  img1: s.image(),
  img2: s.image(),
  file1: s.file(),
}), {
  img1: c.image("/public/val/logo.png"),
  img2: c.image("/public/val/images/photo.jpg"),
  file1: c.file("/public/val/document.pdf"),
});
    `;

    const diagnostics = validatePaths(code);

    assert.strictEqual(
      diagnostics.length,
      0,
      "Should have no diagnostics for valid file paths"
    );
  });

  it("should NOT report error for empty strings", () => {
    const code = `
import { c, s } from "@valbuild/core";
export default c.define("/test.val.ts", s.image(), c.image(""));
    `;

    const diagnostics = validatePaths(code);

    assert.strictEqual(
      diagnostics.length,
      0,
      "Should have no diagnostics for empty string (user is still typing)"
    );
  });

  it("should NOT report error for paths without trailing slash", () => {
    const code = `
import { c, s } from "@valbuild/core";
export default c.define("/test.val.ts", s.image(), c.image("/public/val"));
    `;

    const diagnostics = validatePaths(code);

    assert.strictEqual(
      diagnostics.length,
      0,
      "Should have no diagnostics for /public/val without trailing slash (handled by Val core)"
    );
  });
});
