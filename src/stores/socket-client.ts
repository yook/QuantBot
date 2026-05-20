// Pure IPC client for PageViewer
// Direct communication with Electron main process via ipcRenderer
import type {
  ProjectData,
  SortedRequestOptions,
  GetAllDataRequest,
  SortedUrlsResponse,
  TableFilterOption,
  ExportUrlsRequest,
} from "../types/schema";

// Type-safe IPC client wrapper class
class IPCClient {
  private ipc: any;

  constructor() {
    this.ipc = (window as any).ipcRenderer;
    if (!this.ipc) {
      console.error('[IPC Client] ipcRenderer not available in window');
    }
  }

  async invoke(channel: string, ...args: any[]) {
    if (!this.ipc || typeof this.ipc.invoke !== 'function') {
      throw new Error('[IPC Client] ipcRenderer.invoke is not available');
    }
    return this.ipc.invoke(channel, ...args);
  }

  // Direct DB calls via IPC
  async getProjectsAll() {
    const result = await this.ipc.invoke('db:projects:getAll');
    return result.success ? result.data : null;
  }

  async getProject(id: number) {
    const result = await this.ipc.invoke('db:projects:get', id);
    return result.success ? result.data : null;
  }

  async insertProject(name: string, url: string) {
    const result = await this.ipc.invoke('db:projects:insert', name, url);
    return result;
  }

  async updateProject(name: string, url: string, id: number) {
    const result = await this.ipc.invoke('db:projects:update', name, url, id);
    return result.success ? result.data : null;
  }

  async deleteProject(id: number) {
    const result = await this.ipc.invoke('db:projects:delete', id);
    return result.success ? result.data : null;
  }

  // IPC event listeners (for worker progress updates)
  on(channel: string, callback: (data: any) => void) {
    if (this.ipc) {
      this.ipc.on(channel, (_event: any, data: any) => callback(data));
    }
  }

  off(channel: string, callback?: (data: any) => void) {
    if (!this.ipc) return;
    if (callback) {
      this.ipc.removeListener(channel, callback);
    } else {
      // Remove all listeners for the channel when no specific callback provided
      try {
        if ((this.ipc as any).removeAllListeners) {
          (this.ipc as any).removeAllListeners(channel);
          return;
        }
      } catch (_e) {}
      // Fallback: safe no-op if underlying API doesn't support removeAllListeners
    }
  }

  async getUrlsAll(projectId: number) {
    const result = await this.ipc.invoke('db:urls:getAll', projectId);
    return result.success ? result.data : [];
  }

  async getUrlsCurrent(projectId: number, skip = 0, limit = 200) {
    const result = await this.ipc.invoke('db:urls:current:get', projectId, skip, limit);
    return result.success ? result.data : [];
  }

  async getUrlsSorted(options: SortedRequestOptions) {
    // Serialize options to plain object to avoid IPC cloning errors
    const plainOptions = JSON.parse(JSON.stringify(options));
    console.log('🔌 [IPC Client] getUrlsSorted sending to Electron:', plainOptions);
    const result = await this.ipc.invoke('db:urls:getSorted', plainOptions);
    console.log('🔌 [IPC Client] getUrlsSorted response:', {
      success: result.success,
      dataLength: result.data?.length || 0,
      db: plainOptions.db,
    });
    return result.success ? result.data : [];
  }

  async getAllUrlsForExport(options: SortedRequestOptions) {
    // Export-specific method that doesn't interfere with UI state
    const plainOptions = JSON.parse(JSON.stringify(options));
    console.log('📤 [IPC Client] getAllUrlsForExport sending to Electron:', plainOptions);
    const result = await this.ipc.invoke('db:urls:getAllForExport', plainOptions);
    console.log('📤 [IPC Client] getAllUrlsForExport response:', {
      success: result.success,
      dataLength: result.data?.length || 0,
      db: plainOptions.db,
    });
    return result.success ? result.data : [];
  }

  async exportUrls(options: ExportUrlsRequest) {
    const plainOptions = JSON.parse(JSON.stringify(options));
    const result = await this.ipc.invoke('db:urls:export', plainOptions);
    if (!result || !result.success) {
      throw new Error(result?.error || 'Export failed');
    }
    return result.data;
  }

  async getUrlHistory(projectId: number, url: string, paramKey: string, limit = 200) {
    const result = await this.ipc.invoke('db:url-history:get', projectId, url, paramKey, limit);
    return result.success ? result.data : [];
  }

