'use strict';

module.exports = {
  extends: ['stylelint-config-standard', 'stylelint-prettier/recommended'],
  rules: {
    // 构建链中的 clean-css 不支持 range notation，沿用 max-width 写法
    'media-feature-range-notation': null,
    // clean-css 不支持现代空格分隔 rgb 写法，沿用 rgba()
    'color-function-notation': null,
    'alpha-value-notation': null,
    // Sass 需要字符串形式的 @import，不能改成 url()
    'import-notation': null,
    // clean-css 不支持 inset 简写，沿用 top/right/bottom/left
    'declaration-block-no-redundant-longhand-properties': null,
  },
};
