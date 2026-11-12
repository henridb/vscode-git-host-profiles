# Git Host Profiles

Automatically select a VS Code profile when you open a project, using Git remote
hosts, folder patterns, project files, or standalone file extensions.

For example, show your GitHub tools in GitHub projects and your self-hosted
forge's tools in work projects. New repositories that match your rules need no
individual setup.

## Getting started

1. Create the profiles you want through **File > Preferences > Profiles**.
2. In each profile, choose the extensions and Activity Bar icons you want.
3. Install Git Host Profiles and select **Apply Extension to all Profiles** from
   its extension management menu.
4. Add rules to your **user settings** through
   **Preferences: Open User Settings (JSON)**.

There are no built-in host mappings or profile names. This example uses a public
host and a fictional self-hosted instance; replace the names with your own:

~~~json
{
  "gitHostProfiles.rules": [
    {
      "profile": "GitHub",
      "remoteHosts": ["github.com"]
    },
    {
      "profile": "Work Git",
      "remoteHosts": ["forge.example.org"]
    }
  ]
}
~~~

The profile names must exactly match existing profiles. The extension does not
create profiles, install other extensions, or authenticate with your Git host.
Profile switching can restart extensions or reopen the current workspace.

## Match folders by pattern

Folder rules can cover whole groups of current and future repositories:

~~~json
{
  "gitHostProfiles.rules": [
    {
      "profile": "GitHub",
      "folders": ["~/Documents/gits/gh-*/**"]
    },
    {
      "profile": "Work Git",
      "folders": ["~/Documents/gits/gl-*/**"]
    }
  ]
}
~~~

Folders are matched against their absolute paths. Use forward slashes even on
Windows. A leading ~ expands to your home directory.

| Pattern | Meaning |
| --- | --- |
| * | Zero or more characters within one path segment |
| ? | One character within one path segment |
| ** | Any number of characters, including directory separators |
| **/ | Zero or more directory levels |

Matching is case-insensitive on Windows and macOS, and case-sensitive on Linux.
Braces, brackets, and other regex syntax are literal characters in folder and
host patterns.

## Project files and standalone files

Use files to require project markers. Every file pattern in a rule must find at
least one file; patterns are relative to the repository or workspace folder.
These use [VS Code file glob syntax](https://code.visualstudio.com/docs/editor/glob-patterns).
The extension searches filenames without reading their contents and excludes
.git and node_modules directories.

~~~json
{
  "gitHostProfiles.rules": [
    {
      "profile": "TypeScript",
      "files": ["package.json", "src/**/*.ts"]
    },
    {
      "profile": "Python",
      "fileExtensions": ["py", ".pyi"]
    }
  ]
}
~~~

Standalone file rules apply only when no workspace folder is open and a saved
local file is active. Suffixes are case-insensitive; .d.ts is supported.
Keep standalone file rules separate from folder, host, and project-file rules.

## How selection works

- Rules run in array order. The first matching rule wins for each repository
  or workspace folder.
- Host and folder arrays offer alternatives within that condition. Different
  conditions in one rule must all match. Every project-file pattern is required.
- Every selected fetch and push destination must match a host rule. A repository
  with conflicting or unknown destinations stays unchanged unless another rule,
  such as an explicit folder rule, matches it.
- In a workspace containing multiple repositories discovered by VS Code's Git
  integration, or multiple workspace folders, all must select
  the same profile. A disagreement or an unmatched target keeps the current
  profile. This also applies to saved multi-root workspaces.
- With no match, the current profile stays selected.
- Rules are reevaluated after repository, remote, workspace, rule, or relevant
  filename changes. Standalone files are checked when the active editor changes.
- Manual profile choices are respected while the matching inputs stay the same.
  Use **Apply Profile Rules Now** to reapply the rules.

Hosts are compared locally from URLs such as HTTPS, SSH, and scp-style Git
remotes. Custom ports do not affect host matching. SSH aliases are matched as
written in the remote; SSH configuration and Git URL rewrites are not expanded.
Local filesystem remotes and unrecognized transports have no known host.

Use gitHostProfiles.remoteNames to restrict which remotes count:

~~~json
{
  "gitHostProfiles.remoteNames": ["origin"]
}
~~~

An empty list, the default, considers every remote. Restricting the list
deliberately ignores other destinations.

## Commands and settings

Commands are available through the Command Palette under **Git Host Profiles**:

| Command | Effect |
| --- | --- |
| Explain Profile Selection | Show the selected profile, matching rule numbers, or why no switch applies |
| Apply Profile Rules Now | Reapply the current rules, including after a manual profile choice |
| Pause or Resume Automatic Switching | Remember a pause for the current workspace |

The status bar item opens the explanation. Pause takes precedence over the
Apply command; resume switching first.

| User setting | Default | Effect |
| --- | --- | --- |
| gitHostProfiles.enabled | true | Enable automatic selection |
| gitHostProfiles.rules | [] | Ordered profile selection rules |
| gitHostProfiles.remoteNames | [] | Remote names to consider; empty means all |

These settings apply across profiles and cannot be supplied by workspace or
repository settings. They are excluded from Settings Sync by default. Keep your
private hosts, paths, and profile names in your user settings, outside this
repository. Settings Sync preferences can override the exclusion.

Invalid rules stop selection and show a warning. Use the explanation command
after correcting them.

## Local installation and updates

Build the reviewed source with Node.js 24 or newer:

~~~sh
npm ci
npm test
npm run package
~~~

Choose **Extensions: Install from VSIX...** and select the file under artifacts/.

**Disable auto-update for this extension in its extension management menu.**
VS Code can update a sideloaded extension if a Marketplace item later uses the
same publisher and extension ID. A local VSIX is not, by itself, a guarantee
against future automatic updates.

The initial publisher ID, local-git-host-profiles, is a packaging placeholder,
not a verified publisher or an ownership claim. Before Marketplace publication,
replace it with a publisher you control. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Privacy and compatibility

The extension has no third-party runtime dependencies, telemetry, network
requests, shell commands, or credential requirements. It uses the built-in Git
extension's repository information. Decision logs omit remote URLs and paths;
stored decision markers are hashes.

VS Code extensions still run with VS Code's permissions. Reviewing this source
and controlling updates remain necessary trust decisions.

Automatic selection runs only in trusted **local desktop workspaces**. Remote
SSH, WSL, containers, and virtual workspaces are not supported in this version.

VS Code does not provide a complete public profile-management API. The small
compatibility adapter reads profile names from VS Code's local catalog and
uses its profile-opening commands. It never writes that catalog. Changes to
VS Code's storage layout or commands may require an extension update. When the
adapter cannot find a profile or supported command, it reports the problem
instead of creating profiles or invoking an external program.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for tests, packaging, and the publication
checklist.

## Inspiration and license

Inspired by [VSCode Profile Automatic Switcher](https://marketplace.visualstudio.com/items?itemName=azure-zee.vscode-profile-automatic-switcher)
and its rule-based approach to folders, project files, and file extensions.
This is an independent implementation; no source code was copied.

Licensed under [GPL-3.0-only](LICENSE).
