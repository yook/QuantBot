<template>
  <div class="mx-10">
    <el-drawer
      v-model="helpDrawerVisible"
      direction="rtl"
      size="40%"
      :title="t('parser.help.title')"
    >
      <div class="text-sm leading-6">
        <p>{{ t("parser.help.summary") }}</p>
        <p class="mt-2">{{ t("parser.help.summaryDetails") }}</p>
      </div>

      <el-divider content-position="left">{{
        t("parser.help.supportedTitle")
      }}</el-divider>
      <div class="mb-4 text-sm leading-6">
        <div v-for="group in selectorGroups" :key="group.title" class="mb-3">
          <div>
            <strong>{{ group.title }}</strong>
          </div>
          <div>{{ group.examples.join(", ") }}</div>
        </div>
      </div>

      <el-divider content-position="left">{{
        t("parser.help.defaultsTitle")
      }}</el-divider>
      <div class="mb-4 text-sm leading-6">
        <div>{{ defaultSelectors.join(", ") }}</div>
      </div>

      <el-divider content-position="left">{{
        t("parser.help.findTitle")
      }}</el-divider>
      <div class="mb-4 text-sm leading-6">
        <div v-for="mode in findModes" :key="mode.name" class="mb-3">
          <div>
            <strong>{{ mode.name }}</strong>
          </div>
          <div>{{ mode.description }}</div>
          <div
            v-if="mode.example"
            class="mt-1 text-xs text-(--el-text-color-secondary)"
          >
            {{ mode.example }}
          </div>
        </div>
      </div>

      <el-divider content-position="left">{{
        t("parser.help.limitsTitle")
      }}</el-divider>
      <ul class="mb-4 pl-5 text-sm leading-6 list-disc">
        <li v-for="item in limitations" :key="item">{{ item }}</li>
      </ul>

      <el-divider content-position="left">{{
        t("parser.help.examplesTitle")
      }}</el-divider>
      <div class="text-sm leading-6">
        <div
          v-for="example in practicalExamples"
          :key="example.title"
          class="mb-3"
        >
          <div>
            <strong>{{ example.title }}</strong>
          </div>
          <div>{{ example.selector }}</div>
          <div>{{ example.find }}</div>
          <div v-if="example.attr">{{ example.attr }}</div>
        </div>
      </div>
    </el-drawer>

    <el-dialog
      v-model="newSelectorDialogVisible"
      width="820px"
      :title="t('parser.newSelector')"
    >
      <el-form label-position="top" class="selector-dialog-form">
        <el-form-item :label="t('parser.name')">
          <el-input :placeholder="$t('parser.name')" v-model="newRow.name" />
        </el-form-item>

        <el-form-item :label="t('parser.selector')">
          <el-input
            :placeholder="$t('parser.selector') + ': tag, id, class'"
            v-model="newRow.selector"
            class="selector-input-with-type"
          >
            <template #prepend>
              <el-select
                v-model="newRow.selectorType"
                :placeholder="t('parser.selectorType')"
                style="width: 110px"
              >
                <el-option
                  v-for="option in selectorTypeOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
            </template>
          </el-input>
        </el-form-item>

        <el-form-item :label="t('parser.find')">
          <el-select
            v-model="newRow.find"
            :placeholder="$t('parser.find')"
            style="width: 100%"
          >
            <el-option
              v-for="mode in findSelectOptions"
              :key="mode.value"
              :label="mode.label"
              :value="mode.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item v-if="showParamField" :label="paramPlaceholder">
          <el-input
            :placeholder="paramPlaceholder"
            v-model="newRow.attrClass"
            class="el-input-select"
          />
        </el-form-item>
      </el-form>

      <div
        v-if="selectedFindMode"
        class="mt-2 text-sm leading-6 text-(--el-text-color-secondary)"
      >
        <div>
          <strong v-if="dynamicFindTitle">{{ dynamicFindTitle }}</strong>
          <span v-if="dynamicFindTitle"> - </span>
          <span>{{ dynamicFindDescription }}</span>
        </div>
      </div>

      <template #footer>
        <span class="dialog-footer">
          <el-button @click="newSelectorDialogVisible = false">
            {{ t("crawler.cancelButton") }}
          </el-button>
          <el-button
            type="primary"
            :disabled="!canCreateRow"
            @click="submitNewSelectorFromDialog"
          >
            {{ t("common.save") }}
          </el-button>
        </span>
      </template>
    </el-dialog>

    <!-- Удалена дублирующая ручная верстка parser элементов; оставлена только таблица ниже -->
    <el-table
      :data="project.data.parser"
      table-layout="auto"
      class="mb-12"
      style="width: 100%"
    >
      <el-table-column prop="name" :label="$t('parser.name')" width="180" />
      <el-table-column
        prop="selector"
        :label="$t('parser.selector')"
        width="420"
      >
        <template #default="scope">
          <el-input
            v-model="scope.row.selector"
            :placeholder="$t('parser.selector')"
            class="selector-input-with-type"
            @change="onParserRowSelectorChange(scope.row)"
          >
            <template #prepend>
              <el-select
                v-model="scope.row.selectorType"
                style="width: 110px"
                @change="onParserRowSelectorTypeChange(scope.row)"
              >
                <el-option
                  v-for="option in selectorTypeOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
            </template>
          </el-input>
        </template>
      </el-table-column>
      <el-table-column prop="find" :label="$t('parser.find')">
        <template #default="scope">
          <div>{{ getFindColumnText(scope.row) }}</div>
        </template>
      </el-table-column>
      <el-table-column align="right">
        <template #default="scope">
          <el-button type="danger" text circle @click="deleteCol(scope.row)">
            <i-tabler-trash />
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { computed, ref, watchEffect } from "vue";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { useProjectStore } from "../../stores/project";

