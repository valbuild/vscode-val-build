import * as ts from "typescript";
import { getRemoteUploadFileFix } from "./getRemoteUploadFileFix";
import { Internal } from "@valbuild/core";
import * as assert from "assert";

describe("getRemoteUploadFileFix", () => {
  it("basics with hotspot", async () => {
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
      '/public/val/fakeImage.webp',
      {
        width: 2048,
        height: 1365,
        mimeType: 'image/webp',
        hotspot: {
          x: 0.5062893081761006,
          y: 0.4293465501781632,
        },
      }
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
        line: 33,
        character: 0,
      },
    ] as const;
    const sourceFile = ts.createSourceFile(
      "<synthetic-source-file>",
      getText(input, range),
      ts.ScriptTarget.ES2015,
      true,
      ts.ScriptKind.TSX
    );
    const bucket = "v01";
    const publicProjectId = "12345";
    const coreVersion = "0.0.1";
    const validationHash = "abc123";
    const res = getRemoteUploadFileFix(
      Internal,
      bucket,
      coreVersion,
      validationHash,
      publicProjectId,
      sourceFile,
      () => {
        return {
          mimeType: "image/png",
          width: 42,
          height: 42,
        };
      },
      () => {
        return Buffer.from("fakeBuffer");
      }
    );
    assert.deepStrictEqual(
      res.newNodeText,
      `c.remote("https://remote.val.build/file/p/12345/b/v01/v/0.0.1/h/abc123/f/1f072448a8aa/p/public/val/fakeImage.webp", {
    width: 42,
    height: 42,
    mimeType: "image/png",
    hotspot: {
        x: 0.5062893081761006,
        y: 0.4293465501781632,
    }
}), `
    );
  });
});

type Range = [
  { line: number; character: number },
  { line: number; character: number }
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
