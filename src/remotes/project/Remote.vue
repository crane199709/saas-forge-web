<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { ElAlert, ElButton, ElCard, ElForm, ElFormItem, ElInput, ElOption, ElSelect } from 'element-plus';
import type { Project } from '@crane199709/saas-forge-api-client';
import type { ProjectHost, ProjectTextKey } from '../project-host';

const props = defineProps<{
  host: ProjectHost;
  text(key: ProjectTextKey): string;
  permissions: string[];
  refreshPermissions(): Promise<void>;
}>();
defineOptions({ name: 'ProjectTaskRemote' });
const projects = ref<Project.Project[]>([]);
const tasks = ref<Project.Task[]>([]);
const selected = ref<
  Pick<Project.Project, 'id' | 'name'> & Partial<Pick<Project.Project, 'description' | 'version'>>
>();
const viewedTask = ref<Project.Task>();
const createdProject = ref<Pick<Project.Project, 'id' | 'name'>>();
const editingProject = ref<string>();
const editingTask = ref<string>();
const editingProjectVersion = ref<number>();
const editingTaskVersion = ref<number>();
const targetProjectId = ref('');
const targetProjectVersion = ref('');
const targetTaskId = ref('');
const targetTaskVersion = ref('');
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
const permissionState = ref<'allowed' | 'denied' | 'unavailable'>();
let pendingWrite: 'project' | 'task' | 'delete-project' | 'delete-task' | undefined;
const can = (resource: 'project' | 'task', operation: 'create' | 'list' | 'read' | 'update' | 'delete') =>
  props.permissions.includes(`example:${resource}:${operation}`);
const canUseTasks = computed(() =>
  (['create', 'list', 'read', 'update', 'delete'] as const).some(operation => can('task', operation))
);
const canUseProjects = computed(() =>
  (['create', 'list', 'read', 'update', 'delete'] as const).some(operation => can('project', operation))
);
const validId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const validVersion = (value: string) => /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value));

function failureCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

