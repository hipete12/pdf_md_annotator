import { createApp } from 'vue'
import { createStore } from 'vuex'
import App from './App.vue'
import store from './store'
import './styles/main.css'

console.log('=== PDF Annotator Starting ===')

try {
  console.log('1. App component:', App)
  console.log('2. Store:', store)

  const app = createApp(App)
  console.log('3. Vue app created')

  app.use(store)
  console.log('4. Store attached')

  app.config.errorHandler = (err, vm, info) => {
    console.error('Vue Error:', err)
    console.error('Component:', vm)
    console.error('Info:', info)
  }
  
  app.config.warnHandler = (msg, vm, trace) => {
    console.warn('Vue Warning:', msg)
  }

  const mountedApp = app.mount('#app')
  console.log('5. App mounted to #app:', mountedApp)
  console.log('=== Startup Complete ===')
} catch (error) {
  console.error('Startup Error:', error)
  console.error('Stack:', error.stack)
  // Display error on page
  document.body.innerHTML = `<div style="color: red; padding: 20px;"><h1>Startup Error</h1><pre>${error.message}\n${error.stack}</pre></div>`
}
