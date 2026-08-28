import {
  chooseValRoot,
  findUriArgument,
  ServerCommandRouter,
  type ServerCommandRouterHost,
} from "./serverCommands";

/**
 * What a router has to get right, and why each case is here:
 *
 * VS Code's command registry is global while this extension runs one language
 * server per Val root, so "one registration per command name, whoever serves it"
 * is not an optimisation — a second registration of the same name throws, from
 * inside `initialize`, and costs the user every Val feature in that root. See
 * `serverCommands.ts`.
 */

const ROOT_A = "/work/apps/web";
const ROOT_B = "/work/apps/docs";

function fakeHost(overrides: Partial<ServerCommandRouterHost> = {}) {
  const registered = new Map<string, (...args: unknown[]) => unknown>();
  const disposed: string[] = [];
  const warnings: string[] = [];
  const host: ServerCommandRouterHost = {
    registerCommand: (command, handler) => {
      if (registered.has(command)) {
        // Exactly what vscode.commands.registerCommand does, which is the whole
        // reason this module exists.
        throw new Error(`command '${command}' already exists`);
      }
      registered.set(command, handler);
      return {
        dispose: () => {
          registered.delete(command);
          disposed.push(command);
        },
      };
    },
    activePath: () => null,
    // Enough of vscode.Uri.parse for `file://` URIs.
    toFsPath: (uri) =>
      uri.startsWith("file://") ? decodeURIComponent(uri.slice(7)) : null,
    log: () => undefined,
    warn: (message) => warnings.push(message),
    ...overrides,
  };
  return { host, registered, disposed, warnings };
}

