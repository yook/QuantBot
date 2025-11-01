<template>
  <div>
    <div class="demo-collapse mb-4">
      <el-collapse accordion>
        <el-collapse-item name="1">
          <template #title="{ isActive }">
            <div :class="['title-wrapper', { 'is-active': isActive }]">
              {{ $t("classification.title") }}
              <el-icon class="header-icon">
                <InfoFilled />
              </el-icon>
            </div>
          </template>
          <div class="text-sm">
            <div class="mb-2">
              <h3></h3>
              <strong>{{ t("classification.goal") }}</strong
              ><br />
              {{ t("classification.goalDescription") }}
              <br /><br />
              <strong>{{ t("classification.descriptionTitle") }}</strong
              ><br />
              {{ t("classification.description") }}
            </div>
            <div>
              <strong>{{ t("classification.algorithmTitle") }}</strong
              ><br />
              <div class="algorithm-steps">
                {{ t("classification.algorithmSteps") }}
              </div>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>
    <div class="mt-2">
      <el-collapse
        accordion
        v-model="activeName"
        expand-icon-position="left"
        class="mb-4"
      >
        <el-collapse-item
          v-for="row in groupedSamples"
          :key="row.label"
          :name="String(row.label)"
        >
          <template #title>
            <div
              style="
                display: flex;
                align-items: center;
                justify-content: space-between;
                width: 100%;
              "
            >
              <div style="display: flex; align-items: center; gap: 8px">
                <span style="font-weight: 600">{{ row.label }}</span>
                <el-tag size="small" type="">{{
                  phrases(row.text).length
                }}</el-tag>
                <span style="margin-left: 6px">
                  <template
                    v-if="
                      rowStatus[String(row.label)] &&
                      rowStatus[String(row.label)].state === 'saving'
                    "
                  >
                    <el-icon style="vertical-align: middle"
                      ><Loading
                    /></el-icon>
                  </template>
                  <template
                    v-else-if="
                      rowStatus[String(row.label)] &&
                      rowStatus[String(row.label)].state === 'saved'
                    "
                  >
                    <small style="color: var(--el-color-success)">{{
                      t("classification.saved")
                    }}</small>
                  </template>
                  <template
                    v-else-if="
                      rowStatus[String(row.label)] &&
                      rowStatus[String(row.label)].state === 'error'
                    "
                  >
                    <small style="color: var(--el-color-danger)">{{
                      rowStatus[String(row.label)].message ||
                      t("classification.save_error")
                    }}</small>
                  </template>
                </span>
              </div>
              <div>
                <el-button
                  type="danger"
                  text
                  :icon="Delete"
                  circle
                  @click.stop="deleteRow(row)"
                ></el-button>
                <!-- edit inline directly; tags are editable by default -->
              </div>
            </div>
          </template>

          <div style="margin-bottom: 8px">
            <el-input-tag
              v-model="rowTags[String(row.label)]"
              draggable
              :placeholder="t('classification.edit_placeholder')"
              :delimiter="delimiter"
              v-multi-paste="{ mode: 'row', row }"
              class="fixed-input-tag"
              @paste="(e) => handleRowPaste(e, row)"
              @change="(val) => onTagsChange(row, val)"
            />
          </div>
        </el-collapse-item>
      </el-collapse>

      <el-divider content-position="center">{{
        t("classification.add_class")
      }}</el-divider>

      <div class="py-2 items-center flex">
        <div class="w-64 mr-2">
          <el-input
            :placeholder="t('classification.name_placeholder')"
            v-model="sampleLabel"
          />
        </div>

        <div class="flex-1 mr-2">
          <el-input-tag
            v-model="input"
            draggable
            collapse-tags
            collapse-tags-tooltip
            :max-collapse-tags="10"
            :placeholder="t('classification.description_placeholder')"
            :delimiter="delimiter"
            v-multi-paste="{ mode: 'add' }"
            @change="(val) => onInputChange(val)"
          />
        </div>

        <div class="w-16 text-right">
          <el-button type="primary" plain @click="addSamples">{{
            t("classification.add_button")
          }}</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import {
  defineComponent,
  ref,
  onMounted,
  onUnmounted,
  watch,
  computed,
} from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Delete, InfoFilled, Loading, Check } from "@element-plus/icons-vue";
import {
  ElInputTag,
  ElCollapse,
  ElCollapseItem,
  ElTag,
  ElIcon,
} from "element-plus";
import { useProjectStore } from "../../../stores/project";
import { useTypingStore } from "../../../stores/typing";
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "TypingConfig",
  components: {
    ElInputTag,
    ElCollapse,
    ElCollapseItem,
    ElTag,
    ElIcon,
    // icons
    InfoFilled,
    Delete,
    Loading,
    Check,
  },
  directives: {
    multiPaste: {
      mounted(el, binding) {
        const handler = (e) => {
          try {
            if (!e.clipboardData) return;
            const text = e.clipboardData.getData("text");
            if (!text) return;
            // Only intercept if multiline (contains \n or \r) OR tabs
            if (!/[\r\n\t]/.test(text)) return; // allow default single-line paste
            e.preventDefault();
            const { instance } = binding;
            if (!instance) return;
            const { mode, row } = binding.value || {};
            const MAX_LEN = instance.MAX_LEN || 100; // fallback
            // Split: newlines first, then commas inside each line
            let parts = text
              .split(/\r?\n/)
              .map((s) => s.split(/[，,]/))
              .flat()
              .map((s) => (s == null ? "" : String(s).trim()))
              .filter(Boolean);
            if (!parts.length) return;
            const before = parts.length;
            parts = parts.filter((s) => s.length <= MAX_LEN);
            const discarded = before - parts.length;
            if (discarded > 0 && instance.ElMessage && instance.t) {
              instance.ElMessage.error(
                instance.t("classification.phrase_too_long", {
                  max: MAX_LEN,
                }) || `Phrases longer than ${MAX_LEN} characters were removed`
              );
            }
            if (mode === "add") {
              const current = Array.isArray(instance.input.value)
                ? instance.input.value.slice()
                : [];
              const merged = [...current, ...parts];
              instance.input.value = merged;
              instance.onInputChange(merged);
            } else if (mode === "row" && row && row.id != null) {
              const id = String(row.id);
              const currentRow = Array.isArray(instance.rowTags.value[id])
                ? instance.rowTags.value[id].slice()
                : [];
              const merged = [...currentRow, ...parts];
              instance.rowTags.value[id] = merged;
              instance.onTagsChange(row, merged);
            }
          } catch (err) {
            // silent
          }
        };
        el.__multiPasteHandler__ = handler;
        // Attach on root; attempt also on inner input when available
        el.addEventListener("paste", handler);
        // Attempt to bind to inner input (Element Plus renders an input inside)
        setTimeout(() => {
          const inner = el.querySelector && el.querySelector("input");
          if (inner) inner.addEventListener("paste", handler);
        }, 0);
      },
      beforeUnmount(el) {
        const handler = el.__multiPasteHandler__;
        if (handler) {
          el.removeEventListener("paste", handler);
          const inner = el.querySelector && el.querySelector("input");
          if (inner) inner.removeEventListener("paste", handler);
        }
        delete el.__multiPasteHandler__;
      },
    },
  },
  setup() {
    const sampleLabel = ref("");
    const sampleText = ref("");
    const input = ref([]);
    const activeName = ref(null);
    const rowTags = ref({});
    const rowStatus = ref({});
    const editingLabels = ref(new Set());
    const project = useProjectStore();
    const typingStore = useTypingStore();
    // delimiter for el-input-tag: split on commas or newlines
    const delimiter = /[,\n]+/;
    const MAX_LEN = 100; // expose via instance (used in directive)

    function phrases(text) {
      if (!text) return [];
      return String(text)
        .split(delimiter)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    // Группируем записи по label, чтобы в UI был один блок на метку
    const groupedSamples = computed(() => {
      const map = new Map();
      for (const s of typingStore.samples || []) {
        if (!s || !s.label) continue;
        const label = String(s.label);
        const arr = map.get(label) || [];
        // каждая запись сейчас одна фраза в text
        const txt = (s.text || "").trim();
        if (txt) arr.push(txt);
        map.set(label, arr);
      }
      const list = [];
      for (const [label, arr] of map.entries()) {
        list.push({ label, text: arr.join(", ") });
      }
      return list;
    });

    // Синхронизация БД для одной метки: минимально дифф-операции (удаляем только лишние, добавляем недостающие)
    async function syncLabelPhrases(label, phrasesArr) {
      const pid = project.currentProjectId;
      if (!pid || !label) return;
      try {
        // Получаем текущие записи для метки (локально из store)
        const current = (typingStore.samples || []).filter(
          (s) => s && s.label === label
        );

        // Нормализованный набор желаемых фраз
        const desired = (Array.isArray(phrasesArr) ? phrasesArr : [])
          .map((p) =>
            String(p || "")
              .trim()
              .toLowerCase()
          )
          .filter(Boolean);

        // Если нет желаемых фраз — удаляем все текущие записи
        if (desired.length === 0) {
          for (const rec of current) {
            if (rec && rec.id) await typingStore.deleteSample(pid, rec.id);
          }
          return;
        }

        // Map current texts -> records (text already stored lowercase by backend)
        const currentMap = new Map();
        for (const rec of current) {
          const txt =
            rec && rec.text ? String(rec.text).trim().toLowerCase() : null;
          if (!txt) continue;
          // keep list of records per text (should be unique, but safe)
          const arr = currentMap.get(txt) || [];
          arr.push(rec);
          currentMap.set(txt, arr);
        }

        // 1) Delete current records that are not in desired
        for (const rec of current) {
          const txt =
            rec && rec.text ? String(rec.text).trim().toLowerCase() : null;
          if (!txt) {
            if (rec && rec.id) await typingStore.deleteSample(pid, rec.id);
            continue;
          }
          if (!desired.includes(txt)) {
            // remove this obsolete row
            if (rec && rec.id) await typingStore.deleteSample(pid, rec.id);
          }
        }

        // 2) For each desired phrase, ensure there's at least one DB row
        const toAdd = [];
        for (const d of desired) {
          const have = currentMap.get(d);
          if (!have || have.length === 0) {
            toAdd.push({ label, text: d });
          }
        }

        if (toAdd.length > 0) {
          // addSamples accepts array of {label, text}
          await typingStore.addSamples(pid, toAdd);
        }
      } catch (e) {
        console.error("Error in syncLabelPhrases:", e);
      }
    }

    const { t } = useI18n();

    function deleteRow(row) {
      if (!row || !row.label) return;
      ElMessageBox.confirm(
        t("classification.delete_confirm", { label: row.label }),
        t("сonfiguration"),
        {
          confirmButtonText: t("delete"),
          cancelButtonText: t("cancel") || "Отмена",
          type: "warning",
        }
      ).then(() => {
        const pid = project.currentProjectId;
        const toDelete = (typingStore.samples || []).filter(
          (s) => s && s.label === row.label
        );
        for (const rec of toDelete) {
          if (rec && rec.id) typingStore.deleteSample(pid, rec.id);
        }
      });
    }

    // Simple debounce helper
    function debounce(fn, wait = 300) {
      let t = null;
      return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), wait);
      };
    }

    // helper normalize phrases: lowercase + dedup (order preserved)
    function normalizeList(arr) {
      const out = [];
      const seen = new Set();
      for (const raw of arr) {
        const p = (raw == null ? "" : String(raw)).trim().toLowerCase();
        if (!p) continue;
        if (p.length > MAX_LEN) continue;
        if (seen.has(p)) continue;
        seen.add(p);
        out.push(p);
      }
      return out;
    }

    // Save tags for a row: update the sample text in DB via store
    const saveTagsImmediate = (rowKey, tags) => {
      const pid = project.currentProjectId;
      if (!pid || !rowKey) return;
      const arr = Array.isArray(tags) ? tags.slice() : [];
      const normalized = normalizeList(arr);

      // reflect normalized state in UI model
      rowTags.value[String(rowKey)] = normalized;
      // set status saving
      rowStatus.value[String(rowKey)] = { state: "saving" };
      // перезаписываем записи для данной метки
      syncLabelPhrases(String(rowKey), normalized)
        .then(() => {
          rowStatus.value[String(rowKey)] = { state: "saved" };
          editingLabels.value.delete(String(rowKey));
          setTimeout(() => {
            if (
              rowStatus.value[String(rowKey)] &&
              rowStatus.value[String(rowKey)].state === "saved"
            )
              delete rowStatus.value[String(rowKey)];
          }, 1500);
        })
        .catch((err) => {
          rowStatus.value[String(rowKey)] = {
            state: "error",
            message: err && err.message ? err.message : null,
          };
          editingLabels.value.delete(String(rowKey));
        });
    };

    const saveTags = debounce(saveTagsImmediate, 500);

    // no toggle: tags are editable inline by default

    function onTagsChange(row, newTags) {
      const id = String(row.label);
      editingLabels.value.add(id);
      const arr = Array.isArray(newTags) ? newTags.slice() : [];
      const before = arr.slice();
      const normalized = normalizeList(arr);
      const removed = before.filter((p) => {
        const low = (p || "").trim().toLowerCase();
        if (!low) return true;
        if (low.length > MAX_LEN) return true;
        if (!normalized.includes(low)) return true;
        return false;
      });
      if (removed.length) {
        const shown = new Set();
        removed.forEach((r) => {
          const low = (r || "").trim().toLowerCase();
          if (shown.has(low)) return;
          shown.add(low);
          if (low.length > MAX_LEN) {
            ElMessage.error(
              t("classification.phrase_too_long", { max: MAX_LEN }) ||
                `Phrases longer than ${MAX_LEN} characters were removed`
            );
          } else {
            ElMessage.error(
              t("classification.duplicate_removed", { phrase: r }) ||
                `Duplicate phrase removed: ${r}`
            );
          }
        });
      }
      rowTags.value[id] = normalized;
      saveTags(id, normalized);
    }

    // Explicit paste handler for per-row tags (fallback if directive missed inner input)
    function handleRowPaste(e, row) {
      try {
        if (!row || row.id == null) return;
        const data = e && e.clipboardData && e.clipboardData.getData("text");
        if (!data) return;
        // Process only if multiline or tabs present
        if (!/[\r\n\t]/.test(data)) return; // allow normal paste for single line
        e.preventDefault();
        let parts = data
          .split(/\r?\n/)
          .map((s) => s.split(/[，,]/))
          .flat()
          .map((s) => (s == null ? "" : String(s).trim()))
          .filter(Boolean);
        if (!parts.length) return;
        const before = parts.length;
        parts = parts.filter((s) => s.length <= MAX_LEN);
        const discarded = before - parts.length;
        if (discarded > 0) {
          ElMessage.error(
            t("classification.phrase_too_long", { max: MAX_LEN }) ||
              `Phrases longer than ${MAX_LEN} characters were removed`
          );
        }
        const id = String(row.label);
        const current = Array.isArray(rowTags.value[id])
          ? rowTags.value[id].slice()
          : [];
        const merged = [...current, ...parts];
        rowTags.value[id] = merged;
        onTagsChange(row, merged); // will trigger debounced save
      } catch (err) {
        // silent
      }
    }

    // Handle change on the add-sample input to enforce MAX_LEN immediately
    function onInputChange(newTags) {
      const arr = Array.isArray(newTags) ? newTags.slice() : [];
      const before = arr.slice();
      const normalized = normalizeList(arr);
      const removed = before.filter((p) => {
        const low = (p || "").trim().toLowerCase();
        if (!low) return true;
        if (low.length > MAX_LEN) return true;
        if (!normalized.includes(low)) return true;
        return false;
      });
      if (removed.length) {
        const shown = new Set();
        removed.forEach((r) => {
          const low = (r || "").trim().toLowerCase();
          if (shown.has(low)) return;
          shown.add(low);
          if (low.length > MAX_LEN) {
            ElMessage.error(
              t("classification.phrase_too_long", { max: MAX_LEN }) ||
                `Phrases longer than ${MAX_LEN} characters were removed`
            );
          } else {
            ElMessage.error(
              t("classification.duplicate_removed", { phrase: r }) ||
                `Duplicate phrase removed: ${r}`
            );
          }
        });
      }
      input.value = normalized;
    }

    // Truncation/normalization is handled immediately in onTagsChange and in saveTagsImmediate

    function deleteAll() {
      if (!typingStore.samples || typingStore.samples.length === 0) {
        ElMessage.warning(t("classification.empty_warning"));
        return;
      }
      ElMessageBox.confirm(
        t("classification.delete_all_confirm", {
          count: typingStore.samples.length,
        }),
        t("сonfiguration"),
        {
          confirmButtonText: t("delete"),
          cancelButtonText: t("cancel") || "Отмена",
          type: "warning",
        }
      ).then(() => {
        typingStore.clearSamples(project.currentProjectId);
      });
    }

    function addSamples() {
      if (!project.currentProjectId) {
        ElMessage.error(t("select_project") || "Выберите проект");
        return;
      }
      const label = (sampleLabel.value || "").trim();
      // normalize input.value array and remove phrases longer than MAX_LEN
      let inputArr = Array.isArray(input.value) ? input.value.slice() : [];
      const before = inputArr.slice();
      const normalized = normalizeList(inputArr);
      const removed = before.filter((p) => {
        const low = (p || "").trim().toLowerCase();
        if (!low) return true;
        if (low.length > MAX_LEN) return true;
        if (!normalized.includes(low)) return true;
        return false;
      });
      if (removed.length) {
        const shown = new Set();
        removed.forEach((r) => {
          const low = (r || "").trim().toLowerCase();
          if (shown.has(low)) return;
          shown.add(low);
          if (low.length > MAX_LEN) {
            ElMessage.warning(
              t("classification.phrase_too_long", { max: MAX_LEN }) ||
                `Phrases longer than ${MAX_LEN} characters were removed`
            );
          } else {
            ElMessage.error(
              t("classification.duplicate_removed", { phrase: r }) ||
                `Duplicate phrase removed: ${r}`
            );
          }
        });
      }
      input.value = normalized;

      const text =
        normalized.length > 0
          ? normalized.join(", ").trim()
          : (sampleText.value || "").trim();
      if (!label || !text) {
        ElMessage.warning(t("classification.both_required"));
        return;
      }
      const parsed = [{ label, text }];
      typingStore.addSamples(project.currentProjectId, parsed);
      setTimeout(() => {
        sampleLabel.value = "";
        sampleText.value = "";
        input.value = [];
      }, 300);
    }

    function clearAll() {
      if (!project.currentProjectId) return;
      ElMessageBox.confirm(
        t("classification.delete_all_confirm_message"),
        t("classification.delete_all_confirm_title"),
        {
          confirmButtonText: t("delete"),
          cancelButtonText: t("cancel"),
          type: "warning",
        }
      )
        .then(() => {
          typingStore.clearSamples(project.currentProjectId);
        })
        .catch(() => {});
    }

    onMounted(() => {
      if (project.currentProjectId)
        typingStore.loadSamples(project.currentProjectId);
      // attach socket listener for per-row update acknowledgements
      if (socket && socket.on) {
        // при стратегии syncLabelPhrases перехват обновления per-id не обязателен
      }
    });

    // cleanup socket listeners on unmount
    onUnmounted(() => {
      try {
        if (socket && socket.off) socket.off("typing:samples:updated");
      } catch (e) {}
    });

    watch(
      () => project.currentProjectId,
      (id) => {
        if (id) typingStore.loadSamples(id);
      }
    );

    // Initialize rowTags whenever samples are loaded/changed
    watch(
      () => groupedSamples.value,
      (list) => {
        try {
          if (!Array.isArray(list)) return;
          for (const r of list) {
            if (r && r.label) {
              const id = String(r.label);
              if (!editingLabels.value.has(id)) {
                rowTags.value[id] = phrases(r.text || "").filter(
                  (s) => s.length <= MAX_LEN
                );
              }
            }
          }
        } catch (e) {}
      },
      { immediate: true }
    );

    return {
      sampleLabel,
      sampleText,
      input,
      project,
      typingStore,
      delimiter,
      activeName,
      phrases,
      groupedSamples,
      deleteRow,
      deleteAll,
      addSamples,
      clearAll,
      Delete,
      InfoFilled,
      rowTags,
      rowStatus,
      onTagsChange,
      onInputChange,
      handleRowPaste,
      // expose for directive access
      MAX_LEN,
      ElMessage,
      t,
    };
  },
});
</script>

<style scoped>
/* Ensure badges inside the table are not clipped by cell overflow */
.el-table .cell {
  overflow: visible !important;
}
.item,
.el-badge {
  display: inline-block;
  position: relative;
  z-index: 10;
  overflow: visible !important;
}

/* Keep collapse items fixed width and prevent horizontal growth */
.typing-collapse {
  max-width: 100px; /* adjust as needed */
  width: 100%;
}
.typing-collapse :deep(.el-collapse-item__wrap),
.typing-collapse :deep(.el-collapse-item) {
  overflow: hidden;
}
.typing-collapse :deep(.el-collapse-item__content) {
  overflow: auto;
}

/* Fixed width for per-row el-input-tag to avoid expanding the collapse item */
.fixed-input-tag {
  max-width: 720px; /* reasonable max width, adjust if needed */
  width: 100%;
  box-sizing: border-box;
  display: block;
}

/* Format algorithm steps with proper line breaks */
.algorithm-steps {
  white-space: pre-line;
  line-height: 1.5;
  margin-top: 8px;
}
</style>
