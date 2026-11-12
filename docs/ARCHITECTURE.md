# Git Host Profiles: an implementation walkthrough

This guide explains the current implementation from its user-visible behavior
down to its individual functions. The examples use fictional project paths and
reserved example domains. Real hostnames, paths, and rules belong in user settings.

Start with sections 1–4 for the overall design. Sections 5–9 explain the runtime
code. The remaining sections cover tests, packaging, configuration files, and
how to read or extend the project.

## 1. What the extension actually controls

The original goal was to show different Git tools for different projects.
A VS Code profile can already store the relevant extensions and view layout.
The extension's job is to select the appropriate existing profile automatically.

~~~mermaid
flowchart LR
    Project["Open a project"] --> Rules["Evaluate your local rules"]
    Rules --> Profile["Select an existing VS Code profile"]
    Profile --> VSCode["VS Code applies that profile"]
    VSCode --> Extensions["Enabled extensions"]
    VSCode --> Layout["Activity Bar and view layout"]
    VSCode --> Settings["Other profile settings"]
~~~

You create and configure the profiles yourself. For example, one profile can
show GitHub tools and another can show tools for a self-hosted forge.
The switcher does not directly hide Activity Bar icons or decide which other
extensions to install.

Consequently, switching profiles can also change fonts, themes, or other
settings if you configured those differences. Keeping profiles similar except
for the desired Git tools is a user configuration choice.

## 2. Three jobs, with a small adapter at the end

The code separates collecting facts, deciding what they mean, and changing
VS Code's state.

~~~mermaid
flowchart TD
    Settings["User settings"] --> Validation["model.ts: parseRules"]
    Git["Built-in VS Code Git API"] --> Controller["extension.ts: Controller"]
    Workspace["Folders, filenames, active editor"] --> Controller
    Validation --> Controller
    Controller --> Snapshot["Snapshot: plain matching inputs"]
    Snapshot --> Engine["matching.ts: decide"]
    Engine --> Decision["Decision: profile or no selection, plus a reason"]
    Decision --> Coordinator["coordinator.ts: suppress repeated applications"]
    Coordinator --> Adapter["profiles.ts: apply the profile"]
    Catalog["profile-catalog.ts: resolve profile names and IDs"] --> Adapter
    Adapter --> Editor["VS Code profile command and possible window reload"]
~~~

The matching engine has no dependency on the editor's live state. Given the
same rules and snapshot, it produces the same decision. This makes most behavior
easy to test without opening VS Code.

The Controller owns the live editor interaction: event subscriptions, filenames,
Git discovery, the status bar, and commands.

The coordinator remembers which context has already been handled. The profile
adapter contains the version-sensitive interaction with VS Code's profile
implementation.

This division also tells us where to make a change. A rule priority change
belongs in the matching engine; a changed VS Code profile command belongs in
the adapter.

## 3. Follow one project through the system

Suppose your user settings contain:

~~~json
{
  "gitHostProfiles.rules": [
    {
      "profile": "Work Git",
      "remoteHosts": ["forge.example.org"]
    }
  ]
}
~~~

You open a repository whose remote is:

~~~text
git@forge.example.org:team/example.git
~~~

The process is:

1. VS Code loads the extension after startup and calls `activate(context)`.
2. The Controller connects to VS Code's built-in Git extension.
3. Once Git discovery is initialized, the Controller reads the repository's
   remotes through that API.
4. `remoteHost()` extracts `forge.example.org` locally.
5. `snapshot()` represents the facts as plain data.
6. `decide()` checks the ordered rules against those facts.
7. The coordinator records a fingerprint before applying the selection.
8. The profile adapter finds the ID of `Work Git` and invokes VS Code's command.
9. The workspace window may reload. On activation again, the saved fingerprint
   prevents applying the same decision repeatedly.

A simplified snapshot looks like this:

~~~ts
{
  targets: [
    {
      folder: "/projects/gh-team/example",
      hosts: ["forge.example.org"],
      files: new Set()
    }
  ],
  home: "/home/example",
  caseSensitive: true
}
~~~

The folder name is irrelevant to this particular rule: only the host condition
is present.

