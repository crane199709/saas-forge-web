// 202610162255：状态标签颜色以 #13 确认的映射为准；只用于对象状态字段与操作记录状态列，进度描述保持纯文字。
type TagType = 'primary' | 'success' | 'warning' | 'danger' | 'info';

const tenantTagTypes: Readonly<Record<string, TagType>> = {
  ACTIVE: 'success',
  PENDING: 'warning',
  SUSPENDED: 'danger',
  EXPIRED: 'danger',
  CLOSED: 'info'
};

const operationTagTypes: Readonly<Record<string, TagType>> = {
  COMMITTED: 'success',
  PROCESSING: 'primary',
  UNKNOWN: 'warning',
  NOT_COMMITTED: 'info'
};

const definitionTagTypes: Readonly<Record<string, TagType>> = {
  ACTIVE: 'success',
  DRAFT: 'primary',
  RETIRED: 'info'
};

const oauthClientTagTypes: Readonly<Record<string, TagType>> = {
  ACTIVE: 'success',
  REVOKED: 'danger'
};

const tagTypes = {
  tenant: tenantTagTypes,
  operation: operationTagTypes,
  definition: definitionTagTypes,
  oauthClient: oauthClientTagTypes
};

/** 未知状态值回退为中性色，不因服务端新增枚举而报错。 */
export function statusTagType(kind: keyof typeof tagTypes, value: string): TagType {
  return tagTypes[kind][value] ?? 'info';
}
