# Val Build IntelliSense

Val Build IntelliSense improves the Val development experience by providing Visual Studio Code users with advanced features such as validation errors, warnings and hot fixes.

## Installation

**[Install via the Visual Studio Code Marketplace →](https://marketplace.visualstudio.com/items?itemName=valbuild.vscode-val-build)**

In order for the extension to activate you must have [`Val` installed](https://val.build/docs).

## Features

### Validation errors

View validation errors right in VS Code.

<img src="https://raw.githubusercontent.com/valbuild/vscode-val-build/master/.github/validation_errors.gif" alt="" />

### Apply hot fixes

Apply hot fixes on validation errors right from VS Code.

<img src="https://raw.githubusercontent.com/valbuild/vscode-val-build/master/.github/hotfixes.gif" alt="" />

## How it works

Every Val feature — validation errors, quick fixes, media path and route
completions, remote upload and download, logging in — is served by
**`@valbuild/language-server`**, which ships inside the Val your own project
depends on. This extension resolves that server and runs it, one per Val root.

That is the whole design, and it is deliberate. The extension used to carry its
own copy of Val: a re-implementation of module evaluation, its own schema walker,
its own copy of Val's mime table, its own remote-upload client. One extension
release therefore worked against one Val release, Val-specific fixes shipped on
this repository's cadence rather than Val's, and no other editor could benefit.

Now the contract is plain LSP:

- A feature your Val gains works immediately, with no extension update.
- A feature your Val does not have is hidden, rather than answered wrongly.
- Other editors get the same features by launching the same binary. See
  [`packages/language-server/README.md`](https://github.com/valbuild/val/blob/main/packages/language-server/README.md)
  in the Val repository for a Neovim configuration.

One server runs per Val root, because roots in a monorepo may pin different
versions of Val.

### What you need installed

The only requirement is that **`@valbuild/language-server` resolves from your
project**. There is no minimum version of `@valbuild/core` or of any other Val
package — the extension never checks one.

You do not install it yourself. It ships inside whichever Val package your
project already depends on:

| If your project is | The package that carries it |
| ------------------ | --------------------------- |
| Next.js            | `@valbuild/next`            |
| TanStack Start     | `@valbuild/tanstackstart-react` |
| Anything else      | `@valbuild/cli`             |

So if the extension reports that the language server could not be resolved,
**upgrade the package above that matches your project** — `@valbuild/next` for a
Next.js app — and it will come with it. For `@valbuild/next` and
`@valbuild/cli` that means 0.98.0 or later.

`@valbuild/core` is versioned separately and never carries a language server (the
server depends on core, so it could not without a cycle). A project that depends
only on `@valbuild/core` needs one of the packages above **added**, not upgraded.

The extension does not hold a list of framework packages: it reads your
`package.json` and resolves through the `@valbuild/*` packages you actually depend
on. A Val package released after the extension was published therefore works
without an extension update — which matters under pnpm, where a transitive
dependency is reachable only through the package that depends on it.

### Settings

| Setting                       | Default | Description                                                                                        |
| ----------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| `valBuild.languageServerPath` | `""`    | Absolute path to a language server entry point, used instead of resolving one from `node_modules`. |

`VAL_LANGUAGE_SERVER_PATH` does the same as `valBuild.languageServerPath` and is
used when the setting is empty.

### Troubleshooting

Run **Val: Show Language Server Info** from the command palette. It reports the
resolved server path, its version, which package it was resolved through, whether
a setting or environment variable overrode it, the detected Val version, the
negotiated protocol version, and the features the server actually serves.

Three situations have different fixes, and the extension tells them apart:

- **Your Val predates the language server.** Upgrade the package that carries it
  for your project; the notification offers the command for your package manager.
- **You have Val libraries but no framework or CLI package.** Add one — the
  language server travels inside them.
- **The carrier package is new enough but the server will not resolve.** Usually a
  broken or partial install; reinstalling dependencies fixes it. Under Yarn PnP
  there is no `node_modules` to resolve through at all, so set
  `valBuild.languageServerPath`.

Pointing `valBuild.languageServerPath` at a Val monorepo checkout's
`packages/language-server/bin.js` is also how to develop against an unreleased
Val.
