<template>
  <el-popover
    v-if="isFree"
    :trigger="disabled ? 'hover' : 'click'"
    placement="top"
    :width="340"
  >
    <template #reference>
      <div class="free-limit-wrap">
        <slot />
      </div>
    </template>
    <div class="free-limit-content">
      <div class="free-limit-text">{{ text }}</div>
      <a :href="proUrl" target="_blank" rel="noopener noreferrer" class="free-limit-link">
        {{ cta }}
      </a>
    </div>
  </el-popover>
  <slot v-else />
</template>

<script setup>
defineProps({
  isFree: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  text: { type: String, required: true },
  cta: { type: String, default: "Перейти на Pro" },
  proUrl: { type: String, default: "https://example.com/pro" },
});
</script>

<style scoped>
.free-limit-wrap {
  display: inline-block;
  width: 100%;
}

.free-limit-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.free-limit-text {
  color: var(--el-text-color-regular);
}

.free-limit-link {
  color: var(--el-color-primary);
  text-decoration: none;
  font-weight: 600;
}
</style>