async function action(operation: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  failed.value = false;
  permissionState.value = undefined;
  try {
    await operation();
  } catch (error) {
    const code = failureCode(error);
    if (code === 'PERMISSION_DENIED' || code === 'PERMISSION_AUTHORITY_UNAVAILABLE') {
      permissionState.value = code === 'PERMISSION_DENIED' ? 'denied' : 'unavailable';
    } else failed.value = true;
  } finally {
    busy.value = false;
    unknown.value = props.host.pending();
    if (!unknown.value) pendingWrite = undefined;
  }
}
async function projectPage(append = false) {
  const page = await props.host.listProjects(append ? (projectCursor.value ?? undefined) : undefined);
  projects.value = append ? [...projects.value, ...page.items] : page.items;
  projectCursor.value = page.nextCursor;
  permissionState.value = 'allowed';
}
async function taskPage(append = false) {
  if (!selected.value) return;
  const page = await props.host.listTasks(selected.value.id, append ? (taskCursor.value ?? undefined) : undefined);
  tasks.value = append ? [...tasks.value, ...page.items] : page.items;
  taskCursor.value = page.nextCursor;
}
async function select(project: Project.Project) {
  selected.value = can('project', 'read') ? await props.host.getProject(project.id) : project;
  editingTask.value = undefined;
  title.value = '';
  taskDescription.value = '';
  taskStatus.value = 'TODO';
  if (can('task', 'list')) await taskPage();
}
async function openTargetProject() {
  const id = targetProjectId.value.trim();
  selected.value = can('project', 'read') ? await props.host.getProject(id) : { id, name: id };
  tasks.value = [];
  viewedTask.value = undefined;
  taskCursor.value = null;
  if (can('task', 'list')) await taskPage();
}
async function saveProject() {
  const body = { name: name.value, description: description.value || null };
  pendingWrite = 'project';
  if (editingProject.value) await props.host.updateProject(editingProject.value, body, editingProjectVersion.value);
  else {
    const created = await props.host.createProject(body);
    createdProject.value = { id: created.id, name: created.name };
    if (canUseTasks.value) selected.value = created;
  }
  editingProject.value = undefined;
  editingProjectVersion.value = undefined;
  name.value = '';
  description.value = '';
  if (can('project', 'list')) await projectPage();
}
async function editProject(project: Project.Project) {
  const value = can('project', 'read') ? await props.host.getProject(project.id) : project;
  editingProject.value = value.id;
  editingProjectVersion.value = undefined;
  name.value = value.name;
  description.value = value.description ?? '';
}
function editTargetProject() {
  editingProject.value = targetProjectId.value.trim();
  editingProjectVersion.value = Number(targetProjectVersion.value);
  name.value = '';
  description.value = '';
}
async function saveTask() {
  if (!selected.value) return;
  const body = { title: title.value, description: taskDescription.value || null };
  pendingWrite = 'task';
  if (editingTask.value)
    await props.host.updateTask(
      { projectId: selected.value.id, id: editingTask.value, expectedVersion: editingTaskVersion.value },
      { ...body, status: taskStatus.value }
    );
  else await props.host.createTask(selected.value.id, body);
  editingTask.value = undefined;
  editingTaskVersion.value = undefined;
  title.value = '';
  taskDescription.value = '';
  taskStatus.value = 'TODO';
  if (can('task', 'list')) await taskPage();
}
async function editTask(task: Project.Task) {
  if (!selected.value) return;
  const value = can('task', 'read') ? await props.host.getTask(selected.value.id, task.id) : task;
  editingTask.value = value.id;
  editingTaskVersion.value = undefined;
  title.value = value.title;
  taskDescription.value = value.description ?? '';
  taskStatus.value = value.status;
}
function editTargetTask() {
  editingTask.value = targetTaskId.value.trim();
  editingTaskVersion.value = Number(targetTaskVersion.value);
  title.value = '';
  taskDescription.value = '';
  taskStatus.value = 'TODO';
}
async function readTargetTask() {
  if (!selected.value) return;
  viewedTask.value = await props.host.getTask(selected.value.id, targetTaskId.value.trim());
}
async function readTask(task: Project.Task) {
  if (!selected.value) return;
  viewedTask.value = await props.host.getTask(selected.value.id, task.id);
}
async function removeProject(id: string, expectedVersion?: number) {
  pendingWrite = 'delete-project';
  await props.host.deleteProject(id, expectedVersion);
  if (selected.value?.id === id) {
    selected.value = undefined;
    tasks.value = [];
  }
  if (can('project', 'list')) await projectPage();
}
async function removeTask(id: string, expectedVersion?: number) {
  if (!selected.value) return;
  pendingWrite = 'delete-task';
  await props.host.deleteTask(selected.value.id, id, expectedVersion);
  if (can('task', 'list')) await taskPage();
}
async function recover() {
  const kind = pendingWrite;
  const result = await props.host.retryPending();
  if (kind === 'project') {
    if (
      result &&
      typeof result === 'object' &&
      'id' in result &&
      'name' in result &&
      typeof result.id === 'string' &&
      typeof result.name === 'string'
    ) {
      createdProject.value = { id: result.id, name: result.name };
      if (canUseTasks.value) selected.value = createdProject.value;
    }
    editingProject.value = undefined;
    editingProjectVersion.value = undefined;
    name.value = '';
    description.value = '';
  }
  if (kind === 'task') {
    editingTask.value = undefined;
    editingTaskVersion.value = undefined;
    title.value = '';
    taskDescription.value = '';
    taskStatus.value = 'TODO';
  }
  if (kind === 'delete-project') {
    selected.value = undefined;
    tasks.value = [];
  }
  if (kind === 'delete-task') viewedTask.value = undefined;
  if (can('project', 'list')) await projectPage();
  if (can('task', 'list')) await taskPage();
}
async function refreshPermissionHints() {
  await props.refreshPermissions();
  await nextTick();
  if (can('project', 'list')) await action(() => projectPage());
}
onMounted(() => {
  if (can('project', 'list')) action(() => projectPage());
});
</script>

