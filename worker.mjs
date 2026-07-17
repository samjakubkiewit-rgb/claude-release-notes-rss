const MONTHS = new Map([
  ["january", 0], ["february", 1], ["march", 2], ["april", 3],
  ["may", 4], ["june", 5], ["july", 6], ["august", 7],
  ["september", 8], ["october", 9], ["november", 10], ["december", 11],
]);

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function cdata(value) {
  return `<![CDATA[${String(value).replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function decodeEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
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
  return decodeEntities(html.replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function absoluteUrl(url, baseUrl) {
  try { return new URL(decodeEntities(url), baseUrl).href; }
  catch { return baseUrl; }
}

function sanitizeHtml(html, baseUrl) {
  const paired = ["script", "style", "button", "svg", "form", "nav"];
  let clean = html;
  for (const element of paired) {
    clean = clean.replace(new RegExp(`<${element}\\b[\\s\\S]*?<\\/${element}>`, "gi"), "");
  }
  const allowed = new Set([
    "a", "blockquote", "br", "code", "em", "h2", "h3", "h4", "li", "ol", "p",
    "pre", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul",
  ]);
  return clean.replace(/<!--([\s\S]*?)-->/g, "")
    .replace(/<([a-z][a-z0-9]*)\b([^>]*)>/gi, (tag, name, attrs) => {
      const element = name.toLowerCase();
      if (!allowed.has(element)) return "";
      if (element === "a") {
        const href = attrs.match(/\bhref=(?:"([^"]*)"|'([^']*)')/i);
        return href ? `<a href="${escapeXml(absoluteUrl(href[1] ?? href[2], baseUrl))}">` : "<a>";
      }
      return `<${element}>`;
    })
    .replace(/<\/([a-z][a-z0-9]*)\s*>/gi, (tag, name) => {
      const element = name.toLowerCase();
      return allowed.has(element) && element !== "br" ? `</${element}>` : "";
    }).trim();
}

function parseDate(value) {
  const match = value.trim().match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
  if (!match) return null;
  const month = MONTHS.get(match[1].toLowerCase());
  if (month === undefined) return null;
  return new Date(Date.UTC(Number(match[3]), month, Number(match[2]), 12));
}

function dateLabel(date) {
  return date.toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
}

function isoDay(date) { return date.toISOString().slice(0, 10); }

function dateHeadings(html, level) {
  const headings = [];
  const pattern = new RegExp(`<h${level}\\b([^>]*)>([\\s\\S]*?)<\\/h${level}>`, "gi");
  let match;
  while ((match = pattern.exec(html))) {
    const label = textContent(match[2]);
    const date = parseDate(label);
    if (!date) continue;
    const id = match[1].match(/\bid=(?:"([^"]+)"|'([^']+)')/i);
    headings.push({ start: match.index, end: pattern.lastIndex, date, id: id?.[1] ?? id?.[2] ?? "" });
  }
  return headings;
}

export function entriesFromDatedHtml(html, { sourceUrl, headingLevel, titlePrefix }) {
  const headings = dateHeadings(html, headingLevel);
  const byDate = new Map();
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const end = headings[index + 1]?.start ?? html.length;
    const content = sanitizeHtml(html.slice(heading.end, end), sourceUrl);
    if (!textContent(content)) continue;
    const day = isoDay(heading.date);
    const existing = byDate.get(day);
    if (existing) existing.content += content;
    else byDate.set(day, {
      date: heading.date,
      title: `${titlePrefix} — ${dateLabel(heading.date)}`,
      link: `${sourceUrl}${heading.id ? `#${heading.id}` : ""}`,
      guid: `${sourceUrl}#rss-${day}`,
      content,
    });
  }
  return [...byDate.values()];
}