  async getUrlsCount(projectId: number, dbTable = 'urls', filters: TableFilterOption[] = []) {
    const plainFilters = JSON.parse(JSON.stringify(Array.isArray(filters) ? filters : []));
    const result = await this.ipc.invoke('db:urls:count', projectId, dbTable, plainFilters);
    return result.success ? result.data?.count || 0 : 0;
  }

  async getCrawlerStats(projectId: number) {
    const result = await this.ipc.invoke('db:stats:crawler:get', projectId);
    return result.success ? result.data : null;
  }

  async deleteFilteredUrls(projectId: number, dbTable = 'urls', filters: TableFilterOption[] = []) {
    const result = await this.ipc.invoke('db:urls:deleteFiltered', projectId, dbTable, filters);
    return result.success ? result.data : null;
  }

  async bulkInsertUrls(projectId: number, urls: string[]) {
    const result = await this.ipc.invoke('db:urls:bulkInsert', projectId, urls);
    return result;
  }

  once(channel: string, cb: (...args: any[]) => void) {
    const wrapper = (_e: any, ...args: any[]) => {
      cb(...args);
      this.ipc.off(channel, wrapper);
    };
    this.ipc.on(channel, wrapper);
    return () => this.ipc.off(channel, wrapper);
  }
}

// Create IPC client instance
export const ipcClient = new IPCClient();

// Legacy exports for backward compatibility (will be migrated gradually)
export const emitGetAllProjects = () => ipcClient.getProjectsAll();
export const emitGetProject = (projectId: string | number) => ipcClient.getProject(Number(projectId));
export const emitChangeProject = (projectId: string | number) => {
  console.warn('[IPC] emitChangeProject is deprecated - use store directly');
  return ipcClient.getProject(Number(projectId));
};
export const emitSaveNewProject = (data: ProjectData) => {
  return ipcClient.insertProject(data.name, data.url || '');
};
export const emitUpdateProject = (data: ProjectData) => {
  return ipcClient.updateProject(data.name, data.url || '', Number(data.id));
};
export const emitDeleteProject = (projectId: string | number | null) => {
  if (projectId) return ipcClient.deleteProject(Number(projectId));
};
export const emitDeleteAll = (_projectId: string | number | null) => {
  console.warn('[IPC] emitDeleteAll not implemented yet');
};
export const emitStartCrawler = (_data: ProjectData) => {
  console.warn('[IPC] emitStartCrawler not implemented yet');
};
export const emitFreezeQueue = () => {
  console.warn('[IPC] emitFreezeQueue not implemented yet');
};
export const emitGetSortedUrls = (options: SortedRequestOptions) => {
  return ipcClient.getUrlsSorted(options);
};
export const emitGetAllData = (_req: GetAllDataRequest) => {
  console.warn('[IPC] emitGetAllData not implemented yet');
};
export const emitSyncProjectStats = (_projectId: number) => {
  console.warn('[IPC] emitSyncProjectStats not implemented yet');
};

// Dynamic event helper for backward compatibility
export const onSortedUrlsData = (
  requestId: string,
  handler: (response: SortedUrlsResponse) => void
) => {
  const eventName = `sorted-urls-data-${requestId}`;
  ipcClient.on(eventName, handler);
  return () => {}; // cleanup handled by IPC
};

// No-op for IPC
export const disconnectSocket = () => {};
export const reconnectSocket = () => {};

// Lightweight compatibility socket object (will be removed gradually)
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
    ipcClient.on(channel, cb);
  },
  off(_channel: string, _cb?: (...args: any[]) => void) {
    try {
      if (_cb) {
        ipcClient.off(_channel, _cb as any);
      } else {
        ipcClient.off(_channel as any);
      }
    } catch (e) {
      // ignore
    }
  },
  once(channel: string, cb: (...args: any[]) => void) {
    ipcClient.once(channel, cb);
  },
  emit(_eventName: string, ..._args: any[]) {
    const eventName = _eventName;
    try {
      switch (eventName) {
        default:
          console.warn('[IPC Socket] emit deprecated / unsupported event:', eventName);
      }
    } catch (e: any) {
      console.error('[IPC Socket] emit mapping error', eventName, e?.message || e);
    }
  },
  connect() {
    // no-op
  },
  disconnect() {
    // no-op
  },
  connected: true,
  disconnected: false,
} as any;

export default ipcClient;
