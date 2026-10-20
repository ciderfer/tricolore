// Tricolore — manchettes du Canadien à partir de sources publiques.
// On ne garde QUE : titre, source, date de publication et lien vers l'article original.
// Aucun résumé, aucun texte d'article, aucune image.

const UA = "tricolore (site de partisan; github.com/ciderfer/tricolore)";
const MAX_ITEMS = 8;
const MAX_PER_SOURCE = 3; // pour varier les sources
const MAX_AGE_DAYS = 7;

// hockey: true  => flux déjà limité au hockey : on accepte aussi les noms des joueurs du CH.
// hockey: false => flux de tous les sports : on exige une mention explicite de l'équipe.
export const NEWS_SOURCES = [
  { id: "lnh", name: "LNH.com", kind: "nhl", url: "https://forge-dapi.d3.nhle.com/v2/content/fr-ca/stories?tags.slug=teamid-8&$limit=20" },
  { id: "lapresse", name: "La Presse", kind: "rss", hockey: true, url: "https://www.lapresse.ca/sports/hockey/rss", host: "lapresse.ca" },
  { id: "jdm", name: "Journal de Montréal", kind: "rss", hockey: true, url: "https://www.journaldemontreal.com/sports/hockey/rss.xml", host: "journaldemontreal.com" },
  { id: "radiocanada", name: "Radio-Canada", kind: "rss", hockey: false, url: "https://ici.radio-canada.ca/rss/771", host: "radio-canada.ca" },
  { id: "ledevoir", name: "Le Devoir", kind: "rss", hockey: false, url: "https://www.ledevoir.com/rss/section/sports.xml", host: "ledevoir.com" },
];

// « Canadien(s) » avec majuscule (exclut « Canadienne »), CH, Tricolore, Habs, Centre Bell, St-Louis (entraîneur).
const TEAM_RE = /\b(Canadiens?|CH|Tricolore|Habs|Centre Bell|Martin St-Louis)\b/;
const NOT_TEAM_RE = /\b(un|une) Canadiens?\b/; // « un Canadien » = une personne
const NAME_STOP = new Set(["Anderson", "Evans", "Carrier", "Smith", "Brown"]);

async function get(url, as = "text") {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return as === "json" ? res.json() : res.text();
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
      e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : "";
};

function parseRss(xml) {
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map((m) => ({
    title: tag(m[0], "title"),
    url: tag(m[0], "link") || tag(m[0], "guid"),
    publishedAt: tag(m[0], "pubDate") || tag(m[0], "dc:date"),
  }));
}

function safeUrl(u, host) {
  try {
    const url = new URL(u);
    if (url.protocol !== "https:") return null;
    if (host && !(url.hostname === host || url.hostname.endsWith("." + host))) return null;
    return url.href;
  } catch { return null; }
}

// Nom de joueur : sans tenir compte des accents (« Slafkovsky » ou « Slafkovský »), et en mot entier.
// \b ne suffit pas : en JavaScript, une lettre accentuée n'est pas un caractère de mot (« Slafkovský » ne trouvait jamais rien).
const plain = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const nameRe = (n) => new RegExp(`(?<![\\p{L}\\p{N}])${plain(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u");

function isAboutHabs(title, hockeyFeed, names) {
  if (TEAM_RE.test(title) && !NOT_TEAM_RE.test(title)) return true;
  return hockeyFeed && names.some((n) => nameRe(n).test(plain(title)));
}

async function fromSource(src, names) {
  if (src.kind === "nhl") {
    const data = await get(src.url, "json");
    return (data.items || []).map((x) => {
      const ctx = x.context?.slug;
      const url = ctx === "teamid-8" ? `https://www.nhl.com/fr/canadiens/news/${x.slug}` : `https://www.nhl.com/fr/news/${x.slug}`;
      return { title: decode(x.headline || x.title || ""), url, publishedAt: x.contentDate };
    });
  }
  const items = parseRss(await get(src.url));
  if (!items.length) throw new Error("flux vide ou illisible");
  return items
    .filter((i) => isAboutHabs(i.title, src.hockey, names))
    .map((i) => ({ ...i, url: safeUrl(i.url, src.host) }));
}

const norm = (t) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// rosterLastNames : noms de famille des joueurs actuels (API LNH), pour les flux hockey.
function isoOrNull(v) {
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export async function fetchNews(rosterLastNames = []) {
  const names = rosterLastNames.filter((n) => n && n.length >= 5 && !NAME_STOP.has(n));
  const status = {};
  const all = [];
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400e3;
  await Promise.all(NEWS_SOURCES.map(async (src) => {
    try {
      const items = (await fromSource(src, names))
        .map((i) => ({ title: i.title, source: src.name, url: i.url, publishedAt: isoOrNull(i.publishedAt) }))
        .filter((i) => i.title && i.url && i.publishedAt && Date.parse(i.publishedAt) > cutoff && Date.parse(i.publishedAt) <= Date.now() + 3600e3);
      status[src.id] = { ok: true, name: src.name };
      all.push(...items);
    } catch (err) {
      status[src.id] = { ok: false, name: src.name, error: String(err?.message || err) };
    }
  }));
  // Le plus récent d'abord, sans doublons (même lien ou même titre), au plus MAX_PER_SOURCE par source.
  all.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const seenUrl = new Set(), seenTitle = new Set(), perSource = {}, items = [];
  for (const i of all) {
    const t = norm(i.title);
    if (seenUrl.has(i.url) || seenTitle.has(t)) continue;
    if ((perSource[i.source] || 0) >= MAX_PER_SOURCE) continue;
    seenUrl.add(i.url); seenTitle.add(t); perSource[i.source] = (perSource[i.source] || 0) + 1;
    items.push(i);
    if (items.length >= MAX_ITEMS) break;
  }
  // Ordre fixe (celui de NEWS_SOURCES) pour que meta.json ne change pas sans raison.
  const ordered = Object.fromEntries(NEWS_SOURCES.map((s) => [s.id, status[s.id]]));
  return { items, status: ordered };
}
