<template>
  <div class="welcome-screen">
    <div class="welcome-icon">📄</div>
    <h1 class="welcome-title">PDF Annotator</h1>
    <p class="welcome-text">Open a PDF file to get started</p>
    <button class="btn btn-primary" @click="$emit('open-file')">
      Open PDF File
    </button>
    <p class="welcome-hint">or drag and drop a PDF file here</p>
    
    <div class="welcome-shortcuts">
      <h3>Keyboard Shortcuts</h3>
      <ul>
        <li><kbd>Ctrl+O</kbd> Open PDF</li>
        <li><kbd>Ctrl+S</kbd> Save annotations</li>
        <li><kbd>Ctrl+B</kbd> Bold text</li>
        <li><kbd>Ctrl+I</kbd> Italic text</li>
        <li><kbd>Ctrl+U</kbd> Underline text</li>
        <li><kbd>Ctrl+H</kbd> Hide/Show annotation</li>
        <li><kbd>Ctrl+\</kbd> Toggle sidebar</li>
      </ul>
    </div>
  </div>
</template>

<script>
export default {
  name: 'WelcomeScreen',
  emits: ['open-file']
}
</script>

<style scoped>
.welcome-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 12px;
}

.welcome-shortcuts {
  margin-top: 40px;
  text-align: left;
  background: var(--sidebar-bg);
  padding: 20px 30px;
  border-radius: 8px;
}

.welcome-shortcuts h3 {
  font-size: 14px;
  margin-bottom: 12px;
  color: var(--text-color);
}

.welcome-shortcuts ul {
  list-style: none;
  padding: 0;
}

.welcome-shortcuts li {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 8px;
  display: flex;
  gap: 12px;
}

.welcome-shortcuts kbd {
  background: var(--border-color);
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Consolas', monospace;
  font-size: 11px;
  min-width: 70px;
  text-align: center;
}
</style>
