import * as ts from "typescript";

export const getAddMetadataFix = (
  sourceFile: ts.SourceFile,
  getMetadata: (filename: string) => Record<string, string | number>
) => {
  let newCallExpression: ts.CallExpression;
  const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (
    context
  ) => {
    return (sourceFile) => {
      const visitor = (node: ts.Node): ts.Node => {
        if (ts.isCallExpression(node)) {
          const filenameNode = node.arguments[0];
          if (ts.isStringLiteral(filenameNode) && !node.arguments[1]) {
            const metadata: Record<string, string | number> = getMetadata(
              filenameNode.text
            );
            newCallExpression = ts.factory.updateCallExpression(
              node,
              node.expression,
              undefined,
              [
                node.arguments[0],

                ts.factory.createObjectLiteralExpression(
                  Object.entries(metadata).map(([key, value]) =>
                    ts.factory.createPropertyAssignment(
                      ts.factory.createIdentifier(key),
                      typeof value === "number"
                        ? value < 0
                          ? ts.factory.createPrefixUnaryExpression(
                              ts.SyntaxKind.MinusToken,
                              ts.factory.createNumericLiteral(value.toString())
                            )
                          : ts.factory.createNumericLiteral(value.toString())
                        : ts.factory.createStringLiteral(value)
                    )
                  ) as ts.PropertyAssignment[],
                  true
                ),
              ]
            );
            return newCallExpression;
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
    return {
      newNodeText,
    };
  }
  return null;
};
