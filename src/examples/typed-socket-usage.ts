// Example usage of the typed socket client
// This file demonstrates how to use the new typed socket wrapper

import { typedSocketClient } from '../stores/socket-client';
import type { ProjectData } from '../types/schema';

// Example: Setting up typed event listeners
export function setupProjectListeners() {
  // Type-safe listeners with auto-completion and error checking
  const unsubscribeProjectData = typedSocketClient.onProjectData((data) => {
    // TypeScript knows data is ProjectData | null
    if (data) {
      console.log('Received project:', data.name);
      // Full type checking available
      console.log('Parser fields:', data.parser.length);
    }
  });

  const unsubscribeStats = typedSocketClient.onStatsUpdate((stats) => {
    // TypeScript knows stats is Partial<Stats>
    console.log('Stats update:', {
      fetched: stats.fetched,
      queue: stats.queue,
      html: stats.html
    });
  });

  const unsubscribeCrawlerStatus = typedSocketClient.onStopping((status) => {
    // TypeScript knows status is CrawlerStatus
    console.log('Crawler stopping:', status.message);
    if (status.freezed) {
      console.log('Crawler is frozen');
    }
  });

  // Return cleanup function
  return () => {
    unsubscribeProjectData();
    unsubscribeStats();
    unsubscribeCrawlerStatus();
  };
}

// Example: Using typed emitters
export function projectActions() {
  // Type-safe emitters with parameter validation
  function loadProject(projectId: string | number) {
    typedSocketClient.getProject(projectId);
  }

  function saveProject(projectData: ProjectData) {
    // TypeScript ensures projectData matches ProjectData interface
    typedSocketClient.saveNewProject(projectData);
  }

  function startCrawler(projectData: ProjectData) {
    // Type checking ensures all required fields are present
    typedSocketClient.startCrawler(projectData);
  }

  function requestSortedData(projectId: string | number, sortBy: string, ascending: boolean) {
    typedSocketClient.getSortedUrls({
      id: projectId,
      sort: { [sortBy]: ascending ? 1 : -1 },
      limit: 50,
      skip: 0,
      db: 'urls',
      requestId: `request_${Date.now()}`
    });
  }

  return {
    loadProject,
    saveProject,
    startCrawler,
    requestSortedData
  };
}

// Example: Advanced usage with dynamic events
export function setupDynamicEventHandling() {
  function requestSortedDataWithCallback(
    projectId: string | number,
    requestId: string,
    callback: (data: any[]) => void
  ) {
    // Set up listener for dynamic response
    const cleanup = typedSocketClient.onSortedUrlsData(requestId, (response) => {
      if (response.data) {
        callback(response.data);
      }
    });

    // Make the request
    typedSocketClient.getSortedUrls({
      id: projectId,
      sort: { id: 1 },
      limit: 100,
      skip: 0,
      db: 'urls',
      requestId
    });

    // Return cleanup function
    return cleanup;
  }

  return { requestSortedDataWithCallback };
}

// Example: Error handling patterns
export function exampleErrorHandling() {
  // Listen for error events
  const cleanup = typedSocketClient.onProjectSaveError((errorMessage) => {
    console.error('Project save failed:', errorMessage);
    // Handle error appropriately
  });

  const cleanupDeleteError = typedSocketClient.onDeleteError((errorMessage) => {
    console.error('Delete operation failed:', errorMessage);
  });

  return () => {
    cleanup();
    cleanupDeleteError();
  };
}

// Example: Composable patterns for Vue 3
export function useTypedSocket() {
  let cleanupFunctions: (() => void)[] = [];

  function addListener<T extends keyof import('../types/socket-events').ServerToClientEvents>(
    event: T,
    handler: import('../types/socket-events').ServerToClientEvents[T]
  ) {
    // Type-safe event subscription
    const cleanup = (typedSocketClient as any)[`on${event.charAt(0).toUpperCase() + event.slice(1)}`]?.(handler);
    if (cleanup) {
      cleanupFunctions.push(cleanup);
    }
    return cleanup;
  }

  function cleanup() {
    cleanupFunctions.forEach(fn => fn());
    cleanupFunctions = [];
  }

  return {
    client: typedSocketClient,
    addListener,
    cleanup
  };
}