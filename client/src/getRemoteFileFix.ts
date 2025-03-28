import * as ts from "typescript";
import { type Internal as InternalCoreFn } from "@valbuild/core";
import { VAL_REMOTE_HOST } from "./envConstants";

export function getRemoteFileFix(
  Internal: typeof InternalCoreFn,
  bucket: string,
  coreVersion: string,
  validationHash: string,
  publicProjectId: string,
  sourceFile: ts.SourceFile,
  getMetadata: (filename: string) => Record<string, string | number>,
  getBuffer: (filename: string) => Buffer
) {
  let newCallExpression: ts.CallExpression;
  let foundExpressionType: "image" | "file" | null = null;
  let foundFilename: string | null = null;
  let ref: string | null = null;
  let fileBuffer: Buffer;
  let fileHash: string;
  let filePath: `public/val/${string}` | null = null;
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
            const filenameNode = node.arguments[0];
            const cExprName = node.expression.name.getText();
            if (
              ts.isStringLiteral(filenameNode) &&
              node.expression.expression.getText() === "c" &&
              (cExprName === "image" || cExprName === "file")
            ) {
              foundExpressionType = cExprName;
              foundFilename = filenameNode.text;
              // We always recreate metadata: this way we do not have to check what is there and besides it probably is just as well?
              const metadata: Record<string, string | number> =
                getMetadata(foundFilename);

              fileBuffer = getBuffer(foundFilename);
              fileHash = Internal.remote.getFileHash(fileBuffer);
              filePath = foundFilename.slice(1) as `public/val/${string}`;
              ref = Internal.remote.createRemoteRef(VAL_REMOTE_HOST, {
                bucket,
                coreVersion,
                fileHash,
                filePath,
                validationHash,
                publicProjectId,
              });
              const newPropertyAccessExpression =
                ts.factory.updatePropertyAccessExpression(
                  node.expression,
                  node.expression.expression,
                  ts.factory.createIdentifier("remote")
                );
              const prevMetadataExpr = node.arguments[1];
              if (!ts.isObjectLiteralExpression(prevMetadataExpr)) {
                return;
              }

              const prevProps = new Map<string, ts.PropertyAssignment>();

              for (const prop of prevMetadataExpr.properties) {
                if (
                  ts.isPropertyAssignment(prop) &&
                  ts.isIdentifier(prop.name)
                ) {
                  prevProps.set(prop.name.text, prop);
                }
              }
              // Merge in the new metadata, overriding any existing keys
              for (const [key, value] of Object.entries(metadata)) {
                const newValue =
                  typeof value === "number"
                    ? value < 0
                      ? ts.factory.createPrefixUnaryExpression(
                          ts.SyntaxKind.MinusToken,
                          ts.factory.createNumericLiteral(Math.abs(value))
                        )
                      : ts.factory.createNumericLiteral(value)
                    : ts.factory.createStringLiteral(value);

                prevProps.set(
                  key,
                  ts.factory.createPropertyAssignment(
                    ts.factory.createIdentifier(key),
                    newValue
                  )
                );
              }
              const metadataExpr = ts.factory.createObjectLiteralExpression(
                Array.from(prevProps.values()),
                true
              );
              newCallExpression = ts.factory.updateCallExpression(
                node,
                newPropertyAccessExpression,
                undefined,
                [ts.factory.createStringLiteral(ref), metadataExpr]
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
    if (
      foundExpressionType !== null &&
      foundFilename !== null &&
      ref !== null &&
      fileBuffer !== null &&
      fileHash !== null &&
      filePath !== null
    ) {
      return {
        newNodeText,
        foundExpressionType,
        foundFilename,
        ref,
        fileBuffer,
        fileHash,
        filePath,
      };
    }
  }
  return null;
}
