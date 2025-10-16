<template>
  <el-container class="body-page">
    <el-main class="body-main">
      <!-- <div class="flex mb-1">
        <KeywordsAdd class="flex-1 mr-1" />
        <KeywordsMenu />
      </div>
      <KeywordsMain /> -->
    </el-main>
  </el-container>
</template>

<script setup>
// import { useI18n } from "vue-i18n";
// import { useKeywordsStore } from "../../stores/keywords";
// import { useProjectStore } from "../../stores/project";
// import { onMounted, watch } from "vue";
// import KeywordsMain from "../components/keywords/KeywordsMain.vue";
// import KeywordsMenu from "../components/keywords/KeywordsMenu.vue";

const { t } = useI18n();
const keywordsStore = useKeywordsStore();
const project = useProjectStore();

onMounted(() => {
  if (project.currentProjectId) {
    keywordsStore.loadKeywords(project.currentProjectId);
  }
});

// Слушаем изменения currentProjectId и загружаем ключевые запросы для нового проекта
watch(
  () => project.currentProjectId,
  (newProjectId) => {
    if (newProjectId) {
      keywordsStore.loadKeywords(newProjectId);
    }
  }
);
</script>

<style scoped>
.body-main {
  height: 100%;
}
</style>
