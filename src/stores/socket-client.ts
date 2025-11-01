// Switched from socket.io to Electron ipcRenderer-based transport
// Uses `window.ipcRenderer.invoke/on/off` exposed by preload
import type { ProjectData, SortedRequestOptions, GetAllDataRequest, SortedUrlsResponse } from "../types/schema";

// Stable per-window instance id for debugging
const clientInstanceId = (() => {
  const w = window as any;
  if (!w.__ipcClientInstanceId) {
    w.__ipcClientInstanceId = `renderer-${Math.random().toString(36).slice(2, 8)}-${Date.now()}`;
  }
  return w.__ipcClientInstanceId as string;
})();

// Ensure renderer asks main to register handlers
try {
  // ignore result for now
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).ipcRenderer.invoke('socket:connect', { clientInstanceId }).catch((e: any) => {
    console.warn('ipc socket connect failed', e);
  });
} catch (e) {
  console.warn('ipc socket connect error', e);
}

// Type-safe socket client wrapper class
class TypedSocketClient {
  // wrapper that uses ipcRenderer.invoke/send to interact with main
  private clientId: string;

  constructor(clientId: string) {
    this.clientId = clientId;
  }

  private emit(eventName: string, ...args: any[]) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ipcRenderer.invoke('socket:emit', {
        clientInstanceId: this.clientId,
        eventName,
        args,
      });
    } catch (e) {
      console.warn('ipc emit failed', e);
    }
  }

  // Project management emits
  getAllProjects() { this.emit('get-all-projects'); }
  getProject(projectId: string | number) { this.emit('get-project', projectId); }
  changeProject(projectId: string | number) { this.emit('change-project', projectId); }
  saveNewProject(data: ProjectData) { this.emit('save-new-project', data); }
  updateProject(data: ProjectData) { this.emit('update-project', data); }
  deleteProject(projectId: string | number | null) { this.emit('delete-project', projectId); }
  deleteAll(projectId: string | number | null) { this.emit('delete-all', projectId); }
  clearEmbeddingsCache() { this.emit('clear-embeddings-cache'); }

  // Crawler emits
  startCrawler(data: ProjectData) { this.emit('startCrauler', data); }
  freezeQueue() { this.emit('freezeQueue'); }

  // Table emits
  getSortedUrls(options: SortedRequestOptions) { this.emit('get-sorted-urls', options); }
  getAllData(req: GetAllDataRequest) { this.emit('get-all-data', req); }

  // Stats emits
  syncProjectStats(projectId: number) { this.emit('sync-project-stats', projectId); }

  // Listeners wired via preload ipcRenderer.on/off
  on(channel: string, cb: (...args: any[]) => void) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).ipcRenderer.on(channel, (_e: any, ...args: any[]) => cb(...args));
    return () => (window as any).ipcRenderer.off(channel, cb);
  }

  once(channel: string, cb: (...args: any[]) => void) {
    const wrapper = (_e: any, ...args: any[]) => {
      cb(...args);
      (window as any).ipcRenderer.off(channel, wrapper);
    };
    (window as any).ipcRenderer.on(channel, wrapper);
    return () => (window as any).ipcRenderer.off(channel, wrapper);
  }

  // Compatibility typed listener helpers (wrap common event names)
  onAllProjectsData(cb: (data: any) => void) { return this.on('all-projects-data', cb); }
  onProjectData(cb: (data: any) => void) { return this.on('project-data', cb); }
  onNewProjectData(cb: (data: any) => void) { return this.on('new-project-data', cb); }
  onStopping(cb: (data: any) => void) { return this.on('stopping', cb); }
  onStopped(cb: (data: any) => void) { return this.on('stopped', cb); }
  onComplete(cb: () => void) { return this.on('complete', cb); }
  onFetched(cb: (data: any) => void) { return this.on('fetched', cb); }
  onQueue(cb: (data: any) => void) { return this.on('queue', cb); }
  onStatsUpdate(cb: (data: any) => void) { return this.on('statsUpdate', cb); }
  onDataUpdated(cb: (data: any) => void) { return this.on('data-updated', cb); }
  onUrlsAllData(cb: (data: any) => void) { return this.on('urls-all-data', cb); }
  onProjectStatssynced(cb: (data: any) => void) { return this.on('project-stats-synced', cb); }
  onDeleted(cb: (data: any) => void) { return this.on('deleted', cb); }
  onCrawlerDataCleared(cb: (data: any) => void) { return this.on('crawler-data-cleared', cb); }
  onDeleteError(cb: (err: any) => void) { return this.on('delete-error', cb); }
  onProjectDeleted(cb: () => void) { return this.on('projectDeleted', cb); }
  onProjectDeleteError(cb: (err: any) => void) { return this.on('projectDeleteError', cb); }
  onProjectSaveError(cb: (err: any) => void) { return this.on('project-save-error', cb); }
  onDisallow(cb: (n: number) => void) { return this.on('disallow', cb); }
  onStatHtml(cb: (data: any) => void) { return this.on('stat-html', cb); }
  onStatJscss(cb: (data: any) => void) { return this.on('stat-jscss', cb); }
  onStatImage(cb: (data: any) => void) { return this.on('stat-image', cb); }
  onStatRedirect(cb: (data: any) => void) { return this.on('stat-redirect', cb); }
  onStatError(cb: (data: any) => void) { return this.on('stat-error', cb); }
  onStatDepth3(cb: (data: any) => void) { return this.on('stat-depth3', cb); }
  onStatDepth5(cb: (data: any) => void) { return this.on('stat-depth5', cb); }
  onStatDepth6(cb: (data: any) => void) { return this.on('stat-depth6', cb); }
  onStatOther(cb: (data: any) => void) { return this.on('stat-other', cb); }
  onSortedUrlsData(requestId: string, cb: (data: any) => void) {
    const eventName = `sorted-urls-data-${requestId}`;
    return this.on(eventName, cb);
  }
}

