import fs from "fs";
import path from "path";
import ts from "typescript";

/**
 * Helper function to check if a file path is in val.modules by checking the AST
 * This checks the actual import statements in the val.modules file
 */
export function isFileInValModulesAST(
  filePath: string,
  valRoot: string,
  valModulesFile: string
): boolean {
  try {
    const valModulesContent = fs.readFileSync(valModulesFile, "utf-8");
    const relativePath = path
      .relative(path.dirname(valModulesFile), filePath)
      .replace(/\\/g, "/")
      .replace(/\.val\.ts$/, ".val")
      .replace(/\.val\.js$/, ".val");

    // Parse the val.modules file to find the modules array
    const sourceFile = ts.createSourceFile(
      valModulesFile,
      valModulesContent,
      ts.ScriptTarget.Latest,
      true
    );

    let foundImport = false;

    // Helper to check if a node contains an import call with the target path
    function checkImportCall(node: ts.Node): boolean {
      if (ts.isCallExpression(node)) {
        const importExpr = node.expression;
        // Check for dynamic import: import("./path")
        // The expression kind is ImportKeyword for dynamic imports
        if (
          importExpr.kind === ts.SyntaxKind.ImportKeyword &&
          node.arguments.length > 0
        ) {
          const importArg = node.arguments[0];
          if (ts.isStringLiteral(importArg)) {
            const importPath = importArg.text;
            // Normalize the import path (remove leading ./)
            const normalizedImportPath = importPath.replace(/^\.\//, "");
            const normalizedRelativePath = relativePath.replace(/^\.\//, "");

            if (normalizedImportPath === normalizedRelativePath) {
              return true;
            }
          }
        }
      }
      return false;
    }

    // Find the modules array - supports both formats:
    // 1. config.modules([...])
    // 2. modules(config, [...])
    ts.forEachChild(sourceFile, function visit(node) {
      if (ts.isCallExpression(node)) {
        // Check for config.modules([...]) or modules(config, [...])
        let arrayArg: ts.Expression | undefined;

        if (
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "modules" &&
          node.arguments.length > 0
        ) {
          // config.modules([...])
          arrayArg = node.arguments[0];
        } else if (
          ts.isIdentifier(node.expression) &&
          node.expression.text === "modules" &&
          node.arguments.length >= 2
        ) {
          // modules(config, [...])
          arrayArg = node.arguments[1];
        }

        if (arrayArg && ts.isArrayLiteralExpression(arrayArg)) {
          // Check each element in the array
          for (const element of arrayArg.elements) {
            // Check for direct import: import("./path/to/file.val")
            if (checkImportCall(element)) {
              foundImport = true;
              return;
            }

            // Check for object with def property: { def: () => import("...") }
            if (ts.isObjectLiteralExpression(element)) {
              for (const prop of element.properties) {
                if (
                  ts.isPropertyAssignment(prop) &&
                  ts.isIdentifier(prop.name) &&
                  prop.name.text === "def"
                ) {
                  // Check if it's an arrow function
                  if (ts.isArrowFunction(prop.initializer)) {
                    const body = prop.initializer.body;
                    // Check if the body is an import call
                    if (checkImportCall(body)) {
                      foundImport = true;
                      return;
                    }
                  }
                }
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    });

    return foundImport;
  } catch (error) {
    console.error("Error checking if file is in val.modules AST:", error);
    return false;
  }
}
