/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
      },
      backgroundImage: {
        'gradient-light': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        'gradient-light-alt': 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        'gradient-light-blue': 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        'gradient-light-card': 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
        'gradient-light-subtle': 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
        'gradient-dark': 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)',
        'gradient-dark-alt': 'linear-gradient(135deg, #0c3483 0%, #a2b6df 100%)',
        'gradient-dark-purple': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        'gradient-dark-card': 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
        'gradient-dark-subtle': 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)',
        'gradient-primary': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        'gradient-primary-hover': 'linear-gradient(135deg, #764ba2 0%, #667eea 100%)',
        'gradient-blue': 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        'gradient-blue-hover': 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
      },
    },
  },
  plugins: [],
}

