/**@type {import('eslint').Linter.Config} */
// eslint-disable-next-line no-undef
export default {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: [],
  rules: {
    semi: [2, "always"],
    "@typescript-eslint/no-unused-vars": 0,
    "@typescript-eslint/no-explicit-any": 0,
    "@typescript-eslint/explicit-module-boundary-types": 0,
    "@typescript-eslint/no-non-null-assertion": 0,
  },
};
