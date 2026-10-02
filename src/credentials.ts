const API_KEYS = new WeakMap<object, string>();

export function storeApiKey(client: object, apiKey: string): void {
  API_KEYS.set(client, apiKey);
}

export function apiKeyFor(client: object): string {
  const apiKey = API_KEYS.get(client);
  if (apiKey === undefined) {
    throw new Error("SpaceXAI: internal API key state is unavailable");
  }
  return apiKey;
}