// Create typed client instance
export const typedSocketClient = new TypedSocketClient(clientInstanceId);

// Legacy exports for backward compatibility
export const emitGetAllProjects = () => typedSocketClient.getAllProjects();
export const emitGetProject = (projectId: string | number) => typedSocketClient.getProject(projectId);
export const emitChangeProject = (projectId: string | number) => typedSocketClient.changeProject(projectId);
export const emitSaveNewProject = (data: ProjectData) => typedSocketClient.saveNewProject(data);
export const emitUpdateProject = (data: ProjectData) => typedSocketClient.updateProject(data);
export const emitDeleteProject = (projectId: string | number | null) => typedSocketClient.deleteProject(projectId);
export const emitDeleteAll = (projectId: string | number | null) => typedSocketClient.deleteAll(projectId);
export const emitStartCrawler = (data: ProjectData) => typedSocketClient.startCrawler(data);
export const emitFreezeQueue = () => typedSocketClient.freezeQueue();
export const emitGetSortedUrls = (options: SortedRequestOptions) => typedSocketClient.getSortedUrls(options);
export const emitGetAllData = (req: GetAllDataRequest) => typedSocketClient.getAllData(req);
export const emitSyncProjectStats = (projectId: number) => typedSocketClient.syncProjectStats(projectId);
export const emitClearEmbeddingsCache = () => typedSocketClient.clearEmbeddingsCache();

// Dynamic event helper for backward compatibility
export const onSortedUrlsData = (
  requestId: string,
  handler: (response: SortedUrlsResponse) => void
) => {
  const eventName = `sorted-urls-data-${requestId}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).ipcRenderer.on(eventName, (_e: any, payload: any) => handler(payload));
  return () => (window as any).ipcRenderer.off(eventName, handler as any);
};

// Disconnect socket (useful for cleanup during HMR)
export const disconnectSocket = () => {
  try { (window as any).ipcRenderer.invoke('socket:disconnect', { clientInstanceId }); } catch (e) {}
};

// Reconnect is a no-op for IPC (reconnect handled by page lifecycle)
export const reconnectSocket = () => {};

// HMR cleanup
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.log('Socket client module reloaded via HMR');
  });
  
  import.meta.hot.dispose(() => {
    console.log('Socket client module disposing - keeping socket alive for reuse');
    // Don't disconnect - we want to reuse the socket
  });
}

// Provide a lightweight compatibility `socket` object (default export)
// so existing modules that import `socket` continue to work.
type IpcSocket = {
  on(channel: string, cb: (payload: any) => void): void;
  off(channel: string, cb?: (payload: any) => void): void;
  once(channel: string, cb: (payload: any) => void): void;
  emit(eventName: string, ...args: any[]): void;
  connect(): void;
  disconnect(): void;
  connected: boolean;
  disconnected: boolean;
};

export const socket: IpcSocket = {
  on(channel: string, cb: (...args: any[]) => void) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).ipcRenderer.on(channel, (_e: any, ...args: any[]) => cb(...args));
  },
  off(channel: string, cb?: (...args: any[]) => void) {
    try { (window as any).ipcRenderer.off(channel, cb); } catch (e) {}
  },
  once(channel: string, cb: (...args: any[]) => void) {
    const wrapper = (_e: any, ...args: any[]) => {
      cb(...args);
      (window as any).ipcRenderer.off(channel, wrapper);
    };
    (window as any).ipcRenderer.on(channel, wrapper);
  },
  emit(eventName: string, ...args: any[]) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).ipcRenderer.invoke('socket:emit', { clientInstanceId, eventName, args });
    } catch (e) {}
  },
  connect() {
    try { (window as any).ipcRenderer.invoke('socket:connect', { clientInstanceId }); } catch (e) {}
  },
  disconnect() {
    try { (window as any).ipcRenderer.invoke('socket:disconnect', { clientInstanceId }); } catch (e) {}
  },
  // compatibility flags
  connected: true,
  disconnected: false,
} as any;

export default socket;
