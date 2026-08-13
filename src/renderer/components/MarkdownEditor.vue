<template>
  <div 
    class="markdown-editor"
    ref="editorContainer"
    :class="{ editing: isEditing }"
  >
    <!-- Split view: textarea on left, preview on right when editing -->
    <div class="editor-split" v-if="isEditing">
      <textarea
        ref="textareaRef"
        class="markdown-textarea"
        :value="rawContent"
        @input="handleInput"
        @keydown="handleKeydown"
        @blur="handleBlur"
        placeholder="Type markdown here... (Esc to close)"
      ></textarea>
      <div class="markdown-preview live-preview" v-html="renderedContent"></div>
    </div>
    
    <!-- View mode: rendered markdown only -->
    <div 
      v-else
      ref="previewContent"
      class="markdown-preview"
      @click="startEditing"
      v-html="renderedContent"
    ></div>
  </div>
</template>

<script>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useStore } from 'vuex'
import { renderMarkdown } from '../utils/markdown'

export default {
  name: 'MarkdownEditor',
  
  props: {
    content: {
      type: String,
      default: ''
    },
    styleConfig: {
      type: Object,
      default: () => ({})
    }
  },
  
  emits: ['update', 'hide-annotation'],
  
  setup(props, { emit }) {
    const store = useStore()
    const editorContainer = ref(null)
    const textareaRef = ref(null)
    const previewContent = ref(null)
    const rawContent = ref(props.content)
    const isEditing = ref(false)
    
    // Track the position of the last inserted formatting end tag for Tab navigation
    const lastFormatEndPos = ref(null)
    
    // Get LaTeX macros from settings
    const latexMacros = computed(() => store.getters.latexMacros)
    
    // Rendered HTML content
    const renderedContent = computed(() => {
      if (!rawContent.value || rawContent.value.trim() === '') {
        return '<span class="placeholder">Click to add notes...</span>'
      }
      return renderMarkdown(rawContent.value, {
        latexMacros: latexMacros.value
      })
    })
    
    // Watch for external content changes
    watch(() => props.content, (newContent) => {
      if (newContent !== rawContent.value) {
        rawContent.value = newContent
      }
    })
    
    // Start editing mode
    const startEditing = () => {
      isEditing.value = true
      nextTick(() => {
        if (textareaRef.value) {
          textareaRef.value.focus()
          // Move cursor to end
          textareaRef.value.selectionStart = textareaRef.value.value.length
          textareaRef.value.selectionEnd = textareaRef.value.value.length
        }
      })
    }
    
    // Methods
    const handleInput = (e) => {
      rawContent.value = e.target.value
      emit('update', rawContent.value)
    }
    
    const handleKeydown = (e) => {
      // Tab: Jump past formatting markers or insert tab
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        
        const textarea = textareaRef.value
        if (!textarea) return
        
        const cursorPos = textarea.selectionStart
        const text = textarea.value
        
        // Look for common formatting end markers after cursor
        const afterCursor = text.substring(cursorPos)
        
        // Check for various end markers (**, *, </u>, etc.)
        const endMarkers = ['**', '*', '</u>', '</s>', '</mark>', '`', '$$', '$', ']]', ')']
        
        for (const marker of endMarkers) {
          if (afterCursor.startsWith(marker)) {
            // Jump past this marker
            const newPos = cursorPos + marker.length
            textarea.selectionStart = newPos
            textarea.selectionEnd = newPos
            lastFormatEndPos.value = null
            return
          }
        }
        
        // If no marker found, insert a tab character (2 spaces)
        const before = text.substring(0, cursorPos)
        const after = text.substring(cursorPos)
        rawContent.value = before + '  ' + after
        emit('update', rawContent.value)
        
        nextTick(() => {
          textarea.selectionStart = cursorPos + 2
          textarea.selectionEnd = cursorPos + 2
        })
        return
      }
      
      // Bold: Ctrl+B
      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault()
        insertFormatting('**', '**')
        return
      }
      
      // Italic: Ctrl+I
      if (e.ctrlKey && e.key === 'i') {
        e.preventDefault()
        insertFormatting('*', '*')
        return
      }
      
      // Underline: Ctrl+U
      if (e.ctrlKey && e.key === 'u') {
        e.preventDefault()
        insertFormatting('<u>', '</u>')
        return
      }
      
      // Strikethrough: Ctrl+Shift+S
      if (e.ctrlKey && e.shiftKey && e.key === 'S') {
        e.preventDefault()
        insertFormatting('~~', '~~')
        return
      }
      
      // Code: Ctrl+`
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault()
        insertFormatting('`', '`')
        return
      }
      
      // Hide annotation: Ctrl+H
      if (e.ctrlKey && e.key === 'h') {
        e.preventDefault()
        emit('hide-annotation')
        return
      }
      
      // Escape to exit editing
      if (e.key === 'Escape') {
        e.preventDefault()
        isEditing.value = false
        return
      }
    }
    
    const insertFormatting = (startTag, endTag) => {
      if (!textareaRef.value) return
      
      const textarea = textareaRef.value
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const selectedText = textarea.value.substring(start, end)
      
      const before = textarea.value.substring(0, start)
      const after = textarea.value.substring(end)
      
      rawContent.value = before + startTag + selectedText + endTag + after
      emit('update', rawContent.value)
      
      // Position cursor:
      // - If text was selected, place cursor after the selected text but before end tag
      // - If no text selected, place cursor between start and end tags
      nextTick(() => {
        let newPos
        if (selectedText.length > 0) {
          // Text was selected - cursor goes after text, before end tag
          // User can press Tab to jump past end tag
          newPos = start + startTag.length + selectedText.length
        } else {
          // No selection - cursor goes between tags to type new content
          newPos = start + startTag.length
        }
        textarea.selectionStart = newPos
        textarea.selectionEnd = newPos
        textarea.focus()
        
        // Track end tag position for Tab navigation
        lastFormatEndPos.value = start + startTag.length + selectedText.length + endTag.length
      })
    }
    
    const handleBlur = () => {
      // Small delay to allow clicking other elements within the annotation
      setTimeout(() => {
        isEditing.value = false
      }, 150)
      emit('update', rawContent.value)
    }
    
    // Focus the editor
    const focus = () => {
      startEditing()
    }
    
    return {
      editorContainer,
      textareaRef,
      previewContent,
      rawContent,
      isEditing,
      renderedContent,
      startEditing,
      handleInput,
      handleKeydown,
      handleBlur,
      focus
    }
  }
}
</script>

