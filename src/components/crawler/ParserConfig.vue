<template>
  <div class="m-10">
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
        width="180"
      />
      <el-table-column prop="find" :label="$t('parser.find')">
        <template #default="scope">
          <div>
            <span v-if="scope.row.find === 'hasClass'">class=</span>
            <span v-else> {{ scope.row.find }}</span>
            <span v-if="scope.row.attrClass"> "{{ scope.row.attrClass }}"</span>
            <span v-if="scope.row.getLength"> length</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column align="right">
        <template #default="scope">
          <el-button
            type="danger"
            text
            :icon="Delete"
            circle
            @click="deleteCol(scope.row)"
          />
        </template>
      </el-table-column>
    </el-table>

    <el-divider content-position="center">{{ $t("parser.new") }}</el-divider>

    <div class="py-2 items-center flex">
      <div class="w-40 mr-2">
        <el-input
          :placeholder="$t('parser.name')"
          v-model="newRow.name"
          class=""
        />
      </div>

      <div class="w-96 mr-2">
        <el-input
          :placeholder="$t('parser.selector') + ': tag, id, class'"
          v-model="newRow.selector"
          class="w-2"
        >
          <template #append>
            <el-select
              v-model="newRow.find"
              :placeholder="$t('parser.find')"
              style="width: 115px"
            >
              <el-option value="text" />
              <el-option value="attr" />
              <el-option value="hasClass" />
              <el-option value="quantity" />
            </el-select>
          </template>
        </el-input>
      </div>
      <div class="mr-2" v-if="newRow.find === 'hasClass'">
        <el-input
          placeholder="class-name"
          v-model="newRow.attrClass"
          class="el-input-select"
        />
      </div>
      <div class="mr-2" v-if="newRow.find === 'attr'">
        <el-input
          placeholder="attr"
          v-model="newRow.attrClass"
          class="el-input-select"
        />
      </div>
      <div class="mr-2" v-if="newRow.find !== 'quantity'">
        <el-checkbox
          v-model="newRow.getLength"
          label="Length"
          border
        ></el-checkbox>
      </div>
      <div class="flex-1 text-right">
        <div class=" ">
          <el-button type="primary" plain @click="newCol">+</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, inject } from "vue";
import { Delete, Close } from "@element-plus/icons-vue";
import { useProjectStore } from "../../stores/project";

const project = useProjectStore();

const emit = defineEmits(["newCol", "deleteCol"]);

// const props = defineProps({
//   project: Object,
//   id: String,
// });

let newRow = ref({
  name: "",
  prop: "",
  selector: "",
  find: "",
  attrClass: "",
  getLength: false,
});

const form = { ...newRow };

// function resetForm() {
//   Object.assign(form, newRow);
// }

// function setForm(obj) {
//   Object.assign(form, obj);
// }
function newCol() {
  console.log("Adding new parser column...");
  newRow.value.prop = Math.floor(Math.random() * 1000000) + "";

  const obj = { ...newRow.value };
  project.data.parser.push(obj);
  console.log("Parser data updated:", project.data.parser);

  // Сохраняем изменения в базу данных
  project.updateProject();

  newRow.value = {
    name: "",
    prop: "",
    selector: "",
    find: "",
    attrClass: "",
    getLength: false,
  };
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
