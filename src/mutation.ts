export interface MutationDeps {
  saveSnapshot: () => void;
  scheduleRedraw: () => void;
  markDirty: () => void;
}

export function runMutation(deps: MutationDeps, action: () => void): void {
  deps.saveSnapshot();
  action();
  deps.scheduleRedraw();
  deps.markDirty();
}