<style scoped>
.markdown-editor {
  height: 100%;
  overflow: hidden;
  position: relative;
}

.markdown-editor.editing {
  overflow: visible;
}

.editor-split {
  display: flex;
  gap: 8px;
  height: 100%;
  min-height: 80px;
}

.editor-split .markdown-textarea {
  flex: 1;
  min-width: 0;
}

.editor-split .live-preview {
  flex: 1;
  min-width: 0;
  border-left: 1px solid var(--border-color);
  padding-left: 8px;
  overflow-y: auto;
  overflow-x: hidden;
}

.markdown-textarea {
  width: 100%;
  height: 100%;
  min-height: 60px;
  border: none;
  outline: none;
  resize: none;
  padding: 0;
  margin: 0;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: var(--md-font-size, 14px);
  line-height: var(--md-line-height, 1.6);
  background: rgba(255, 255, 255, 0.9);
  color: inherit;
  border-radius: 4px;
  padding: 4px;
}

.markdown-preview {
  min-height: 100%;
  cursor: text;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.markdown-preview:empty::before,
.markdown-preview .placeholder {
  content: 'Click to add notes...';
  color: var(--text-muted);
  font-style: italic;
}

.markdown-preview .placeholder {
  color: var(--text-muted);
  font-style: italic;
}

/* Override some katex styles for inline display */
.markdown-preview :deep(.katex) {
  font-size: 1em;
}

.markdown-preview :deep(.katex-display) {
  margin: 0.5em 0;
  overflow-x: auto;
  overflow-y: hidden;
}

/* Math block styling */
.markdown-preview :deep(.math-block) {
  margin: 0.5em 0;
  text-align: center;
}

.markdown-preview :deep(.math-inline) {
  display: inline;
}

.markdown-preview :deep(.math-error) {
  color: #ef4444;
  font-family: monospace;
  font-size: 0.9em;
}

/* Markdown rendered styles */
.markdown-preview :deep(h1),
.markdown-preview :deep(h2),
.markdown-preview :deep(h3) {
  margin-top: 0.5em;
  margin-bottom: 0.25em;
}

.markdown-preview :deep(p) {
  margin: 0.25em 0;
}

.markdown-preview :deep(ul),
.markdown-preview :deep(ol) {
  margin: 0.25em 0;
  padding-left: 1.5em;
}

.markdown-preview :deep(li) {
  margin: 0;
}

.markdown-preview :deep(li p) {
  margin: 0;
}

.markdown-preview :deep(ul) {
  list-style-type: disc;
}

.markdown-preview :deep(ol) {
  list-style-type: decimal;
}

.markdown-preview :deep(blockquote) {
  margin: 0.5em 0;
  padding-left: 1em;
  border-left: 3px solid var(--primary-color);
  color: var(--text-muted);
}

.markdown-preview :deep(code) {
  background: rgba(0, 0, 0, 0.1);
  padding: 0.1em 0.3em;
  border-radius: 3px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}

.markdown-preview :deep(pre) {
  background: rgba(0, 0, 0, 0.1);
  padding: 0.5em;
  border-radius: 4px;
  overflow-x: auto;
}

.markdown-preview :deep(pre code) {
  background: none;
  padding: 0;
}
</style>
