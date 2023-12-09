import ts from "typescript";

export type ModulePathMap = {
  [modulePath: string]: {
    children: ModulePathMap;
    start: {
      line: number;
      character: number;
    };
    end: {
      line: number;
      character: number;
    };
  };
};

export function getModulePathRange(
  modulePath: string,
  modulePathMap: ModulePathMap
) {
  const segments = modulePath.split(".").map((segment) => JSON.parse(segment)); // TODO: this is not entirely correct, but works for now. We have a function I think that does this so replace this with it
  let range = modulePathMap[segments[0]];
  for (const pathSegment of segments.slice(1)) {
    if (!range) {
      break;
    }
    range = range.children[pathSegment];
  }
  return (
    range?.start &&
    range?.end && {
      start: range.start,
      end: range.end,
    }
  );
}

export function createModulePathMap(sourceFile: ts.SourceFile) {
  for (const child of sourceFile
    .getChildren()
    .flatMap((child) => child.getChildren())) {
    if (ts.isExportAssignment(child)) {
      const contentNode =
        child.expression &&
        ts.isCallExpression(child.expression) &&
        child.expression.arguments[2];

      if (contentNode) {
        return traverse(contentNode, sourceFile);
      }
    }
  }
}

function traverse(node: ts.Expression, sourceFile: ts.SourceFile) {
  if (ts.isObjectLiteralExpression(node)) {
    return traverseObjectLiteral(node, sourceFile);
  } else if (ts.isArrayLiteralExpression(node)) {
    return traverseArrayLiteral(node, sourceFile);
  }
}

function traverseArrayLiteral(
  node: ts.ArrayLiteralExpression,
  sourceFile: ts.SourceFile
): ModulePathMap {
  return node.elements.reduce((acc, element, index) => {
    if (ts.isExpression(element)) {
      const tsEnd = sourceFile.getLineAndCharacterOfPosition(element.end);
      const start = {
        line: tsEnd.line,
        character: tsEnd.character - element.getWidth(sourceFile),
      };
      const end = {
        line: tsEnd.line,
        character: tsEnd.character,
      };
      return {
        ...acc,
        [index]: {
          children: traverse(element, sourceFile),
          start,
          end,
        },
      };
    }
    return acc;
  }, {});
}

function traverseObjectLiteral(
  node: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile
): ModulePathMap {
  return node.properties.reduce((acc, property) => {
    if (ts.isPropertyAssignment(property)) {
      const key =
        property.name && ts.isIdentifier(property.name) && property.name.text;
      const value = property.initializer;
      if (key) {
        const tsEnd = sourceFile.getLineAndCharacterOfPosition(
          property.name.end
        );
        const start = {
          line: tsEnd.line,
          character: tsEnd.character - property.name.getWidth(sourceFile),
        };
        const end = {
          line: tsEnd.line,
          character: tsEnd.character,
        };
        return {
          ...acc,
          [key]: {
            children: ts.isExpression(value) ? traverse(value, sourceFile) : {},
            start,
            end,
          },
        };
      }
    }
    return acc;
  }, {});
}
