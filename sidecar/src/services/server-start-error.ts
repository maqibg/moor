export function getPublicServerStartErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const missingCommand =
    /^Command "([^"]+)" was not found on PATH while starting this stdio server\./.exec(message);
  if (missingCommand) {
    return `Command "${missingCommand[1]}" was not found. Configure an absolute command path or update this server environment.`;
  }

  const missingAbsoluteCommand =
    /^Command "([^"]+)" is not executable while starting this stdio server\./.exec(message);
  if (missingAbsoluteCommand) {
    return `Command "${missingAbsoluteCommand[1]}" is not executable. Check that the absolute path exists and has execute permission.`;
  }

  return "Server failed to start. Check logs for details.";
}
