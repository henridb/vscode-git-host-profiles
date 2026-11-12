# Marketplace media

The README includes the extension icon, a short looping demonstration, and a
static alternative. These are presentation assets; the installed extension does
not run the capture tools.

## Files

| File                                              | Purpose                                                 |
| ------------------------------------------------- | ------------------------------------------------------- |
| [media/icon.png](../media/icon.png)               | 256 × 256 PNG used by the extension manifest and README |
| [media/icon-source.png](../media/icon-source.png) | Original generated artwork, retained for future exports |
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

## Icon provenance

The original artwork was created with the built-in image-generation tool and
exported to a 256 × 256 PNG using high-quality bicubic downsampling. The design
uses an original branch-and-profile motif, without hosting-service mascots or
logos. The source image is retained in this repository.

The generation prompt was:

> Use case: logo-brand. Asset type: square Visual Studio Code Marketplace extension icon for an open-source utility named Git Host Profiles. Primary request: one polished, original, minimal app icon expressing Git repository branches automatically selecting editor profiles. Composition: a bold central branching connector with three circular Git-like nodes, transitioning into two small rounded editor-profile cards, one slightly offset behind the other. Keep the silhouette simple and readable at 32 pixels. Flat geometric vector-like style, crisp thick strokes, restrained cyan and warm amber accents on a solid deep ink/navy rounded-square tile, centered with generous safe padding. No letters, words, numbers, watermark, company mascots, GitHub/GitLab/VS Code trademarks, gradients, photographic effects, or mockup surroundings. Deliver one icon only, straight-on, square canvas with an opaque background.
