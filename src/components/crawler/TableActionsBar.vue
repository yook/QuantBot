<template>
  <div class="table-right-actions">
    <el-button size="small" @click="$emit('open-settings')">
      <i-tabler-layout-grid />
    </el-button>

    <el-dropdown
      trigger="click"
      placement="bottom-end"
      :disabled="exporting"
      @command="$emit('export-command', $event)"
    >
      <el-button size="small" :loading="exporting">
        <i-tabler-download /> Экспорт
      </el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="xlsx">Excel</el-dropdown-item>
          <el-dropdown-item command="csv">CSV</el-dropdown-item>
          <el-dropdown-item command="json">JSON</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <el-dropdown
      trigger="click"
      placement="bottom-end"
      :teleported="false"
      :popper-options="deleteDropdownPopperOptions"
      @command="$emit('delete-command', $event)"
    >
      <el-button size="small" type="danger" plain :disabled="deleteDisabled">
        <i-tabler-trash />
      </el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="filtered" :disabled="activeFiltersCount === 0">
            Удалить отфильтрованные
          </el-dropdown-item>
          <el-dropdown-item command="all" divided>
            Очистить все данные раздела
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<script setup>
defineProps({
  exporting: { type: Boolean, default: false },
  deleteDisabled: { type: Boolean, default: false },
  activeFiltersCount: { type: Number, default: 0 },
  deleteDropdownPopperOptions: { type: Object, default: () => ({}) },
});

defineEmits(["open-settings", "export-command", "delete-command"]);
</script>

<style scoped>
.table-right-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  width: 100%;
}

.table-right-actions :deep(.el-button) {
  min-width: 44px;
}
</style>
