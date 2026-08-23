import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import {
  activate,
  EXTENSION_ID,
  hasOldValFixture,
  hasRealValFixture,
  noValRoot,
  oldValRoot,
  realValRoot,
} from "./helper";

/**
 * Integration coverage for the launcher path: the surface a user actually
 * touches, checked inside a real VS Code instance rather than against mocks.
 *
 * Deliberately narrow. The launcher is small and stable, and these are the
 * things unit tests cannot see: whether the extension activates at all, whether
 * the commands it registers are reachable, and whether the settings it
 * contributes have the defaults they are documented to have.
 *
 * The workspace has two Val roots in deliberately different states:
 * `client/testFixture` has no `@valbuild/*` installed at all (which must stay
 * completely silent — no notification, no error), and `fixtures/npm` is a real
 * project on a Val that ships a language server. The launcher is per-root, so
 * one workspace exercises both paths at once.
 */
suite("Language server launcher", () => {
  suiteSetup(async () => {
    await activate();
  });

  test("the extension activates", async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not installed`);
    assert.strictEqual(extension.isActive, true);
  });

  test("every registered command is contributed", async () => {
    // Six of seven commands used to be registered in code but absent from
    // `contributes.commands`, which left them unreachable and untitled.
    const commands = await vscode.commands.getCommands(true);
    for (const command of [
      "val.login",
      "val.showLanguageServerInfo",
      "val.uploadRemoteFile",
      "val.downloadRemoteFile",
      "val.addModuleToValModules",
      "val.addToMediaGallery",
      "val.moveFileToGalleryDirectory",
      "val.removeGalleryEntry",
    ]) {
      assert.ok(commands.includes(command), `${command} is not registered`);
    }
  });

  test("the project language server is off by default", async () => {
    const configuration = vscode.workspace.getConfiguration("valBuild");
    assert.strictEqual(
      configuration.get("useProjectLanguageServer"),
      false,
      "shipping this on by default would replace every feature at once",
    );
    assert.strictEqual(configuration.get("languageServerPath"), "");
  });

  test("the dead maxNumberOfProblems setting is gone", async () => {
    // Contributed but never read: `getDocumentSettings` was never called.
    const inspected = vscode.workspace
      .getConfiguration("valBuild")
      .inspect("maxNumberOfProblems");
    assert.strictEqual(inspected?.defaultValue, undefined);
  });

  test("val.showLanguageServerInfo reports the workspace's Val roots", async () => {
    const report = await vscode.commands.executeCommand<string>(
      "val.showLanguageServerInfo",
    );
    assert.ok(report, "the command returned nothing");
    assert.match(report, /valBuild\.useProjectLanguageServer: false/);
    assert.match(report, /bundled language server is handling everything/);
    // Both roots must be found: root detection is per-package, and a monorepo
    // with several Val roots is the case that needs a server each.
    for (const root of [/no-val/, /old-val/, /npm/]) {
      assert.match(report, new RegExp(`Val roots in workspace: .*${root.source}`));
    }
    // ...and, with the setting off, no server may have been started for it.
    assert.match(report, /No project language servers\./);
  });

  test("a root with no Val installed stays silent when the switch is on", async () => {
    // The one case that must produce nothing at all: no notification, no session,
    // no error. `fixtures/no-val` has a package.json and a val.config but no
    // @valbuild/* anywhere above it, which is what "not a Val project, or
    // dependencies are not installed" looks like. Nagging here would make the
    // extension unusable in any workspace that also holds non-Val packages.
    const configuration = vscode.workspace.getConfiguration("valBuild");
    await configuration.update(
      "useProjectLanguageServer",
      true,
      vscode.ConfigurationTarget.Workspace,
    );
    try {
      // The setting change is handled asynchronously by onDidChangeConfiguration.
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const report = await vscode.commands.executeCommand<string>(
        "val.showLanguageServerInfo",
      );
      assert.ok(report);
      assert.match(report, /valBuild\.useProjectLanguageServer: true/);
      // Listed as a Val root...
      assert.match(report, new RegExp(`Val roots in workspace: .*no-val`));
      // ...but given no session of its own.
      assert.ok(
        !report.includes(`--- ${noValRoot()} ---`),
        `expected no session for ${noValRoot()} in:\n${report}`,
      );
    } finally {
      await configuration.update(
        "useProjectLanguageServer",
        undefined,
        vscode.ConfigurationTarget.Workspace,
      );
    }
  });

  (hasOldValFixture() ? test : test.skip)(
    "tells a root on an older Val to upgrade, not that nothing was found",
    async () => {
      // The common case in practice, and the one that must never surface as a
      // generic error. `fixtures/old-val` is a healthy install of @valbuild/next
      // 0.97.7 — the release before the language server existed.
      const configuration = vscode.workspace.getConfiguration("valBuild");
      await configuration.update(
        "useProjectLanguageServer",
        true,
        vscode.ConfigurationTarget.Workspace,
      );
      try {
        await new Promise((resolve) => setTimeout(resolve, 6000));
        const report = await vscode.commands.executeCommand<string>(
          "val.showLanguageServerInfo",
        );
        assert.ok(report);
        const marker = `--- ${oldValRoot()} ---`;
        assert.ok(report.includes(marker), `no section for old-val in:\n${report}`);
        const section = report.slice(report.indexOf(marker));
        assert.match(section, /state: +failed/);
        // Read off @valbuild/next, not @valbuild/core: next@0.98.0 depends on
        // core@0.97.7, so core's version says nothing about the floor.
        assert.match(section, /Val version: +0\.97\.7 \(from @valbuild\/next\)/);
        // The requirement is @valbuild/language-server, not a version of Val —
        // the message says so, and names the package this project can act on.
        assert.match(section, /@valbuild\/language-server ships with/);
        assert.match(section, /@valbuild\/next 0\.98\.0 and later/);
      } finally {
        await configuration.update(
          "useProjectLanguageServer",
          undefined,
          vscode.ConfigurationTarget.Workspace,
        );
      }
    },
  );

  (hasRealValFixture() ? test : test.skip)(
    "starts a project server for a root on a Val that ships one",
    async () => {
      // The happy path, end to end, against the published
      // @valbuild/language-server: resolve it out of the project's node_modules,
      // launch it, negotiate, and read back what it says it can do.
      const configuration = vscode.workspace.getConfiguration("valBuild");
      await configuration.update(
        "useProjectLanguageServer",
        true,
        vscode.ConfigurationTarget.Workspace,
      );
      try {
        await new Promise((resolve) => setTimeout(resolve, 8000));
        const report = await vscode.commands.executeCommand<string>(
          "val.showLanguageServerInfo",
        );
        assert.ok(report, "the command returned nothing");
        const section = report.slice(report.indexOf(realValRoot()));
        assert.ok(
          section.length > 0,
          `no section for ${realValRoot()} in:\n${report}`,
        );
        assert.match(section, /state: +running/);
        // Resolved through the anchor package, at the published version.
        assert.match(section, /server version: +0\.98\./);
        assert.match(section, /protocol version: 1/);
        assert.match(section, /features: .*diagnostics/);
        assert.match(section, /override: +none/);
      } finally {
        await configuration.update(
          "useProjectLanguageServer",
          undefined,
          vscode.ConfigurationTarget.Workspace,
        );
      }
    },
  );

  ((hasRealValFixture() && hasOldValFixture()) ? test : test.skip)(
    "valBuild.languageServerPath overrides resolution, and is never invisible",
    async () => {
      // Manual check 5 from the migration plan, automated. The override exists
      // because Yarn PnP has no node_modules for path resolution to walk, and
      // because pointing at a monorepo checkout is how you develop against an
      // unreleased Val. Proven here by rescuing the root that resolution rejects:
      // `old-val` is on a Val with no language server, so it fails outright —
      // unless an explicit path takes precedence, which it must.
      const override = path.join(
        realValRoot(),
        "node_modules",
        "@valbuild",
        "language-server",
        "bin.js",
      );
      const configuration = vscode.workspace.getConfiguration("valBuild");
      await configuration.update(
        "languageServerPath",
        override,
        vscode.ConfigurationTarget.Workspace,
      );
      await configuration.update(
        "useProjectLanguageServer",
        true,
        vscode.ConfigurationTarget.Workspace,
      );
      try {
        await new Promise((resolve) => setTimeout(resolve, 8000));
        const report = await vscode.commands.executeCommand<string>(
          "val.showLanguageServerInfo",
        );
        assert.ok(report);
        const marker = `--- ${oldValRoot()} ---`;
        assert.ok(report.includes(marker), `no old-val section in:\n${report}`);
        const section = report.slice(report.indexOf(marker));
        // It no longer reports "upgrade Val": the explicit path won.
        assert.doesNotMatch(section, /ships with @valbuild\/next 0\.98\.0 and later/);
        // And the override is reported, so it can never be the invisible reason
        // a session behaves unexpectedly.
        assert.match(
          section,
          /override: +valBuild\.languageServerPath = /,
        );
        assert.ok(
          section.includes(override),
          `the report should name the overriding path, got:\n${section}`,
        );
      } finally {
        await configuration.update(
          "languageServerPath",
          undefined,
          vscode.ConfigurationTarget.Workspace,
        );
        await configuration.update(
          "useProjectLanguageServer",
          undefined,
          vscode.ConfigurationTarget.Workspace,
        );
      }
    },
  );

  test("a Val root with no dependencies installed produces no diagnostics noise", async () => {
    // The fixture has no @valbuild/* at all. The bundled server cannot
    // initialise a service for it, and that must not turn into diagnostics on an
    // unrelated file.
    const document = await activate("content/page.val.ts");
    const diagnostics = vscode.languages.getDiagnostics(document.uri);
    const fromVal = diagnostics.filter((d) => d.source === "val");
    assert.deepStrictEqual(
      fromVal.map((d) => `${d.code}: ${d.message}`),
      [],
      "an uninstalled Val project should be quiet, not wrong",
    );
  });
});
