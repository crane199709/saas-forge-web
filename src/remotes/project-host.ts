import type { Project } from '@crane199709/saas-forge-api-client';

export type ProjectTextKey =
  | 'projects'
  | 'tasks'
  | 'name'
  | 'description'
  | 'title'
  | 'status'
  | 'todo'
  | 'inProgress'
  | 'done'
  | 'edit'
  | 'create'
  | 'save'
  | 'delete'
  | 'select'
  | 'cancel'
  | 'reload'
  | 'next'
  | 'empty'
  | 'failed'
  | 'recover'
  | 'unknown';

/** Shell 只交付业务能力；幂等键、版本条件、会话与底层 Client 保留在 Shell 内。 */
export interface ProjectHost {
  listProjects(cursor?: string): Promise<Project.ProjectPage>;
  getProject(id: string): Promise<Project.Project>;
  createProject(body: Project.CreateProject): Promise<Project.Project>;
  updateProject(id: string, body: Project.CreateProject): Promise<Project.Project>;
  deleteProject(id: string): Promise<void>;
  listTasks(projectId: string, cursor?: string): Promise<Project.TaskPage>;
  getTask(projectId: string, id: string): Promise<Project.Task>;
  createTask(projectId: string, body: Project.CreateTask): Promise<Project.Task>;
  updateTask(projectId: string, id: string, body: Project.UpdateTask): Promise<Project.Task>;
  deleteTask(projectId: string, id: string): Promise<void>;
  retryPending(): Promise<void>;
  pending(): boolean;
}
