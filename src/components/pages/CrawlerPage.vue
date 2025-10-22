<template>
  <el-container class="body-page">
    <el-main class="body-main">
      <div class="flex mb-1">
        <CrawlerInputUrl class="flex-1 mr-1" />
        <CrawlerMenu />
      </div>
      <CrawlerStats />
      <CrawlerTable />
    </el-main>
  </el-container>
</template>

<script setup>
// import { onMounted } from "vue";
// import { useProjectStore } from "../../stores/project";
// import CrawlerTable from "../components/crawler/CrawlerTable.vue";

import CrawlerInputUrl from "../crawler/CrawlerInputUrl.vue";
import CrawlerMenu from "../crawler/CrawlerMenu.vue";
import CrawlerStats from "../crawler/CrawlerStats.vue";
import CrawlerTable from "../crawler/CrawlerTable.vue";

// const project = useProjectStore();

// onMounted(() => {
//   project.socketOn();
// });
</script>

<style scoped></style>