<template>
  <section data-testid="project-remote" class="space-y-16px" :aria-busy="busy">
    <h2 class="text-18px font-semibold">{{ text('projects') }}</h2>
    <ElAlert v-if="failed" :title="text('failed')" type="error" :closable="false" role="alert" />
    <ElAlert
      v-if="permissionState === 'denied'"
      :title="text('permissionDenied')"
      type="warning"
      :closable="false"
      role="alert"
    />
    <ElAlert
      v-if="permissionState === 'unavailable'"
      :title="text('permissionUnavailable')"
      type="error"
      :closable="false"
      role="alert"
    />
    <p v-if="permissionState === 'allowed'" role="status">{{ text('permissionAllowed') }}</p>
    <p v-if="!canUseProjects && !canUseTasks" role="status">{{ text('noOperations') }}</p>
    <ElButton :disabled="busy" @click="refreshPermissionHints">{{ text('refreshPermissions') }}</ElButton>
    <ElAlert v-if="unknown" :title="text('unknown')" type="warning" :closable="false" role="status" />
    <ElButton v-if="unknown" :disabled="busy" @click="action(recover)">{{ text('recover') }}</ElButton>
    <p v-if="createdProject" role="status">
      {{ createdProject.name }} · {{ text('projectId') }}: {{ createdProject.id }}
    </p>
    <ElCard v-if="canUseProjects || canUseTasks">
      <ElForm
        v-if="can('project', editingProject ? 'update' : 'create')"
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
            editingProjectVersion = undefined;
            name = '';
            description = '';
          "
        >
          {{ text('cancel') }}
        </ElButton>
      </ElForm>
      <ElForm
        v-if="can('project', 'read') || can('project', 'update') || can('project', 'delete') || canUseTasks"
        :aria-label="text('targetProject')"
        label-position="top"
        :disabled="busy || unknown"
        @submit.prevent="action(openTargetProject)"
      >
        <ElFormItem :label="text('projectId')">
          <ElInput v-model="targetProjectId" :aria-label="text('projectId')" autocomplete="off" />
        </ElFormItem>
        <ElFormItem v-if="can('project', 'update') || can('project', 'delete')" :label="text('expectedVersion')">
          <ElInput v-model="targetProjectVersion" :aria-label="text('expectedVersion')" inputmode="numeric" />
        </ElFormItem>
        <ElButton
          v-if="can('project', 'read') || canUseTasks"
          native-type="submit"
          :disabled="!validId(targetProjectId.trim())"
        >
          {{ text('openTarget') }}
        </ElButton>
        <ElButton
          v-if="can('project', 'update')"
          :disabled="!validId(targetProjectId.trim()) || !validVersion(targetProjectVersion)"
          @click="editTargetProject"
        >
          {{ text('edit') }}
        </ElButton>
        <ElButton
          v-if="can('project', 'delete')"
          type="danger"
          :disabled="!validId(targetProjectId.trim()) || !validVersion(targetProjectVersion)"
          @click="action(() => removeProject(targetProjectId.trim(), Number(targetProjectVersion)))"
        >
          {{ text('delete') }}
        </ElButton>
      </ElForm>
      <ElButton v-if="can('project', 'list')" class="mt-16px" :disabled="busy" @click="action(() => projectPage())">
        {{ text('reload') }}
      </ElButton>
      <p v-if="can('project', 'list') && !projects.length && !busy" class="mt-16px">{{ text('empty') }}</p>
      <ul v-if="can('project', 'list')" class="mt-16px space-y-12px">
        <li v-for="project in projects" :key="project.id">
          <span>{{ project.name }} · v{{ project.version }}</span>
          <ElButton
            v-if="can('project', 'read') || canUseTasks"
            :disabled="busy"
            @click="action(() => select(project))"
          >
            {{ text('select') }}
          </ElButton>
          <ElButton
            v-if="can('project', 'update')"
            :disabled="busy || unknown"
            @click="action(() => editProject(project))"
          >
            {{ text('edit') }}
          </ElButton>
          <ElButton
            v-if="can('project', 'delete')"
            type="danger"
            :disabled="busy || unknown"
            @click="action(() => removeProject(project.id))"
          >
            {{ text('delete') }}
          </ElButton>
        </li>
      </ul>
      <ElButton
        v-if="can('project', 'list') && projectCursor"
        :disabled="busy"
        @click="action(() => projectPage(true))"
      >
        {{ text('next') }}
      </ElButton>
    </ElCard>
    <ElCard v-if="selected && (canUseTasks || can('project', 'read'))">
      <h3 class="mb-16px text-18px font-semibold">{{ selected.name }} · {{ text('tasks') }}</h3>
      <p v-if="selected.version" role="status">{{ selected.name }} · v{{ selected.version }}</p>
      <p v-if="selected.description">{{ selected.description }}</p>
      <ElForm
        v-if="can('task', editingTask ? 'update' : 'create')"
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
            editingTaskVersion = undefined;
            title = '';
            taskDescription = '';
            taskStatus = 'TODO';
          "
        >
          {{ text('cancel') }}
        </ElButton>
      </ElForm>
      <ElForm
        v-if="can('task', 'read') || can('task', 'update') || can('task', 'delete')"
        :aria-label="text('targetTask')"
        label-position="top"
        :disabled="busy || unknown"
        @submit.prevent="action(readTargetTask)"
      >
        <ElFormItem :label="text('taskId')">
          <ElInput v-model="targetTaskId" :aria-label="text('taskId')" autocomplete="off" />
        </ElFormItem>
        <ElFormItem v-if="can('task', 'update') || can('task', 'delete')" :label="text('expectedVersion')">
          <ElInput v-model="targetTaskVersion" :aria-label="text('expectedVersion')" inputmode="numeric" />
        </ElFormItem>
        <ElButton v-if="can('task', 'read')" native-type="submit" :disabled="!validId(targetTaskId.trim())">
          {{ text('read') }}
        </ElButton>
        <ElButton
          v-if="can('task', 'update')"
          :disabled="!validId(targetTaskId.trim()) || !validVersion(targetTaskVersion)"
          @click="editTargetTask"
        >
          {{ text('edit') }}
        </ElButton>
        <ElButton
          v-if="can('task', 'delete')"
          type="danger"
          :disabled="!validId(targetTaskId.trim()) || !validVersion(targetTaskVersion)"
          @click="action(() => removeTask(targetTaskId.trim(), Number(targetTaskVersion)))"
        >
          {{ text('delete') }}
        </ElButton>
      </ElForm>
      <p v-if="viewedTask && can('task', 'read')" role="status">
        {{ viewedTask.title }} · {{ statusText(viewedTask.status) }} · v{{ viewedTask.version }}
      </p>
      <p v-if="viewedTask?.description && can('task', 'read')">{{ viewedTask.description }}</p>
      <ElButton v-if="can('task', 'list')" class="mt-16px" :disabled="busy" @click="action(() => taskPage())">
        {{ text('reload') }}
      </ElButton>
      <p v-if="can('task', 'list') && !tasks.length && !busy" class="mt-16px">{{ text('empty') }}</p>
      <ul v-if="can('task', 'list')" class="mt-16px space-y-12px">
        <li v-for="task in tasks" :key="task.id">
          <span>{{ task.title }} · {{ statusText(task.status) }} · v{{ task.version }}</span>
          <ElButton v-if="can('task', 'read')" :disabled="busy" @click="action(() => readTask(task))">
            {{ text('read') }}
          </ElButton>
          <ElButton v-if="can('task', 'update')" :disabled="busy || unknown" @click="action(() => editTask(task))">
            {{ text('edit') }}
          </ElButton>
          <ElButton
            v-if="can('task', 'delete')"
            type="danger"
            :disabled="busy || unknown"
            @click="action(() => removeTask(task.id))"
          >
            {{ text('delete') }}
          </ElButton>
        </li>
      </ul>
      <ElButton v-if="can('task', 'list') && taskCursor" :disabled="busy" @click="action(() => taskPage(true))">
        {{ text('next') }}
      </ElButton>
    </ElCard>
  </section>
</template>
