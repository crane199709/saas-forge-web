import process from 'node:process';
import { spawnSync } from 'node:child_process';
// 只构建前端隔离测试制品；API 由浏览器拦截，不读取个人环境目标或启动后端。
const result = spawnSync(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'build', '--mode', 'prod', '--outDir', '.ui-dist'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_API_ORIGIN: 'https://api.ui.test',
      VITE_STORAGE_PREFIX: 'UI_',
      VITE_AUTOMATICALLY_DETECT_UPDATE: 'N'
    }
  }
);
process.exit(result.status ?? 1);
