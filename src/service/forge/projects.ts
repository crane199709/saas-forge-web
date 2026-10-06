import { Project } from '@crane199709/saas-forge-api-client';
import type { ProjectHost } from '../../remotes/project-host';
import type { ConsoleSessionRuntime, SessionView } from '../../runtime/console-session';

export class ProjectFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** 闭包保存凭据能力和版本；Remote 拿到的对象只含业务函数，不能读取 Client 或会话。 */
export function createProjectHost(
  api: Project.DefaultApi,
  session: Pick<ConsoleSessionRuntime, 'subscribe'>,
  key: () => string
): {
  host: ProjectHost;
  dispose(): void;
} {
  const projects = new Map<string, Project.Project>();
  const tasks = new Map<string, Project.Task>();
  let owner: string | undefined;
  let ready = false;
  let generation = 0;
  let controller = new AbortController();
  let pending: { owner: string; generation: number; run(): Promise<unknown> } | undefined;
  let writing = false;

  function update(view: SessionView) {
    const snapshot = view.snapshot;
    const context = snapshot?.activeContext;
    const next =
      context?.type === 'TENANT'
        ? `${snapshot?.sessionId}:${snapshot?.identity?.identityId}:${context.tenantId}:${context.membershipId}`
        : undefined;
    ready = view.status === 'authenticated' && Boolean(next);
    if (next === owner) return;
    owner = next;
    generation += 1;
    controller.abort();
    controller = new AbortController();
    projects.clear();
    tasks.clear();
    pending = undefined;
    writing = false;
  }
  const unsubscribe = session.subscribe(update);
  function requireReady() {
    if (!ready || !owner) throw new ProjectFailure('TENANT_CONTEXT_REQUIRED');
    return owner;
  }
  async function failure(error: unknown): Promise<ProjectFailure> {
    if (error instanceof Project.ResponseError) {
      const problem: unknown = await error.response.json().catch(() => undefined);
      if (problem && typeof problem === 'object' && 'code' in problem && typeof problem.code === 'string')
        return new ProjectFailure(problem.code);
      return new ProjectFailure('SERVICE_UNAVAILABLE');
    }
    return error instanceof ProjectFailure ? error : new ProjectFailure('NETWORK_UNAVAILABLE');
  }
  async function read<T>(operation: (options: RequestInit) => Promise<T>): Promise<T> {
    requireReady();
    const started = generation;
    try {
      const result = await operation({
        redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])
      });
      if (started !== generation || !ready) throw new ProjectFailure('CONTEXT_CHANGED');
      return structuredClone(result);
    } catch (error) {
      throw await failure(error);
    }
  }
  function rememberProject(value: Project.Project) {
    projects.set(value.id, structuredClone(value));
    return value;
  }
  function rememberTask(value: Project.Task) {
    tasks.set(`${value.projectId}:${value.id}`, structuredClone(value));
    return value;
  }
  function version(id: string, projectId?: string) {
    const value = projectId ? tasks.get(`${projectId}:${id}`) : projects.get(id);
    if (!value) throw new ProjectFailure('RESOURCE_RELOAD_REQUIRED');
    return `"${value.version}"`;
  }
  async function submit<T>(operation: () => Promise<T>, remember: (value: T) => void): Promise<T> {
    const current = requireReady();
    const started = generation;
    if (pending || writing) throw new ProjectFailure('WRITE_RECOVERY_REQUIRED');
    const attempt = {
      owner: current,
      generation: started,
      run: async () => {
        const value = await operation();
        if (generation !== started) throw new ProjectFailure('CONTEXT_CHANGED');
        remember(value);
        return value;
      }
    };
    pending = attempt;
    return await execute<T>(attempt);
  }
  async function execute<T>(attempt: { owner: string; generation: number; run(): Promise<unknown> }): Promise<T> {
    if (requireReady() !== attempt.owner || generation !== attempt.generation || writing)
      throw new ProjectFailure('WRITE_RECOVERY_REQUIRED');
    writing = true;
    try {
      const result = await attempt.run();
      if (pending === attempt) pending = undefined;
      return structuredClone(result) as T;
    } catch (error) {
      // 只有正式业务 4xx 可确定未提交/稳定结果；网络、5xx、过期认证保留原键供恢复后重放。
      const problem = await failure(error);
      if (
        error instanceof Project.ResponseError &&
        error.response.status >= 400 &&
        error.response.status < 500 &&
        ![401, 403, 408, 429].includes(error.response.status) &&
        problem.code !== 'IDEMPOTENCY_REQUEST_IN_PROGRESS' &&
        pending === attempt
      )
        pending = undefined;
      throw problem;
    } finally {
      if (generation === attempt.generation) writing = false;
    }
  }
  const writeOptions = () => ({
    redirect: 'error' as const,
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])
  });
  const host: ProjectHost = Object.freeze({
    async listProjects(cursor?: string) {
      const page = await read(options => api.listProjects({ cursor, limit: 20 }, options));
      page.items.forEach(rememberProject);
      return page;
    },
    async getProject(id: string) {
      return rememberProject(await read(options => api.getProject({ projectId: id }, options)));
    },
    async createProject(body: Project.CreateProject) {
      const request = { idempotencyKey: key(), createProject: structuredClone(body) };
      return await submit(() => api.createProject(request, writeOptions()), rememberProject);
    },
    async updateProject(id: string, body: Project.CreateProject) {
      const request = {
        projectId: id,
        idempotencyKey: key(),
        ifMatch: version(id),
        createProject: structuredClone(body)
      };
      return await submit(() => api.updateProject(request, writeOptions()), rememberProject);
    },
    async deleteProject(id: string) {
      const request = { projectId: id, idempotencyKey: key(), ifMatch: version(id) };
      await submit(
        () => api.deleteProject(request, writeOptions()),
        () => projects.delete(id)
      );
    },
    async listTasks(projectId: string, cursor?: string) {
      const page = await read(options => api.listTasks({ projectId, cursor, limit: 20 }, options));
      page.items.forEach(rememberTask);
      return page;
    },
    async getTask(projectId: string, id: string) {
      return rememberTask(await read(options => api.getTask({ projectId, taskId: id }, options)));
    },
    async createTask(projectId: string, body: Project.CreateTask) {
      const request = { projectId, idempotencyKey: key(), createTask: structuredClone(body) };
      return await submit(() => api.createTask(request, writeOptions()), rememberTask);
    },
    async updateTask(projectId: string, id: string, body: Project.UpdateTask) {
      const request = {
        projectId,
        taskId: id,
        idempotencyKey: key(),
        ifMatch: version(id, projectId),
        updateTask: structuredClone(body)
      };
      return await submit(() => api.updateTask(request, writeOptions()), rememberTask);
    },
    async deleteTask(projectId: string, id: string) {
      const request = { projectId, taskId: id, idempotencyKey: key(), ifMatch: version(id, projectId) };
      await submit(
        () => api.deleteTask(request, writeOptions()),
        () => tasks.delete(`${projectId}:${id}`)
      );
    },
    async retryPending() {
      if (!pending) return;
      await execute(pending);
    },
    pending: () => Boolean(pending)
  });
  return {
    host,
    dispose() {
      unsubscribe();
      ready = false;
      owner = undefined;
      generation += 1;
      controller.abort();
      projects.clear();
      tasks.clear();
      pending = undefined;
    }
  };
}
