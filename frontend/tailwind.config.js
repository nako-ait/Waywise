/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 与地图标记保持同一套语义色（整体收敛为「黑白灰 + 单一蓝」）
        hotel: '#1d4ed8', // 酒店（起点/终点）：全图唯一的有彩色元素
        picked: '#0f172a', // 选中目的地：墨黑序号针
        candidate: '#94a3b8', // 候选目的地：浅灰小圆
        ink: '#0f172a',
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'PingFang SC',
          'Microsoft YaHei',
          'sans-serif',
        ],
      },
      boxShadow: {
        panel: '0 1px 2px rgba(15,23,42,.06), 0 8px 24px -12px rgba(15,23,42,.25)',
      },
    },
  },
  plugins: [],
}
