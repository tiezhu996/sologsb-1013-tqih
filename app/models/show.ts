export type CueKind = '灯光' | '音响' | '道具' | '演员' | '舞台' | '字幕';

export interface Cue {
  id: string;
  kind: CueKind;
  title: string;
  duration: number;
  owner: string;
  lighting: string;
  sound: string;
  props: string[];
  cast: string[];
  notes: string;
  dependsOn: string[];
  offset: number;
}

export interface Scene {
  id: string;
  act: string;
  name: string;
  title: string;
  startTime: string;
  locked: boolean;
  cues: Cue[];
}

export interface ShowData {
  title: string;
  venue: string;
  date: string;
  scenes: Scene[];
  updatedAt: string;
  author?: string;
}

/** 变更单中的一条字段级改动 */
export interface FieldChange {
  sceneId: string;
  sceneLabel: string;
  cueId?: string;
  cueLabel?: string;
  /** 字段名（英文键），整场提示级改动时为 '*' */
  field: string;
  /** 字段中文名 */
  fieldLabel: string;
  oldValue: string;
  newValue: string;
}

/** 变更单：每次保存 / 合并 / 裁决 / 导入都形成一张变更单 */
export interface ChangeOrder {
  id: string;
  createdAt: string;
  author: string;
  kind: 'save' | 'merge' | 'decision' | 'import' | 'structural';
  summary: string;
  changes: FieldChange[];
}

/** 待裁决项：两边改了同一字段，或锁定场次收到的外部改动 */
export interface PendingItem {
  id: string;
  createdAt: string;
  reason: 'conflict' | 'locked-scene';
  sceneId: string;
  sceneLabel: string;
  cueId?: string;
  cueLabel?: string;
  field: string;
  fieldLabel: string;
  /** 裁决时写回正式表的原始值 */
  baseRaw: unknown;
  localRaw: unknown;
  incomingRaw: unknown;
  baseValue: string;
  localValue: string;
  incomingValue: string;
}

/** 异常箱记录：旧版提示表中字段损坏、无法载入的记录 */
export interface ExceptionRecord {
  id: string;
  createdAt: string;
  source: string;
  sceneId?: string;
  sceneLabel: string;
  cueId?: string;
  cueLabel?: string;
  reason: string;
  raw: string;
}

export interface VersionSnapshot {
  id: string;
  name: string;
  createdAt: string;
  data: ShowData;
}

export interface CueDraft {
  id?: string;
  kind: CueKind;
  title: string;
  duration: number;
  owner: string;
  lighting: string;
  sound: string;
  props: string;
  cast: string;
  notes: string;
  dependsOn: string;
}

export interface CueIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  icon?: string;
  sceneId?: string;
  cueId?: string;
}

export interface VersionDiff {
  id: string;
  changed: boolean;
  label: string;
  before: string;
  after: string;
}

export const CUE_KINDS: CueKind[] = [
  '灯光',
  '音响',
  '道具',
  '演员',
  '舞台',
  '字幕',
];
export const OWNERS = ['李岚', '周启', '陈默', '赵一帆', '孙禾', '待指定'];