A simplified decision looks like this:

~~~ts
{
  profile: "Work Git",
  reason: "All repositories and folders select the same profile.",
  rules: [0]
}
~~~

Rule indices are zero-based in the code. The displayed explanation converts
them to human-friendly numbers starting at 1.

## 4. The contract: what “matches” means

These are deliberate behavior choices in the current implementation. Tests
check that the code follows them; passing tests alone do not determine whether
you want a different contract.

### Within one rule

| Condition | How it is interpreted |
| --- | --- |
| `profile` | Exact name of an existing profile |
| `remoteHosts` | Every selected remote destination must match at least one listed host pattern |
| `folders` | The target folder must match at least one listed folder pattern |
| `files` | Every listed pattern must find at least one filename |
| `fileExtensions` | The active standalone file must have at least one listed suffix |

Different workspace conditions in one rule are combined with **AND**.

For example:

~~~json
{
  "profile": "Work TypeScript",
  "remoteHosts": ["forge.example.org"],
  "folders": ["**/work/**"],
  "files": ["package.json", "src/**/*.ts"]
}
~~~

This requires a matching host, a folder under the matching path, and both
project-file patterns. Merely having `package.json` is insufficient.

Host and folder arrays offer alternatives within their condition.
The `files` array is intentionally different: it lists required project
markers, rather than alternatives.

Standalone suffix rules apply only when no workspace folder is open.
Validation rejects combining `fileExtensions` with workspace conditions.

### Across rules

For each target, the **first matching rule wins**. Array order expresses
priority; there is no automatic ranking by specificity.

A broad folder rule placed first can therefore take precedence over a more
specific host rule. Place the rule you want to win first.

### Across repositories and workspace folders

A window has one active profile. All targets must therefore agree.

| Target A selects | Target B selects | Window decision |
| --- | --- | --- |
| Work Git | Work Git | Work Git |
| Work Git | Personal Git | Keep the current profile |
| Work Git | No matching rule | Keep the current profile |

The Controller uses repositories discovered by VS Code's Git integration.
If a workspace folder contains no discovered repository, the folder itself
becomes a target. If a workspace opens a subfolder of a repository, the
Controller can associate it with the enclosing discovered repository.

A repository can also have conflicting remotes. If its fetch destination is
on one host and its push destination is on another, a rule matching only one
host does not match that repository. An explicit folder rule could still match.

The `remoteNames` user setting can deliberately restrict consideration to
particular remotes, such as `origin`. The default considers all remote names,
including their available fetch and push URLs.

## 5. The data types and validation: model.ts

Source: [src/model.ts](../src/model.ts).

An `interface` describes a TypeScript data contract. It does not create a
runtime object or validate incoming JSON. That is why this file contains both
interfaces and an actual validator.

| Interface | Purpose |
| --- | --- |
| `Rule` | A profile name and one or more matching conditions |
| `Target` | Facts about one repository or folder |
| `Snapshot` | All targets in a window, optional standalone file, home directory, and path case behavior |
| `Decision` | Optional selected profile, explanation, and matching rule indices |

### parseRules(value)

Settings arrive as `unknown`: the code must inspect them before trusting their
shape. `parseRules()`:

- Requires an array of rule objects.
- Rejects unknown property names, including likely typos.
- Requires a nonempty profile name and at least one condition.
- Rejects empty or malformed condition arrays.
- Checks host patterns and IPv6 host literals.
- Requires project-file patterns to be relative and disallows parent traversal.
- Checks standalone filename suffixes and incompatible condition combinations.
- Copies condition arrays into newly created rule objects.

The nested `fail(message)` helper adds the rule number to a validation error.

Rejecting a misspelled condition matters. Silently ignoring `remoteHost` when
the user meant `remoteHosts` could make a combined rule broader than intended.

The `readonly` annotations help the TypeScript compiler catch accidental
mutation. They do not freeze JavaScript objects at runtime. Copying the selector
arrays is the concrete protection against retaining a caller's mutable arrays.

## 6. The decision engine: matching.ts

Source: [src/matching.ts](../src/matching.ts).

