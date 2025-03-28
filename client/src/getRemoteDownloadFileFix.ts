import * as ts from "typescript";
import { type Internal as InternalCoreFn } from "@valbuild/core";
import { getFileExt } from "./getFileExt";

export function getRemoteDownloadFileFix(
  Internal: typeof InternalCoreFn,
  newType: "image" | "file",
  sourceFile: ts.SourceFile
): {
  newNodeText: string;
  newLocalFilePath: string;
  foundRemoteRef: string;
} | null {
  let newCallExpression: ts.CallExpression;
  let foundRemoteRef: string | null = null;
  let newLocalFilePath: string | null = null;
  const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (
    context
  ) => {
    return (sourceFile) => {
      const visitor = (node: ts.Node): ts.Node => {
        if (newCallExpression) {
          return node;
        }
        if (ts.isCallExpression(node)) {
          if (ts.isPropertyAccessExpression(node.expression)) {
            const remoteRefNode = node.arguments[0];
            const cExprName = node.expression.name.getText();
            if (
              ts.isStringLiteral(remoteRefNode) &&
              node.expression.expression.getText() === "c" &&
              cExprName === "remote"
            ) {
              foundRemoteRef = remoteRefNode.text;
              const newPropertyAccessExpression =
                ts.factory.updatePropertyAccessExpression(
                  node.expression,
                  node.expression.expression,
                  ts.factory.createIdentifier(newType)
                );
              const metadataExpr = node.arguments[1];
              if (!ts.isObjectLiteralExpression(metadataExpr)) {
                return;
              }
              const splitRemoteRefDataRes =
                Internal.remote.splitRemoteRef(foundRemoteRef);
              if (splitRemoteRefDataRes.status !== "success") {
                return;
              }
              const { filePath, fileHash } = splitRemoteRefDataRes;
              const fileExt = getFileExt(filePath);
              const shortFileHash = fileHash.slice(0, 5);
              newLocalFilePath = filePath;
              if (!filePath.endsWith("_" + shortFileHash + "." + fileExt)) {
                newLocalFilePath = `${filePath.slice(
                  0,
                  -`.${fileExt}`.length
                )}_${shortFileHash}.${fileExt}`;
              }
              newCallExpression = ts.factory.updateCallExpression(
                node,
                newPropertyAccessExpression,
                undefined,
                [
                  ts.factory.createStringLiteral(`/${newLocalFilePath}`),
                  metadataExpr,
                ]
              );
              return newCallExpression;
            }
          }
        }
        return ts.visitEachChild(node, visitor, context);
      };
      return ts.visitNode(sourceFile, visitor) as ts.SourceFile;
    };
  };
  const printer = ts.createPrinter();
  const result = ts.transform(sourceFile, [transformerFactory]);
  if (newCallExpression) {
    let newNodeText = printer
      .printNode(
        ts.EmitHint.Unspecified,
        result.transformed[0],
        result.transformed[0]
      )
      .trim();
    newNodeText =
      newNodeText && newNodeText.slice(-1) === ";"
        ? newNodeText.slice(0, -1) // trim trailing semicolon if exists (seems to be the case?)
        : newNodeText;
    if (newLocalFilePath !== null && foundRemoteRef !== null) {
      return {
        newNodeText,
        newLocalFilePath,
        foundRemoteRef,
      };
    }
  }
  return null;
}
