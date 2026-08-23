/**
 * Arbitration between the two language servers this extension can run.
 *
 * Not part of `@valbuild/language-server`'s protocol: it is a private
 * notification from this client to the **bundled** server in `server/`, telling
 * it which features the project's own Val server has taken over so that both do
 * not publish diagnostics for the same file.
 *
 * Kept in its own module so the client and the bundled server share one
 * spelling of the name without the client importing server code — the client is
 * bundled by esbuild, and importing from `server/src` would pull
 * `vscode-languageserver` into `client/out/extension.js`.
 *
 * Disappears entirely at the flip, when there is only one server.
 */
export const VAL_SUPPRESS_FEATURES_NOTIFICATION = "val/suppressFeatures";

export type SuppressFeaturesParams = {
  valRoot: string;
  /** Empty means "serve everything again". */
  features: string[];
};
