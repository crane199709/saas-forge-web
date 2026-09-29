import NProgress from 'nprogress';

/** Setup plugin NProgress */
export function setupNProgress() {
  // 默认 role="bar"/"spinner" 不是合法 ARIA role；装饰进度由页面状态另行播报。
  NProgress.configure({
    easing: 'ease',
    speed: 500,
    barSelector: '.bar',
    spinnerSelector: '.spinner',
    template:
      '<div class="bar" aria-hidden="true"><div class="peg"></div></div><div class="spinner" aria-hidden="true"><div class="spinner-icon"></div></div>'
  });

  // mount on window
  window.NProgress = NProgress;
}
