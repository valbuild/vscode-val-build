import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as ts from "typescript";

// Exported helper functions for testing
export function calculateRelativePath(
  valModulesFile: string,
  filePath: string,
): string {
  return path
    .relative(path.dirname(valModulesFile), filePath)
    .replace(/\\/g, "/")
    .replace(/\.val\.ts$/, ".val");
}

export function findInsertionPoint(
  valModulesContent: string,
  valModulesFile: string,
): {
  insertPosition: number | null;
  indentation: string;
} {
  const sourceFile = ts.createSourceFile(
    valModulesFile,
    valModulesContent,
    ts.ScriptTarget.Latest,
    true,
  );

  let insertPosition: number | null = null;
  let indentation = "  "; // Default indentation (2 spaces)

  // Find the modules array in modules(config, [...])
  ts.forEachChild(sourceFile, function visit(node) {
    if (ts.isCallExpression(node)) {
      // Check if this is a call to "modules" function
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "modules" &&
        node.arguments.length >= 2
      ) {
        // Second argument should be the array
        const secondArg = node.arguments[1];
        if (ts.isArrayLiteralExpression(secondArg)) {
          // Find the last element in the array
          if (secondArg.elements.length > 0) {
            const lastElement =
              secondArg.elements[secondArg.elements.length - 1];
            insertPosition = lastElement.end;

            // Detect indentation from the first element
            const firstElement = secondArg.elements[0];
            const firstElementPos = sourceFile.getLineAndCharacterOfPosition(
              firstElement.getStart(sourceFile),
            );
            indentation = " ".repeat(firstElementPos.character);
          } else {
            // Empty array - insert at array start
            insertPosition = secondArg.getStart(sourceFile) + 1; // After the '['
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  });

  return { insertPosition, indentation };
}

export function generateInsertText(
  relativePath: string,
  indentation: string,
  hasExistingElements: boolean,
): string {
  const importStatement = `{ def: () => import("./${relativePath}") }`;
  return hasExistingElements
    ? `,\n${indentation}${importStatement}`
    : `\n${indentation}${importStatement}\n${indentation.slice(2)}`;
}

export const addModuleToValModulesCommand = async (args: {
  filePath: string;
  valRoot: string;
  valModulesFile: string;
}) => {
  console.log("Add module to val.modules command called with arguments:", args);

  if (!args || !args.filePath || !args.valRoot || !args.valModulesFile) {
    vscode.window.showErrorMessage(
      "Invalid arguments provided to addModuleToValModulesCommand",
    );
    return;
  }

  const { filePath, valRoot, valModulesFile } = args;

  try {
    // Read the val.modules file
    const valModulesContent = fs.readFileSync(valModulesFile, "utf-8");

    // Calculate relative path using helper
    const relativePath = calculateRelativePath(valModulesFile, filePath);

    // Find insertion point using helper
    const { insertPosition, indentation } = findInsertionPoint(
      valModulesContent,
      valModulesFile,
    );

    if (insertPosition === null) {
      vscode.window.showErrorMessage(
        "Could not find modules array in val.modules file",
      );
      return;
    }

    // Generate insert text using helper
    const hasElements = valModulesContent.includes("import(");
    const newText = generateInsertText(relativePath, indentation, hasElements);

    // Create the edit
    const edit = new vscode.WorkspaceEdit();
    const valModulesUri = vscode.Uri.file(valModulesFile);
    const valModulesDocument =
      await vscode.workspace.openTextDocument(valModulesUri);
    const position = valModulesDocument.positionAt(insertPosition);

    edit.insert(valModulesUri, position, newText);

    // Apply the edit
    const success = await vscode.workspace.applyEdit(edit);

    if (success) {
      vscode.window.showInformationMessage(
        `Added module ${path.basename(filePath)} to val.modules`,
      );
      // Save the file
      const doc = await vscode.workspace.openTextDocument(valModulesUri);
      await doc.save();
    } else {
      vscode.window.showErrorMessage("Failed to add module to val.modules");
    }
  } catch (error) {
    console.error("Error adding module to val.modules:", error);
    vscode.window.showErrorMessage(
      `Failed to add module to val.modules: ${error.message}`,
    );
  }
};
