// Static build: the API runs in the browser against mock data. No network.
import { handleApi } from "./src/api.mjs";
import { createMockProvider } from "./src/providers/mock-provider.mjs";

const provider = createMockProvider();

export async function request(path) {
  const body = await handleApi(provider, new URL(path, "https://dashboard.local"));
  return JSON.parse(JSON.stringify(body)); // same shape as an HTTP response
}
