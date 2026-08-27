import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import path from "path";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import {
  CLIENT_PROTOCOL_VERSIONS,
  type ValInitializationOptions,
  type ValServerCapabilities,
} from "./valProtocol";

/**
 * Does a real `@valbuild/language-server` serve this extension, launched the way
 * this extension launches it?
 *
 * The unit tests around `resolveLanguageServer` prove we can *find* a server;
 * `client/src/test/` proves VS Code activates. Neither proves the two halves
 * speak to each other, and that is the whole contract now that every Val feature
 * lives on the other side of it.
 *
 * It matters most for the media shape. Val changed media from `c.image(path, {…})`
 * to a plain `{ path, width, height, mimeType }` object, and removed
 * `FILE_REF_PROP` from `@valbuild/core`. The extension's own server read `_ref`
 * and matched on `c.image(` call sites, so against a project on the new shape it
 * would have found nothing and completed nothing — silently, because it pinned
 * its own copy of core and still compiled. This test is what would have caught
 * that, and what will catch the next such change.
 *
 * Skipped unless a Val checkout is present, because the new shape only exists on
 * an unreleased branch: the committed `fixtures/` are real installs of published
 * Val. Point `VAL_MONOREPO` at a checkout to run it. This is the same mechanism
 * a developer uses through `valBuild.languageServerPath`.
 */

const VAL_MONOREPO =
  process.env.VAL_MONOREPO ??
  path.resolve(__dirname, "..", "..", "..", "val");
const SERVER_ENTRY = path.join(
  VAL_MONOREPO,
  "packages",
  "language-server",
  "bin.js",
);
const EXAMPLE_APP = path.join(VAL_MONOREPO, "examples", "next");

function hasValCheckout(): boolean {
  return fs.existsSync(SERVER_ENTRY) && fs.existsSync(EXAMPLE_APP);
}

type Diagnostic = {
  message: string;
  severity?: number;
  code?: string;
  source?: string;
  data?: { code?: string; sourcePath?: string; fixes?: string[] };
};

type CompletionItem = {
  label: string;
  detail?: string;
  data?: unknown;
  textEdit?: unknown;
  additionalTextEdits?: { newText: string }[];
};

const describeIfVal = hasValCheckout() ? describe : describe.skip;

