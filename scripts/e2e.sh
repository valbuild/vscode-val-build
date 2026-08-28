#!/usr/bin/env bash
set -euo pipefail

# Integration suite: launches a real VS Code with the Val fixture as its
# workspace. Paths and launch arguments live in client/src/test/runTest.ts; the
# CODE_TESTS_PATH / CODE_TESTS_WORKSPACE variables this script used to export
# belonged to the deprecated `vscode` npm module and were read by nothing.

# VS Code sets ELECTRON_RUN_AS_NODE=1 in its extension host, and it is inherited
# by anything started from the integrated terminal. @vscode/test-electron passes
# the environment straight through to the VS Code it spawns, which then runs as
# plain Node and tries to execute the workspace path as a script:
#
#   Error: Cannot find module '.../client/testFixture'
#
# So running `npm test` from inside VS Code fails in a way that looks nothing
# like its cause. Unset it.
unset ELECTRON_RUN_AS_NODE

node "$(dirname "$0")/../client/out/test/runTest"