describe("ServerCommandRouter", () => {
  test("registers each command the server announces", () => {
    const { host, registered } = fakeHost();
    const router = new ServerCommandRouter(host);
    router.add({
      id: "static-0",
      valRoot: ROOT_A,
      commands: ["val.login", "val.uploadRemote"],
      execute: async () => undefined,
    });
    expect(router.commands()).toEqual(["val.login", "val.uploadRemote"]);
    expect([...registered.keys()].sort()).toEqual([
      "val.login",
      "val.uploadRemote",
    ]);
  });

  test("registers a name once however many roots serve it", () => {
    // The monorepo case, and the one that used to throw: every root runs the
    // same Val, so every root announces the same command names.
    const { host, registered } = fakeHost();
    const router = new ServerCommandRouter(host);
    const commands = ["val.login", "val.uploadRemote", "val.downloadRemote"];
    for (const valRoot of [ROOT_A, ROOT_B]) {
      router.add({
        id: "static-0",
        valRoot,
        commands,
        execute: async () => undefined,
      });
    }
    expect(registered.size).toBe(3);
  });

  test("routes an invocation to the root that owns the document", async () => {
    const { host, registered } = fakeHost();
    const router = new ServerCommandRouter(host);
    const ranIn: string[] = [];
    for (const valRoot of [ROOT_A, ROOT_B]) {
      router.add({
        id: "static-0",
        valRoot,
        commands: ["val.uploadRemote"],
        execute: async (command) => {
          ranIn.push(`${valRoot}:${command}`);
          return "done";
        },
      });
    }
    const handler = registered.get("val.uploadRemote");
    const result = await handler?.({
      uri: `file://${ROOT_B}/content/page.val.ts`,
      moduleFilePath: "/content/page.val.ts",
      sourcePath: "/content/page.val.ts?p=image",
      fix: "image:upload-remote",
      message: "…",
    });
    expect(ranIn).toEqual([`${ROOT_B}:val.uploadRemote`]);
    expect(result).toBe("done");
  });

  test("says so rather than guessing when it cannot tell which root", async () => {
    // Running a command against the wrong project is worse than being asked to
    // be clearer: an upload would go to another project's remote.
    const { host, registered, warnings } = fakeHost();
    const router = new ServerCommandRouter(host);
    const ran: string[] = [];
    for (const valRoot of [ROOT_A, ROOT_B]) {
      router.add({
        id: "static-0",
        valRoot,
        commands: ["val.login"],
        execute: async () => {
          ran.push(valRoot);
        },
      });
    }
    await registered.get("val.login")?.();
    expect(ran).toEqual([]);
    expect(warnings).toEqual([
      expect.stringContaining("could not tell which Val project"),
    ]);
  });

  test("reports a failing command instead of swallowing it", async () => {
    const { host, registered, warnings } = fakeHost();
    const router = new ServerCommandRouter(host);
    router.add({
      id: "static-0",
      valRoot: ROOT_A,
      commands: ["val.login"],
      execute: async () => {
        throw new Error("the device flow timed out");
      },
    });
    await registered.get("val.login")?.();
    expect(warnings).toEqual([
      expect.stringContaining("the device flow timed out"),
    ]);
  });

  test("keeps a name while any root still serves it", () => {
    const { host, registered } = fakeHost();
    const router = new ServerCommandRouter(host);
    for (const valRoot of [ROOT_A, ROOT_B]) {
      router.add({
        id: "static-0",
        valRoot,
        commands: ["val.login"],
        execute: async () => undefined,
      });
    }
    router.remove(ROOT_A, "static-0");
    expect(registered.has("val.login")).toBe(true);
    router.remove(ROOT_B, "static-0");
    expect(registered.has("val.login")).toBe(false);
  });

  test("scopes registration ids by root, since servers pick their own", () => {
    // A dynamic registration's id comes from the server, so two roots can hand
    // over the same one. Keyed only by id, one root's unregistration would drop
    // the other's commands.
    const { host, registered } = fakeHost();
    const router = new ServerCommandRouter(host);
    for (const valRoot of [ROOT_A, ROOT_B]) {
      router.add({
        id: "shared-uuid",
        valRoot,
        commands: ["val.login"],
        execute: async () => undefined,
      });
    }
    router.remove(ROOT_A, "shared-uuid");
    expect(registered.has("val.login")).toBe(true);
  });

  test("removeRoot drops everything a stopped client registered", () => {
    const { host, registered } = fakeHost();
    const router = new ServerCommandRouter(host);
    router.add({
      id: "static-0",
      valRoot: ROOT_A,
      commands: ["val.login"],
      execute: async () => undefined,
    });
    router.add({
      id: "dynamic-1",
      valRoot: ROOT_A,
      commands: ["val.uploadRemote"],
      execute: async () => undefined,
    });
    router.removeRoot(ROOT_A);
    expect(registered.size).toBe(0);
    expect(router.commands()).toEqual([]);
  });

  test("a re-registered name is registered again, not left dangling", async () => {
    // A server that closes and restarts clears its features and initializes
    // again. If disposal did not really free the name, the restart would throw.
    const { host, registered } = fakeHost();
    const router = new ServerCommandRouter(host);
    const registration = {
      id: "static-0",
      valRoot: ROOT_A,
      commands: ["val.login"],
      execute: async () => "second",
    };
    router.add({ ...registration, execute: async () => "first" });
    router.removeRoot(ROOT_A);
    router.add(registration);
    expect(await registered.get("val.login")?.()).toBe("second");
  });

  test("a name the editor already owns costs that command, not the start-up", () => {
    // Whatever else is in the editor, `add` runs inside `initialize`: a throw
    // escaping it fails the handshake, and the root gets no Val at all.
    const { host, registered } = fakeHost();
    const taken = host.registerCommand("val.login", () => undefined);
    const router = new ServerCommandRouter(host);
    expect(() =>
      router.add({
        id: "static-0",
        valRoot: ROOT_A,
        commands: ["val.login", "val.uploadRemote"],
        execute: async () => undefined,
      }),
    ).not.toThrow();
    expect(registered.has("val.uploadRemote")).toBe(true);
    taken.dispose();
  });

  test("dispose gives every name back to VS Code", () => {
    const { host, registered, disposed } = fakeHost();
    const router = new ServerCommandRouter(host);
    router.add({
      id: "static-0",
      valRoot: ROOT_A,
      commands: ["val.login", "val.uploadRemote"],
      execute: async () => undefined,
    });
    router.dispose();
    expect(registered.size).toBe(0);
    expect(disposed.sort()).toEqual(["val.login", "val.uploadRemote"]);
  });
});

