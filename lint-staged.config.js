/**
 * @filename: lint-staged.config.js
 * @type {import('lint-staged').Configuration}
 */
export default {
  'src/**/*.{js,jsx,ts,tsx}': [
      `prettier --write`,
      `eslint --fix`,
    ],
}
