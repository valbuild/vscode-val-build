import type {
  ProtocolNegotiationResult,
  ProtocolVersionRange,
} from "@valbuild/language-server";

/**
 * The Val language server protocol, as this extension speaks it.
 *
 * Split deliberately: **types from npm, runtime values vendored.**
 *
 * ## Types — imported
 *
 * A `devDependency` on `@valbuild/language-server` plus type-only imports gives
 * compile-time drift detection for free, and is erased at build time so it
 * creates no runtime coupling. Every type the rest of the client needs is
 * re-exported from here, so this is the only module that names the package at
 * all — one place for the type-only discipline to hold.
 *
 * It must stay `import type`. The client is bundled by esbuild
 * (`--bundle --format=cjs`), so a value import would pull the entire server —
 * `vscode-languageserver` and all — into `client/out/extension.js`: a silently
 * doubled VSIX that also pins the contract to one version of Val, which is the
 * whole thing this migration exists to undo. Two things stop that regressing:
 * `@typescript-eslint/consistent-type-imports` is an error for `client/src`, and
 * the build is checked with
 * `grep -c "vscode-languageserver/node" client/out/extension.js`.
 *
 * ## Runtime values — vendored
 *
 * Negotiation has to work **before and independently of** whichever server
 * version resolves out of the user's `node_modules` — including when none
 * resolves at all, which is the common case for a project on an older Val.
 * Negotiating against a range imported from the server would defeat the point.
 * Both sides of a wire protocol holding a copy of the contract is the normal
 * arrangement.
 *
 * `valProtocol.test.ts` asserts the vendored copies still agree with the
 * published package's, so the two cannot drift silently either.
 */

export type {
  ProtocolNegotiationResult,
  ProtocolVersionRange,
  ValClientCapabilities,
  ValClientInfo,
  ValEnvOverrides,
  ValFeature,
  ValInitializationOptions,
  ValInputParams,
  ValInputResult,
  ValPickItem,
  ValPickParams,
  ValPickResult,
  ValServerCapabilities,
} from "@valbuild/language-server";

/**
 * The protocol version range this client can speak.
 *
 * The invariant the whole design rests on: a client pinned at `{min: 1, max: 1}`
 * keeps working against every future server, until Val deliberately raises its
 * own `min` — which is a breaking change on Val's side, and is what produces the
 * actionable `server-too-old` / `client-too-old` messages instead of a dead end.
 */
export const CLIENT_PROTOCOL_VERSIONS: ProtocolVersionRange = {
  min: 1,
  max: 1,
};

/**
 * Feature flags a server may announce, as of the version this client was built
 * against.
 *
 * Read the server's own `features` array rather than this list: it is the source
 * of truth for the version actually installed, and it will grow. An **unknown**
 * string means "a capability this Val version has that I do not know about" —
 * ignore it. A **missing** one means "not available" — hide the corresponding UI.
 * That is the mechanism that makes a newer Val degrade gracefully against an
 * older extension.
 */
export const VAL_FEATURES = [
  "diagnostics",
  "diagnostics/gallery",
  "completions/route",
  "completions/keyOf",
  "completions/mediaPath",
  "completions/galleryKey",
  "completions/richtextLink",
  "fix/metadata",
  "fix/upload-remote",
  "fix/download-remote",
  "fix/missing-module",
  "fix/gallery",
  "login",
] as const;

// ---------------------------------------------------------------------------
// Custom requests: server -> client
//
// Standard LSP already covers applying edits (`workspace/applyEdit`), opening a
// URL in a browser (`window/showDocument` with `external: true`), progress
// (`$/progress`) and confirmations (`window/showMessageRequest`). These two are
// the only UI primitives LSP lacks that Val needs, and both are deliberately
// content-agnostic: they carry no Val types, so they do not change when Val
// changes.
// ---------------------------------------------------------------------------

/** Ask the user to choose one of a list of options (a "quick pick"). */
export const VAL_PICK_REQUEST = "val/pick";

/** Ask the user to type a value (an "input box"). */
export const VAL_INPUT_REQUEST = "val/input";

/**
 * Pick the highest protocol version both sides can speak.
 *
 * The failure is *directional* on purpose, so the user can be told which side to
 * update rather than shown a generic "incompatible versions" error.
 */
export function negotiateProtocolVersion(
  client: ProtocolVersionRange,
  server: ProtocolVersionRange,
): ProtocolNegotiationResult {
  const min = Math.max(client.min, server.min);
  const max = Math.min(client.max, server.max);
  if (min <= max) {
    return { status: "ok", protocolVersion: max };
  }
  if (server.max < client.min) {
    return { status: "server-too-old", server, client };
  }
  return { status: "client-too-old", server, client };
}
