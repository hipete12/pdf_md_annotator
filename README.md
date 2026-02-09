# PDF Annotator

A PDF viewer and annotator with Markdown and LaTeX support, built with Electron and Vue 3.

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
- **Keyboard Shortcuts**:
  - `Ctrl+B`: Bold
  - `Ctrl+I`: Italic
  - `Ctrl+U`: Underline
  - `Ctrl+H`: Hide/show annotation
  - `Ctrl+S`: Save
  - `Ctrl+O`: Open file
  - `Ctrl+\`: Toggle sidebar
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

# Build for production
npm run build

# Create distributable
npm run dist
```

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

## Auto-Save

The application auto-saves changes to a temporary file (`.pdfmark.tmp`) every 2 seconds. Press `Ctrl+S` to commit changes to the final `.pdfmark` file.

## Development

### Project Structure

```
src/
├── main/           # Electron main process
│   └── main.js     # Main entry point
├── renderer/       # Vue.js frontend
│   ├── components/ # Vue components
│   ├── store/      # Vuex store
│   ├── utils/      # Utilities (markdown, etc.)
│   └── styles/     # CSS styles
└── common/         # Shared code

test/
├── unit/           # Unit tests (Karma + Mocha)
└── e2e/            # E2E tests (Playwright)

static/             # Static assets
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