| Function | Input → result | Role |
| --- | --- | --- |
| `remoteHost(remote)` | Remote text → hostname or `null` | Normalize different remote formats |
| `globMatches(pattern, value, caseSensitive)` | Pattern and text → boolean | Match the small host/folder glob language |
| `folderMatches(pattern, folder, home, caseSensitive)` | Folder pattern and path → boolean | Normalize paths and expand a leading `~` |
| `matchesTarget(rule, target, snapshot)` | One rule and target → boolean | Apply the workspace-condition contract |
| `decide(rules, snapshot)` | Validated rules and facts → `Decision` | Apply priority and require agreement |

### remoteHost()

Both of these produce the same host:

~~~text
https://forge.example.org/team/example.git
git@forge.example.org:team/example.git
                 ↓
        forge.example.org
~~~

The parser handles supported URL-style remotes and scp-style SSH remotes.
It normalizes case and a trailing hostname dot. User information, repository
paths, and ports do not become part of the host.

Local paths, Git remote-helper syntax, malformed inputs, and unsupported
transports return `null`. An unknown host is represented explicitly, rather
than guessed.

This function parses text. It does not authenticate, contact the forge,
read SSH configuration, or resolve SSH aliases. An alias in a remote is
matched as that alias.

### globMatches() and folderMatches()

Host and folder matching support `*`, `?`, and `**`. The glob is converted to
an anchored regular expression; other regex characters are escaped.

For example:

