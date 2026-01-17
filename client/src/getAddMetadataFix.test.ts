import * as ts from "typescript";
import * as assert from "assert";
import { getAddMetadataFix } from "./getAddMetadataFix";

describe("getAddMetadataFix", () => {
  it("basics", async () => {
    const input = `import { s, c, t } from '../../val.config';

export const employeeSchema = s.object({
  email: s.string().raw(),
  image: s.image().remote(),
  name: s.string(),
  hide: s.boolean(),
  phoneNumber: s.string(),
  position: s.union(
    s.literal('Designer'),
    s.literal('Office manager')
  ),
  contactPerson: s.boolean(),
});
export type Employee = t.inferSchema<typeof employeeSchema>;
export const schema = s.record(employeeSchema);

export default c.define('/content/company/allEmployees.val.ts', schema, {
  fake: {
    email: 'fake@mail.com',
    hide: false,
    image: c.image(
      '/public/val/fakeImage.webp'
    ),
    name: 'Fake Image',
    phoneNumber: '12345678',
    position: 'Office manager',
    contactPerson: false,
  },
});
`;

    const range: Range = [
      {
        line: 21,
        character: 11,
      },
      {
        line: 24,
        character: 0,
      },
    ] as const;
    const sourceFile = ts.createSourceFile(
      "<synthetic-source-file>",
      getText(input, range),
      ts.ScriptTarget.ES2015,
      true,
      ts.ScriptKind.TSX,
    );
    console.log(getText(input, range));
    const res = getAddMetadataFix(sourceFile, () => {
      return {
        mimeType: "image/png",
        width: 42,
        height: 42,
      };
    });
    assert.deepStrictEqual(
      res.newNodeText,
      `c.image('/public/val/fakeImage.webp', {
    mimeType: "image/png",
    width: 42,
    height: 42
}), `,
    );
  });
});

type Range = [
  { line: number; character: number },
  { line: number; character: number },
];
function getText(input: string, range: Range) {
  const lines = input.split("\n");
  const start = range[0];
  const end = range[1];
  if (start.line === end.line) {
    return lines[start.line].slice(start.character, end.character);
  }
  return (
    lines[start.line].slice(start.character) +
    lines.slice(start.line + 1, end.line).join("\n") +
    lines[end.line].slice(0, end.character)
  );
}
