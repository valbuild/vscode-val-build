module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
  // src/test is the VS Code integration suite: it imports the `vscode` module,
  // which only exists inside a running editor. It is compiled by `tsc -b` and run
  // by scripts/e2e.sh, never by jest.
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/src/test/"],
  moduleFileExtensions: ["ts", "js", "json"],
};
