import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as ts from "typescript";
import { getImageMetadata, getFileMetadata } from "../metadataUtils";
import { getProjectRootDir } from "../getProjectRootDir";
import { resolveInsideRoot } from "../safePath";

export type GalleryInsertion = {
  insertPosition: number;
  indentation: string;
  hasExistingEntries: boolean;
};

/**
 * Locate the third argument of c.define(modulePath, schema, RECORD) in the
 * referenced module file and return the insertion point for a new entry.
 */
export function findGalleryInsertionPoint(
  fileContent: string,
  fileName: string,
): GalleryInsertion | null {
  const sourceFile = ts.createSourceFile(
    fileName,
    fileContent,
    ts.ScriptTarget.Latest,
    true,
  );

  let result: GalleryInsertion | null = null;
  ts.forEachChild(sourceFile, function visit(node) {
    if (result) return;
    if (ts.isExportAssignment(node) && ts.isCallExpression(node.expression)) {
      result = extractFromCDefine(node.expression, sourceFile);
      if (result) return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "c" &&
      ts.isIdentifier(node.expression.name) &&
      node.expression.name.text === "define"
    ) {
      result = extractFromCDefine(node, sourceFile);
      if (result) return;
    }
    ts.forEachChild(node, visit);
  });
  return result;
}

function extractFromCDefine(
  callExpression: ts.CallExpression,
  sourceFile: ts.SourceFile,
): GalleryInsertion | null {
  if (
    !ts.isPropertyAccessExpression(callExpression.expression) ||
    !ts.isIdentifier(callExpression.expression.expression) ||
    callExpression.expression.expression.text !== "c" ||
    !ts.isIdentifier(callExpression.expression.name) ||
    callExpression.expression.name.text !== "define"
  ) {
    return null;
  }
  const third = callExpression.arguments[2];
  if (!third || !ts.isObjectLiteralExpression(third)) {
    return null;
  }
  if (third.properties.length === 0) {
    const openBracePos = third.getStart(sourceFile) + 1;
    return {
      insertPosition: openBracePos,
      indentation: "  ",
      hasExistingEntries: false,
    };
  }
  const lastProp = third.properties[third.properties.length - 1];
  const firstProp = third.properties[0];
  const firstPropStart = sourceFile.getLineAndCharacterOfPosition(
    firstProp.getStart(sourceFile),
  );
  return {
    insertPosition: lastProp.getEnd(),
    indentation: " ".repeat(firstPropStart.character),
    hasExistingEntries: true,
  };
}

/**
 * Build the source text for a new entry in the gallery record. Per product
 * decision, alt is omitted even if the gallery schema requires it — the user
 * will be prompted by a separate validation error to fill it in.
 */
export function generateGalleryEntryText(args: {
  filePath: string;
  indentation: string;
  hasExistingEntries: boolean;
  metadata: Record<string, string | number>;
}): string {
  const { filePath, indentation, hasExistingEntries, metadata } = args;
  const entries = Object.entries(metadata)
    .map(([key, value]) => {
      const v =
        typeof value === "number"
          ? value.toString()
          : JSON.stringify(value);
      return `${indentation}  ${key}: ${v}`;
    })
    .join(",\n");
  const body = `${JSON.stringify(filePath)}: {\n${entries},\n${indentation}}`;
  if (hasExistingEntries) {
    return `,\n${indentation}${body}`;
  }
  return `\n${indentation}${body},\n${indentation.slice(2) || ""}`;
}

/**
 * Strip alt from metadata. Per user decision, alt is not auto-inserted.
 */
function stripAlt(
  metadata: Record<string, string | number>,
): Record<string, string | number> {
  const { alt: _alt, ...rest } = metadata as { alt?: unknown } & Record<
    string,
    string | number
  >;
  return rest;
}

export const addToMediaGalleryCommand = async (args: {
  uri: vscode.Uri;
  data: {
    path: string;
    referencedModuleFilePath: string;
    mediaType?: "files" | "images";
  };
}) => {
  if (!args || !args.uri || !args.data) {
    vscode.window.showErrorMessage(
      "Invalid arguments provided to addToMediaGalleryCommand",
    );
    return;
  }
  const { uri, data } = args;
  const valRoot = getProjectRootDir(uri);
  if (!valRoot) {
    vscode.window.showErrorMessage(
      "Could not determine the Val project root for this file.",
    );
    return;
  }

  const dataPathAbs = resolveInsideRoot(valRoot, data.path);
  if (!dataPathAbs) {
    vscode.window.showErrorMessage(
      `Media path escapes the Val project root: ${data.path}`,
    );
    return;
  }

  const referencedAbsPath = resolveInsideRoot(
    valRoot,
    data.referencedModuleFilePath,
  );
  if (!referencedAbsPath) {
    vscode.window.showErrorMessage(
      `Referenced gallery module path escapes the Val project root: ${data.referencedModuleFilePath}`,
    );
    return;
  }
  if (!fs.existsSync(referencedAbsPath)) {
    vscode.window.showErrorMessage(
      `Referenced gallery module not found on disk: ${referencedAbsPath}`,
    );
    return;
  }

  const referencedUri = vscode.Uri.file(referencedAbsPath);
  const referencedDoc = await vscode.workspace.openTextDocument(referencedUri);
  const referencedContent = referencedDoc.getText();

  const mediaType = data.mediaType ?? "images";
  const rawMetadata =
    mediaType === "images"
      ? getImageMetadata(data.path, uri)
      : getFileMetadata(data.path, uri);
  const metadata = stripAlt(rawMetadata as Record<string, string | number>);
  if (Object.keys(metadata).length === 0) {
    vscode.window.showErrorMessage(
      `Could not read metadata for ${data.path}. Make sure the file exists at ${dataPathAbs}.`,
    );
    return;
  }

  const insertion = findGalleryInsertionPoint(
    referencedContent,
    referencedAbsPath,
  );
  if (!insertion) {
    vscode.window.showErrorMessage(
      `Could not locate c.define(...) record in ${data.referencedModuleFilePath}. The file does not appear to be a Val media gallery module.`,
    );
    return;
  }

  const insertText = generateGalleryEntryText({
    filePath: data.path,
    indentation: insertion.indentation,
    hasExistingEntries: insertion.hasExistingEntries,
    metadata,
  });

  const edit = new vscode.WorkspaceEdit();
  const position = referencedDoc.positionAt(insertion.insertPosition);
  edit.insert(referencedUri, position, insertText);

  const success = await vscode.workspace.applyEdit(edit);
  if (!success) {
    vscode.window.showErrorMessage(
      `Failed to add ${data.path} to gallery ${data.referencedModuleFilePath}`,
    );
    return;
  }
  await referencedDoc.save();
  vscode.window.showInformationMessage(
    `Added ${data.path} to gallery ${data.referencedModuleFilePath}`,
  );
};
