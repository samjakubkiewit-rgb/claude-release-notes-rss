import { mkdir, writeFile } from "node:fs/promises";
import {
  entriesFromDatedHtml, entriesFromDatedMarkdown, entriesFromPlatformHtml, renderFeed,
} from "./worker.mjs";

const urls = {
  platform: "https://platform.claude.com/docs/en/release-notes/overview",
  claudeApps: "https://support.claude.com/en/articles/12138966-release-notes",
  microsoft: "https://learn.microsoft.com/en-us/microsoft-365/copilot/release-notes?tabs=all",
  chatgpt: "https://help.openai.com/en/articles/6825453-chatgpt-release-notes",
  chatgptReader: "https://r.jina.ai/http://help.openai.com/en/articles/6825453-chatgpt-release-notes",
};

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "ReleaseNotesRSS/2.0 (+GitHub Pages feed generator)" },
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

const [platformHtml, claudeAppsHtml, microsoftHtml, chatgptMarkdown] = await Promise.all([
  fetchText(urls.platform), fetchText(urls.claudeApps), fetchText(urls.microsoft), fetchText(urls.chatgptReader),
]);

const claudeEntries = [
  ...entriesFromPlatformHtml(platformHtml, urls.platform),
  ...entriesFromDatedHtml(claudeAppsHtml, { sourceUrl: urls.claudeApps, headingLevel: 3, titlePrefix: "Claude Apps updates" }),
];
const microsoftEntries = entriesFromDatedHtml(microsoftHtml, {
  sourceUrl: urls.microsoft, headingLevel: 2, titlePrefix: "Microsoft 365 Copilot updates",
});
const chatgptEntries = entriesFromDatedMarkdown(chatgptMarkdown, {
  sourceUrl: urls.chatgpt, titlePrefix: "ChatGPT updates",
});

const baseUrl = process.env.PAGES_BASE_URL ?? "";
const feeds = [
  ["feed.xml", renderFeed({
    title: "Claude release notes", description: "Combined Claude Platform and Claude Apps release notes.",
    siteUrl: urls.platform, selfUrl: baseUrl && `${baseUrl}/feed.xml`, entries: claudeEntries,
  })],
  ["microsoft-365-copilot.xml", renderFeed({
    title: "Microsoft 365 Copilot release notes", description: "Microsoft 365 Copilot features and improvements.",
    siteUrl: urls.microsoft, selfUrl: baseUrl && `${baseUrl}/microsoft-365-copilot.xml`, entries: microsoftEntries,
  })],
  ["chatgpt.xml", renderFeed({
    title: "ChatGPT release notes", description: "The latest updates and release notes for ChatGPT.",
    siteUrl: urls.chatgpt, selfUrl: baseUrl && `${baseUrl}/chatgpt.xml`, entries: chatgptEntries,
  })],
];

await mkdir("public", { recursive: true });
for (const [filename, xml] of feeds) await writeFile(`public/${filename}`, xml, "utf8");
await writeFile("public/index.html", `<!doctype html><meta charset="utf-8"><title>AI release-note feeds</title>
<h1>AI release-note feeds</h1><ul>
<li><a href="feed.xml">Claude release notes (Platform + Apps)</a></li>
<li><a href="microsoft-365-copilot.xml">Microsoft 365 Copilot release notes</a></li>
<li><a href="chatgpt.xml">ChatGPT release notes</a></li>
</ul>`, "utf8");

console.log(JSON.stringify({ claude: claudeEntries.length, microsoft: microsoftEntries.length, chatgpt: chatgptEntries.length }));
