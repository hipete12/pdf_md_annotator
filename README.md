# PDF Annotator

A PDF viewer and annotator with Markdown and LaTeX support, built with Electron and Vue 3.
It is also a study chat: start a chat without a PDF, let the model search the web, and turn the
conversation into a Quarto document.

## Features

- **PDF Viewing**: Open and view PDF documents with zoom controls
- **Page Management**: 
  - Sidebar with page thumbnails
  - Multi-select pages (Ctrl+Click, Shift+Click)
  - Drag and drop to reorder pages
  - Delete pages from the view
  - Toggle sidebar visibility
- **Markdown Annotations**:
  - Double-click on PDF to create annotation boxes
  - Live Markdown rendering
  - Resize annotation boxes
  - Per-annotation style customization
- **LaTeX Support**:
  - Inline math with `$...$`
  - Display math with `$$...$$`
  - Custom macros via `\newcommand`
  - Error display for invalid LaTeX
- **Code Highlighting**: Syntax highlighting for 20+ programming languages
- **AI Chat** (`Ctrl+Shift+L`): chat about the open PDF with an LLM
  - OpenRouter, OpenAI, OpenCode Go, local Ollama / LM Studio, or any OpenAI-compatible API
  - The document text is included automatically; select text or click a note to attach it as context
  - Multiple sessions per document, resizable panel, full-screen mode
  - Optional page images for vision-capable models
  - Optional web search and page reading through Tavily
- **Standalone chats** (`Ctrl+N`): a full-window chat without a PDF, saved as `untitled1.chat`, …
  - `/generate [instructions]` writes a Quarto study document from the conversation
  - `/open` shows the rendered document next to the chat; `/open run` also runs its code
- **Keyboard Shortcuts**:
  - `Ctrl+B`: Bold
  - `Ctrl+I`: Italic
  - `Ctrl+U`: Underline
  - `Ctrl+H`: Hide/show annotation
  - `Ctrl+S`: Save
  - `Ctrl+Shift+S`: Save As (copies the PDF and its annotations to a new name)
  - `Ctrl+O`: Open a PDF or a chat
  - `Ctrl+N`: New chat
  - `Ctrl+\`: Toggle sidebar
  - `Ctrl+Shift+L`: Toggle chat
  - `Ctrl+L`: Add the current selection (PDF text, note or chat reply) to the chat
- **Hide/Collapse Annotations**:
  - Press `Ctrl+H` to hide an annotation with a title
  - Shows as a small icon with title when collapsed
  - Click to expand, click elsewhere to collapse again
- **Settings**:
  - Markdown defaults (font size, line height, font family)
  - Annotation box defaults
  - Custom LaTeX macros
  - Customizable keyboard shortcuts
  - Light/Dark theme

## Installation

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build the application (webpack -> app-build/)
npm run build

# Create a Linux AppImage (-> dist/)
npm run dist:linux

# Create a Windows installer (run on Windows)
npm run dist
```

## Linux

`npm run dist:linux` produces `dist/pdf-annotator-<version>-x86_64.AppImage`.

The AppImage automatically detects whether unprivileged user namespaces are available.
On systems that allow them (for example stock Fedora), Electron runs with its sandbox
enabled. On systems that restrict them (for example Ubuntu 23.10+ / 24.04, where AppArmor
restricts unprivileged user namespaces by default), it prints a short notice to stderr and
automatically falls back to `--no-sandbox`. This means the AppImage should just work:

```bash
chmod +x dist/pdf-annotator-*.AppImage
./dist/pdf-annotator-*.AppImage
```

On Ubuntu 24.04+, install the FUSE 2 runtime first:

```bash
sudo apt install libfuse2t64
```

If FUSE is unavailable, run the AppImage with
`APPIMAGE_EXTRACT_AND_RUN=1 ./dist/pdf-annotator-*.AppImage`. This only works around FUSE
mount problems, not sandbox errors.

`--no-sandbox` remains available as an explicit manual override:

```bash
./dist/pdf-annotator-*.AppImage --no-sandbox
```

### Fedora

The legacy AppImage runtime needs FUSE 2. On Fedora, install it with:

```bash
sudo dnf install fuse fuse-libs
```

There is no `libfuse2` package name on Fedora. Normal Fedora Workstation installations
usually already include these packages; minimal installations may also need:

