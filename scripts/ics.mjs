// Tricolore — calendrier iCalendar (RFC 5545) des matchs du Canadien, à partir de schedule.json.
// - Saison régulière et séries (pas les matchs préparatoires).
// - Heures en UTC (suffixe Z) : les applis les affichent à l'heure locale (heure de l'Est à Montréal).
// - UID stable par match (identifiant LNH) : une mise à jour remplace l'événement, sans doublon.
// - DTSTAMP : heure de la génération. On compare le contenu sans les DTSTAMP pour ne réécrire
//   le fichier (et donc ne committer) que si un match a réellement changé.
const SITE = "https://ciderfer.github.io/tricolore";
const DURATION = "PT2H45M";
const DONE = new Set(["OFF", "FINAL"]);

const loc = (o) => (o ? o.fr || o.default : "");
const esc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const utc = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// Pliage des lignes à 75 octets (UTF-8), sans couper un caractère.
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = "", size = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > limit) { out.push(cur); cur = ""; size = 0; limit = 74; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

function event(g, stamp) {
  const away = loc(g.awayTeam.commonName) || g.awayTeam.abbrev;
  const home = loc(g.homeTeam.commonName) || g.homeTeam.abbrev;
  const start = new Date(g.startTimeUTC);
  const tv = [...new Set((g.tvBroadcasts || []).filter((b) => b.countryCode === "CA").map((b) => b.network))]
    .sort((a, b) => (/RDS|TVA/.test(b) ? 1 : 0) - (/RDS|TVA/.test(a) ? 1 : 0)); // réseaux francophones d’abord, comme sur le site
  const state = g.gameScheduleState || "OK";
  const flag = state === "PPD" ? " (reporté)" : state === "CNCL" ? " (annulé)" : state === "TBD" ? " (heure à confirmer)" : "";
  const lines = [];
  if (g.gameType === 3) lines.push("Séries éliminatoires");
  if (DONE.has(g.gameState) && Number.isFinite(g.awayTeam.score) && Number.isFinite(g.homeTeam.score)) {
    const x = g.gameOutcome?.lastPeriodType;
    lines.push(`Final${g.gameState === "FINAL" ? " (non officiel)" : ""} : ${away} ${g.awayTeam.score}, ${home} ${g.homeTeam.score}${x === "OT" ? " (prolongation)" : x === "SO" ? " (tirs de barrage)" : ""}`);
  }
  lines.push(tv.length ? `Télé : ${tv.join(", ")}` : "Télé : non annoncée");
  if (flag) lines.push(`État : ${flag.trim().replace(/[()]/g, "")}`);
  const url = `${SITE}/match.html?id=${g.id}`;
  lines.push(`Feuille de match : ${url}`);
  lines.push("Tricolore, site de partisan non officiel.");
  const venue = loc(g.venue);
  const place = g.neutralSite ? venue : [venue, loc(g.homeTeam.placeName)].filter(Boolean).join(", ");
  return [
    "BEGIN:VEVENT",
    `UID:${g.id}@tricolore.ciderfer.github.io`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${utc(start)}`,
    `DURATION:${DURATION}`,
    `SUMMARY:${esc(`${away} @ ${home}${flag}`)}`,
    place ? `LOCATION:${esc(place)}` : null,
    `DESCRIPTION:${esc(lines.join("\n"))}`,
    `URL:${url}`,
    `STATUS:${state === "CNCL" ? "CANCELLED" : state === "OK" ? "CONFIRMED" : "TENTATIVE"}`,
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
  ].filter(Boolean);
}

export function buildIcs(schedule, now = new Date()) {
  const stamp = utc(now);
  const games = (schedule?.games || [])
    .filter((g) => (g.gameType === 2 || g.gameType === 3) && g.startTimeUTC && /^\d{10}$/.test(String(g.id)))
    .sort((a, b) => a.startTimeUTC.localeCompare(b.startTimeUTC));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tricolore//Calendrier du Canadien//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Canadiens · Tricolore",
    "X-WR-CALDESC:Matchs du Canadien de Montréal (saison et séries). Site de partisan non officiel.",
    "X-WR-TIMEZONE:America/Toronto",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
    ...games.flatMap((g) => event(g, stamp)),
    "END:VCALENDAR",
  ];
  return { text: lines.map(fold).join("\r\n") + "\r\n", count: games.length };
}

// Contenu sans les DTSTAMP, pour savoir si un match a changé.
export const withoutStamps = (text) => String(text || "").replace(/^DTSTAMP:.*\r?\n/gm, "");