~~~text
Pattern:  **/gits/gh-*/**
Path:     /home/example/gits/gh-new-team/new-repository
Result:   match
~~~

`*` stays within a path segment; `**` can cross separators.
`**/` also permits zero directory levels.

`folderMatches()` first normalizes backslashes to forward slashes, expands a
leading `~` using the supplied home directory, and removes trailing separators.
The Controller currently chooses case-sensitive folder matching on Linux and
case-insensitive matching on Windows and macOS.

Project-file patterns take a different route: the Controller passes those
directly to VS Code's filename search API. They use VS Code's file glob syntax.

### matchesTarget() and decide()

`matchesTarget()` contains the per-rule boolean logic. It excludes standalone
suffix rules from workspace matching and checks the host, folder, and
project-file conditions.

`decide()` has two branches:

~~~mermaid
flowchart TD
    Start["decide"] --> Workspace{"Any workspace targets?"}
    Workspace -->|No| Standalone["Find the first matching standalone suffix rule"]
    Workspace -->|Yes| Each["Find the first matching workspace rule for each target"]
    Each --> All{"Every target matched?"}
    All -->|No| Keep["Return no selected profile"]
    All -->|Yes| Agree{"All selected profile names agree?"}
    Agree -->|No| Keep
    Agree -->|Yes| Select["Return that profile"]
    Standalone --> Result["Return a profile or no selection, with a reason"]
~~~

The engine returns a decision. It does not perform the switch.

## 7. Connecting the editor to the engine: extension.ts and git.ts

Sources: [src/extension.ts](../src/extension.ts) and
[src/git.ts](../src/git.ts).

### The entry point and VS Code context

`activate(context)` is the function VS Code calls to start the extension.
It creates a Controller, registers it for disposal, starts it, and returns a
small inspection API for checking the current decision.

The `context` provides VS Code-managed resources such as workspace state,
the extension's storage URI, and a place to register cleanup operations.

The exported `ExtensionApi` exposes `inspect()`. Its result, `Inspection`,
contains the decision and whether evaluation is ready, enabled, or paused.
The integration probe uses it without reaching into private Controller fields.

### Git API types

`git.ts` describes the small part of the built-in Git extension's API that the
Controller consumes.

| Interface | What it describes |
| --- | --- |
| `GitRemote` | A remote name and optional fetch/push URLs |
| `Repository` | A repository root, remotes, and repository-change event |
| `GitApi` | Discovery state, current repositories, and repository open/close events |
| `GitExtension` | Enablement state, its change event, and `getAPI(1)` |

These are type descriptions, not another Git implementation. The runtime uses
the Git support already supplied by VS Code. The switcher's runtime does not
spawn its own Git process.

### Controller functions

The constructor wires the profile adapter and coordinator together. It also
creates the output channel and status bar item, registers the three commands,
and subscribes to configuration, workspace, editor, and trust changes.

The other functions divide into four groups:

| Function | Responsibility |
| --- | --- |
| `start()` | Set up file watchers, activate the built-in Git extension when applicable, connect to it, and schedule initial evaluation |
| `connectGit()` | Replace Git subscriptions when enablement changes; watch discovery and repository open/close events |
| `watchRepository(repository)` | Subscribe once to changes in a discovered repository |
| `watchFiles()` | Replace watchers for configured project-file patterns; reevaluate on filename creation/deletion |
| `settings()` | Read user configuration and validate rules and remote names |
| `snapshot(rules, remoteNames, token)` | Collect the plain matching inputs |
| `evaluate(token)` | Check operating conditions, gather a snapshot, decide, and calculate the fingerprint |
| `inspect()` | Evaluate and return an explanation without applying it |
| `describe(inspection)` | Format the explanation and human-readable rule numbers |
| `schedule(force)` | Debounce events, invalidate stale work, and remember an explicit reapply request |
| `run()` | Evaluate the latest context, update status, and send a ready decision to the coordinator |
| `dispose()` | Clear timers, cancel work, and dispose watchers, subscriptions, and UI resources |

The module-level `belongsTo(parent, child)` helper checks URI scheme and
authority, then uses a relative path to test containment. This avoids confusing
a sibling such as `/projects/repo-other` with a descendant of `/projects/repo`.

### What snapshot() actually stores

`snapshot()` associates workspace folders with discovered repositories, filters
the selected remote names, gathers fetch/push URLs, and turns them into hosts.

It searches each requested project-file pattern with a maximum of one result:
the question is whether a match exists. It excludes `.git` and `node_modules`.

An important detail: `Target.files` contains the **patterns that found a match**,
not the matched paths or file contents.

~~~ts
{
  folder: "/projects/example",
  hosts: ["forge.example.org"],
  files: new Set(["package.json", "src/**/*.ts"])
}
~~~

The matching engine can consequently test `target.files.has(pattern)` without
knowing anything about filesystem APIs.

### When evaluate() declines to act

Evaluation is not ready to apply a decision when switching is disabled, the
workspace is paused or untrusted, the workspace is remote/virtual, or the Git
API is still initializing.

Waiting for Git initialization avoids prematurely treating a newly opened Git
project as a plain folder before its remotes are discovered.

A ready evaluation can still have no selected profile. That means matching
completed but did not find an agreed selection; it is different from waiting
for discovery.

### Commands

| Command | Constructor callback |
| --- | --- |
| Explain Profile Selection | Call `inspect()`, format the explanation, and show the output channel |
| Apply Profile Rules Now | Call `schedule(true)` to bypass duplicate suppression for this application |
| Pause or Resume Automatic Switching | Toggle the saved workspace pause flag, then schedule reevaluation; resuming requests a reapply |

The Apply command does not bypass pause, trust checks, or unsupported-workspace
checks. These are evaluated before any decision is applied.

## 8. Handling events, asynchronous work, and reloads

There are four separate problems here, with a mechanism for each.

| Problem | Mechanism | Location |
| --- | --- | --- |
| Several events arrive together | A 300 ms debounce timer | `Controller.schedule()` |
| An old search finishes after newer information arrives | Generation number and cancellation token | `schedule()` and `run()` |
| Two application requests overlap | A Promise chain that serializes operations | `SwitchCoordinator.apply()` |
| Reloading starts the extension again | A persisted decision fingerprint | `evaluate()` and `SwitchCoordinator.apply()` |

### Debouncing and stale results

Opening a repository can trigger discovery events, state changes, and editor
events in quick succession. Scheduling resets the timer, so the code waits for
a short quiet period instead of reacting immediately to every event.

The `generation` counter is incremented for each new schedule request. A run
captures its generation before awaiting searches. If the counter has changed
by the time the searches finish, that result is stale and is discarded.

Cancellation asks outstanding searches to stop early. The generation check is
still needed because cancellation and completion can race.

### The coordinator and its fingerprint

Source: [src/coordinator.ts](../src/coordinator.ts).

`DecisionState` describes the small storage interface the coordinator needs:
`get()` and `update()`. The live extension passes VS Code's workspace state;
unit tests pass a small in-memory implementation.

The constructor receives that state and a function capable of switching to a
profile. It does not need to know about VS Code commands.

`apply(signature, profile, force)`:

1. Waits behind any previous application request.
2. Skips an already handled fingerprint unless `force` is true.
3. Saves the fingerprint before attempting the switch.
4. If no profile was selected, records the context without switching.
5. Otherwise invokes the supplied switch function.
6. Restores the previous marker if the switch reports a failure.

The `tail` Promise is the queue. Each new operation is appended with `then()`.
A rejection is absorbed on the queue's continuation so one failed request
does not prevent later requests from running. The caller still receives the
actual operation's rejection.

`evaluate()` computes the fingerprint from the rules, remote-name selection,
targets, found file-pattern strings, optional standalone file, and decision.
The targets contain parsed hosts, not raw remote URLs.

The data is serialized and hashed with SHA-256. Sets of found patterns are
converted to sorted arrays before serialization.

That hash is a context-comparison marker. It is not a signature of the
installed extension, an approval decision, or a guarantee about future updates.

### Why persistence happens before the switch

~~~mermaid
sequenceDiagram
    participant Code as VS Code
    participant Controller as Controller
    participant State as Workspace state
    participant Adapter as Profile adapter
    Code->>Controller: Activate and discover project
    Controller->>Controller: Evaluate rules and calculate fingerprint H
    Controller->>State: Save lastDecision = H
    Controller->>Adapter: Apply selected profile
    Adapter->>Code: Profile command, then reload if needed
    Code->>Controller: Activate after reload
    Controller->>Controller: Calculate fingerprint H again
    Controller->>State: Read lastDecision
    State-->>Controller: H
    Controller->>Controller: Skip repeated application
~~~

Saving only after the switch would be too late if the extension host stopped
before reaching that instruction.

This suppression also respects manual profile choices while the matching
inputs remain unchanged. An explicit Apply request can reapply the rule.

The current implementation compares fingerprints, not the selected name against
a complete public current-profile API. Changed rules or matching inputs can
therefore trigger an application/reload even if the desired profile name has
not changed.

An unmatched context is recorded too. This lets a transition from context A,
to an unmatched context B, and back to A be handled as a new transition.

## 9. Applying a profile: profiles.ts and profile-catalog.ts

Sources: [src/profiles.ts](../src/profiles.ts) and
[src/profile-catalog.ts](../src/profile-catalog.ts).

The rules use a human-readable profile name. VS Code's per-profile command
uses an internal ID. The adapter translates between them.

~~~text
Rule profile name:  "Work Git"
         ↓ local profile catalog
Profile ID:         "example-profile-id"
         ↓ fixed command prefix
Command:            workbench.profiles.actions.profileEntry.example-profile-id
~~~

| Function | Role |
| --- | --- |
| `profileCatalogPath(extensionStoragePath)` | Locate the common profile catalog starting from the storage URI supplied by VS Code |
| `profileIds(value)` | Validate catalog data and build a name-to-ID map |
| `ProfileSwitcher.constructor(globalStorageUri)` | Retain the editor-supplied storage location |
| `ProfileSwitcher.switchTo(name)` | Resolve a configured profile, verify command availability, invoke it, and request a workspace-window reload |

The catalog resolver handles both default-profile storage and storage beneath
a named profile. It derives the path from VS Code's supplied URI rather than
hardcoding a particular user's home directory or installation path.

`profileIds()` includes the built-in `Default → default` mapping. Named entries
must have usable names and restricted ID strings; duplicate names are rejected
as ambiguous.

The adapter checks that the target exists and the expected command is
registered. If a lookup fails, it reports an error rather than creating a
profile or choosing another one.

During integration testing, a native profile command could save a newly opened
folder's profile association without changing the current window immediately.
The adapter consequently requests `workbench.action.reloadWindow` when workspace
folders are open. The persisted fingerprint prevents repeating that reload for
an unchanged context.

This is the main compatibility limitation. VS Code does not expose a complete
public profile-management API; catalog layout and internal command names can
change. Keeping this behavior in two small files limits the changes needed
when adapting to another VS Code version.

The code reads the catalog. VS Code itself performs any changes to profile
associations through its commands; the extension never edits the catalog file.

## 10. Where information is kept

| Information | Location / handling |
| --- | --- |
| Host, folder, and profile rules | VS Code user settings; no private mapping is built into the source |
| Enabled flag and selected remote names | Application-scoped user settings |
| Workspace pause flag | VS Code's workspace state |
| Last handled decision | A hash in workspace state |
| Existing profile names and IDs | Read from VS Code's local profile catalog |
| Decision explanations | The local Git Host Profiles output channel and status tooltip |
| Integration-test projects and settings | Newly created temporary directories |

The configuration entries use `scope: "application"`, so repository settings
cannot supply them and the rules apply across profiles. `ignoreSync: true`
excludes them from Settings Sync by default; user sync preferences can override
that exclusion.

A relevant consequence of automatic profile selection is that a profile can
enable other installed extensions. Automatic operation is therefore disabled
for untrusted workspaces, and the runtime also checks workspace trust.

The running extension contains no third-party npm runtime dependencies,
network requests, or subprocess launches. Development scripts do launch Git,
VS Code, and the packaging tool while testing or building. Those scripts are
excluded from the installed package.

## 11. What the tests establish

### Contract tests

| File | Tests | Behavior covered |
| --- | ---: | --- |
| [test/matching.test.ts](../test/matching.test.ts) | 12 | Remote formats, domain boundaries, mixed destinations, folder globs, literal regex characters, priority, required files, target agreement, suffix rules, validation, ownership, IPv6 |
| [test/coordinator.test.ts](../test/coordinator.test.ts) | 4 | Persistence before switching, restart suppression, queued duplicates, force, failure recovery, returning from an unmatched context |
| [test/profile-catalog.test.ts](../test/profile-catalog.test.ts) | 2 | Catalog locations and valid/unambiguous name-to-ID mapping |

The matching tests build representative `Target` and `Snapshot` values.
The coordinator tests use a fake state store and switch callback to check
observable ordering and behavior without starting the editor.

The `state()` helper in coordinator tests creates the in-memory store.
The `target()` and `snapshot()` helpers in matching tests keep fixtures concise.

### Actual VS Code integration

Sources: [scripts/integration.cjs](../scripts/integration.cjs) and
[test/integration.ts](../test/integration.ts).

The outer Node.js runner prepares a separate environment:

~~~mermaid
flowchart TD
    Runner["scripts/integration.cjs: main"] --> Fixture["Temporary project, Git remotes, settings and profiles"]
    Fixture --> Install["Copy compiled runtime and test probe into isolated extensions directory"]
    Install --> Launch["Start a separate VS Code instance"]
    Launch --> Probe["test/integration.ts: activate and run"]
    Probe --> Host["Verify automatic remote-host selection"]
    Host --> Reload["Profile change restarts editor components"]
    Reload --> Probe
    Probe --> Folder["Verify folder/file rules and pause/resume"]
    Folder --> Mixed["Verify mixed remote destinations and unmatched rules"]
    Mixed --> Result["Write result JSON and close the test window"]
    Result --> Check["Runner checks the result and process exit"]
~~~

The runner's `main()` creates the fixtures, locates or downloads VS Code, starts
it, enforces a timeout, and checks the result. Its nested `write()` helper writes
fixture files; `git()` runs local Git commands to initialize fixture repositories
and configure fictional remotes.

The test probe is a separate temporary extension:

- `activate()` starts the checks and records a failure if one occurs.
- `until(check, message)` polls a condition until it succeeds or times out.
- `run()` performs the assertions, using a small phase file to continue after
  profile-related extension-host restarts.

The phases are `host` and `folder`. The phase file is outside the extension host
so restarting the host does not erase test progress.

The named fixture profiles use distinct tab sizes. Observing the corresponding
tab size after a change checks that the profile took effect, rather than merely
checking which name our own matching engine selected.

The fixtures also contain a conflicting workspace-level rule, verifying that
it cannot override the application-scoped user rule.

At implementation handoff, contract tests passed, the single-workspace
integration passed on Windows with VS Code 1.100.0 and 1.145.3, and the saved
two-folder workspace/mixed-destination scenario passed with 1.145.3.
CI is configured for additional operating-system and version combinations;
that configuration is not evidence that remote CI has already passed.

The integration fixtures disable workspace trust prompts to run as trusted
fixtures. They do not establish behavior of every trust prompt, remote setup,
editor customization, or operating system. Remote workspaces are explicitly
unsupported in this version.

## 12. Building the extension and the VSIX

~~~mermaid
flowchart LR
    Source["src/*.ts and test/*.ts"] --> Compiler["TypeScript compiler"]
    Compiler --> Runtime["dist/src/*.js"]
    Compiler --> Tests["dist/test/*.js"]
    Tests --> Node["Node contract tests / isolated VS Code probe"]
    Runtime --> Package["vsce packages the manifest allowlist"]
    Metadata["Manifest, README, changelog and license"] --> Package
    Package --> VSIX["artifacts/*.vsix"]
~~~

TypeScript is the source language. VS Code runs the generated JavaScript.
The `@types/vscode` development package supplies compile-time API declarations;
the actual `vscode` API module is supplied by the editor at runtime.

The VSIX is the installable archive. Its allowlist includes the compiled runtime
and package metadata/documents. Tests, developer scripts, local settings,
dependency trees, and this walkthrough are excluded.

| npm command | Purpose |
| --- | --- |
| `npm ci` | Install the locked development dependencies |
| `npm run check` | Type-check without generating JavaScript |
| `npm run compile` | Compile source and tests into `dist` |
| `npm test` | Compile, then run the Node contract tests |
| `npm run test:integration` | Compile, then start the isolated editor test |
| `npm run clean` | Remove generated `dist` output |
| `npm run package` | Create the VSIX under `artifacts` |
| `npm run vscode:prepublish` | Clean and compile; the packaging tool invokes this before packaging too |

The name `vscode:prepublish` does not mean the command uploads the extension.
The current build workflow contains no publishing step.

[scripts/package.cjs](../scripts/package.cjs) creates the artifacts directory,
reads the manifest name/version to form the output filename, and invokes the
official packaging tool with `--no-dependencies`. Its process exit code reports
whether packaging succeeded.

[scripts/clean.cjs](../scripts/clean.cjs) removes the generated `dist` directory.
There is no application logic in either script.

The package manifest's `files` allowlist and inspection of the finished archive
are what establish which files are delivered. Declaring a dependency as
development-only is not the only packaging control.

## 13. The remaining project files

| File | Role |
| --- | --- |
| [package.json](../package.json) | Extension identity, entry point, minimum VS Code version, startup activation, commands, configuration schema, capabilities, developer tools, scripts, package allowlist |
| [package-lock.json](../package-lock.json) | Exact resolved development dependency tree and package integrity values |
| [tsconfig.json](../tsconfig.json) | Strict TypeScript checks, JavaScript target, source inclusion, and generated output location |
| [.npmrc](../.npmrc) | Save exact dependency versions and disable dependency install scripts |
| [.gitignore](../.gitignore) | Keep generated files, dependencies, downloaded editor builds, logs, and environment files out of Git |
| [.gitattributes](../.gitattributes) | Consistent text line endings and binary treatment for VSIX files |
| [.editorconfig](../.editorconfig) | UTF-8, indentation, trailing whitespace, and final-newline conventions |
| [.vscode/launch.json](../.vscode/launch.json) | F5 extension development launch configuration |
| [.vscode/tasks.json](../.vscode/tasks.json) | Compilation task and compiler-error integration |
| [.github/workflows/ci.yml](../.github/workflows/ci.yml) | Contract/package jobs on Linux, Windows and macOS; isolated editor tests on Ubuntu for minimum/stable versions and one/two-root workspaces |
| [README.md](../README.md) | Installation, local configuration examples, matching behavior, supported environments, update considerations, inspiration |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Development commands, test setup, packaging and publication checklist |
| [CHANGELOG.md](../CHANGELOG.md) | User-facing release changes |
| [LICENSE](../LICENSE) | The repository's existing GPLv3 license, preserved |
| [This guide](ARCHITECTURE.md) | Explanation of how the implementation fits together |

The manifest contains a placeholder publisher ID for local packaging.
Publishing requires replacing it with a publisher you control.

A sideloaded VSIX can still be updated if a Marketplace extension later uses the
same publisher/name ID. The README therefore instructs users of the local build
to disable auto-update for this extension. Reviewing the current source does
not establish the safety of a future release.

The README credits VSCode Profile Automatic Switcher as inspiration.
The implementation was written independently.

Generated directories have different purposes:

| Directory | Contents |
| --- | --- |
| `node_modules/` | Installed development tools |
| `dist/` | Compiled JavaScript |
| `artifacts/` | Generated VSIX archive |
| `.vscode-test/` | Downloaded editor builds when needed |

## 14. TypeScript constructs used in the code

These comparisons may help if you are more familiar with Python:

| Construct | Meaning in this code |
| --- | --- |
| `interface` | A compile-time description of an object's fields and methods |
| `readonly` | A compile-time restriction on mutation; it does not freeze data |
| `unknown` | A value that must be checked before its fields can be used |
| `undefined` | An absent optional value, such as no selected profile |
| `Set` / `Map` | Similar purposes to Python's `set` / `dict` |
| `array.some(predicate)` | Like `any(...)` |
| `array.every(predicate)` | Like `all(...)` |
| `array.findIndex(predicate)` | Index of the first matching element, or -1 |
| `value?.field` | Read a field only if the value is present |
| `value ?? fallback` | Use the fallback for `null` or `undefined` |
| `...object` or `...array` | Copy/spread fields or elements into a new container |
| `value!` | Tell the compiler the value is present; this adds no runtime check |
| `Promise` and `async/await` | Represent asynchronous work without blocking while waiting |
| `Disposable` | An object with cleanup behavior, such as removing an event listener |
| `CancellationToken` | A way to ask an asynchronous operation to stop |
| `Uri` | An address containing a scheme, authority, and path; not always a local filename |

In particular, a TypeScript assertion is not input validation. The actual
validation in `parseRules()` and `profileIds()` is what checks external data.

## 15. Where to make future changes

| Desired change | Main places to examine |
| --- | --- |
| Change rule priority or agreement behavior | `matching.ts` and contract tests; then update the documented contract |
| Add a matcher | `model.ts`, manifest schema, `matching.ts`, and possibly `Controller.snapshot()` |
| React to another editor event | Controller subscriptions and scheduling |
| Change explanations or status display | `describe()`, `inspect()` and UI callbacks |
| Handle a new VS Code profile layout or command | `profile-catalog.ts` and `profiles.ts` |
| Support remote workspaces | Extension placement, Git API availability, storage location and compatibility checks; removing the guard alone is insufficient |
| Change delivered files | Manifest `files` allowlist and packaging inspection |
| Publish to the Marketplace | Publisher ownership, manifest metadata, release review and CONTRIBUTING checklist |

For a manual code review, a useful reading order is:

1. [model.ts](../src/model.ts): learn the data contracts and validation.
2. [matching.ts](../src/matching.ts): follow the decision without editor details.
3. [matching tests](../test/matching.test.ts): compare the contract with examples.
4. [extension.ts](../src/extension.ts): follow how real facts reach the engine.
5. [coordinator.ts](../src/coordinator.ts): inspect state and restart handling.
6. [profile-catalog.ts](../src/profile-catalog.ts) and
   [profiles.ts](../src/profiles.ts): examine the compatibility boundary.
7. [integration tests](../test/integration.ts) and their
   [runner](../scripts/integration.cjs): inspect the evidence for actual editor behavior.
