import { io, Socket } from "socket.io-client";
import type { ServerToClientEvents, ClientToServerEvents } from "../types/socket-events";
import type { 
  ProjectData, 
  SortedRequestOptions,
  GetAllDataRequest,
  SortedUrlsResponse,
  UrlData,
  ProjectStatsSync,
  CrawlerStatus,
  QueueUpdate,
  TableUpdate,
  Stats,
  ProjectSummary
} from "../types/schema";

const port = import.meta.env.VITE_DEV_SERVER_URL ? 8090 : 8090;
// Stable per-window instance id for debugging
const clientInstanceId = (() => {
  const w = window as any;
  if (!w.__socketClientInstanceId) {
    w.__socketClientInstanceId = `renderer-${Math.random().toString(36).slice(2, 8)}-${Date.now()}`;
  }
  return w.__socketClientInstanceId as string;
})();

// Singleton pattern to prevent multiple socket instances during HMR
let socket: Socket<ServerToClientEvents, ClientToServerEvents>;

// Check if socket already exists in window (for HMR)
if (import.meta.hot) {
  // In dev mode, reuse existing socket if available
  if ((window as any).__appSocket) {
    console.log('Reusing existing socket connection from previous HMR');
    socket = (window as any).__appSocket;
  } else {
    console.log('Creating new socket connection');
    socket = io(`ws://localhost:${port}/`, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 20000,
      transports: ["websocket"],
      path: "/quantbot-socket",
      query: { clientInstanceId },
    });
    // Store socket in window for HMR reuse
    (window as any).__appSocket = socket;
  }
} else {
  // Production: create socket normally
  socket = io(`ws://localhost:${port}/`, {
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    timeout: 20000,
    transports: ["websocket"],
    path: "/quantbot-socket",
    query: { clientInstanceId },
  });
}
// Avoid duplicate base listeners across HMR reloads
const wAny = window as any;
if (!wAny.__socketBaseListenersRegistered) {
  wAny.__socketBaseListenersRegistered = true;
  socket.on("connect", () => {
    console.log("Socket connected:", { id: socket.id, port, clientInstanceId });
  });
  socket.on("connect_error", (error: Error) => {
    console.error("Socket connection error:", error.message);
    console.log("Make sure the socket.io server is running on port", port);
  });
  socket.on("disconnect", (reason: string) => {
    console.log("Socket disconnected:", reason);
  });
  // Using raw socket for system events that aren't in our typed interface
  (socket as any).on("reconnect", (attemptNumber: number) => {
    console.log("Socket reconnected after", attemptNumber, "attempts");
  });
  (socket as any).on("reconnect_error", (error: Error) => {
    console.error("Socket reconnection failed:", error.message);
  });
} else {
  // In case of HMR re-evaluation, skip re-binding base listeners
  console.log("socket-client: base listeners already registered, skipping re-bind");
}

// Type-safe socket client wrapper class
class TypedSocketClient {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents>;

  constructor(socketInstance: Socket<ServerToClientEvents, ClientToServerEvents>) {
    this.socket = socketInstance;
  }

  // Project management emits
  getAllProjects() {
    this.socket.emit("get-all-projects");
  }

  getProject(projectId: string | number) {
    this.socket.emit("get-project", projectId);
  }

  changeProject(projectId: string | number) {
    this.socket.emit("change-project", projectId);
  }

  saveNewProject(data: ProjectData) {
    this.socket.emit("save-new-project", data);
  }

  updateProject(data: ProjectData) {
    this.socket.emit("update-project", data);
  }

  deleteProject(projectId: string | number | null) {
    this.socket.emit("delete-project", projectId);
  }

  deleteAll(projectId: string | number | null) {
    this.socket.emit("delete-all", projectId);
  }

  clearEmbeddingsCache() {
    this.socket.emit("clear-embeddings-cache");
  }

  // Crawler emits
  startCrawler(data: ProjectData) {
    this.socket.emit("startCrauler", data);
  }

  freezeQueue() {
    this.socket.emit("freezeQueue");
  }

  // Table emits
  getSortedUrls(options: SortedRequestOptions) {
    this.socket.emit("get-sorted-urls", options);
  }

  getAllData(req: GetAllDataRequest) {
    this.socket.emit("get-all-data", req);
  }

  // Stats emits
  syncProjectStats(projectId: number) {
    this.socket.emit("sync-project-stats", projectId);
  }

  // Event listeners with proper typing
  onAllProjectsData(callback: (data: ProjectSummary[]) => void) {
    this.socket.on("all-projects-data", callback);
    return () => this.socket.off("all-projects-data", callback);
  }

  onProjectData(callback: (data: ProjectData | null) => void) {
    this.socket.on("project-data", callback);
    return () => this.socket.off("project-data", callback);
  }

  onNewProjectData(callback: (newDoc: { id: string | number }) => void) {
    this.socket.on("new-project-data", callback);
    return () => this.socket.off("new-project-data", callback);
  }

  onStopping(callback: (data: CrawlerStatus) => void) {
    this.socket.on("stopping", callback);
    return () => this.socket.off("stopping", callback);
  }

  onStopped(callback: (data: CrawlerStatus) => void) {
    this.socket.on("stopped", callback);
    return () => this.socket.off("stopped", callback);
  }