const project = useProjectStore();
const { t, tm } = useI18n();
const helpDrawerVisible = ref(false);
const newSelectorDialogVisible = ref(false);
const visibleFindModes = [
  "text",
  "attr",
  "html",
  "outerHtml",
  "firstText",
  "firstAttr",
  "exists",
  "matchesRegex",
  "allTextArray",
  "allAttrArray",
  "uniqueText",
  "countTextLength",
  "countAttrLength",
  "countWords",
  "number",
  "trimmedText",
  "ownText",
  "quantity",
];
const attrModes = ["attr", "firstAttr", "allAttrArray", "countAttrLength"];
const regexModes = ["matchesRegex"];

let newRow = ref({
  name: "",
  prop: "",
  selector: "",
  selectorType: "css",
  find: "text",
  attrClass: "",
  getLength: false,
});

const selectorGroups = tm("parser.help.selectorGroups");
const defaultSelectors = tm("parser.help.defaultSelectors");
const findModes = tm("parser.help.findModes");
const limitations = tm("parser.help.limitations");
const practicalExamples = tm("parser.help.practicalExamples");
const selectedFindMode = computed(() =>
  findModes.find((mode) => mode.name === newRow.value.find),
);
const showParamField = computed(() => regexModes.includes(newRow.value.find));
const canCreateRow = computed(() => {
  const hasName = Boolean(newRow.value.name?.trim());
  const hasSelector = Boolean(newRow.value.selector?.trim());
  const hasFind = Boolean(newRow.value.find?.trim());
  const hasParam =
    !showParamField.value || Boolean(newRow.value.attrClass?.trim());

  return hasName && hasSelector && hasFind && hasParam;
});
const findSelectOptions = computed(() =>
  visibleFindModes.map((mode) => ({
    value: mode,
    label: getFindModeLabel(mode),
  })),
);
const selectorTypeOptions = computed(() => [
  { value: "css", label: t("parser.selectorTypes.css") },
  { value: "xpath", label: t("parser.selectorTypes.xpath") },
]);
const paramPlaceholder = computed(() => {
  if (regexModes.includes(newRow.value.find)) return "regex";
  return "";
});
function getFindModeLabel(mode) {
  const prefix = `${mode} - `;

  switch (mode) {
    case "text":
      return prefix + t("parser.dynamicHint.text");
    case "attr":
      return prefix + t("parser.dynamicHint.attr");
    case "html":
      return prefix + t("parser.dynamicHint.html");
    case "outerHtml":
      return prefix + t("parser.dynamicHint.outerHtml");
    case "firstText":
      return prefix + t("parser.dynamicHint.firstText");
    case "firstAttr":
      return prefix + t("parser.dynamicHint.firstAttr");
    case "exists":
      return prefix + t("parser.dynamicHint.exists");
    case "matchesRegex":
      return prefix + t("parser.dynamicHint.matchesRegex");
    case "allTextArray":
      return prefix + t("parser.dynamicHint.allTextArray");
    case "allAttrArray":
      return prefix + t("parser.dynamicHint.allAttrArray");
    case "uniqueText":
      return prefix + t("parser.dynamicHint.uniqueText");
    case "countTextLength":
      return prefix + t("parser.dynamicHint.countTextLength");
    case "countAttrLength":
      return prefix + t("parser.dynamicHint.countAttrLength");
    case "countWords":
      return prefix + t("parser.dynamicHint.countWords");
    case "number":
      return prefix + t("parser.dynamicHint.number");
    case "trimmedText":
      return prefix + t("parser.dynamicHint.trimmedText");
    case "ownText":
      return prefix + t("parser.dynamicHint.ownText");
    case "quantity":
      return prefix + t("parser.dynamicHint.quantity");
    default:
      return mode;
  }
}

