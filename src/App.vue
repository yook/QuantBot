<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useProjectStore } from "./stores/project";
import AppHeader from "./components/AppHeader.vue";
import AppMenu from "./components/AppMenu.vue";
import CrawlerPage from "./components/pages/CrawlerPage.vue";
import ParsingPage from "./components/pages/ParsingPage.vue";
import SettingsPage from "./components/pages/SettingsPage.vue";

const SIDEBAR_COLLAPSE_STORAGE_KEY = "sidebarCollapsed";

const project = useProjectStore();
const isCollapse = ref(true);
const sidebarWidth = computed(() => (isCollapse.value ? 60 : 220));

// Initialize socket listeners once when app mounts
onMounted(() => {
  const savedSidebarState = localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY);
  if (savedSidebarState !== null) {
    isCollapse.value = savedSidebarState === "true";
    console.log(
      "[App] Restored sidebar state:",
      savedSidebarState === "true" ? "collapsed" : "expanded",
    );
  } else {
    console.log("[App] No saved sidebar state, using default (collapsed)");
  }

  console.log("App mounted - initializing socket listeners");
  project.socketOn();
});

watch(isCollapse, (value) => {
  localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, String(value));
  console.log("[App] Saved sidebar state:", value ? "collapsed" : "expanded");
});

// Cleanup on unmount (mainly for HMR in dev mode)
onBeforeUnmount(() => {
  console.log("App unmounting - would cleanup socket listeners here if needed");
});

// Map activePage to component
const currentPageComponent = computed(() => {
  switch (project.activePage) {
    case "1":
      return CrawlerPage;
    case "3":
      return ParsingPage;
    case "2":
      return SettingsPage;
    default:
      return CrawlerPage; // default to crawler
  }
});
</script>

<template>
  <!-- Absolute header -->
  <AppHeader :sidebar-width="sidebarWidth" />

  <!-- Body under header: aside (left) + main content -->
  <el-container class="app-root app-body">
    <el-aside :width="`${sidebarWidth}px`" class="app-aside">
      <AppMenu
        :is-collapse="isCollapse"
        @toggle-collapse="isCollapse = !isCollapse"
      />
    </el-aside>
    <el-container class="app-right is-vertical">
      <el-main class="app-content p-1">
        <component :is="currentPageComponent" v-if="currentPageComponent" />
        <div v-else class="placeholder-content">
          <el-empty description="Страница в разработке" />
        </div>
      </el-main>
    </el-container>
  </el-container>
</template>

<style>
html,
body,
#app {
  height: 100vh;
  margin: 0;
  padding: 0;
  overflow: hidden;
  background-color: var(--el-bg-color-page);
}

.app-root {
  height: 100vh;
  overflow: hidden;
  min-height: 0;
}

/* leave space for absolute header (48px) */
.app-body {
  height: 100vh;
  overflow: hidden;
  min-height: 0;
}

.app-aside {
  border-right: 1px solid var(--el-border-color);
  overflow: hidden;
  box-sizing: border-box;
  transition: width 0.28s ease;
  min-height: 0;
}

.app-right {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  height: 100%;
  padding-top: 48px;
  box-sizing: border-box;
  min-height: 0;
}

.app-content {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  overflow: auto;
  padding-bottom: 20px; /* keep content visible above fixed footer */
}
</style>
