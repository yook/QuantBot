<template>
  <el-container class="m-5">
    <el-main>
      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <h1 class="">Интеграции</h1>
          </div>
        </template>

        <div class="settings-content">
          <el-row :gutter="20">
            <el-col :span="24">
              <el-card shadow="never" class="mb-4">
                <template #header>
                  <div class="card-header">
                    <h2 class="">
                      <img
                        class="openai-favicon"
                        src="/openai-favicon.svg"
                        alt="OpenAI"
                      />
                      OpenAI
                    </h2>
                  </div>
                </template>
                <el-form label-width="150px">
                  <el-form-item label="OpenAI API key">
                    <el-input
                      :disabled="!!maskedInput.value"
                      v-model="form.openaiKey"
                      placeholder="sk-p..."
                    />
                  </el-form-item>
                  <!-- Put masked key into the input value instead of showing separate label -->
                  <el-form-item>
                    <el-button type="primary" @click="save('openai')">
                      Сохранить
                    </el-button>
                    <el-button
                      v-if="hasOpenaiKey.value"
                      type="danger"
                      plain
                      @click="confirmDelete"
                      style="margin-left: 8px"
                    >
                      Удалить ключ
                    </el-button>
                    <el-button
                      type="warning"
                      plain
                      @click="clearCache"
                      style="margin-left: 8px"
                    >
                      Очистить кэш
                    </el-button>
                    <span
                      style="margin-left: 16px; font-size: 12px; color: #909399"
                    >
                      Размер кэша: {{ cacheSize.value }} записей
                    </span>
                  </el-form-item>
                </el-form>
              </el-card>
            </el-col>
          </el-row>
        </div>
      </el-card>
    </el-main>
  </el-container>
</template>

<script setup>
import { reactive, onMounted, watch, onUnmounted, markRaw } from "vue";
import { socket } from "../../stores/socket-client";
import { useProjectStore } from "../../stores/project";
import { ElMessageBox, ElMessage } from "element-plus";
import { Delete } from "@element-plus/icons-vue";
// no additional vue refs needed

const project = useProjectStore();
const form = reactive({ openaiKey: "" });
const hasOpenaiKey = reactive({ value: false });
const masked = reactive({ key: null, updated_at: null });
const maskedInput = reactive({ value: "" });
const cacheSize = reactive({ value: 0 });

onMounted(() => {
  const pid = project.currentProjectId;
  if (pid)
    socket.emit("integrations:get", { projectId: pid, service: "openai" });

  // Get cache size
  socket.emit("get-embeddings-cache-size");

  // no master-key management UI anymore

  // Watch for project id becoming available (e.g., after reload)
  const stop = watch(
    () => project.currentProjectId,
    (val) => {
      if (val)
        socket.emit("integrations:get", { projectId: val, service: "openai" });
    }
  );
  // ensure we stop the watcher on unmount
  onUnmounted(() => stop());
});

socket.on("integrations:info", (data) => {
  try {
    if (!data) return;
    // Only update UI if belongs to current project
    if (String(data.projectId) !== String(project.currentProjectId)) return;
    hasOpenaiKey.value = !!data.hasKey;
    masked.key = data.maskedKey || null;
    masked.updated_at = data.updated_at || null;
    // show server-provided maskedKey as-is in the input and exit edit mode
    if (masked.key) {
      maskedInput.value = masked.key;
      form.openaiKey = maskedInput.value;
    } else {
      maskedInput.value = "";
      // clear input if no key
      if (!form.openaiKey) form.openaiKey = "";
    }
  } catch (e) {}
});

socket.on("integrations:setKey:ok", (data) => {
  if (!data) return;
  if (String(data.projectId) !== String(project.currentProjectId)) return;
  window.$message?.success("OpenAI key saved");
  // Clear input for security
  form.openaiKey = "";

  // Refresh info
  socket.emit("integrations:get", {
    projectId: data.projectId,
    service: "openai",
  });
});

socket.on("integrations:deleted", (data) => {
  try {
    if (!data) return;
    // show message and refresh
    ElMessage.success("Ключ удалён");
    const pid = project.currentProjectId;
    // clear input immediately
    maskedInput.value = "";
    form.openaiKey = "";
    hasOpenaiKey.value = false;
    if (pid)
      socket.emit("integrations:get", { projectId: pid, service: "openai" });
  } catch (e) {}
});

socket.on("embeddings-cache-size", (data) => {
  cacheSize.value = data.size || 0;
});

socket.on("embeddings-cache-cleared", () => {
  cacheSize.value = 0;
  ElMessage.success("Кэш эмбеддингов очищен");
});

// cleanup socket listeners on unmount
onUnmounted(() => {
  try {
    socket.off("integrations:info");
    socket.off("integrations:setKey:ok");
    socket.off("integrations:deleted");
    socket.off("embeddings-cache-size");
    socket.off("embeddings-cache-cleared");
  } catch (e) {}
});

function save(kind) {
  if (kind === "openai") {
    const pid = project.currentProjectId;
    if (!pid) {
      window.$message?.error("Проект не выбран");
      return;
    }
    // If the input equals the masked placeholder and a key already exists, do nothing
    if (
      hasOpenaiKey.value &&
      maskedInput.value &&
      form.openaiKey === maskedInput.value
    ) {
      window.$message?.info("Ключ не изменён");
      return;
    }
    socket.emit("integrations:setKey", {
      projectId: pid,
      service: "openai",
      key: form.openaiKey,
    });
  }
}

// master-key handling removed

function confirmDelete() {
  ElMessageBox.confirm(
    "Вы уверены, что хотите удалить сохранённый ключ OpenAI? Это действие удалит ключ для всех проектов.",
    "Удалить ключ",
    {
      confirmButtonText: "Да, удалить",
      cancelButtonText: "Отмена",
      type: "error",
      icon: markRaw(Delete),
      customClass: "delete-msgbox-class",
    }
  )
    .then(() => {
      const pid = project.currentProjectId;
      socket.emit("integrations:delete", { projectId: pid, service: "openai" });
    })
    .catch(() => {
      /* cancelled */
    });
}

function clearCache() {
  project.clearEmbeddingsCache();
}

// editing via focus removed; input is readonly when key exists
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.settings-content {
  min-height: 300px;
}

.mb-4 {
  margin-bottom: 1rem;
}

.openai-favicon {
  width: 18px;
  height: 18px;
  margin-right: 0;
  vertical-align: middle;
  display: inline-block;
}
</style>
