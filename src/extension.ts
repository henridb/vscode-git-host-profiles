import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { SwitchCoordinator } from './coordinator';
import type { GitApi, GitExtension, Repository } from './git';
import { decide, remoteHost } from './matching';
import { parseRules, type Decision, type Rule, type Snapshot, type Target } from './model';
import { ProfileSwitcher } from './profiles';
import { belongsTo, topLevelRepositories } from './repositories';

const SECTION = 'gitHostProfiles';
const FILE_EXCLUDES = '**/{.git,node_modules}/**';

export interface Inspection {
  readonly decision: Decision;
  readonly ready: boolean;
  readonly paused: boolean;
  readonly enabled: boolean;
}

export interface ExtensionApi {
  inspect(): Promise<Inspection>;
}

class Controller implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel('Git Host Profiles');
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly repositories = new Map<Repository, vscode.Disposable>();
  private gitSubscriptions: vscode.Disposable[] = [];
  private fileWatchers: vscode.Disposable[] = [];
  private readonly coordinator: SwitchCoordinator;
  private git: GitApi | undefined;
  private gitExtension: GitExtension | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private disposed = false;
  private cancellation = new vscode.CancellationTokenSource();
  private pendingForce = false;
  private lastError = '';

  constructor(private readonly context: vscode.ExtensionContext) {
    const switcher = new ProfileSwitcher(context.globalStorageUri);
    this.coordinator = new SwitchCoordinator(context.workspaceState, name => switcher.switchTo(name));
    this.status.command = 'gitHostProfiles.explain';
    this.status.name = 'Git Host Profiles';
    this.status.text = '$(account) Profile rules';
    this.status.show();
    this.subscriptions.push(
      this.output, this.status,
      vscode.commands.registerCommand('gitHostProfiles.explain', async () => {
        const inspection = await this.inspect();
        this.output.appendLine(this.describe(inspection));
        this.output.show(true);
      }),
      vscode.commands.registerCommand('gitHostProfiles.apply', () => {
        this.schedule(true);
      }),
      vscode.commands.registerCommand('gitHostProfiles.togglePause', async () => {
        const paused = !context.workspaceState.get<boolean>('paused', false);
        await context.workspaceState.update('paused', paused);
        this.schedule(!paused);
      }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration(SECTION)) {
          this.watchFiles();
          this.schedule();
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => { this.watchFiles(); this.schedule(); }),
      vscode.window.onDidChangeActiveTextEditor(() => {
        if (!vscode.workspace.workspaceFolders?.length) {
          this.schedule();
        }
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.schedule()),
    );
  }

  async start(): Promise<void> {
    this.watchFiles();
    if (!vscode.env.remoteName) {
      const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
      if (extension) {
        this.gitExtension = await extension.activate();
        this.subscriptions.push(this.gitExtension.onDidChangeEnablement(() => this.connectGit()));
        this.connectGit();
      }
    }
    this.schedule();
  }

  private connectGit(): void {
    this.gitSubscriptions.forEach(subscription => subscription.dispose());
    this.gitSubscriptions = [];
    for (const subscription of this.repositories.values()) {
      subscription.dispose();
    }
    this.repositories.clear();
    this.git = undefined;
    if (this.gitExtension?.enabled) {
      this.git = this.gitExtension.getAPI(1);
      const api = this.git;
      this.gitSubscriptions.push(
        api.onDidChangeState(() => this.schedule()),
        api.onDidOpenRepository(repository => {
          if (this.git === api) {
            this.watchRepository(repository);
            this.schedule();
          }
        }),
        api.onDidCloseRepository(repository => {
          if (this.git === api) {
            this.repositories.get(repository)?.dispose();
            this.repositories.delete(repository);
            this.schedule();
          }
        }),
      );
      api.repositories.forEach(repository => this.watchRepository(repository));
    }
    this.schedule();
  }

  private watchRepository(repository: Repository): void {
    if (!this.repositories.has(repository)) {
      this.repositories.set(repository, repository.state.onDidChange(() => this.schedule()));
    }
  }

  private watchFiles(): void {
    this.fileWatchers.forEach(watcher => watcher.dispose());
    this.fileWatchers = [];
    try {
      const patterns = new Set(this.settings().rules.flatMap(rule => rule.files ?? []));
      for (const pattern of patterns) {
        const watcher = vscode.workspace.createFileSystemWatcher(pattern, false, true, false);
        this.fileWatchers.push(watcher, watcher.onDidCreate(() => this.schedule()), watcher.onDidDelete(() => this.schedule()));
      }
    } catch {
      // The regular evaluation reports invalid settings.
    }
  }

  private settings(): { rules: Rule[]; remoteNames: readonly string[]; enabled: boolean } {
    const configuration = vscode.workspace.getConfiguration(SECTION);
    const remoteNames: unknown = configuration.get('remoteNames', []);
    if (!Array.isArray(remoteNames) || !remoteNames.every(name => typeof name === 'string' && name.trim())) {
      throw new Error('Remote names must be an array of nonempty strings.');
    }
    return {
      rules: parseRules(configuration.get<unknown>('rules', [])),
      remoteNames,
      enabled: configuration.get<boolean>('enabled', true),
    };
  }

  private async snapshot(rules: readonly Rule[], remoteNames: readonly string[], token: vscode.CancellationToken): Promise<Snapshot> {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const candidates = new Map<string, { uri: vscode.Uri; repository?: Repository }>();
    for (const folder of workspaceFolders) {
      const repositories = topLevelRepositories(folder.uri, this.git?.repositories ?? []);
      if (repositories.length) {
        for (const repository of repositories) {
          candidates.set(repository.rootUri.toString(), { uri: repository.rootUri, repository });
        }
      } else {
        // A workspace can open a subfolder of a repository.
        const repository = this.git?.repositories
          .filter(item => belongsTo(item.rootUri, folder.uri))
          .sort((left, right) => right.rootUri.path.length - left.rootUri.path.length)[0];
        candidates.set(folder.uri.toString(), repository ? { uri: folder.uri, repository } : { uri: folder.uri });
      }
    }
    const patterns = [...new Set(rules.flatMap(rule => rule.files ?? []))];
    const targets: Target[] = [];
    for (const { uri, repository } of candidates.values()) {
      const remotes = repository?.state.remotes.filter(remote => remoteNames.length === 0 || remoteNames.includes(remote.name)) ?? [];
      const urls = [...new Set(remotes.flatMap(remote => [remote.fetchUrl, remote.pushUrl])
        .filter((url): url is string => typeof url === 'string' && url.length > 0))];
      const files = new Set<string>();
      for (const pattern of patterns) {
        if (token.isCancellationRequested) {
          break;
        }
        const matches = await vscode.workspace.findFiles(new vscode.RelativePattern(uri, pattern), FILE_EXCLUDES, 1, token);
        if (matches.length) {
          files.add(pattern);
        }
      }
      targets.push({ folder: uri.fsPath, hosts: urls.map(remoteHost).sort(), files });
    }
    const editor = vscode.window.activeTextEditor;
    return {
      targets,
      home: homedir(),
      caseSensitive: process.platform === 'linux',
      ...(!workspaceFolders.length && editor?.document.uri.scheme === 'file'
        ? { standaloneFile: editor.document.fileName } : {}),
    };
  }

  private async evaluate(token: vscode.CancellationToken): Promise<{ inspection: Inspection; signature: string }> {
    const { rules, remoteNames, enabled } = this.settings();
    const paused = this.context.workspaceState.get<boolean>('paused', false);
    let reason: string | undefined;
    if (!enabled) {
      reason = 'Automatic switching is disabled in user settings.';
    } else if (paused) {
      reason = 'Automatic switching is paused for this workspace.';
    } else if (!vscode.workspace.isTrusted) {
      reason = 'Automatic switching requires a trusted workspace.';
    } else if (vscode.env.remoteName || vscode.workspace.workspaceFolders?.some(folder => folder.uri.scheme !== 'file')) {
      reason = 'This version supports local desktop workspaces only.';
    } else if (this.git?.state === 'uninitialized') {
      reason = 'Waiting for Git repository discovery.';
    }
    if (reason) {
      return { inspection: { decision: { reason, rules: [] }, ready: false, paused, enabled }, signature: '' };
    }
    const snapshot = await this.snapshot(rules, remoteNames, token);
    const decision = decide(rules, snapshot);
    // Store a hash, rather than paths, remote URLs, or user configuration.
    const signature = createHash('sha256').update(JSON.stringify({
      rules, remoteNames, targets: snapshot.targets.map(target => ({ ...target, files: [...target.files].sort() })),
      standaloneFile: snapshot.standaloneFile, decision,
    })).digest('hex');
    return { inspection: { decision, ready: true, paused, enabled }, signature };
  }

  async inspect(): Promise<Inspection> {
    const cancellation = new vscode.CancellationTokenSource();
    try {
      return (await this.evaluate(cancellation.token)).inspection;
    } finally {
      cancellation.dispose();
    }
  }

  private describe(inspection: Inspection): string {
    const { decision } = inspection;
    return decision.reason + (decision.profile ? ' Selected profile: ' + decision.profile + '.' : '') +
      (decision.rules.length ? ' Matching rules: ' + decision.rules.map(index => index + 1).join(', ') + '.' : '');
  }

  private schedule(force = false): void {
    if (this.disposed) {
      return;
    }
    this.pendingForce ||= force;
    this.generation++;
    this.cancellation.cancel();
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => { void this.run(); }, 300);
  }

  private async run(): Promise<void> {
    const generation = this.generation;
    const force = this.pendingForce;
    this.cancellation.dispose();
    this.cancellation = new vscode.CancellationTokenSource();
    try {
      const { inspection, signature } = await this.evaluate(this.cancellation.token);
      if (this.disposed || generation !== this.generation) {
        return;
      }
      this.pendingForce = false;
      this.status.text = inspection.paused ? '$(debug-pause) Profile rules' : '$(account) Profile rules';
      this.status.tooltip = this.describe(inspection);
      if (inspection.ready) {
        const switched = await this.coordinator.apply(signature, inspection.decision.profile, force);
        if (switched || force) {
          this.output.appendLine(this.describe(inspection));
        }
      }
      this.lastError = '';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Profile selection failed.';
      this.status.tooltip = message;
      this.output.appendLine(message);
      if (message !== this.lastError) {
        this.lastError = message;
        void vscode.window.showWarningMessage('Git Host Profiles: ' + message);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.cancellation.cancel();
    this.cancellation.dispose();
    this.repositories.forEach(subscription => subscription.dispose());
    this.gitSubscriptions.forEach(subscription => subscription.dispose());
    this.fileWatchers.forEach(watcher => watcher.dispose());
    this.subscriptions.forEach(subscription => subscription.dispose());
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<ExtensionApi> {
  const controller = new Controller(context);
  context.subscriptions.push(controller);
  await controller.start();
  return { inspect: () => controller.inspect() };
}
