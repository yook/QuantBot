<template>
  <div>
    <div class="demo-collapse mb-4">
      <el-collapse accordion>
        <el-collapse-item name="1">
          <template #title="{ isActive }">
            <div :class="['title-wrapper', { 'is-active': isActive }]">
              Морфологический анализ
              <el-icon class="header-icon">
                <InfoFilled />
              </el-icon>
            </div>
          </template>
          <div class="text-sm">
            <div class="mb-2">
              <strong>Цель:</strong><br />
              Привести ключевые слова к базовой форме (леммам) для дальнейшей
              фильтрации и анализа.
            </div>

            <div class="mb-2">
              <strong>Описание:</strong><br />
              Ключевая фраза анализируется с помощью морфологического
              анализатора:<br />
              - Поле «Лемма» содержит лемму для всей фразы.<br />
              - Поле «Теги» — уникальный, отсортированный по алфавиту список
              всех слов фразы.
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>
  </div>
</template>

<script setup>
import { InfoFilled } from "@element-plus/icons-vue";
</script>

<style scoped>
.demo-collapse {
  border: none;
}

.title-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  transition: color 0.3s ease;
}

.title-wrapper.is-active {
  color: var(--el-color-primary);
}

.header-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
</style>
