import { helper } from '@ember/component/helper';

/** 变更新旧值展示：空串显示为“（清空）” */
export default helper(function displayValue([value]: [unknown]): string {
  return value === '' || value === undefined || value === null
    ? '（清空）'
    : String(value);
});
