export function stackToLine(
  filename: string,
  stack: string,
): number | undefined {
  const lines = stack.split("\n");
  for (const line of lines) {
    const match = line.match(/.*? \((.+):(\d+)\)/);
    if (match && match[1] === filename) {
      const maybeNumber = Number(match[2]);
      if (!Number.isNaN(maybeNumber)) {
        return maybeNumber;
      }
    }
  }
  return undefined;
}
