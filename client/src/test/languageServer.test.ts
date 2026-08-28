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
  openDocument,
  realValRoot,
  waitForValDiagnostics,
} from "./helper";

/**
 * Integration coverage for the launcher, checked inside a real VS Code instance.
 *
 * Deliberately narrow. The launcher is all that is left of this extension —
 * every Val feature is served by `@valbuild/language-server` out of the user's
 * own project — so what is worth testing here is exactly what unit tests cannot
 * see: whether the extension activates, whether the palette commands and the
 * server's own commands are reachable, whether a server is resolved and started
 * per Val root, and whether its diagnostics arrive in the editor.
 *
 * The workspace has three Val roots in deliberately different states, so one
 * run exercises every branch of resolution at once:
 *
 *  - `fixtures/no-val`   — a package.json and a val.config, no `@valbuild/*` at
 *                          all. Must stay completely silent.
 *  - `fixtures/old-val`  — a healthy install of a Val too old to ship a language
 *                          server. Must say "upgrade", not "not found".
 *  - `fixtures/npm`      — a real Val that does ship one. The happy path. Kept
 *                          on a current Val on purpose: a Val old enough to
 *                          announce no `workspace/executeCommand` names hid the
 *                          command collision that broke 1.1.0 entirely.
 */
suite("Language server launcher", () => {
  suiteSetup(async () => {
    await activate();
    // The servers start asynchronously during activation, one per root.
    await new Promise((resolve) => setTimeout(resolve, 8000));
  });

  test("the extension activates", async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not installed`);
    assert.strictEqual(extension.isActive, true);
  });

  test("the contributed commands are registered, under valBuild.", async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const command of [
      "valBuild.login",
      "valBuild.showLanguageServerInfo",
    ]) {
      assert.ok(commands.includes(command), `${command} is not registered`);
    }
    // The six commands that used to live here are code actions on the language
    // server now, and a code action's command is registered by the client. A
    // leftover registration would shadow the server's own.
    for (const gone of [
      "val.uploadRemoteFile",
      "val.downloadRemoteFile",
      "val.addModuleToValModules",
      "val.addToMediaGallery",
      "val.moveFileToGalleryDirectory",
      "val.removeGalleryEntry",
    ]) {
      assert.ok(
        !commands.includes(gone),
        `${gone} is still registered by the extension`,
      );
    }
  });

  (hasRealValFixture() ? test : test.skip)(
    "the server's own commands are registered once, by the router",
    async () => {
      // The regression test for 1.1.0's startup failure. The extension
      // registered `val.login` for its palette entry; every Val from 0.103 on
      // announces a `val.login` command of its own, which the language client
      // then registers too — and a duplicate registration throws from inside
      // `initialize`, so the server never finished starting and no Val feature
      // worked at all.
      //
      // Both halves of the fix are visible here: the names below exist (so the
      // handshake got as far as registering them, and a quick fix whose command
      // is one of them can be applied), and the "starts a server" test above
      // asserts the session actually reached `running`.
      const commands = await vscode.commands.getCommands(true);
      for (const command of [
        "val.login",
        "val.uploadRemote",
        "val.downloadRemote",
      ]) {
        assert.ok(
          commands.includes(command),
          `${command} is not registered; the handshake did not get that far`,
        );
      }
    },
  );

  test("only languageServerPath is contributed", async () => {
    const configuration = vscode.workspace.getConfiguration("valBuild");
    assert.strictEqual(configuration.get("languageServerPath"), "");
    // Both are gone: `useProjectLanguageServer` had no second implementation to
    // switch to once the bundled server was deleted, and maxNumberOfProblems was
    // never read.
    for (const dead of ["useProjectLanguageServer", "maxNumberOfProblems"]) {
      assert.strictEqual(
        configuration.inspect(dead)?.defaultValue,
        undefined,
        `${dead} is still contributed`,
      );
    }
  });

  test("valBuild.showLanguageServerInfo reports the workspace's Val roots", async () => {
    const report = await vscode.commands.executeCommand<string>(
      "valBuild.showLanguageServerInfo",
    );
    assert.ok(report, "the command returned nothing");
    // Root detection is per-package, and a monorepo with several Val roots is
    // the case that needs a server each.
    for (const root of [/no-val/, /old-val/, /npm/]) {
      assert.match(
        report,
        new RegExp(`Val roots in workspace: .*${root.source}`),
      );
    }
  });

  test("a root with no Val installed is given no session at all", async () => {
    // The one case that must produce nothing: no notification, no session, no
    // error. `fixtures/no-val` has a package.json and a val.config but no
    // @valbuild/* anywhere above it, which is what "not a Val project, or
    // dependencies are not installed" looks like. Nagging here would make the
    // extension unusable in any workspace that also holds non-Val packages.
    const report = await vscode.commands.executeCommand<string>(
      "valBuild.showLanguageServerInfo",
    );
    assert.ok(report);
    assert.match(report, new RegExp(`Val roots in workspace: .*no-val`));
    assert.ok(
      !report.includes(`--- ${noValRoot()} ---`),
      `expected no session for ${noValRoot()} in:\n${report}`,
    );
  });

  (hasOldValFixture() ? test : test.skip)(
    "tells a root on an older Val to upgrade, not that nothing was found",
    async () => {
      // The common case in practice, and the one that must never surface as a
      // generic error. With no bundled server to fall back on, this message is
      // the entire user experience for such a project, so it has to be right.
      const report = await vscode.commands.executeCommand<string>(
        "valBuild.showLanguageServerInfo",
      );
      assert.ok(report);
      const marker = `--- ${oldValRoot()} ---`;
      assert.ok(report.includes(marker), `no section for old-val in:\n${report}`);
      const section = report.slice(report.indexOf(marker));
      assert.match(section, /state: +failed/);
      // Read off @valbuild/next, not @valbuild/core: next@0.98.0 depends on
      // core@0.97.7, so core's version says nothing about the floor.
      assert.match(section, /Val version: +0\.97\.7 \(from @valbuild\/next\)/);
      assert.match(section, /@valbuild\/language-server ships with/);
    },
  );

  (hasRealValFixture() ? test : test.skip)(
    "starts a server for a root on a Val that ships one",
    async () => {
      // The happy path, end to end, against the published
      // @valbuild/language-server: resolve it out of the project's node_modules,
      // launch it, negotiate, and read back what it says it can do.
      const report = await vscode.commands.executeCommand<string>(
        "valBuild.showLanguageServerInfo",
      );
      assert.ok(report, "the command returned nothing");
      const marker = `--- ${realValRoot()} ---`;
      assert.ok(report.includes(marker), `no npm section in:\n${report}`);
      const section = report.slice(report.indexOf(marker));
      assert.match(section, /state: +running/);
      assert.match(section, /protocol version: 1/);
      assert.match(section, /features: .*diagnostics/);
      assert.match(section, /override: +none/);
    },
  );

  (hasRealValFixture() ? test : test.skip)(
    "the server's diagnostics reach the editor",
    async () => {
      // "It starts" is not "it works". A session in `running` proves the
      // handshake finished; this proves the thing the user actually notices — and
      // is the symptom that reached us when the handshake did not finish, since a
      // client that fails to initialize also never sends `textDocument/didOpen`.
      //
      // `content/errors.val.ts` is a plain string one character short of its
      // schema, which every Val old enough to ship a language server reports.
      const document = await openDocument(
        realValRoot(),
        "content/errors.val.ts",
      );
      const diagnostics = await waitForValDiagnostics(document.uri);
      assert.ok(
        diagnostics.length > 0,
        "the language server published no diagnostics for a module that has an error",
      );
      assert.match(diagnostics[0].message, /at least 30 characters/);
    },
  );

  ((hasRealValFixture() && hasOldValFixture()) ? test : test.skip)(
    "valBuild.languageServerPath overrides resolution, and is never invisible",
    async () => {
      // The override exists because Yarn PnP has no node_modules for path
      // resolution to walk, and because pointing at a monorepo checkout is how
      // you develop against an unreleased Val -- which is the only way to run
      // against a Val newer than the last release. Proven here by rescuing the
      // root that resolution rejects: `old-val` is on a Val with no language
      // server, so it fails outright unless an explicit path takes precedence.
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
      try {
        await new Promise((resolve) => setTimeout(resolve, 8000));
        const report = await vscode.commands.executeCommand<string>(
          "valBuild.showLanguageServerInfo",
        );
        assert.ok(report);
        const marker = `--- ${oldValRoot()} ---`;
        assert.ok(report.includes(marker), `no old-val section in:\n${report}`);
        const section = report.slice(report.indexOf(marker));
        // It no longer reports "upgrade Val": the explicit path won.
        assert.doesNotMatch(section, /@valbuild\/language-server ships with/);
        // And the override is reported, so it can never be the invisible reason
        // a session behaves unexpectedly.
        assert.match(section, /override: +valBuild\.languageServerPath = /);
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
      }
    },
  );

  test("a Val root with no dependencies installed produces no diagnostics noise", async () => {
    // The fixture has no @valbuild/* at all, so no server runs for it. That must
    // stay quiet rather than turning into diagnostics on an unrelated file.
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
