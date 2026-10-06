<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElAlert, ElButton, ElCard, ElForm, ElFormItem, ElInput, ElOption, ElSelect } from 'element-plus';
import type { Project } from '@crane199709/saas-forge-api-client';
import type { ProjectHost, ProjectTextKey } from '../project-host';

const props = defineProps<{ host: ProjectHost; text(key: ProjectTextKey): string; brandName: string }>();
defineOptions({ name: 'ProjectTaskRemote' });
const projects = ref<Project.Project[]>([]);
const tasks = ref<Project.Task[]>([]);
const selected = ref<Project.Project>();
const editingProject = ref<string>();
const editingTask = ref<string>();
const name = ref('');
const description = ref('');
const title = ref('');
const taskDescription = ref('');
const taskStatus = ref<Project.Task['status']>('TODO');
const statuses = ['TODO', 'IN_PROGRESS', 'DONE'] as const;
const statusText = (status: Project.Task['status']) =>
  props.text(({ TODO: 'todo', IN_PROGRESS: 'inProgress', DONE: 'done' } as const)[status]);
const projectCursor = ref<string | null>(null);
const taskCursor = ref<string | null>(null);
const busy = ref(false);
const failed = ref(false);
const unknown = ref(false);

async function action(operation: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  failed.value = false;
  try {
    await operation();
  } catch {
    failed.value = true;
  } finally {
    busy.value = false;
    unknown.value = props.host.pending();
  }
}
async function projectPage(append = false) {
  const page = await props.host.listProjects(append ? (projectCursor.value ?? undefined) : undefined);
  projects.value = append ? [...projects.value, ...page.items] : page.items;
  projectCursor.value = page.nextCursor;
}
async function taskPage(append = false) {
  if (!selected.value) return;
  const page = await props.host.listTasks(selected.value.id, append ? (taskCursor.value ?? undefined) : undefined);
  tasks.value = append ? [...tasks.value, ...page.items] : page.items;
  taskCursor.value = page.nextCursor;
}
async function select(id: string) {
  selected.value = await props.host.getProject(id);
  editingTask.value = undefined;
  title.value = '';
  taskDescription.value = '';
  taskStatus.value = 'TODO';
  await taskPage();
}
async function saveProject() {
  const body = { name: name.value, description: description.value || null };
  if (editingProject.value) await props.host.updateProject(editingProject.value, body);
  else await props.host.createProject(body);
  editingProject.value = undefined;
  name.value = '';
  description.value = '';
  await projectPage();
}
async function editProject(id: string) {
  const value = await props.host.getProject(id);
  editingProject.value = value.id;
  name.value = value.name;
  description.value = value.description ?? '';
}
async function saveTask() {
  if (!selected.value) return;
  const body = { title: title.value, description: taskDescription.value || null };
  if (editingTask.value)
    await props.host.updateTask(selected.value.id, editingTask.value, { ...body, status: taskStatus.value });
  else await props.host.createTask(selected.value.id, body);
  editingTask.value = undefined;
  title.value = '';
  taskDescription.value = '';
  taskStatus.value = 'TODO';
  await taskPage();
}
async function editTask(id: string) {
  if (!selected.value) return;
  const value = await props.host.getTask(selected.value.id, id);
  editingTask.value = value.id;
  title.value = value.title;
  taskDescription.value = value.description ?? '';
  taskStatus.value = value.status;
}
async function removeProject(id: string) {
  await props.host.deleteProject(id);
  if (selected.value?.id === id) {
    selected.value = undefined;
    tasks.value = [];
  }
  await projectPage();
}
async function removeTask(id: string) {
  if (!selected.value) return;
  await props.host.deleteTask(selected.value.id, id);
  await taskPage();
}
async function recover() {
  await props.host.retryPending();
  await projectPage();
  await taskPage();
}
onMounted(() => action(() => projectPage()));
</script>

