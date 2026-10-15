import { createOneTimeFragmentLink } from './one-time-fragment-link';

const link = createOneTimeFragmentLink('/password-recovery');

/** Router 初始化前擦除邮件链接中的秘密，后续同文档导航也重新捕获。 */
export const capturePasswordRecoveryLink = link.captureLink;
export const onPasswordRecoveryLink = link.onLink;
export const takePasswordRecoveryChallenge = link.take;
