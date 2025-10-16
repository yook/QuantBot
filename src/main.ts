import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

import { pinia } from './stores/index'
import { i18n } from './i18n'

// Import Element Plus
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'

const app = createApp(App)
app.use(pinia);
app.use(i18n);
app.use(ElementPlus);
app.mount('#app').$nextTick(() => {
  // Use contextBridge
  if (window.ipcRenderer) {
    window.ipcRenderer.on('main-process-message', (_event, message) => {
      console.log(message)
    })
  }
})

// HMR cleanup for socket connections in dev mode
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    console.log('HMR: Cleaning up old app instance');
    app.unmount();
  });
}
