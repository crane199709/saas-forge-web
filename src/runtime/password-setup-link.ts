import { createOneTimeFragmentLink } from './one-time-fragment-link';

const link = createOneTimeFragmentLink('/password-setup');

/** 在 Router 创建前擦除邮件 fragment，包括同文档打开另一封设置邮件的导航。 */
export const capturePasswordSetupLink = link.captureLink;
export const onPasswordSetupLink = link.onLink;
export const takePasswordSetupChallenge = link.take;
