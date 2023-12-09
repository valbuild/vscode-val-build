import ts from "typescript";
import { createModulePathMap, getModulePathRange } from "./modulePathMap";

describe("Should map source path to line / cols", () => {
  test("test 1", () => {
    const text = `import type { InferSchemaType } from '@valbuild/next';
import { s, val } from '../val.config';

const commons = {
  keepAspectRatio: s.boolean().optional(),
  size: s.union(s.literal('xs'), s.literal('md'), s.literal('lg')).optional(),
};

export const schema = s.object({
  text: s.string({ minLength: 10 }),
  nested: s.object({
    text: s.string({ minLength: 10 }),
  }),
  testText: s
  .richtext({
    a: true,
    bold: true,
    headings: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    lineThrough: true,
    italic: true,
    link: true,
    img: true,
    ul: true,
    ol: true,
  })
  .optional(),
  testUnion: s.union(
  'type',
  s.object({
    ...commons,
    type: s.literal('singleImage'),
    image: s.image().optional(),
  }),
  s.object({
    ...commons,
    type: s.literal('doubleImage'),
    image1: s.image().optional(),
    image2: s.image().optional(),
  })
  ),
});
export type TestContent = InferSchemaType<typeof schema>;

export default val.content(
  '/oj/test', // <- NOTE: this must be the same path as the file
  schema,
  {
  testText: val.richtext\`
Hei dere!
Dette er gøy!
\`,
  text: 'hei',
  nested: {
    text: 'hei',
  },
  testUnion: {
    type: 'singleImage',
    keepAspectRatio: true,
    size: 'xs',
    image: val.file('/public/Screenshot 2023-11-30 at 20.20.11_dbcdb.png'),
  },
  }
);
`;
    const sourceFile = ts.createSourceFile(
      "./oj/test.val.ts",
      text,
      ts.ScriptTarget.ES2015
    );

    const modulePathMap = createModulePathMap(sourceFile);

    if (modulePathMap) {
      console.log(getModulePathRange('"text"', modulePathMap));
      console.log(getModulePathRange('"nested"."text"', modulePathMap));
    }
  });

  test("test 2", () => {
    const text = `import { s, val } from '../val.config';

const commons = {
  keepAspectRatio: s.boolean().optional(),
  size: s.union(s.literal('xs'), s.literal('md'), s.literal('lg')).optional(),
};

export const schema = s.object({
  ingress: s.string({ maxLength: 1 }),
  theme: s.string().raw(),
  header: s.string(),
  image: s.image(),
});

export default val.content('/content/aboutUs', schema, {
  ingress:
    'Vi elsker å bytestgge digitale tjenester som betyr noe for folk, helt fra bunn av, og helt ferdig. Vi tror på iterative utviklingsprosesser, tverrfaglige team, designdrevet produktutvikling og brukersentrerte designmetoder.',
  header: 'SPESIALISTER PÅ DIGITAL PRODUKTUTVIKLING',
  image: val.file(
    '/public/368032148_1348297689148655_444423253678040057_n_64374.png',
    {
      sha256:
        '6437456f9b596355e54df8bbbe9bf32228a7b79ddbdd17cca5679931bd80ea84',
      width: 1283,
      height: 1121,
    }
  ),
});
`;
    const sourceFile = ts.createSourceFile(
      "./oj/test.val.ts",
      text,
      ts.ScriptTarget.ES2015
    );

    const modulePathMap = createModulePathMap(sourceFile);

    if (modulePathMap) {
      console.log(modulePathMap);
      console.log(getModulePathRange('"ingress"', modulePathMap));
    }
  });

  test("test 3", () => {
    const text = `import { s, val } from '../val.config';

export const schema = s.object({
  first: s.array(s.object({ second: s.record(s.array(s.string()))}))
});

export default val.content('/content', schema, {
  first: [{ second: { a: ['a', 'b'] } }]
});
`;
    const sourceFile = ts.createSourceFile(
      "./content.val.ts",
      text,
      ts.ScriptTarget.ES2015
    );

    const modulePathMap = createModulePathMap(sourceFile);

    if (modulePathMap) {
      console.log(
        getModulePathRange('"first".0."second"."a".1', modulePathMap)
      );
    }
  });
});