describe("chooseValRoot", () => {
  const toFsPath = (uri: string) =>
    uri.startsWith("file://") ? uri.slice(7) : null;

  test("prefers the document the command is about", () => {
    expect(
      chooseValRoot({
        args: [{ uri: `file://${ROOT_A}/content/page.val.ts` }],
        valRoots: [ROOT_A, ROOT_B],
        // Deliberately contradicting: a code action is about its own document,
        // not about whatever the user has since clicked on.
        activePath: `${ROOT_B}/content/page.val.ts`,
        toFsPath,
      }),
    ).toBe(ROOT_A);
  });

  test("the innermost root wins for a nested package", () => {
    const outer = "/work";
    expect(
      chooseValRoot({
        args: [{ uri: `file://${ROOT_A}/content/page.val.ts` }],
        valRoots: [outer, ROOT_A],
        activePath: null,
        toFsPath,
      }),
    ).toBe(ROOT_A);
  });

  test("falls back to the file the user is looking at", () => {
    expect(
      chooseValRoot({
        args: [],
        valRoots: [ROOT_A, ROOT_B],
        activePath: `${ROOT_B}/app/page.tsx`,
        toFsPath,
      }),
    ).toBe(ROOT_B);
  });

  test("then to the only root there is", () => {
    // What makes the palette work from a file that is not part of any Val
    // project, which is most of them.
    expect(
      chooseValRoot({
        args: [],
        valRoots: [ROOT_A],
        activePath: "/somewhere/else/notes.md",
        toFsPath,
      }),
    ).toBe(ROOT_A);
  });

  test("refuses to choose between several roots with nothing to go on", () => {
    expect(
      chooseValRoot({
        args: [],
        valRoots: [ROOT_A, ROOT_B],
        activePath: null,
        toFsPath,
      }),
    ).toBeNull();
  });

  test("refuses a document that belongs to no root", () => {
    // Not routed to some other root: the fix would be applied to a file that
    // server does not own.
    expect(
      chooseValRoot({
        args: [{ uri: "file:///elsewhere/content/page.val.ts" }],
        valRoots: [ROOT_A],
        activePath: `${ROOT_A}/app/page.tsx`,
        toFsPath,
      }),
    ).toBeNull();
  });

  test("an unparseable URI leaves the active editor to decide", () => {
    expect(
      chooseValRoot({
        args: [{ uri: "untitled:Untitled-1" }],
        valRoots: [ROOT_A, ROOT_B],
        activePath: `${ROOT_A}/app/page.tsx`,
        toFsPath,
      }),
    ).toBe(ROOT_A);
  });
});

describe("findUriArgument", () => {
  test("reads the shape Val's remote fixes use", () => {
    expect(
      findUriArgument([
        {
          uri: "file:///work/content/page.val.ts",
          fix: "image:upload-remote",
        },
      ]),
    ).toBe("file:///work/content/page.val.ts");
  });

  test("reads the shape the rest of LSP uses", () => {
    expect(
      findUriArgument([{ textDocument: { uri: "file:///work/a.val.ts" } }]),
    ).toBe("file:///work/a.val.ts");
  });

  test("reads a bare URI string", () => {
    expect(findUriArgument(["file:///work/a.val.ts"])).toBe(
      "file:///work/a.val.ts",
    );
  });

  test("is not fooled by a string that is not a URI", () => {
    expect(findUriArgument(["/work/a.val.ts", 3, null, undefined])).toBeNull();
  });

  test("finds nothing in arguments it does not recognise", () => {
    // Not a failure: routing falls through to the active editor.
    expect(findUriArgument([{ moduleFilePath: "/content/page.val.ts" }])).toBe(
      null,
    );
  });
});
