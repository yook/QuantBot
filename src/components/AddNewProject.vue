<template>
  <!-- Trigger button lives here now -->
  <el-button
    type="primary"
    class="add-project-btn no-drag"
    @click="openNewProjectDialog"
  >
    <el-icon><Plus /></el-icon>
    {{ t("header.addProjectButton") }}
  </el-button>

  <!-- Dialog with form -->
  <el-dialog
    v-model="showNewProjectDialog"
    :title="t('addProject.title')"
    width="600px"
    :modal="true"
    class="no-drag"
    :close-on-click-modal="allowClose"
    :close-on-press-escape="allowClose"
    :show-close="allowClose"
    @close="onRequestClose"
  >
    <div class="flex flex-col items-center">
      <el-form
        label-position="top"
        label-width="100px"
        class="form-compact"
        ref="ruleFormRef"
        :model="RuleForm"
        :rules="rules"
        status-icon
        @keydown.enter.prevent="submitForm(ruleFormRef)"
      >
        <el-form-item :label="t('common.name')" prop="name" class="w-500">
          <el-input
            v-model="RuleForm.name"
            :placeholder="t('addProject.namePlaceholder')"
            autofocus
          />
        </el-form-item>
        <el-form-item :label="t('common.url')" prop="url" class="w-500">
          <el-input
            v-model="RuleForm.url"
            :placeholder="t('addProject.urlPlaceholder')"
          />
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <div style="display: flex; justify-content: center; width: 100%">
        <el-button type="primary" @click="submitForm(ruleFormRef)">
          {{ t("common.save") }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { reactive, ref, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useProjectStore } from "../stores/project";
import { Plus } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
// i18n
const { t } = useI18n();

// Define emits (kept for compatibility; parent may listen)
const emit = defineEmits(["project-created"]);

const project = useProjectStore();
// remove local t() stub, using official vue-i18n

const showNewProjectDialog = ref(false);
const ruleFormRef = ref();
const RuleForm = reactive({
  name: "",
  url: "",
});

const rules = reactive({
  name: [
    {
      required: true,
      message: t("addProject.validations.nameRequired"),
      trigger: "blur",
    },
  ],
  url: [
    {
      type: "url",
      message: t("addProject.validations.urlInvalid"),
      trigger: "blur",
    },
  ],
});

async function submitForm(formEl) {
  if (!formEl) return;
  await formEl.validate(async (valid, fields) => {
    if (valid) {
      try {
        // Save the project
        await project.saveNewProject(RuleForm);

        // Reset form
        RuleForm.name = "";
        RuleForm.url = "";

        // Refresh projects locally and emit event (if parent cares)
        project.getProjects();
        emit("project-created");

        // Close dialog
        showNewProjectDialog.value = false;

        console.log("Project saved successfully");
      } catch (error) {
        console.error("Error saving project:", error);
      }
    } else {
      console.log("error submit!", fields);
    }
  });
}

function openNewProjectDialog() {
  showNewProjectDialog.value = true;
}

const allowClose = computed(() => {
  try {
    return !!(project.projects && project.projects.length > 0);
  } catch (e) {
    return false;
  }
});

function onRequestClose() {
  // Prevent closing if there are no projects yet
  if (!allowClose.value) {
    ElMessage.warning(
      t("addProject.createFirstWarning") ||
        "Создайте проект прежде чем закрывать диалог"
    );
    // ensure dialog stays open (v-model will be false if parent tried to close)
    showNewProjectDialog.value = true;
    return;
  }
  // otherwise let it close
  showNewProjectDialog.value = false;
}

// Auto-open dialog only after projects list has been fetched at least once
const autoOpened = ref(false);
watch(
  () => ({
    len: project.projects?.length ?? 0,
    loaded: project.projectsLoaded,
  }),
  ({ len, loaded }) => {
    if (
      loaded &&
      len === 0 &&
      !showNewProjectDialog.value &&
      !autoOpened.value
    ) {
      showNewProjectDialog.value = true;
      autoOpened.value = true;
    }
  },
  { immediate: true, deep: false }
);

// If some external action tries to close the dialog while there are no projects,
// reopen and show a warning. This covers parent-driven v-model changes.
watch(
  () => showNewProjectDialog.value,
  (val) => {
    if (val === false && !(project.projects && project.projects.length > 0)) {
      // reopen and warn
      showNewProjectDialog.value = true;
      ElMessage.warning(
        t("addProject.createFirstWarning") ||
          "Создайте проект прежде чем закрывать диалог"
      );
    }
  }
);

// if (!validator.isURL(url, { require_protocol: true })) {
//   url = "https://" + url;
// }
// if (!validator.isURL(url)) {
//   ElMessage.error(t("isNotURL"));
// } else {
//   project.start(url);
// }
</script>

<style>
.input-with-select .el-input-group__prepend {
  background-color: var(--el-fill-color-blank);
}

.add-project {
  margin: 70px 0 50px;
  text-align: center;
}
.el-form-item.el-form-item--large {
  margin-right: 0px;
}
.alert {
  text-align: -webkit-center;
}

/* Reduce spacing between inputs and footer button inside this dialog */
.el-dialog__body {
  padding-bottom: 6px !important;
}

/* Compact form spacing for this dialog */
.form-compact .el-form-item {
  margin-bottom: 10px;
}
.form-compact .el-form-item:last-of-type {
  margin-bottom: 6px;
}

/* Spacing between button icon and text */
.add-project-btn .el-icon {
  margin-right: 8px;
  display: inline-flex;
  align-items: center;
}

/* Dark theme for add project button */
html.dark .add-project-btn {
  background-color: var(--el-color-primary) !important;
  border-color: var(--el-color-primary) !important;
  color: #ffffff !important;
}

html.dark .add-project-btn:hover {
  background-color: var(--el-color-primary-light-3) !important;
  border-color: var(--el-color-primary-light-3) !important;
}
</style>
