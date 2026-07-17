# Claude Platform release notes RSS — GitHub Pages

This repository converts the official Claude Platform release-notes page into RSS 2.0 and hosts it free on GitHub Pages.

The GitHub Action runs daily at 11:17 UTC and whenever `main` changes. It publishes the feed at:

`https://YOUR-USERNAME.github.io/claude-release-notes-rss/feed.xml`

The feed contains one item per dated release-note section. Stable source anchors are used as GUIDs so newsletter software can deduplicate items. If the upstream structure changes and no entries are found, the build fails instead of publishing an empty feed.
