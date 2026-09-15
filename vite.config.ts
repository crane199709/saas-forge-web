import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import { setupVitePlugins } from './build/plugins';
import { getBuildTime } from './build/config';
import { requireHttpsOrigin } from './src/service/forge/config';

export default defineConfig(configEnv => {
  const viteEnv = loadEnv(configEnv.mode, process.cwd()) as unknown as Env.ImportMeta;

  const buildTime = getBuildTime();

  const localEnv = loadEnv(configEnv.mode, process.cwd(), 'SF_');
  let developmentOrigin: string | undefined;
  if (configEnv.command === 'serve') {
    try {
      developmentOrigin = requireHttpsOrigin(localEnv.SF_CONSOLE_ORIGIN);
    } catch {
      throw new Error('Set SF_CONSOLE_ORIGIN to the trusted HTTPS Console origin in your ignored .env.local.');
    }
  }

  const browserEntry: Plugin = {
    name: 'forge-browser-entry',
    configureServer(server) {
      server.printUrls = () => {
        server.config.logger.info(`浏览器入口 / Browser entry: ${developmentOrigin}`);
        server.config.logger.info('内部监听 / Internal listener: 127.0.0.1:5174');
      };
    }
  };

  return {
    base: viteEnv.VITE_BASE_URL,
    resolve: {
      alias: {
        '~': fileURLToPath(new URL('./', import.meta.url)),
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
          additionalData: `@use "@/styles/scss/global.scss" as *;`
        }
      }
    },
    plugins: [...setupVitePlugins(viteEnv, buildTime), browserEntry],
    define: {
      BUILD_TIME: JSON.stringify(buildTime)
    },
    server: {
      host: '127.0.0.1',
      port: 5174,
      strictPort: true,
      open: false,
      origin: developmentOrigin,
      allowedHosts: developmentOrigin ? [new URL(developmentOrigin).hostname] : [],
      hmr: developmentOrigin
        ? {
            protocol: 'wss',
            host: new URL(developmentOrigin).hostname,
            clientPort: Number(new URL(developmentOrigin).port || 443)
          }
        : undefined
    },
    preview: {
      port: 9725
    },
    build: {
      reportCompressedSize: false,
      sourcemap: viteEnv.VITE_SOURCE_MAP === 'Y',
      commonjsOptions: {
        ignoreTryCatch: false
      }
    }
  };
});
