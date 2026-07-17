import { mkdir, writeFile } from "node:fs/promises";
import { generateFeed } from "./worker.mjs";

const sourceUrl = "https://platform.claude.com/docs/en/release-notes/overview";
const feedUrl = process.env.FEED_URL ?? "";
const response = await fetch(sourceUrl, {
  headers: { "User-Agent": "ClaudeReleaseNotesRSS/1.0 (+GitHub Pages feed generator)" },
});

if (!response.ok) {
  throw new Error(`Release-notes page returned HTTP ${response.status}`);
}

const xml = generateFeed(await response.text(), feedUrl);
await mkdir("public", { recursive: true });
await writeFile("public/feed.xml", xml, "utf8");
await writeFile("public/index.html", `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=feed.xml">
<title>Claude Platform release notes RSS</title>
<p><a href="feed.xml">Open the RSS feed</a></p>
`, "utf8");
console.log("Generated public/feed.xml");
