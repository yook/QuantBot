<template>
  <el-dialog width="520px" title="Добавить фильтр" v-model="visibleModel">
    <div v-if="activeFilterTags.length" class="filter-tags-wrap">
      <el-tag
        v-for="tag in activeFilterTags"
        :key="tag.id"
        class="filter-tag"
        closable
        @close="$emit('remove-tag', tag.id)"
      >
        {{ tag.label }}
      </el-tag>
    </div>

    <el-form label-position="top">
      <el-form-item label="Поле">
        <el-select
          v-model="filterDraft.field"
          placeholder="Выберите поле"
          style="width: 100%"
        >
          <el-option
            v-for="field in filterableColumns"
            :key="field.prop"
            :label="field.name"
            :value="field.prop"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="Условие">
        <el-select
          v-model="filterDraft.operator"
          placeholder="Выберите условие"
          style="width: 100%"
        >
          <el-option
            v-for="operator in filterOperators"
            :key="operator.value"
            :label="operator.label"
            :value="operator.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item v-if="filterDraft.operator === 'between'" label="Диапазон">
        <div class="filter-range-row">
          <el-input v-model="filterDraft.value" placeholder="От" type="number" />
          <span class="filter-range-separator">-</span>
          <el-input v-model="filterDraft.secondValue" placeholder="До" type="number" />
        </div>
      </el-form-item>

      <el-form-item
        v-else
        :label="currentFieldMeta.inputType === 'enum' ? 'Значение (из текущих данных)' : 'Значение'"
      >
        <el-select
          v-if="currentFieldMeta.inputType === 'enum'"
          v-model="filterDraft.value"
          placeholder="Выберите значение"
          style="width: 100%"
          filterable
          clearable
        >
          <el-option
            v-for="value in enumFilterValues"
            :key="String(value)"
            :label="String(value)"
            :value="String(value)"
          />
        </el-select>
        <el-input
          v-else
          v-model="filterDraft.value"
          :type="currentFieldMeta.inputType === 'number' ? 'number' : 'text'"
          placeholder="Введите значение"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visibleModel = false">Отмена</el-button>
      <el-button type="primary" @click="$emit('apply')">Применить</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  visible: { type: Boolean, default: false },
  activeFilterTags: { type: Array, default: () => [] },
  filterDraft: { type: Object, required: true },
  filterableColumns: { type: Array, default: () => [] },
  filterOperators: { type: Array, default: () => [] },
  currentFieldMeta: { type: Object, default: () => ({ kind: "text", inputType: "text" }) },
  enumFilterValues: { type: Array, default: () => [] },
});

const emit = defineEmits(["update:visible", "remove-tag", "apply"]);

const visibleModel = computed({
  get: () => props.visible,
  set: (val) => emit("update:visible", !!val),
});
</script>

<style scoped>
.filter-range-row {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 8px;
  align-items: center;
}

.filter-tags-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.filter-tag {
  max-width: 100%;
}

.filter-range-separator {
  color: var(--el-text-color-secondary);
}
</style>
