import * as vscode from "vscode";
import * as ts from "typescript";

export type RemoveGalleryEntryArgs = {
  uri: vscode.Uri;
  data: {
    path: string;
  };
};

/**
 * Locate the property assignment in the c.define(modulePath, schema, RECORD)
 * content object whose key matches `key`.
 */
export function findGalleryProperty(
  fileContent: string,
  fileName: string,
  key: string,
): ts.PropertyAssignment | undefined {
  const sourceFile = ts.createSourceFile(
    fileName,
    fileContent,
    ts.ScriptTarget.Latest,
    true,
  );

  let found: ts.PropertyAssignment | undefined;
  ts.forEachChild(sourceFile, function visit(node) {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "c" &&
      ts.isIdentifier(node.expression.name) &&
      node.expression.name.text === "define"
    ) {
      const third = node.arguments[2];
      if (third && ts.isObjectLiteralExpression(third)) {
        for (const prop of third.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            (ts.isStringLiteral(prop.name) || ts.isIdentifier(prop.name)) &&
            prop.name.text === key
          ) {
            found = prop;
            return;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  });
  return found;
}

/**
 * Compute the source range [start, end) to delete in order to remove a gallery
 * entry cleanly, including its leading trivia (newline + indentation) and a
 * trailing comma if present.
 */
export function getEntryRemovalRange(
  fileContent: string,
  fileName: string,
  key: string,
): { start: number; end: number } | undefined {
  const property = findGalleryProperty(fileContent, fileName, key);
  if (!property) {
    return undefined;
  }
  // getFullStart() includes the leading whitespace/newline before the property
  // (i.e. starts right after the previous `,` or the opening `{`).
  const start = property.getFullStart();
  let end = property.getEnd();
  const trailing = fileContent.slice(end);
  const commaMatch = trailing.match(/^\s*,/);
  if (commaMatch) {
    end += commaMatch[0].length;
  }
  return { start, end };
}

export const removeGalleryEntryCommand = async (
  args: RemoveGalleryEntryArgs,
) => {
  if (!args || !args.uri || !args.data || !args.data.path) {
    vscode.window.showErrorMessage(
      "Invalid arguments provided to removeGalleryEntryCommand",
    );
    return;
  }
  const { uri, data } = args;

  const document = await vscode.workspace.openTextDocument(uri);
  const content = document.getText();

  const range = getEntryRemovalRange(content, uri.fsPath, data.path);
  if (!range) {
    vscode.window.showErrorMessage(
      `Could not find "${data.path}" in the gallery.`,
    );
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  edit.delete(
    uri,
    new vscode.Range(
      document.positionAt(range.start),
      document.positionAt(range.end),
    ),
  );
  const success = await vscode.workspace.applyEdit(edit);
  if (!success) {
    vscode.window.showErrorMessage(
      `Failed to remove ${data.path} from the gallery.`,
    );
    return;
  }
  await document.save();
  vscode.window.showInformationMessage(
    `Removed ${data.path} from the gallery.`,
  );
};