function getFindColumnText(row) {
  return row.findLabel || formatLegacyFindText(row);
}

function ensureSelectorType(row) {
  if (!row || typeof row !== "object") return "css";
  if (row.selectorType !== "xpath") {
    row.selectorType = "css";
  }
  return row.selectorType;
}

function formatSelectorLabel(row) {
  const selector = row.selector?.trim() || "";
  const selectorType = ensureSelectorType(row);

  if (!selector) {
    return "";
  }

  if (selectorType === "xpath") {
    return selector;
  }

  if (
    attrModes.includes(row.find) &&
    row.attrClass?.trim() &&
    !selector.includes("[")
  ) {
    return `${selector}[${row.attrClass.trim()}]`;
  }

  return selector;
}

function formatLegacyFindText(row) {
  let text = row.find === "hasClass" ? "class=" : row.find;

  if (row.attrClass) {
    text += ` "${row.attrClass}"`;
  }

  if (row.getLength) {
    text += " length";
  }

  return text;
}

function getLastSelectorSegment(selectorValue) {
  const selector = String(selectorValue || "").trim();
  if (!selector) return "";
  if (!selector.includes(">")) return selector;

  const parts = selector
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts[parts.length - 1] : selector;
}

function inferAttrFromSelector(selectorValue) {
  const selector = String(selectorValue || "");
  if (!selector) return "";

  const matches = [...selector.matchAll(/\[([^\]]+)\]/g)];
  if (!matches.length) return "";

  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const body = String(matches[i]?.[1] || "").trim();
    if (!body) continue;

    const attrMatch = body.match(/^\s*([^\s~|^$*!=>\]]+)\s*(?:[~|^$*]?=|$)/);
    const attr = String(attrMatch?.[1] || "").trim();

    if (attr) {
      return attr;
    }
  }

  return "";
}

