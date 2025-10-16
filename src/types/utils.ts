// Utility types for enhanced type safety in socket communication

import type { 
  ServerToClientEvents, 
  ClientToServerEvents 
} from './socket-events';
import type { Socket } from 'socket.io-client';

// Type-safe socket instance
export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Helper type to extract event names
export type ServerEventNames = keyof ServerToClientEvents;
export type ClientEventNames = keyof ClientToServerEvents;

// Helper type to extract event payload types
export type ServerEventPayload<T extends ServerEventNames> = 
  ServerToClientEvents[T] extends (payload: infer P) => void ? P : never;

export type ClientEventPayload<T extends ClientEventNames> = 
  ClientToServerEvents[T] extends (payload: infer P) => void ? P : never;

// Type for event handlers
export type EventHandler<T extends ServerEventNames> = ServerToClientEvents[T];

// Type for unsubscribe function
export type UnsubscribeFunction = () => void;

// Helper type for dynamic events (like sorted-urls-data-${string})
export type DynamicEventName<T extends string> = `sorted-urls-data-${T}`;

// Type for socket listener return type with cleanup
export type SocketListener<T extends ServerEventNames> = {
  unsubscribe: UnsubscribeFunction;
  eventName: T;
};

// Utility type for table column definitions with type safety
export interface TypedColumnDef<T = any> {
  name: string;
  prop: keyof T;
  width?: number;
  minWidth?: number;
  disabled?: boolean;
}

// Enhanced project data with stricter typing
export interface TypedProjectState {
  isLoading: boolean;
  hasError: boolean;
  errorMessage?: string;
  lastUpdated?: Date;
}

// Type for form validation
export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

// Type for async operation states
export type AsyncOperationState = 'idle' | 'loading' | 'success' | 'error';

// Type for socket connection states
export type SocketConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

// Helper type for table data with pagination
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// Type for URL filters and sorting
export interface UrlFilter {
  status?: string[];
  contentType?: string[];
  depth?: number;
  dateRange?: {
    from: Date;
    to: Date;
  };
}

// Type for advanced search options
export interface SearchOptions {
  query: string;
  fields: string[];
  matchType: 'exact' | 'partial' | 'regex';
  caseSensitive: boolean;
}