<template>
  <section data-testid="project-remote" class="space-y-16px" :aria-busy="busy">
    <h2 class="text-18px font-semibold">{{ text('projects') }} · {{ brandName }}</h2>
    <ElAlert v-if="failed" :title="text('failed')" type="error" :closable="false" role="alert" />
    <ElAlert v-if="unknown" :title="text('unknown')" type="warning" :closable="false" role="status" />
    <ElButton v-if="unknown" :disabled="busy" @click="action(recover)">{{ text('recover') }}</ElButton>
    <ElCard>
      <ElForm
        :aria-label="text('projects')"
        label-position="top"
        :disabled="busy || unknown"
        @submit.prevent="action(saveProject)"
      >
        <ElFormItem :label="text('name')">
          <ElInput v-model="name" :aria-label="text('name')" maxlength="200" />
        </ElFormItem>
        <ElFormItem :label="text('description')">
          <ElInput v-model="description" :aria-label="text('description')" type="textarea" maxlength="2000" />
        </ElFormItem>
        <ElButton native-type="submit" type="primary" :disabled="!name.trim()">
          {{ text(editingProject ? 'save' : 'create') }}
        </ElButton>
        <ElButton
          v-if="editingProject"
          @click="
            editingProject = undefined;
            name = '';
            description = '';
          "
        >
          {{ text('cancel') }}
        </ElButton>
      </ElForm>
      <ElButton class="mt-16px" :disabled="busy" @click="action(() => projectPage())">{{ text('reload') }}</ElButton>
      <p v-if="!projects.length && !busy" class="mt-16px">{{ text('empty') }}</p>
      <ul class="mt-16px space-y-12px">
        <li v-for="project in projects" :key="project.id">
          <span>{{ project.name }} · v{{ project.version }}</span>
          <ElButton :disabled="busy" @click="action(() => select(project.id))">{{ text('select') }}</ElButton>
          <ElButton :disabled="busy || unknown" @click="action(() => editProject(project.id))">
            {{ text('edit') }}
          </ElButton>
          <ElButton type="danger" :disabled="busy || unknown" @click="action(() => removeProject(project.id))">
            {{ text('delete') }}
          </ElButton>
        </li>
      </ul>
      <ElButton v-if="projectCursor" :disabled="busy" @click="action(() => projectPage(true))">
        {{ text('next') }}
      </ElButton>
    </ElCard>
    <ElCard v-if="selected">
      <h3 class="mb-16px text-18px font-semibold">{{ selected.name }} · {{ text('tasks') }}</h3>
      <ElForm
        :aria-label="text('tasks')"
        label-position="top"
        :disabled="busy || unknown"
        @submit.prevent="action(saveTask)"
      >
        <ElFormItem :label="text('title')">
          <ElInput v-model="title" :aria-label="text('title')" maxlength="200" />
        </ElFormItem>
        <ElFormItem :label="text('description')">
          <ElInput v-model="taskDescription" :aria-label="text('description')" type="textarea" maxlength="2000" />
        </ElFormItem>
        <ElFormItem v-if="editingTask" :label="text('status')">
          <ElSelect v-model="taskStatus" :aria-label="text('status')">
            <ElOption v-for="status in statuses" :key="status" :label="statusText(status)" :value="status" />
          </ElSelect>
        </ElFormItem>
        <ElButton native-type="submit" type="primary" :disabled="!title.trim()">
          {{ text(editingTask ? 'save' : 'create') }}
        </ElButton>
        <ElButton
          v-if="editingTask"
          @click="
            editingTask = undefined;
            title = '';
            taskDescription = '';
            taskStatus = 'TODO';
          "
        >
          {{ text('cancel') }}
        </ElButton>
      </ElForm>
      <ElButton class="mt-16px" :disabled="busy" @click="action(() => taskPage())">{{ text('reload') }}</ElButton>
      <p v-if="!tasks.length && !busy" class="mt-16px">{{ text('empty') }}</p>
      <ul class="mt-16px space-y-12px">
        <li v-for="task in tasks" :key="task.id">
          <span>{{ task.title }} · {{ statusText(task.status) }} · v{{ task.version }}</span>
          <ElButton :disabled="busy || unknown" @click="action(() => editTask(task.id))">{{ text('edit') }}</ElButton>
          <ElButton type="danger" :disabled="busy || unknown" @click="action(() => removeTask(task.id))">
            {{ text('delete') }}
          </ElButton>
        </li>
      </ul>
      <ElButton v-if="taskCursor" :disabled="busy" @click="action(() => taskPage(true))">{{ text('next') }}</ElButton>
    </ElCard>
  </section>
</template>
