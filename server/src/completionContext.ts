import ts from "typescript";

/**
 * Represents the context where completion was requested
 */
export interface CompletionContext {
  type: "none" | "route" | "keyOf" | "c.image" | "c.file";
  // The position where completion was requested
  position: {
    line: number;
    character: number;
  };
  // The node where completion was requested (if it's a string literal)
  stringNode?: ts.StringLiteral;
  // The current partial text being typed (if in a string)
  partialText?: string;
  // For route type: the module path to get schema info
  modulePath?: string;
}

/**
 * Detect the completion context based on cursor position
 * Returns the type of completion needed based on where the cursor is
 */
export function detectCompletionContext(
  sourceFile: ts.SourceFile,
  position: { line: number; character: number }
): CompletionContext {
  const offset = sourceFile.getPositionOfLineAndCharacter(
    position.line,
    position.character
  );

  let context: CompletionContext = {
    type: "none",
    position,
  };

  // Find the node at the cursor position
  function findNodeAtPosition(node: ts.Node): ts.Node | undefined {
    if (offset >= node.getStart(sourceFile) && offset <= node.getEnd()) {
      // This node contains the position
      // Check if any child contains it more specifically
      let foundChild: ts.Node | undefined;
      ts.forEachChild(node, (child) => {
        if (
          !foundChild &&
          offset >= child.getStart(sourceFile) &&
          offset <= child.getEnd()
        ) {
          foundChild = findNodeAtPosition(child);
        }
      });
      return foundChild || node;
    }
    return undefined;
  }

  const nodeAtPosition = findNodeAtPosition(sourceFile);

  if (nodeAtPosition && ts.isStringLiteral(nodeAtPosition)) {
    // Check if cursor is within the string literal bounds
    const stringStart = nodeAtPosition.getStart(sourceFile);
    const stringEnd = nodeAtPosition.getEnd();

    if (offset >= stringStart && offset <= stringEnd) {
      // Calculate position within the string content (excluding quotes)
      const contentStart = stringStart + 1; // +1 for opening quote
      context.stringNode = nodeAtPosition;
      // Get the partial text up to cursor position (relative to content start)
      const textUpToCursor = nodeAtPosition.text.substring(
        0,
        Math.max(0, offset - contentStart)
      );
      context.partialText = textUpToCursor;

      // Check if we're in a property value that might have a route schema
      // We need to traverse up to find if this is inside c.define's content argument
      let parent = nodeAtPosition.parent;

      // Walk up to find if we're in c.define content (3rd argument)
      while (parent) {
        if (ts.isCallExpression(parent)) {
          if (ts.isPropertyAccessExpression(parent.expression)) {
            const obj = parent.expression.expression;
            const method = parent.expression.name;

            if (ts.isIdentifier(obj) && obj.text === "c") {
              if (ts.isIdentifier(method)) {
                // Check which function and which argument
                const args = parent.arguments;
                let argIndex = -1;
                for (let i = 0; i < args.length; i++) {
                  if (
                    args[i] === nodeAtPosition ||
                    (args[i].getStart(sourceFile) <= offset &&
                      offset <= args[i].getEnd())
                  ) {
                    argIndex = i;
                    break;
                  }
                }

                if (method.text === "define" && argIndex === 2) {
                  // Third argument of c.define (the content object)
                  // This string could be a route value
                  // We'll need to check the schema at runtime to know for sure
                  // For now, mark it as potentially a route
                  context.type = "route";

                  // Get the module path from first argument
                  if (args[0] && ts.isStringLiteral(args[0])) {
                    context.modulePath = args[0].text;
                  }
                } else if (method.text === "image" && argIndex === 0) {
                  context.type = "c.image";
                } else if (method.text === "file" && argIndex === 0) {
                  context.type = "c.file";
                } else if (method.text === "keyOf" && argIndex === 0) {
                  context.type = "keyOf";
                }
              }
            }
          }
          break;
        }
        parent = parent.parent;
      }
    }
  }
  return context;
}

/**
 * Check if the document is a .val.ts or .val.js file
 */
export function isValFile(filePath: string): boolean {
  return filePath.includes(".val.ts") || filePath.includes(".val.js");
}
