# Marketplace media

The README includes the extension icon, a short looping demonstration, and a
static alternative. These are presentation assets; the installed extension does
not run the capture tools.

## Files

| File                                              | Purpose                                                 |
| ------------------------------------------------- | ------------------------------------------------------- |
| [media/icon.png](../media/icon.png)               | 256 × 256 PNG used by the extension manifest and README |
| [media/icon.svg](../media/icon.svg) | Editable SVG source for the icon |
| [media/demo.gif](../media/demo.gif)               | Three-frame recording, with 4.5 seconds per state       |
| [media/demo.png](../media/demo.png)               | Static GitHub-state preview                             |

Only the icon, GIF, and static preview are included in the VSIX. The original
artwork, capture scripts, temporary settings, and fixture repositories are
excluded.

## What the demonstration shows

The recording uses the real extension in an isolated VS Code instance. It
changes the origin URL of one temporary repository through three states:

1. github.com selects the existing GitHub profile.
2. forge.example.org selects the existing Work Git profile.
3. other.example.net matches neither rule, so Work Git remains active.

The title bar displays VS Code's actual profile name. The profiles have distinct
colors to make the change visible. The capture also checks the extension's
decision, the Git remote, and a profile-specific editor setting before saving
each frame. It presents the stable results rather than the intermediate reloads.

The JSONC document shown in the editor is an explanation of the rules, not a
workspace configuration file. The actual rules are stored in the fixture's user
settings. No hosting service is contacted, and no credentials are needed.
Extension installation and Activity Bar customization are not demonstrated.

## Re-record

Use the normal development prerequisites from [CONTRIBUTING.md](../CONTRIBUTING.md).
On Windows, run:

```sh
npm run demo
```

By default, the capture uses a downloaded stable VS Code build, through the same
development dependency as the integration tests. Set VSCODE_EXECUTABLE_PATH to
an existing VS Code executable to avoid downloading it, or VSCODE_VERSION to
choose a specific release.

The capture opens a separate VS Code instance with temporary user data,
extensions, Git configuration, and synthetic remotes. It captures only that
instance's renderer through a temporary loopback debugging connection, then
closes the instance. Personal VS Code windows and settings are not recorded.

The scripts have these roles:

- [scripts/demo.cjs](../scripts/demo.cjs) creates the fixture, changes the remote,
  waits for verified results, and saves PNG captures under artifacts/demo/.
- [scripts/demo-probe.cjs](../scripts/demo-probe.cjs) runs only in the fixture,
  checks the selected profile, and opens the explanatory document.
- [scripts/encode-demo.ps1](../scripts/encode-demo.ps1) assembles the frames into
  media/demo.gif and copies the first frame to media/demo.png. It uses Windows'
  built-in WPF encoder; no additional npm dependency is required.

The capture uses synthetic profiles; do not point its user-data directory at
your personal VS Code configuration. Temporary fixture directories and logs
remain in the system temporary directory for troubleshooting.

On Linux or macOS, the capture produces the same three PNG frames and stops
before GIF encoding. Linux requires a graphical session, or xvfb-run. With
FFmpeg installed separately, the frames can be encoded as follows:

```sh
ffmpeg -framerate 2/9 -pattern_type glob -i 'artifacts/demo/0*.png' -filter_complex 'split[a][b];[a]palettegen[p];[b][p]paletteuse' -loop 0 media/demo.gif
```

Copy artifacts/demo/01-github.png to media/demo.png as the static alternative.
Before committing a new recording, inspect every frame and confirm that the
native profile title and depicted remote agree with the scenario.

## Icon source and export

[media/icon.svg](../media/icon.svg) is the editable, hand-authored icon source.
The rounded navy tile has a solid fill, including the centers of the Git nodes
and profile cards. Only the area outside the tile is transparent.

[media/icon.png](../media/icon.png) is the 256 × 256 export used by the README
and Marketplace. To regenerate it after editing the SVG, run:

~~~sh
npm run icon:render
~~~

The exporter needs an installed Chrome, Chromium, or Edge browser. It detects
common installation locations; set GHP_BROWSER_PATH to the browser executable
if it is installed elsewhere. It uses an isolated headless browser profile,
without additional npm dependencies or changes to personal browser settings.

Before saving the PNG, the exporter checks every pixel inside the rounded tile
for full opacity and every pixel outside it for transparency. A one-pixel band
around the outline is excluded from those checks to allow smooth antialiasing.

The exported PNG is committed, so ordinary builds and CI do not need to run a
browser. Commit SVG edits together with their regenerated PNG. Only the PNG is
included in the VSIX; the SVG source and exporter remain development files.
