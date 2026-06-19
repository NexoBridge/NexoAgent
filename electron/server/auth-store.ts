const validTokens = new Set<string>();

export function addAuthToken(token: string) {
  validTokens.add(token);
}

export function removeAuthToken(token: string) {
  validTokens.delete(token);
}

export function hasAuthToken(token: string) {
  return validTokens.has(token);
}
