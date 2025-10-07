/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./**/*.{html,js,ts,jsx,tsx}"],
    safelist: [
        'bg-blue-500',
        'bg-green-500',
        'bg-yellow-500',
        'bg-red-500',
    ],
    theme: {
    extend: {
        colors: {
            'purple-theme': '#2D2848',
            'black-theme': '#1F1F1F',
            'gray-theme' : '#595959',
        },
    },
  },
  plugins: [],
}

