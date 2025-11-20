import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

import { pinia } from './stores/index'
import { i18n } from './i18n'

// Import Element Plus
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import { ElMessageBox, ElMessage } from 'element-plus'

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
    // Mirror main-process logs into renderer console
    window.ipcRenderer.on('app-log', (_event, payload: { level?: string; args?: any[] }) => {
      try {
        const level = (payload && payload.level) || 'log';
        const args = (payload && payload.args) || [];
        const fn = (console as any)[level] || console.log;
        fn.apply(console, args);
      } catch (e) {
        console.log('[app-log]', payload);
      }
      // Auto-updater events from main process
      window.ipcRenderer.on('auto-updater', async (_ev: any, payload: any) => {
        try {
          const evt = payload && payload.event;
          if (!evt) return;

          if (evt === 'update-available') {
            const info = payload.info || {};
            const ver = info.version || info.releaseName || '';
            const notes = info.releaseNotes || info.releaseNotes || '';
            const message = notes || `Найдена новая версия ${ver}. Запустить скачивание обновления?`;
            try {
              await ElMessageBox.confirm(message, 'Доступно обновление', {
                confirmButtonText: 'Скачать',
                cancelButtonText: 'Отложить',
                type: 'info',
              });
              // Ask main to download the update
              window.ipcRenderer.send('auto-updater-download');
              ElMessage({ type: 'info', message: 'Загрузка обновления началась' });
            } catch (e) {
              // User cancelled
            }
          } else if (evt === 'update-downloaded') {
            const info = payload.info || {};
            const message = `Обновление загружено (${info.version || ''}). Установить и перезапустить сейчас?`;
            try {
              await ElMessageBox.confirm(message, 'Готово к установке', {
                confirmButtonText: 'Установить и перезапустить',
                cancelButtonText: 'Позже',
                type: 'warning',
              });
              window.ipcRenderer.send('auto-updater-quit-and-install');
            } catch (e) {
              // User chose not to install now
            }
          } else if (evt === 'error') {
            const err = payload && payload.error;
            ElMessage.error(`Ошибка автообновления: ${err || 'unknown'}`);
          } else if (evt === 'download-progress') {
            // Optionally show progress toast — for now just log
            console.log('Download progress', payload.progress);
          }
        } catch (err) {
          console.error('auto-updater handler error', err);
        }
      });
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
