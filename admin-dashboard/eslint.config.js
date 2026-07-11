import eslintPluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'
import eslintConfigPrettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...eslintPluginVue.configs['flat/recommended'],
  ...tseslint.configs.recommended,
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
    },
  },
  {
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  // Prettierがフォーマットを担うため、行分割等のスタイル系ルールは無効化する
  // (eslint-plugin-vueのrecommendedに含まれる max-attributes-per-line 等と
  // Prettierの出力が食い違い、互いにfixを打ち消し合う事故を防ぐ)。
  eslintConfigPrettier,
)
