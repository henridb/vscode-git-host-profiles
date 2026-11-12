export interface DecisionState {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

/** Save before a switch, since switching can restart the extension host. */
export class SwitchCoordinator {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly state: DecisionState, private readonly switchProfile: (name: string) => Promise<void>) {}

  apply(signature: string, profile: string | undefined, force = false): Promise<boolean> {
    const operation = this.tail.then(async () => {
      if (!force && this.state.get<string>('lastDecision') === signature) {
        return false;
      }
      const previous = this.state.get<string>('lastDecision');
      await this.state.update('lastDecision', signature);
      if (!profile) {
        return false;
      }
      try {
        await this.switchProfile(profile);
        return true;
      } catch (error) {
        await this.state.update('lastDecision', previous);
        throw error;
      }
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }
}
