import type * as vscode from 'vscode';

// The exports of the built-in vscode.git extension, narrowed to what we use.
export interface GitRemote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
}

export interface Repository {
  readonly rootUri: vscode.Uri;
  readonly state: {
    readonly remotes: readonly GitRemote[];
    readonly onDidChange: vscode.Event<void>;
  };
}

export interface GitApi {
  readonly state: 'uninitialized' | 'initialized';
  readonly onDidChangeState: vscode.Event<'uninitialized' | 'initialized'>;
  readonly repositories: readonly Repository[];
  readonly onDidOpenRepository: vscode.Event<Repository>;
  readonly onDidCloseRepository: vscode.Event<Repository>;
}

export interface GitExtension {
  readonly enabled: boolean;
  readonly onDidChangeEnablement: vscode.Event<boolean>;
  getAPI(version: 1): GitApi;
}
