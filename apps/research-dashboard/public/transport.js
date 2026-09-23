// How the frontend reaches the API. This default talks to server.mjs over
// HTTP; the static build (scripts/build-static.mjs) swaps in a version that
// runs the same API code in the browser against mock data.

export async function request(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}
