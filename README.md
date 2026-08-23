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

## Using the language server that ships with your Val

By default this extension uses its own bundled language server. That server is
pinned to one version of Val, so a project on a newer Val can get subtly wrong
results from it.

`@valbuild/language-server` fixes that by shipping *with* Val. The extension
resolves it out of your project's `node_modules` and launches it, so one
published extension works against many versions of Val — and because the
contract is LSP, other editors get support nearly for free.

Set **`valBuild.useProjectLanguageServer`** to `true` to opt in. It is `false`
while the two servers reach feature parity; with it on, every feature the
project's server advertises is switched off in the bundled one, so nothing is
reported twice.

One server is started per Val root, because roots in a monorepo may pin different
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

| Setting                                | Default | Description                                                                                              |
| -------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `valBuild.useProjectLanguageServer`    | `false` | Use the language server from your project's Val instead of the bundled one.                               |
| `valBuild.languageServerPath`          | `""`    | Absolute path to a language server entry point, used instead of resolving one from `node_modules`.         |

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