```bash
sudo dnf install gtk3 nss alsa-lib libnotify libXScrnSaver libXtst at-spi2-core xdg-utils mesa-libgbm libdrm cups-libs libxkbcommon libsecret
```

Stock Fedora allows unprivileged user namespaces, so the Electron sandbox stays enabled.

The AppImage contains a desktop entry and PDF MIME association, but automatic registration
requires [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) or `appimaged`.

## .pdfmark File Format

Annotations are saved in a `.pdfmark` file alongside the PDF (not embedded in the PDF itself). This JSON file contains:

```json
{
  "version": "1.0.0",
  "pdfPath": "/path/to/document.pdf",
  "created": "2024-01-01T00:00:00.000Z",
  "modified": "2024-01-01T00:00:00.000Z",
  "annotations": {
    "1": [
      {
        "id": "uuid",
        "type": "markdown",
        "x": 100,
        "y": 200,
        "width": 300,
        "height": 200,
        "content": "# My Note\n\nWith $LaTeX$ support!",
        "style": {
          "fontSize": 14,
          "lineHeight": 1.6
        },
        "isCollapsed": false,
        "collapsedTitle": ""
      }
    ]
  },
  "pageOrder": [1, 2, 3],
  "deletedPages": [],
  "settings": {}
}
```

## AI Chat

Open **Settings → AI Chat**, pick a provider and load its models:

| Provider | Base URL (default) | API key |
|----------|--------------------|---------|
| OpenRouter | `https://openrouter.ai/api/v1` | required |
| OpenAI | `https://api.openai.com/v1` | required |
| OpenCode Go | `https://opencode.ai/inference/go/openai/v1` | required (models list is public) |
| Ollama | `http://localhost:11434/v1` | – (run `ollama serve`) |
| LM Studio | `http://localhost:1234/v1` | – (start the local server) |
| Custom | any OpenAI-compatible `/v1` endpoint | optional |

OpenCode Go requires a stable session id per conversation; the app sends the chat
session's id in the `x-opencode-session` header (requests without it are rejected).

API keys are encrypted with the OS keychain (Electron `safeStorage`) and never leave
the main process. On Linux without a keyring (GNOME Keyring / KWallet) the key is only
obfuscated; the settings page warns about this.

**Model per session.** The model button under the chat box picks the provider and model
for the current session; it is remembered with that session (also after a restart) until
changed. New sessions start with the default model from Settings.

**Regenerate and branches.** *Regenerate* on a reply (or the pencil on your message)
turns your message into an edit box: change it and press Enter to get a new reply, or Esc /
click elsewhere to cancel. The edited message becomes a new branch, so the earlier version is
kept: switch between versions with `‹ n / m ›` under the message, delete one with the trash
button, or open the branch map (icon next to `+`) to see and jump between all branches.

**Context.** Every request includes the document text page by page (`[Page N]`). If it is
larger than the *document text budget*, only the pages nearest the attached context and the
page in view are sent. Selecting text in the PDF, clicking a note, or selecting part of an
earlier reply shows a dashed chip above the message box; click **+** or press `Ctrl+L` to
attach it to your next message. Chips are colour-coded by source: blue for PDF text, amber
for notes, purple for replies (formulas in quoted replies are kept as LaTeX).

**Prompt templates.** The system and user templates are editable. Placeholders:
`{{title}}`, `{{document}}`, `{{selections}}` (attached text/notes) and `{{input}}`.

**Page images.** With *Send page images* enabled (or the image button in the chat box
turned on for a session), the attached-context pages, or the page in view, are sent as
JPEG images. Image support is read from the provider when available (OpenRouter, Ollama,
LM Studio) and guessed from the model name otherwise; it can be overridden per model.

**Storage.** PDF chat sessions are saved to `<name>.pdfchat` next to the PDF (separate from the
`.pdfmark` annotations), and are copied along on *Save As*. Page images are not stored.

## Standalone Chats, Web Search and Documents

The welcome screen offers **Open PDF** and **New chat**, plus your recent PDFs and chats.

