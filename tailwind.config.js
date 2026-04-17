/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        orange: {
          50: '#FFF7ED',
          100: '#FFEDD5',
          200: '#FED7AA',
          300: '#FDBA74',
          400: '#FB923C',
          500: '#FF9800', // 亮橙 (Primary start)
          600: '#E63900', // 橘红 (Primary end)
          700: '#C2410C',
          800: '#9A3412',
          900: '#7C2D12',
          950: '#4A2311', // 主标题色
        },
        yellow: {
          400: '#FFC107', // 虚线/点缀色
          500: '#FFD54F',
        },
        brand: {
          brown: '#4A2311', // 深褐色/暗橙色
          gray: '#8C6B5D', // 次要信息/灰橙色
        },
        green: {
          500: '#2ECC71', // 羽毛球主题绿色
        }
      },
      fontFamily: {
        sans: ['"PingFang SC"', '"Nunito"', '"Varela Round"', '"Rounded"', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      }
    },
  },
  plugins: [],
}
