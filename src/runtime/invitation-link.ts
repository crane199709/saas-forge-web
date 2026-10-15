import { createOneTimeFragmentLink } from './one-time-fragment-link';

const link = createOneTimeFragmentLink('/invitation');

/** 在 Router 创建前移除邮件凭据；页面只在当前内存中保留它。 */
export const captureInvitationLink = link.captureLink;
export const onInvitationLink = link.onLink;
export const takeInvitationToken = link.take;
