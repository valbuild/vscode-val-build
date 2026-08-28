import fs from "fs";
import path from "path";
import { valCommandNames } from "@valbuild/language-server";

/**
 * The two sides of the command registry must not overlap.
 *
 * VS Code's command registry is global, and an LSP client registers a VS Code
 * command for every name its server announces in `executeCommandProvider`. So a
 * name used by both this extension and the language server is a duplicate
 * registration, and `commands.registerCommand` answers a duplicate with a throw
 * — from inside `initialize`, which fails the handshake. The user is left with an
 * extension that activated and serves nothing: no diagnostics, no quick fixes,
 * no completions, in every Val root in the workspace.
 *
 * That is 1.1.0's bug exactly. It registered `val.login` for its palette entry,
 * and every Val from 0.103 on announces a `val.login` of its own. It could not be
 * caught by the integration suite of the time because `fixtures/npm` was pinned
 * to a Val old enough to announce no commands at all.
 *
 * Hence this test rather than a convention: the ids this extension contributes
 * are checked against the names the *published* server actually serves, so a
 * command Val adds later fails here instead of at a user. A value import of
 * `@valbuild/language-server` is fine in a test — see `valProtocol.test.ts`.
 */

type ContributedCommand = { command: string; title: string };

function contributedCommands(): ContributedCommand[] {
  const manifest = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "..", "package.json"), "utf8"),
  );
  return manifest.contributes?.commands ?? [];
}

describe("the commands this extension contributes", () => {
  test("there are some, read from the real manifest", () => {
    // Guards the test itself: a manifest this could not read would make every
    // assertion below vacuously true.
    expect(contributedCommands().length).toBeGreaterThan(0);
  });

  test("none shares an id with a command the language server serves", () => {
    const served = new Set(valCommandNames());
    const collisions = contributedCommands()
      .map(({ command }) => command)
      .filter((command) => served.has(command));
    expect(collisions).toEqual([]);
  });

  test("all of them live under valBuild., which the server never uses", () => {
    // The rule that makes the collision above impossible rather than merely
    // absent today: `val.` is the server's namespace, `valBuild.` is ours.
    for (const { command } of contributedCommands()) {
      expect(command.startsWith("valBuild.")).toBe(true);
    }
    for (const command of valCommandNames()) {
      expect(command.startsWith("valBuild.")).toBe(false);
    }
  });
});
