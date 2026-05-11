export type RemoveFeedback =
  | { kind: "confirm"; message: string }
  | { kind: "removing"; message: string }
  | { kind: "error"; message: string }
  | null;

export function getRemoveFeedback({
  serverName,
  confirmingRemove,
  isRemoving,
  removeError,
}: {
  serverName: string;
  confirmingRemove: boolean;
  isRemoving: boolean;
  removeError: string | null;
}): RemoveFeedback {
  if (isRemoving) {
    return { kind: "removing", message: `Removing ${serverName}...` };
  }
  if (removeError) {
    return { kind: "error", message: removeError };
  }
  if (confirmingRemove) {
    return { kind: "confirm", message: `Remove "${serverName}"? This cannot be undone.` };
  }
  return null;
}
