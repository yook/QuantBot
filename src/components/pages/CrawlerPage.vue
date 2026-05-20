<template>
  <el-container class="body-page">
    <el-main class="body-main">
      <div class="flex mb-1 w-full">
        <CrawlerInputUrl />
      </div>
      <div class="mb-1">
        <CrawlerStats />
      </div>
      <CrawlerTable />
    </el-main>
  </el-container>
</template>

<script setup>
import CrawlerInputUrl from "../crawler/CrawlerInputUrl.vue";
import CrawlerStats from "../crawler/CrawlerStats.vue";
import CrawlerTable from "../crawler/CrawlerTable.vue";
</script>

<style scoped>
.body-page {
  width: 100%;
}

.body-main {
  width: 100%;
  padding: 0.25rem;
}
</style>
