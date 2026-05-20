<template>
  <el-button size="small" class="filter-btn" :type="type" :plain="plain" @click="$emit('click')">
    <i-tabler-filter class="filter-btn-icon" />
    <span>{{ label }}</span>
    <span v-if="count > 0" class="filter-btn-count">
      {{ count }}
    </span>
  </el-button>
</template>

<script setup>
defineProps({
  count: { type: Number, default: 0 },
  label: { type: String, default: "Фильтр" },
  type: { type: String, default: "primary" },
  plain: { type: Boolean, default: true },
});

defineEmits(["click"]);
</script>

<style scoped>
.filter-btn-icon {
  margin-right: 6px;
}

.filter-btn-count {
  margin-left: 6px;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: var(--el-color-primary);
  color: #fff;
  font-size: 11px;
  line-height: 1;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
</style>
