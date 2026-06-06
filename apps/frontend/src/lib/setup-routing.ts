export function getSetupRedirectPath(
  pathname: string,
  requiresSetup: boolean,
): string | null {
  const isSetupPath = pathname.startsWith("/app/setup");

  if (requiresSetup && !isSetupPath) {
    return "/app/setup";
  }

  if (!requiresSetup && isSetupPath) {
    return "/app";
  }

  return null;
}
