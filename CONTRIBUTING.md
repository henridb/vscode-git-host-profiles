# Contributing

Use Node.js 24 or newer and npm. Keep hostnames, paths, account details, and
tokens out of committed configuration. Examples use reserved example domains.

## Local checks

~~~sh
npm ci
npm run check
npm test
npm run test:integration
npm run package
~~~

Dependency install scripts are disabled by .npmrc. The runtime uses only Node.js
and VS Code APIs; developer tools are locked in package-lock.json.

The minimatch override pins the packaging tool's transitive dependency to a
release addressing GHSA-g3hv-75wg-m249. It is development-only. Recheck the
override when updating @vscode/vsce, including package contents and npm audit.

The contract tests cover rule validation, remote parsing, glob boundaries,
multi-target agreement, caller ownership, profile catalog layouts, restart
suppression, and top-level repository selection. The integration test creates
a temporary Git repository with a real submodule, profiles, and a user-data
directory, then verifies native profile changes across extension-host restarts
and that a dependency's conflicting host does not affect its parent.
It does not use your normal VS Code configuration.

The integration runner downloads stable VS Code by default. Set
VSCODE_EXECUTABLE_PATH to use an existing installation, or VSCODE_VERSION to
test another release. Set GHP_TEST_MULTI_ROOT=1 to exercise a saved multi-root
workspace. On Linux, use xvfb-run -a npm run test:integration when
no display server is available. Fixtures and logs are retained in the system
temporary directory for troubleshooting. The test-only probe is never included
in the VSIX.

Press F5 to launch the development extension for a manual check. Use isolated
test profiles rather than personal workspaces when testing profile changes.

## Code layout

Start with the [implementation walkthrough](docs/ARCHITECTURE.md) to understand
the architecture, matching contract, and how the runtime functions fit together.

- src/model.ts validates the user configuration and defines the matching inputs.
- src/matching.ts makes profile decisions without accessing VS Code.
- src/coordinator.ts prevents repeated switches across reloads.
- src/repositories.ts selects top-level repositories within each workspace root.
- src/extension.ts collects workspace information and manages commands/events.
- src/profiles.ts and src/profile-catalog.ts isolate profile compatibility.

Put matching semantics in the pure engine and test the public behavior. The
order of rules is the priority mechanism; avoid adding implicit specificity
rules. An unknown host or unmatched workspace target must not silently select
a fallback profile.

## Presentation assets

The [media guide](docs/MEDIA.md) describes the icon and the reproducible demo.
Run npm run demo to capture profile switching in an isolated VS Code instance;
on Windows it also rebuilds the GIF. Inspect all frames before committing them.

## Packaging and future publication

npm run package creates a VSIX in artifacts/. The package contains the runtime,
README, changelog, license, manifest, and icon/demo assets. Developer tools,
tests, fixtures, original icon artwork, local
settings, and source-control files are excluded.

Before publishing:

1. Confirm that you can publish under the `HenrideBoutray` Marketplace publisher.
2. Check that package.json uses that publisher ID. The integration runner
   derives the extension ID from that manifest.
3. Review the README, license, version, and changelog. Add a Marketplace icon
   if desired.
4. Run all checks and inspect npx vsce ls --no-dependencies.
5. Test the exact VSIX in an isolated VS Code profile.
6. Follow the current [official publishing instructions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

CI validates changes and builds a VSIX. It has read-only repository permissions
and no publishing credentials or publication step. Publishing requires a
separate decision; do not add credentials to the repository.
