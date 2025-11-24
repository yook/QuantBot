import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  emit(...args: any[]) {
    // Expose emit so renderer code that triggers local ipcRenderer listeners works
    // ipcRenderer.emit triggers listeners registered via ipcRenderer.on in the renderer context
    // Use `any` to avoid typing mismatch; arguments are (channel, ...args)
    try {
      return (ipcRenderer as any).emit(...args);
    } catch (e) {
      // swallow - renderer code should handle absence
      return undefined;
    }
  },

  // You can expose other APTs you need here.
  // ...
})
