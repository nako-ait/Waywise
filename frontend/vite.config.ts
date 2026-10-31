import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Waywise —— Vite 配置
// 关键点：
//  1) 路径别名 @ -> src，便于模块化引用
//  2) /api 代理到 FastAPI（模块 2 起使用，先配好免得到时候再改）
//  3) server.host 固定 127.0.0.1，避免高德 JS API 在 file:// 或异常 host 下报跨域
//  4) watch.ignored 忽略「临时文件/临时目录」—— 某些编辑器与工具写文件时
//     会先在源码目录里建 `.Xxx.tsx.<pid>.<uuid>.tmpdir/` 再改名，Vite 的 watcher
//     去 watch 这种目录会抛 EBUSY 并**直接崩掉整个 dev server**（实测踩到过），
//     表现就是「页面还在，但点任何按钮都没反应」。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    watch: {
      ignored: ['**/.*.tmpdir/**', '**/*.tmp', '**/*.tmpdir/**', '**/.~*'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
