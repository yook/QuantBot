import { defineStore } from "pinia";
import socket from "./socket-client";

// Type-safe wrappers for keyword events
const emitGetKeywords = (projectId: string | number) => {
  (socket as any).emit("get-keywords", projectId);
};

const emitAddKeyword = (projectId: string | number, keyword: any) => {
  (socket as any).emit("add-keyword", { projectId, keyword });
};

const emitDeleteKeyword = (projectId: string | number, keywordId: string | number) => {
  (socket as any).emit("delete-keyword", { projectId, keywordId });
};

const onKeywordsData = (handler: (data: any[]) => void) => {
  (socket as any).once("keywords-data", handler);
};

const onKeywordAdded = (handler: () => void) => {
  (socket as any).once("keyword-added", handler);
};

const onKeywordDeleted = (handler: () => void) => {
  (socket as any).once("keyword-deleted", handler);
};

export const useKeywordsStore = defineStore("keywords", {
  state: () => ({
    keywords: [] as any[],
    loading: false,
  }),
  getters: {
    keywordsList: (state) => state.keywords,
  },
  actions: {
    loadKeywords(projectId: string | number) {
      this.loading = true;
      emitGetKeywords(projectId);
      onKeywordsData((data: any[]) => {
        this.keywords = data || [];
        this.loading = false;
      });
    },
    addKeyword(projectId: string | number, keyword: string) {
      emitAddKeyword(projectId, keyword);
      onKeywordAdded(() => {
        this.loadKeywords(projectId);
      });
    },
    deleteKeyword(projectId: string | number, keywordId: string | number) {
      emitDeleteKeyword(projectId, keywordId);
      onKeywordDeleted(() => {
        this.loadKeywords(projectId);
      });
    },
  },
});