**Standalone chats.** *New chat* (`Ctrl+N`) opens a full-window chat with its own tutor-style
system prompt (editable in *Settings → Standalone Chats*). Chats are saved in the chats folder
(default `Documents/PDF Annotator/Chats`) as `untitled1.chat`, `untitled2.chat`, … — the lowest
number for which neither `untitledN.chat` nor `untitledN.qmd` exists. Nothing is written until the
first message. *Save As* (`Ctrl+Shift+S` or the save button) copies the chat and its document under
a new name and switches to the copy; if either target file exists you are asked first.

**Web search.** With a Tavily API key (*Settings → Web Search*), the model can call `web_search`
(Tavily `/search`) and `web_fetch` (Tavily `/extract`) while answering. The globe button in the chat
box turns this on or off per session; it is on by default for standalone chats and off for PDF
chats. Each reply shows the searches and pages it used. After the tool call limit (default 6) the
model must answer with what it found, so every reply ends with a final answer. Web content is passed
to the model as untrusted data. Models that reject tools answer without them.

**Commands** (standalone chats; type `/` to see them):

| Command | What it does |
|---------|--------------|
| `/generate [instructions]` | Writes `<chat name>.qmd` next to the chat from the visible conversation: key points, points of confusion, examples and visualizations. Run it again to update the document with newer parts of the conversation; the text after `/generate` steers it (`{{steer}}` in the instruction). The instruction is editable in *Settings → Documents*. |
| `/open` | Renders the document with Quarto and shows it in a resizable pane beside the chat. Code cells are shown but not run. |
| `/open run` | Same, but runs the code cells (after a confirmation listing them). Needs Jupyter for Python cells, R/knitr for R cells. |
| `/close` | Hides the document. |

The document only changes on `/generate`. Earlier versions are kept in `.versions/<name>/` in the
chats folder (last 10). Commands are never sent to the model as chat messages.

**Quarto is required for `/open`.** Install it from <https://quarto.org/docs/get-started/>. The app
looks in the path set in *Settings → Documents*, your `PATH`, `~/.local/bin`, `/usr/local/bin`,
`/opt/quarto/bin` and `~/opt/quarto-*/bin`. A user-local install without root:

```bash
curl -fsSLO https://github.com/quarto-dev/quarto-cli/releases/download/v1.11.9/quarto-1.11.9-linux-amd64.tar.gz
mkdir -p ~/opt ~/.local/bin && tar -xzf quarto-1.11.9-linux-amd64.tar.gz -C ~/opt
ln -sf ~/opt/quarto-1.11.9/bin/quarto ~/.local/bin/quarto
```

Documents are rendered to a single self-contained HTML file in the app's cache (math as MathML, so
no network is needed) and shown in a sandboxed frame; links open in your browser.

## Auto-Save

The application auto-saves changes to a temporary file (`.pdfmark.tmp`) every 2 seconds. Press `Ctrl+S` to commit changes to the final `.pdfmark` file.

## Development

### Project Structure

```
src/
├── main/           # Electron main process
│   ├── main.js     # Main entry point, IPC, files
│   ├── llm.js      # OpenAI-compatible client (streaming, tool calls)
│   ├── agent.js    # Tool loop that always ends with a final answer
│   ├── webTools.js # Tavily web_search / web_fetch
│   └── quarto.js   # Find Quarto, render documents
├── renderer/       # Vue.js frontend
│   ├── components/ # Vue components
│   ├── store/      # Vuex store
│   ├── utils/      # Utilities (markdown, etc.)
│   └── styles/     # CSS styles
└── common/         # Shared code (settings, providers, chat files, /generate helpers)

app-build/          # Webpack output (generated)
dist/               # electron-builder output (generated)

test/
├── unit/           # Unit tests (Mocha in Node, bundled with webpack: npm test)
└── e2e/            # E2E tests (Playwright)

static/             # Static assets and application icons
scripts/            # Build scripts
```

### Running Tests

```bash
# Unit tests
npm run test

# E2E tests (requires built app)
npm run build
npm run test:e2e
```

### Tech Stack

- **Electron**: Desktop application framework
- **Vue 3**: Frontend framework
- **Vuex**: State management
- **PDF.js**: PDF rendering
- **KaTeX**: LaTeX rendering
- **Prism.js**: Syntax highlighting
- **Marked**: Markdown parsing
- **electron-store**: Persistent settings
- **electron-builder**: Application packaging

## License

MIT
