import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

/**
 * Flat config, which is the only format ESLint 9+ reads.
 *
 * The previous `.eslintrc.js` never ran at all: the root package.json declares
 * `"type": "module"`, eslintrc configs were loaded with `require`, and ESLint saw
 * `{ __esModule: true, default: {...} }` and rejected it as an invalid config
 * ("Unexpected top-level property \"__esModule\""). So `npm run lint` exited
 * non-zero without checking a single rule.
 */
export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/out/**",
      "client/testFixture/**",
      ".vscode-test/**",
    ],
  },
  {
    files: ["client/src/**/*.ts", "server/src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      semi: ["error", "always"],
    },
  },
  {
    // Client only, because the hazard is specific to it: `client/src` is bundled
    // by esbuild (`--bundle --format=cjs`), so a value import of a types-only
    // package — `@valbuild/language-server` above all — pulls the whole server,
    // `vscode-languageserver` and all, into `client/out/extension.js`. That
    // silently doubles the VSIX *and* pins the protocol contract to one version
    // of Val, which is the entire thing this migration exists to undo.
    // `import type` is erased at build time and cannot do either.
    //
    // `server/` is emitted as plain CJS and never bundled, so the same rule there
    // would only be cosmetic.
    files: ["client/src/**/*.ts"],
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
    },
  },
];
