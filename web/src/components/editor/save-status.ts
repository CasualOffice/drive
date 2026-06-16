/**
 * SaveStatus — the shared shape Drive uses to render save-state pills
 * in the editor chrome ("Saving…", "Saved 2 min ago", "Save failed").
 *
 * Both `<CasualSheetWorkspace>` and `<CasualDocEditor>` accept an
 * `onSaveStatus` callback and emit transitions through this type.
 * FileFullscreen renders the pill from the captured state; the
 * Preview modal currently ignores it (the modal's autosave pill is
 * sourced from the doc SDK's own `onAutosaveState`).
 */
export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "failed"; message: string };

export type OnSaveStatus = (next: SaveStatus) => void;

/** Wrap a save() function so every invocation announces transitions
 *  through the supplied callback. The original return value flows
 *  through unchanged; thrown errors are re-thrown after `failed`
 *  fires so the SDK's own error path still runs. */
export function withSaveStatus<S extends (...args: never[]) => Promise<unknown>>(
  save: S,
  onSaveStatus: OnSaveStatus | undefined,
): S {
  if (!onSaveStatus) return save;
  return ((...args: Parameters<S>) => {
    onSaveStatus({ kind: "saving" });
    return save(...args)
      .then((result) => {
        onSaveStatus({ kind: "saved", at: Date.now() });
        return result;
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        onSaveStatus({ kind: "failed", message });
        throw err;
      });
  }) as S;
}
