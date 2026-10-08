### ✨ Features

- **website**: The home page has a new design in the Graphite look of the app, with a window in the hero that shows a share next to what the server stores of it. The public instances list their status and limits, like the largest file and how long a share is kept.
- **website**: The blog has a new design with a filter by tag, a table of contents in every post and an RSS feed. A new post introduces file and note requests.
- **website**: The roadmap runs releases and plans along one line, with the latest release, the work in progress and the next star goal on top.
- **website**: The report page leads through the report step by step, picks the instance from the pasted link and refuses inbox links before sending.
- **website**: The website is in German as well as English, follows the language of the browser like the app and offers Auto, English and Deutsch to choose from. Blog posts show in German where a translation exists.

### 🔒 Security

- **infra**: The report Worker only accepts https links whose last part is a file, a note or a request, and refuses any link with an inbox in its path.