function buildFindDescription(rowLike) {
  if (!rowLike?.find) return "";

  const selectorType = ensureSelectorType(rowLike);
  const selector =
    selectorType === "xpath"
      ? String(rowLike.selector || "").trim()
      : getLastSelectorSegment(rowLike.selector);
  const explicitAttrClass = rowLike.attrClass?.trim();
  const attrClass =
    explicitAttrClass ||
    (selectorType === "css" ? inferAttrFromSelector(selector) : "");
  const regexPattern = explicitAttrClass;
  const withLength = rowLike.getLength
    ? t("parser.dynamicHint.lengthSuffix")
    : "";

  switch (rowLike.find) {
    case "text":
      return selector
        ? t("parser.dynamicHint.textWithSelector", { selector }) + withLength
        : t("parser.dynamicHint.text") + withLength;
    case "attr":
      if (selector && attrClass) {
        return (
          t("parser.dynamicHint.attrWithSelectorAndAttr", {
            selector,
            attr: attrClass,
          }) + withLength
        );
      }
      if (attrClass) {
        return (
          t("parser.dynamicHint.attrWithAttr", {
            attr: attrClass,
          }) + withLength
        );
      }
      if (selector) {
        return (
          t("parser.dynamicHint.attrWithSelector", {
            selector,
          }) + withLength
        );
      }
      return t("parser.dynamicHint.attr") + withLength;
    case "html":
      return selector
        ? t("parser.dynamicHint.htmlWithSelector", { selector }) + withLength
        : t("parser.dynamicHint.html") + withLength;
    case "outerHtml":
      return selector
        ? t("parser.dynamicHint.outerHtmlWithSelector", { selector }) +
            withLength
        : t("parser.dynamicHint.outerHtml") + withLength;
    case "firstText":
      return selector
        ? t("parser.dynamicHint.firstTextWithSelector", { selector }) +
            withLength
        : t("parser.dynamicHint.firstText") + withLength;
    case "firstAttr":
      if (selector && attrClass) {
        return (
          t("parser.dynamicHint.firstAttrWithSelectorAndAttr", {
            selector,
            attr: attrClass,
          }) + withLength
        );
      }
      if (attrClass) {
        return (
          t("parser.dynamicHint.firstAttrWithAttr", {
            attr: attrClass,
          }) + withLength
        );
      }
      if (selector) {
        return (
          t("parser.dynamicHint.firstAttrWithSelector", {
            selector,
          }) + withLength
        );
      }
      return t("parser.dynamicHint.firstAttr") + withLength;
    case "exists":
      return selector
        ? t("parser.dynamicHint.existsWithSelector", { selector })
        : t("parser.dynamicHint.exists");
    case "matchesRegex":
      if (selector && regexPattern) {
        return (
          t("parser.dynamicHint.matchesRegexWithSelectorAndPattern", {
            selector,
            pattern: regexPattern,
          }) + withLength
        );
      }
      if (regexPattern) {
        return (
          t("parser.dynamicHint.matchesRegexWithPattern", {
            pattern: regexPattern,
          }) + withLength
        );
      }
      if (selector) {
        return (
          t("parser.dynamicHint.matchesRegexWithSelector", { selector }) +
          withLength
        );
      }
      return t("parser.dynamicHint.matchesRegex") + withLength;
    case "allTextArray":
      return selector
        ? t("parser.dynamicHint.allTextArrayWithSelector", { selector }) +
            withLength
        : t("parser.dynamicHint.allTextArray") + withLength;
    case "allAttrArray":
      if (selector && attrClass) {
        return (
          t("parser.dynamicHint.allAttrArrayWithSelectorAndAttr", {
            selector,
            attr: attrClass,
          }) + withLength
        );
      }
      if (attrClass) {
        return (
          t("parser.dynamicHint.allAttrArrayWithAttr", { attr: attrClass }) +
          withLength
        );
      }
      if (selector) {
        return (
          t("parser.dynamicHint.allAttrArrayWithSelector", { selector }) +
          withLength
        );
      }
      return t("parser.dynamicHint.allAttrArray") + withLength;
    case "uniqueText":
      return selector
        ? t("parser.dynamicHint.uniqueTextWithSelector", { selector }) +
            withLength
        : t("parser.dynamicHint.uniqueText") + withLength;
    case "countTextLength":
      return selector
        ? t("parser.dynamicHint.countTextLengthWithSelector", { selector })
        : t("parser.dynamicHint.countTextLength");
    case "countAttrLength":
      if (selector && attrClass) {
        return t("parser.dynamicHint.countAttrLengthWithSelectorAndAttr", {
          selector,
          attr: attrClass,
        });
      }
      if (attrClass) {
        return t("parser.dynamicHint.countAttrLengthWithAttr", {
          attr: attrClass,
        });
      }
      if (selector) {
        return t("parser.dynamicHint.countAttrLengthWithSelector", {
          selector,
        });
      }
      return t("parser.dynamicHint.countAttrLength");
    case "countWords":
      return selector
        ? t("parser.dynamicHint.countWordsWithSelector", { selector })
        : t("parser.dynamicHint.countWords");
    case "number":
      return selector
        ? t("parser.dynamicHint.numberWithSelector", { selector }) + withLength
        : t("parser.dynamicHint.number") + withLength;
    case "trimmedText":
      return selector
        ? t("parser.dynamicHint.trimmedTextWithSelector", { selector }) +
            withLength
        : t("parser.dynamicHint.trimmedText") + withLength;
    case "ownText":
      return selector
        ? t("parser.dynamicHint.ownTextWithSelector", { selector }) + withLength
        : t("parser.dynamicHint.ownText") + withLength;
    case "quantity":
      return selector
        ? t("parser.dynamicHint.quantityWithSelector", { selector })
        : t("parser.dynamicHint.quantity");
    default:
      return "";
  }
}

