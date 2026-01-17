import * as ts from "typescript";

// TODO:
describe("transformer", () => {
  it("should transform a file", async () => {
    let n: ts.Identifier;
    const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (
      context,
    ) => {
      return (sourceFile) => {
        const visitor = (node: ts.Node): ts.Node => {
          if (ts.isCallExpression(node)) {
            const firstArg = node.arguments[0];
            if (ts.isStringLiteral(firstArg) && !node.arguments[1]) {
              const metadata = {
                width: 100,
                height: 100,
                mimeType: "image/jpeg",
                alt: "Image alt text",
              };
              const newCallExpression = ts.factory.updateCallExpression(
                node,
                node.expression,
                undefined,
                [
                  node.arguments[0],
                  ts.factory.createObjectLiteralExpression([
                    ts.factory.createPropertyAssignment(
                      ts.factory.createIdentifier("width"),
                      ts.factory.createNumericLiteral(
                        metadata.width.toString(),
                      ),
                    ),
                    ts.factory.createPropertyAssignment(
                      ts.factory.createIdentifier("height"),
                      ts.factory.createNumericLiteral(
                        metadata.height.toString(),
                      ),
                    ),
                    ts.factory.createPropertyAssignment(
                      ts.factory.createIdentifier("mimeType"),
                      ts.factory.createNumericLiteral(
                        metadata.mimeType.toString(),
                      ),
                    ),
                    ts.factory.createPropertyAssignment(
                      ts.factory.createIdentifier("alt"),
                      ts.factory.createNumericLiteral(metadata.alt.toString()),
                    ),
                  ]),
                ],
              );
              return newCallExpression;
            }
          }
          return ts.visitEachChild(node, visitor, context);
        };

        return ts.visitNode(sourceFile, visitor) as ts.SourceFile;
      };
    };
    const sourceFile = ts.createSourceFile(
      "test.val.ts",
      `c.image('/public/image.png')`,
      ts.ScriptTarget.ESNext,
    );
    // add source file to program:
    const result = ts.transform(sourceFile, [transformerFactory]);
    // console.log(
    //   ts
    //     .createPrinter()
    //     .printNode(ts.EmitHint.Unspecified, n, result.transformed[0])
    // );
    console.log(ts.createPrinter().printFile(result.transformed[0]));
  });
});
