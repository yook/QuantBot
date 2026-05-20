<template>
  <div class="table-left-actions">
    <el-select
      v-if="showDbSelect"
      size="small"
      :model-value="currentDb"
      placeholder="Select"
      class="crawler-db-select"
      popper-class="crawler-db-select"
      @change="$emit('db-change', $event)"
    >
      <el-option-group
        v-for="group in tableReports"
        :key="group.label"
        :label="group.label"
      >
        <el-option
          v-for="item in group.options"
          :key="item.value"
          :label="item.label"
          :value="item.value"
          :disabled="item.disabled"
        >
          <span style="float: left">{{ item.label }}</span>
        </el-option>
      </el-option-group>
    </el-select>

    <FilterActionButton :count="activeFilterCount" label="Фильтр" @click="$emit('add-filter')" />
    <span class="table-rows-count">{{ rowsCount }}</span>
  </div>
</template>

<script setup>
import FilterActionButton from "./FilterActionButton.vue";

defineProps({
  showDbSelect: { type: Boolean, default: true },
  currentDb: { type: String, default: "urls" },
  tableReports: { type: Array, default: () => [] },
  activeFilterCount: { type: Number, default: 0 },
  rowsCount: { type: [String, Number], default: "0" },
});

defineEmits(["db-change", "add-filter"]);
</script>

<style scoped>
.table-left-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.crawler-db-select {
  width: 160px;
}

.table-rows-count {
  min-width: 24px;
  color: var(--el-text-color-regular);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
</style>