describeIfVal("a real language server, launched as this extension launches it", () => {
  jest.setTimeout(90000);

  let child: ChildProcessWithoutNullStreams;
  let client: MessageConnection;
  let capabilities: ValServerCapabilities | undefined;
  let stderr = "";

  beforeAll(async () => {
    // stdio here rather than the IPC transport the extension uses: IPC needs a
    // Node parent that `LanguageClient` sets up. The server picks its transport
    // from argv, so the same binary and the same handshake are exercised.
    child = spawn(process.execPath, [SERVER_ENTRY, "--stdio"], {
      cwd: EXAMPLE_APP,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    client = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );
    // The server logs through window/logMessage; an unhandled notification would
    // otherwise be an error.
    client.onUnhandledNotification(() => {});
    client.listen();

    const initializationOptions: ValInitializationOptions = {
      client: { name: "vscode-val-build", version: null },
      supportedProtocolVersions: CLIENT_PROTOCOL_VERSIONS,
      valRoot: EXAMPLE_APP,
    };
    const result = await client.sendRequest<{
      capabilities: { experimental?: { val?: ValServerCapabilities } };
    }>("initialize", {
      processId: process.pid,
      rootUri: null,
      // Exactly what the extension announces.
      capabilities: { experimental: { val: { pick: true, input: true } } },
      initializationOptions,
    });
    capabilities = result.capabilities.experimental?.val;
    client.sendNotification("initialized", {});
  });

  afterAll(() => {
    // Never end or destroy the streams, and never send `exit`: the server
    // registers stream handlers that call process.exit, which would take the
    // jest worker with it.
    client?.dispose();
    child?.kill();
  });

  test("negotiates, and is not incompatible", () => {
    expect(capabilities).toBeDefined();
    expect(capabilities?.incompatible).toBeUndefined();
    expect(capabilities?.protocolVersion).toBe(1);
    expect(capabilities?.valRoot).toBe(EXAMPLE_APP);
  });

  test("writes nothing to stderr on a successful start", () => {
    // Editors treat stderr noise from a language server as a startup failure.
    expect(stderr).toBe("");
  });

  test("advertises the features this extension no longer implements", () => {
    // Each of these replaced something deleted from this repository. A missing
    // one means a feature was lost rather than moved.
    for (const feature of [
      "diagnostics",
      "fix/metadata",
      "fix/missing-module",
      "fix/upload-remote",
      "fix/download-remote",
      "completions/mediaPath",
      "completions/keyOf",
      "completions/route",
      "completions/galleryKey",
      "completions/richtextLink",
      "login",
    ]) {
      expect(capabilities?.features).toContain(feature);
    }
    expect(capabilities?.commands).toContain("val.login");
  });

  test("serves diagnostics for a module using the new media shape", async () => {
    const file = path.join(EXAMPLE_APP, "content", "media.val.ts");
    const text = fs.readFileSync(file, "utf8");
    // The fixture really is the new shape: a plain object with a path key, no
    // c.image( call anywhere.
    expect(text).not.toContain("c.image(");

    const uri = `file://${file}`;
    const published = await nextDiagnostics(client, uri, () => {
      client.sendNotification("textDocument/didOpen", {
        textDocument: { uri, languageId: "typescript", version: 1, text },
      });
    });

    // The known-bad entry in the example app: stored 800x600 for a 944x944 image.
    const fixable = published.find((d) => d.data?.fixes?.length);
    expect(fixable).toBeDefined();
    expect(fixable?.source).toBe("val");
    expect(fixable?.code).toBe("val/validation");
    expect(fixable?.message).toContain("944");
  });

  test("completes a media path inside the new object shape", async () => {
    // Every field in this fixture starts `null` on purpose, so the buffer is
    // edited the way a user would: type an object with an empty `path`. The
    // server reads the editor's buffer rather than the file, which is what makes
    // completing an unsaved edit work at all.
    const file = path.join(EXAMPLE_APP, "content", "mediaFields.val.ts");
    const original = fs.readFileSync(file, "utf8");
    const text = original.replace("image: null,", 'image: { path: "" },');
    expect(text).not.toBe(original);

    const uri = `file://${file}`;
    client.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId: "typescript", version: 1, text },
    });

    // Inside the empty string. This position used to be found by matching a
    // `c.image(` callee; it is found from the schema now, which is the change
    // that would otherwise have silently killed media completions.
    const inString = text.indexOf('path: "') + 'path: "'.length;
    const before = text.slice(0, inString);
    const line = before.split("\n").length - 1;
    const character = inString - (before.lastIndexOf("\n") + 1);

    const items = await client.sendRequest<CompletionItem[] | null>(
      "textDocument/completion",
      { textDocument: { uri }, position: { line, character } },
    );
    expect(items).toBeTruthy();
    expect(items!.length).toBeGreaterThan(0);
    // Candidates are Val-style refs, including the /public prefix.
    for (const item of items!) {
      expect(item.label.startsWith("/public/")).toBe(true);
    }

    // Accepting one fills in the metadata. The extension used to do this by
    // string-surgery on a call expression's second argument, which has no
    // meaning for an object literal.
    const resolved = await client.sendRequest<CompletionItem>(
      "completionItem/resolve",
      items![0],
    );
    const inserted = (resolved.additionalTextEdits ?? [])
      .map((edit) => edit.newText)
      .join(" ");
    expect(inserted).toMatch(/mimeType/);
    expect(inserted).toMatch(/width/);
  });
});

function nextDiagnostics(
  client: MessageConnection,
  uri: string,
  trigger: () => void,
): Promise<Diagnostic[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`No diagnostics published for ${uri}`)),
      60000,
    );
    client.onNotification(
      "textDocument/publishDiagnostics",
      (params: { uri: string; diagnostics: Diagnostic[] }) => {
        if (params.uri !== uri) {
          return;
        }
        clearTimeout(timer);
        resolve(params.diagnostics);
      },
    );
    trigger();
  });
}
