export const config = {
  matcher: ["/nossportgfx"],
};

// HTTP Basic Auth gate voor /nossportgfx.
//
// De inloggegevens staan BEWUST niet in deze repo: die is publiek, dus alles
// wat hier hardgecodeerd staat is meteen openbaar. Ze komen uit de Vercel
// environment variables GFX_GEBRUIKER en GFX_WACHTWOORD.
//
// Ontbreken die variabelen, dan weigert de gate alles (fail closed). Liever een
// pagina die niemand binnenlaat dan een pagina die per ongeluk openstaat.

// Vergelijking in constante tijd: een gewone === stopt bij het eerste afwijkende
// teken, waardoor de responstijd verraadt hoeveel tekens al klopten.
function gelijkInConstanteTijd(a, b) {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  // Een lengteverschil mag niet vroegtijdig terugkeren, dus we lopen door over
  // de langste van de twee en tellen dat verschil mee in de uitkomst.
  const n = Math.max(ba.length, bb.length);
  let verschil = ba.length ^ bb.length;
  for (let i = 0; i < n; i++) {
    verschil |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return verschil === 0;
}

const weiger = () =>
  new Response("Authenticatie vereist", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="NOS Sport Graphics", charset="UTF-8"',
      // Niet cachen: anders kan een tussenliggende cache een geslaagde response
      // alsnog aan een niet-ingelogde bezoeker teruggeven.
      "Cache-Control": "no-store",
    },
  });

export default function middleware(request) {
  const gebruiker = process.env.GFX_GEBRUIKER;
  const wachtwoord = process.env.GFX_WACHTWOORD;
  if (!gebruiker || !wachtwoord) return weiger();

  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Basic ")) return weiger();

  let ontcijferd;
  try {
    ontcijferd = atob(auth.slice(6));
  } catch {
    return weiger();
  }

  // Alleen op de eerste dubbele punt splitsen: een wachtwoord mag er zelf ook
  // een bevatten.
  const scheiding = ontcijferd.indexOf(":");
  if (scheiding < 0) return weiger();

  // Beide helften altijd controleren (geen && dat kortsluit), zodat de
  // responstijd niet verraadt of de gebruikersnaam al klopte.
  const gebruikerOk = gelijkInConstanteTijd(ontcijferd.slice(0, scheiding), gebruiker);
  const wachtwoordOk = gelijkInConstanteTijd(ontcijferd.slice(scheiding + 1), wachtwoord);
  if (!(gebruikerOk && wachtwoordOk)) return weiger();

  return;
}