export function entriesFromPlatformHtml(html, sourceUrl) {
  const idPattern = /\bid="([a-z]+-\d{1,2}(?:st|nd|rd|th)?-\d{4})"/gi;
  const markers = [];
  const seen = new Set();
  let match;
  while ((match = idPattern.exec(html))) {
    const slug = match[1].toLowerCase();
    if (seen.has(slug)) continue;
    const date = parseDate(slug.replaceAll("-", " "));
    const headingStart = html.lastIndexOf("<h3", match.index);
    const headingEndAt = html.indexOf("</h3>", match.index);
    if (!date || headingStart < 0 || headingEndAt < 0) continue;
    seen.add(slug);
    markers.push({ slug, date, start: headingStart, end: headingEndAt + 5 });
  }
  return markers.map((marker, index) => {
    const end = markers[index + 1]?.start ?? html.length;
    const content = sanitizeHtml(html.slice(marker.end, end), sourceUrl);
    return {
      date: marker.date,
      title: `Claude Platform updates — ${dateLabel(marker.date)}`,
      link: `${sourceUrl}#${marker.slug}`,
      guid: `${sourceUrl}#${marker.slug}`,
      content,
    };
  }).filter((entry) => textContent(entry.content));
}

function inlineMarkdown(value, baseUrl) {
  let result = escapeXml(value.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1"));
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (all, label, href) =>
    `<a href="${escapeXml(absoluteUrl(decodeEntities(href), baseUrl))}">${label}</a>`);
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  return result;
}

function markdownToHtml(markdown, baseUrl) {
  const lines = markdown.split(/\r?\n/);
  const output = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }
    const heading = line.match(/^(#{2,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(4, heading[1].length);
      output.push(`<h${level}>${inlineMarkdown(heading[2], baseUrl)}</h${level}>`);
      index += 1; continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(`<li>${inlineMarkdown(lines[index].trim().replace(/^[-*]\s+/, ""), baseUrl)}</li>`);
        index += 1;
      }
      output.push(`<ul>${items.join("")}</ul>`); continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(`<li>${inlineMarkdown(lines[index].trim().replace(/^\d+\.\s+/, ""), baseUrl)}</li>`);
        index += 1;
      }
      output.push(`<ol>${items.join("")}</ol>`); continue;
    }
    const paragraph = [line]; index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,6})\s+|^[-*]\s+|^\d+\.\s+/.test(lines[index].trim())) {
      paragraph.push(lines[index].trim()); index += 1;
    }
    output.push(`<p>${inlineMarkdown(paragraph.join(" "), baseUrl)}</p>`);
  }
  return output.join("");
}

export function entriesFromDatedMarkdown(markdown, { sourceUrl, titlePrefix }) {
  const lines = markdown.split(/\r?\n/);
  const markers = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].trim().match(/^#\s+(.+)$/);
    const date = match ? parseDate(match[1].replace(/\*\*|__/g, "")) : null;
    if (date) markers.push({ index, date });
  }
  const byDate = new Map();
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const end = markers[index + 1]?.index ?? lines.length;
    const content = markdownToHtml(lines.slice(marker.index + 1, end).join("\n"), sourceUrl);
    const day = isoDay(marker.date);
    const existing = byDate.get(day);
    if (existing) existing.content += content;
    else byDate.set(day, {
      date: marker.date,
      title: `${titlePrefix} — ${dateLabel(marker.date)}`,
      link: sourceUrl,
      guid: `${sourceUrl}#rss-${day}`,
      content,
    });
  }
  return [...byDate.values()];
}

export function renderFeed({ title, description, siteUrl, selfUrl, entries }) {
  const sorted = [...entries].sort((a, b) => b.date - a.date || a.title.localeCompare(b.title));
  if (!sorted.length) throw new Error(`No entries found for ${title}`);
  const items = sorted.map((entry) => `    <item>
      <title>${escapeXml(entry.title)}</title>
      <link>${escapeXml(entry.link)}</link>
      <guid isPermaLink="false">${escapeXml(entry.guid)}</guid>
      <pubDate>${entry.date.toUTCString()}</pubDate>
      <description>${cdata(entry.content)}</description>
      <content:encoded>${cdata(entry.content)}</content:encoded>
    </item>`).join("\n");
  const atom = selfUrl ? `\n    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(siteUrl)}</link>
    <description>${escapeXml(description)}</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>Release notes RSS generator</generator>${atom}
${items}
  </channel>
</rss>\n`;
}
