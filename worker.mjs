const SOURCE_URL = "https://platform.claude.com/docs/en/release-notes/overview";

const MONTHS = new Map([
  ["january", 0], ["february", 1], ["march", 2], ["april", 3],
  ["may", 4], ["june", 5], ["july", 6], ["august", 7],
  ["september", 8], ["october", 9], ["november", 10], ["december", 11],
]);

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function cdata(value) {
  return `<![CDATA[${String(value).replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function decodeEntities(value) {
  const named = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1].toLowerCase() === "x";
      const number = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function textContent(html) {
  return decodeEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

function absolutize(url) {
  try {
    return new URL(decodeEntities(url), SOURCE_URL).href;
  } catch {
    return SOURCE_URL;
  }
}

function sanitizeHtml(html) {
  return html
    .replace(/<(script|style|button|svg)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--([\s\S]*?)-->/g, "")
    .replace(/<([a-z][a-z0-9]*)\b([^>]*)>/gi, (tag, name, attrs) => {
      const element = name.toLowerCase();
      const allowed = new Set(["a", "br", "code", "em", "li", "ol", "p", "strong", "ul"]);
      if (!allowed.has(element)) return "";
      if (element === "a") {
        const href = attrs.match(/\bhref=(?:"([^"]*)"|'([^']*)')/i);
        return href ? `<a href="${escapeXml(absolutize(href[1] ?? href[2]))}">` : "<a>";
      }
      return `<${element}>`;
    })
    .replace(/<\/([a-z][a-z0-9]*)\s*>/gi, (tag, name) => {
      const element = name.toLowerCase();
      return ["a", "code", "em", "li", "ol", "p", "strong", "ul"].includes(element)
        ? `</${element}>`
        : "";
    })
    .trim();
}

function extractFirstList(html) {
  const start = html.search(/<ul\b/i);
  if (start < 0) return "";

  const tags = /<ul\b[^>]*>|<\/ul\s*>/gi;
  tags.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tags.exec(html))) {
    if (/^<ul\b/i.test(match[0])) depth += 1;
    else depth -= 1;
    if (depth === 0) return html.slice(start, tags.lastIndex);
  }
  return "";
}

function dateFromSlug(slug) {
  const match = slug.match(/^([a-z]+)-(\d{1,2})(?:st|nd|rd|th)?-(\d{4})$/i);
  if (!match) return null;
  const month = MONTHS.get(match[1].toLowerCase());
  if (month === undefined) return null;
  return new Date(Date.UTC(Number(match[3]), month, Number(match[2]), 12));
}

function entriesFromPage(html) {
  const idPattern = /\bid="([a-z]+-\d{1,2}(?:st|nd|rd|th)?-\d{4})"/gi;
  const markers = [];
  const seen = new Set();
  let match;

  while ((match = idPattern.exec(html))) {
    const slug = match[1].toLowerCase();
    if (seen.has(slug)) continue;
    const date = dateFromSlug(slug);
    const headingStart = html.lastIndexOf("<h3", match.index);
    const headingEndAt = html.indexOf("</h3>", match.index);
    if (!date || headingStart < 0 || headingEndAt < 0) continue;
    seen.add(slug);
    markers.push({ slug, date, headingStart, headingEnd: headingEndAt + 5 });
  }

  return markers.map((marker, index) => {
    const nextStart = markers[index + 1]?.headingStart ?? html.length;
    const rawList = extractFirstList(html.slice(marker.headingEnd, nextStart));
    const content = sanitizeHtml(rawList);
    const summary = textContent(content);
    return { ...marker, content, summary };
  }).filter((entry) => entry.content && entry.summary);
}

export function generateFeed(html, selfUrl = "") {
  const entries = entriesFromPage(html);
  if (!entries.length) {
    throw new Error("No dated release-note entries were found; the source page structure may have changed.");
  }

  const items = entries.map((entry) => {
    const sourceLink = `${SOURCE_URL}#${entry.slug}`;
    const dateLabel = entry.date.toLocaleDateString("en-US", {
      timeZone: "UTC", year: "numeric", month: "long", day: "numeric",
    });
    return `    <item>
      <title>${escapeXml(`Claude Platform updates — ${dateLabel}`)}</title>
      <link>${escapeXml(sourceLink)}</link>
      <guid isPermaLink="false">${escapeXml(sourceLink)}</guid>
      <pubDate>${entry.date.toUTCString()}</pubDate>
      <description>${cdata(entry.content)}</description>
      <content:encoded>${cdata(entry.content)}</content:encoded>
    </item>`;
  }).join("\n");

  const atomLink = selfUrl
    ? `\n    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml"/>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Claude Platform release notes</title>
    <link>${escapeXml(SOURCE_URL)}</link>
    <description>Updates to the Claude Platform, including the Claude API, client SDKs, and Claude Console.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>Claude release notes RSS worker</generator>${atomLink}
${items}
  </channel>
</rss>
`;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, source: SOURCE_URL });
    }
    if (url.pathname !== "/" && url.pathname !== "/feed.xml" && url.pathname !== "/rss.xml") {
      return new Response("Not found", { status: 404 });
    }

    try {
      const source = await fetch(SOURCE_URL, {
        headers: { "User-Agent": "ClaudeReleaseNotesRSS/1.0 (+RSS feed generator)" },
        cf: { cacheEverything: true, cacheTtl: 900 },
      });
      if (!source.ok) throw new Error(`Source returned HTTP ${source.status}`);
      const xml = generateFeed(await source.text(), new URL("/feed.xml", request.url).href);
      return new Response(xml, {
        headers: {
          "Content-Type": "application/rss+xml; charset=utf-8",
          "Cache-Control": "public, max-age=900",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (error) {
      return new Response(`Feed generation failed: ${error.message}`, {
        status: 502,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },
};
