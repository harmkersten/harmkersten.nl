export const config = {
  matcher: ["/nossportgfx"],
};

// HTTP Basic Auth gate voor /nossportgfx. Wachtwoord: sport2026 (geen gebruikersnaam nodig).
const VALID_AUTH = "Basic " + btoa(":sport2026");

export default function middleware(request) {
  const auth = request.headers.get("authorization");
  if (auth === VALID_AUTH) {
    return;
  }
  return new Response("Authenticatie vereist", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="NOS Sport Graphics"' },
  });
}
