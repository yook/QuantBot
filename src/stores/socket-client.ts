// Pure IPC client for QuantBot
// Direct communication with Electron main process via ipcRenderer
import type { ProjectData, SortedRequestOptions, GetAllDataRequest, SortedUrlsResponse } from "../types/schema";

// Type-safe IPC client wrapper class
class IPCClient {
  private ipc: any;

  constructor() {
    this.ipc = (window as any).ipcRenderer;
    if (!this.ipc) {
      console.error('[IPC Client] ipcRenderer not available in window');
    }
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
    return result.success ? result.data : null;
  }

  async updateProject(name: string, url: string, id: number) {
    const result = await this.ipc.invoke('db:projects:update', name, url, id);
    return result.success ? result.data : null;
  }

  async deleteProject(id: number) {
    const result = await this.ipc.invoke('db:projects:delete', id);
    return result.success ? result.data : null;
  }

  async getKeywordsAll(projectId: number) {
    const result = await this.ipc.invoke('db:keywords:getAll', projectId);
    return result.success ? result.data : [];
  }

  async getKeywordsWindow(projectId: number, skip: number, limit: number, sort: Record<string, number> = {}, searchQuery: string = '') {
    // Serialize sort to plain object to avoid IPC cloning errors
    const plainSort = JSON.parse(JSON.stringify(sort));
    const result = await this.ipc.invoke('db:keywords:getWindow', projectId, skip, limit, plainSort, searchQuery);
    return result.success ? result.data : null;
  }

  async insertKeyword(keyword: string, projectId: number, categoryId: number | null, color: string | null, disabled: number) {
    const result = await this.ipc.invoke('db:keywords:insert', keyword, projectId, categoryId, color, disabled);
    return result.success ? result.data : null;
  }

  async updateKeyword(keyword: string, categoryId: number | null, color: string | null, disabled: number, id: number) {
    const result = await this.ipc.invoke('db:keywords:update', keyword, categoryId, color, disabled, id);
    return result.success ? result.data : null;
  }

  async deleteKeyword(id: number) {
    const result = await this.ipc.invoke('db:keywords:delete', id);
    return result.success ? result.data : null;
  }

  async deleteKeywordsByProject(projectId: number) {
    const result = await this.ipc.invoke('db:keywords:deleteByProject', projectId);
    return result.success ? result.data : null;
  }

  async insertKeywordsBulk(keywords: string[], projectId: number) {
    console.log('[IPC Client] insertKeywordsBulk called:', { 
      keywordsCount: keywords.length, 
      projectId,
      firstKeyword: keywords[0],
      lastKeyword: keywords[keywords.length - 1]
    });
    
    try {
      const result = await this.ipc.invoke('db:keywords:insertBulk', keywords, projectId);
      console.log('[IPC Client] insertKeywordsBulk result:', result);
      return result.success ? result.data : null;
    } catch (err) {
      console.error('[IPC Client] insertKeywordsBulk error:', err);
      throw err;
    }
  }

  async getCategoriesAll(projectId: number) {
    const result = await this.ipc.invoke('db:categories:getAll', projectId);
    return result.success ? result.data : [];
  }

  async insertCategory(name: string, projectId: number, color: string) {
    const result = await this.ipc.invoke('db:categories:insert', name, projectId, color);
    return result.success ? result.data : null;
  }

  async updateCategory(name: string, color: string, id: number) {
    const result = await this.ipc.invoke('db:categories:update', name, color, id);
    return result.success ? result.data : null;
  }

  async deleteCategory(id: number) {
    const result = await this.ipc.invoke('db:categories:delete', id);
    return result.success ? result.data : null;
  }

  async getTypingAll(projectId: number) {
    const result = await this.ipc.invoke('db:typing:getAll', projectId);
    return result.success ? result.data : [];
  }

  async insertTyping(projectId: number, url: string, sample: string, date: string) {
    const result = await this.ipc.invoke('db:typing:insert', projectId, url, sample, date);
    return result.success ? result.data : null;
  }

  async updateTyping(url: string, sample: string, date: string, id: number) {
    const result = await this.ipc.invoke('db:typing:update', url, sample, date, id);
    return result.success ? result.data : null;
  }

  async deleteTyping(id: number) {
    const result = await this.ipc.invoke('db:typing:delete', id);
    return result.success ? result.data : null;
  }

  async deleteTypingByProject(projectId: number) {
    const result = await this.ipc.invoke('db:typing:deleteByProject', projectId);
    return result.success ? result.data : null;
  }

  async getStopwordsAll(projectId: number) {
    const result = await this.ipc.invoke('db:stopwords:getAll', projectId);
    return result.success ? result.data : [];
  }

  async insertStopword(projectId: number, word: string) {
    const result = await this.ipc.invoke('db:stopwords:insert', projectId, word);
    return result.success ? result.data : null;
  }

  async deleteStopword(id: number) {
    const result = await this.ipc.invoke('db:stopwords:delete', id);
    return result.success ? result.data : null;
  }

  async deleteStopwordsByProject(projectId: number) {
    const result = await this.ipc.invoke('db:stopwords:deleteByProject', projectId);
    return result.success ? result.data : null;
  }

  // Process runners: categorization, typing, clustering
  async startCategorization(projectId: number) {
    const result = await this.ipc.invoke('keywords:start-categorization', projectId);
    return result.success ? result.data : null;
  }

  async startTyping(projectId: number) {
    const result = await this.ipc.invoke('keywords:start-typing', projectId);
    return result.success ? result.data : null;
  }

  async startClustering(projectId: number, algorithm: string, eps: number, minPts?: number) {
    const result = await this.ipc.invoke('keywords:start-clustering', projectId, algorithm, eps, minPts);
    return result.success ? result.data : null;
  }

  // IPC event listeners (for worker progress updates)
  on(channel: string, callback: (data: any) => void) {
    if (this.ipc) {
      this.ipc.on(channel, (_event: any, data: any) => callback(data));
    }
  }

  off(channel: string, callback?: (data: any) => void) {
    if (this.ipc && callback) {
      this.ipc.removeListener(channel, callback);
    }
  }

  async getUrlsAll(projectId: number) {
    const result = await this.ipc.invoke('db:urls:getAll', projectId);
    return result.success ? result.data : [];
  }

  async getUrlsSorted(options: SortedRequestOptions) {
    // Serialize options to plain object to avoid IPC cloning errors
    const plainOptions = JSON.parse(JSON.stringify(options));
    const result = await this.ipc.invoke('db:urls:getSorted', plainOptions);
    return result.success ? result.data : [];
  }

  async getUrlsCount(projectId: number) {
    const result = await this.ipc.invoke('db:urls:count', projectId);
    return result.success ? result.data?.count || 0 : 0;
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
export const emitClearEmbeddingsCache = () => {
  console.warn('[IPC] emitClearEmbeddingsCache not implemented yet');
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
    // IPC handles cleanup
  },
  once(channel: string, cb: (...args: any[]) => void) {
    ipcClient.once(channel, cb);
  },
  emit(_eventName: string, ..._args: any[]) {
    console.warn('[IPC Socket] emit() is deprecated - use ipcClient methods directly');
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
