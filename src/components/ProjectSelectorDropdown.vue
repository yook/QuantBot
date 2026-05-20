<template>
  <el-dropdown
    class="no-drag"
    trigger="click"
    placement="bottom-start"
    :teleported="false"
    :popper-options="dropdownPopperOptions"
    popper-class="project-dropdown-popper"
    @command="onCommand"
  >
    <span class="el-dropdown-link" style="cursor: pointer">
      <span class="project-current-label">{{ currentProjectLabel }}</span>
      <el-icon class="el-icon--right project-dropdown-icon">
        <ArrowDown />
      </el-icon>
    </span>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item
          v-for="item in sortedProjects"
          :key="item.id"
          :command="String(item.id)"
          :class="{ 'project-option-active': isActiveProject(item.id) }"
        >
          <div class="project-option-row">
            <span
              class="project-option-name"
              :class="{
                'project-option-name-active': isActiveProject(item.id),
              }"
            >
              {{ item.name }}
            </span>
            <span class="project-option-url">{{ item.url || "-" }}</span>
          </div>
        </el-dropdown-item>
        <el-dropdown-item v-if="sortedProjects.length === 0" disabled>
          {{ t("header.noProjects") }}
        </el-dropdown-item>
        <el-dropdown-item
          divided
          command="__create_project__"
          class="project-create-row"
        >
          <el-button type="primary" size="small" class="project-create-btn">
            <i-tabler-plus class="project-create-icon" />
            {{ t("header.addProjectButton") }}
          </el-button>
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useProjectStore } from "../stores/project";
import { ArrowDown } from "@element-plus/icons-vue";
const emit = defineEmits(["create-project"]);

const project = useProjectStore();
const { t } = useI18n();
const dropdownPopperOptions = {
  modifiers: [
    {
      name: "offset",
      options: {
        // Shift dropdown a bit left so it aligns with content blocks under header
        offset: [-8, 8],
      },
    },
  ],
};

const sortedProjects = computed(() => {
  const list = Array.isArray(project.projects) ? [...project.projects] : [];
  list.sort((left, right) =>
    String(left?.name || "").localeCompare(String(right?.name || ""), "ru", {
      sensitivity: "base",
    }),
  );
  return list;
});

const currentProjectLabel = computed(() => {
  const list = project.projectsList || [];
  const activeId = project.currentProjectId;
  const active = list.find((item) => String(item.value) === String(activeId));
  const label = active ? active.label : project.currentProjectName || "";
  return label && String(label).trim() ? label : t("header.selectProject");
});

function onCommand(id) {
  if (id == null) return;
  const command = String(id);
  if (command === "__create_project__") {
    emit("create-project");
    return;
  }
  project.changeProject(command);
}

function isActiveProject(id) {
  return String(id) === String(project.currentProjectId);
}
</script>

<style scoped>
.project-current-label {
  font-size: 16px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.el-dropdown-link {
  display: inline-flex;
  align-items: center;
}

:deep(.project-create-btn) {
  width: 100%;
}

:deep(.project-create-row:hover),
:deep(.project-create-row:focus) {
  background-color: transparent !important;
}

:deep(.project-create-btn.el-button--primary:hover),
:deep(.project-create-btn.el-button--primary:focus-visible) {
  background-color: var(--el-color-primary) !important;
  border-color: var(--el-color-primary) !important;
}

.project-create-icon {
  margin-right: 6px;
}

:deep(.project-option-active) {
  background: var(--el-fill-color-light) !important;
}

.project-option-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.project-option-name {
  color: var(--el-text-color-primary);
  min-width: 0;
  flex: 0 1 auto;
}

.project-option-name-active {
  color: var(--el-color-primary);
  font-weight: 700;
}

.project-option-url {
  margin-left: auto;
  max-width: 70%;
  min-width: 0;
  flex: 1 1 auto;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: right;
}

:global(.project-dropdown-popper) {
  width: 360px !important;
  min-width: 360px !important;
  max-width: 360px !important;
}

:global(.project-dropdown-popper .el-dropdown-menu__item) {
  white-space: nowrap;
  line-height: 1.35;
  padding-top: 10px;
  padding-bottom: 10px;
}
</style>