function onParserRowSelectorChange(row) {
  if (!row || typeof row !== "object") return;
  ensureSelectorType(row);
  row.selectorLabel = formatSelectorLabel(row);
  // Recompute cached text to avoid stale description after selector edit.
  row.findLabel = buildFindDescription(row);
  project.updateProject();
}

function onParserRowSelectorTypeChange(row) {
  if (!row || typeof row !== "object") return;
  ensureSelectorType(row);
  row.selectorLabel = formatSelectorLabel(row);
  row.findLabel = buildFindDescription(row);
  project.updateProject();
}

function normalizeParserRows() {
  if (!Array.isArray(project.data.parser)) return;

  for (const row of project.data.parser) {
    ensureSelectorType(row);
  }
}

const dynamicFindTitle = computed(() => newRow.value.name?.trim() || "");
const dynamicFindDescription = computed(() =>
  buildFindDescription(newRow.value),
);

function openHelpDrawer() {
  helpDrawerVisible.value = true;
}

function resetNewSelectorForm() {
  newRow.value = {
    name: "",
    prop: "",
    selector: "",
    selectorType: "css",
    find: "text",
    attrClass: "",
    getLength: false,
  };
}

function openNewSelectorDialog() {
  normalizeParserRows();
  resetNewSelectorForm();
  newSelectorDialogVisible.value = true;
}

defineExpose({
  openHelpDrawer,
  createNewSelector: openNewSelectorDialog,
  openNewSelectorDialog,
});

const emit = defineEmits(["newCol", "deleteCol"]);

// const props = defineProps({
//   project: Object,
//   id: String,
// });

const form = { ...newRow };

watchEffect(() => {
  normalizeParserRows();
});

// function resetForm() {
//   Object.assign(form, newRow);
// }

// function setForm(obj) {
//   Object.assign(form, obj);
// }
function newCol() {
  if (!canCreateRow.value) {
    ElMessage.warning("Заполните все обязательные поля");
    return false;
  }

  console.log("Adding new parser column...");
  newRow.value.prop = Math.floor(Math.random() * 1000000) + "";

  const obj = {
    ...newRow.value,
    selectorLabel: formatSelectorLabel(newRow.value),
    findLabel: buildFindDescription(newRow.value),
  };
  project.data.parser.push(obj);
  console.log("Parser data updated:", project.data.parser);

  // Сохраняем изменения в базу данных
  project.updateProject();

  resetNewSelectorForm();
  return true;
}

function submitNewSelectorFromDialog() {
  const created = newCol();
  if (created) {
    newSelectorDialogVisible.value = false;
  }
}

function deleteCol(val) {
  console.log("Deleting parser column:", val);
  let index = project.data.parser.indexOf(val);
  project.data.parser.splice(index, 1);
  console.log("Parser data after deletion:", project.data.parser);

  // Сохраняем изменения в базу данных
  project.updateProject();
}
</script>

<style scoped>
.selector-dialog-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.selector-dialog-form :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}

.selector-input-with-type :deep(.el-input-group__prepend) {
  background-color: var(--el-fill-color-blank);
}
</style>