  onComplete(callback: () => void) {
    this.socket.on("complete", callback);
    return () => this.socket.off("complete", callback);
  }

  onFetched(callback: (data: QueueUpdate) => void) {
    this.socket.on("fetched", callback);
    return () => this.socket.off("fetched", callback);
  }

  onQueue(callback: (data: QueueUpdate) => void) {
    this.socket.on("queue", callback);
    return () => this.socket.off("queue", callback);
  }

  onStatsUpdate(callback: (stats: Partial<Stats>) => void) {
    this.socket.on("statsUpdate", callback);
    return () => this.socket.off("statsUpdate", callback);
  }

  onDataUpdated(callback: (data: TableUpdate) => void) {
    this.socket.on("data-updated", callback);
    return () => this.socket.off("data-updated", callback);
  }

  onUrlsAllData(callback: (data: UrlData[]) => void) {
    this.socket.on("urls-all-data", callback);
    return () => this.socket.off("urls-all-data", callback);
  }

  onProjectStatssynced(callback: (payload: ProjectStatsSync) => void) {
    this.socket.on("project-stats-synced", callback);
    return () => this.socket.off("project-stats-synced", callback);
  }

  onDeleted(callback: (count: number) => void) {
    this.socket.on("deleted", callback);
    return () => this.socket.off("deleted", callback);
  }

  onDeleteError(callback: (errorMessage: string) => void) {
    this.socket.on("delete-error", callback);
    return () => this.socket.off("delete-error", callback);
  }

  onProjectDeleted(callback: () => void) {
    this.socket.on("projectDeleted", callback);
    return () => this.socket.off("projectDeleted", callback);
  }

  onProjectDeleteError(callback: (errorMessage: string) => void) {
    this.socket.on("projectDeleteError", callback);
    return () => this.socket.off("projectDeleteError", callback);
  }

  onProjectSaveError(callback: (errorMessage: string) => void) {
    this.socket.on("project-save-error", callback);
    return () => this.socket.off("project-save-error", callback);
  }

  // Stat-specific listeners
  onDisallow(callback: (count: number) => void) {
    this.socket.on("disallow", callback);
    return () => this.socket.off("disallow", callback);
  }

  onStatHtml(callback: (count: number) => void) {
    this.socket.on("stat-html", callback);
    return () => this.socket.off("stat-html", callback);
  }

  onStatJscss(callback: (count: number) => void) {
    this.socket.on("stat-jscss", callback);
    return () => this.socket.off("stat-jscss", callback);
  }

  onStatImage(callback: (count: number) => void) {
    this.socket.on("stat-image", callback);
    return () => this.socket.off("stat-image", callback);
  }

  onStatRedirect(callback: (count: number) => void) {
    this.socket.on("stat-redirect", callback);
    return () => this.socket.off("stat-redirect", callback);
  }

  onStatError(callback: (count: number) => void) {
    this.socket.on("stat-error", callback);
    return () => this.socket.off("stat-error", callback);
  }

  onStatDepth3(callback: (count: number) => void) {
    this.socket.on("stat-depth3", callback);
    return () => this.socket.off("stat-depth3", callback);
  }

  onStatDepth5(callback: (count: number) => void) {
    this.socket.on("stat-depth5", callback);
    return () => this.socket.off("stat-depth5", callback);
  }

  onStatDepth6(callback: (count: number) => void) {
    this.socket.on("stat-depth6", callback);
    return () => this.socket.off("stat-depth6", callback);
  }

  onStatOther(callback: (count: number) => void) {
    this.socket.on("stat-other", callback);
    return () => this.socket.off("stat-other", callback);
  }

  // Dynamic event helper for sorted urls data
  onSortedUrlsData(requestId: string, callback: (response: SortedUrlsResponse) => void) {
    const eventName = `sorted-urls-data-${requestId}` as `sorted-urls-data-${string}`;
    this.socket.once(eventName, callback);
    return () => this.socket.off(eventName, callback);
  }

  // Raw socket access for advanced usage
  get raw() {
    return this.socket;
  }

  // Connection status helpers
  get connected() {
    return this.socket.connected;
  }

  get disconnected() {
    return this.socket.disconnected;
  }

  connect() {
    this.socket.connect();
  }

  disconnect() {
    this.socket.disconnect();
  }

  // Connection event listeners
  onConnect(callback: () => void) {
    this.socket.on("connect", callback);
    return () => this.socket.off("connect", callback);
  }

  onDisconnect(callback: (reason: string) => void) {
    this.socket.on("disconnect", callback);
    return () => this.socket.off("disconnect", callback);
  }

  onConnectError(callback: (error: Error) => void) {
    this.socket.on("connect_error", callback);
    return () => this.socket.off("connect_error", callback);
  }
}

// Create typed client instance
export const typedSocketClient = new TypedSocketClient(socket);

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
) => typedSocketClient.onSortedUrlsData(requestId, handler);

// Disconnect socket (useful for cleanup during HMR)
export const disconnectSocket = () => {
  console.log('Disconnecting socket...');
  socket.disconnect();
};

// Reconnect socket
export const reconnectSocket = () => {
  console.log('Reconnecting socket...');
  socket.connect();
};

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

export default socket;
