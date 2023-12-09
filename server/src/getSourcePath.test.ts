import ts from 'typescript';

describe('Should map source path to line / cols', () => {
	test('test1', () => {
		const text = `import type { InferSchemaType } from '@valbuild/next';
import { s, val } from '../val.config';

const commons = {
	keepAspectRatio: s.boolean().optional(),
	size: s.union(s.literal('xs'), s.literal('md'), s.literal('lg')).optional(),
};

export const schema = s.object({
	text: s.string({ minLength: 10 }),
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
			'./oj/test.val.ts',
			text,
			ts.ScriptTarget.ES2015
		);

		for (const child of sourceFile
			.getChildren()
			.flatMap((child) => child.getChildren())) {
			if (ts.isExportAssignment(child)) {
				const contentNode =
					child.expression &&
					ts.isCallExpression(child.expression) &&
					child.expression.arguments[2];

				if (contentNode && ts.isObjectLiteralExpression(contentNode)) {
					console.log(traverseObjectLiteral(contentNode));
				}
			}
		}
	});
});

type LineMap = {
	[key: string]: {
		children: LineMap;
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

function traverseObjectLiteral(node: ts.ObjectLiteralExpression): LineMap {
	return node.properties.reduce((acc, property) => {
		if (ts.isPropertyAssignment(property)) {
			const key =
				property.name && ts.isIdentifier(property.name) && property.name.text;
			const value = property.initializer;
			if (key) {
				return {
					...acc,
					[key]: {
						children: ts.isObjectLiteralExpression(value)
							? traverseObjectLiteral(value)
							: {},
						start: {
							line: property.pos,
							character: property.getFullStart(),
						},
						end: {
							line: property.end,
							character: property.getFullWidth(),
						},
					},
				};
			}
		}
		return acc;
	}, {});
}
