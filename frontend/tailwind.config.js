/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 与地图标记保持同一套语义色
        hotel: '#16a34a', // 酒店（起点/终点）：绿色，固定不可取消
        picked: '#f97316', // 选中目的地：橙色水滴针带序号
        candidate: '#9ca3af', // 候选目的地：灰色小圆 + 灰度图标
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
