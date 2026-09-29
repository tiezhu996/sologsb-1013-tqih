import type { Cue, Scene, ShowData } from 'stage-cue-editor/models/show';

/** 变更单内单条字段级新旧值记录 */
export interface FieldChange {
  /** 操作类型：默认 set 为字段赋值，其余为结构性改动 */
  op?: 'set' | 'cue-add' | 'cue-remove' | 'scene-add' | 'cue-order';
  /** 场号（act + name），变更单级冗余，便于异常箱之外直接阅读 */
  sceneLabel: string;
  sceneId: string;
  /** 提示标题；场次级变更时为空 */
  cueId: string;
  cueTitle: string;
  /** show 级为演出字段，scene 级为场次字段，cue 级为提示字段 */
  level: 'show' | 'scene' | 'cue';
  field: string;
  fieldLabel: string;
  oldValue: string;
  newValue: string;
  /** 结构性改动（新增场次/提示）携带的完整数据，供他人并入 */
  payload?: unknown;
}

/** 变更单状态：待自动合并 / 待场务裁决 / 已并入正式表 / 已驳回 */
export type ChangeOrderStatus = 'merged' | 'pending' | 'accepted' | 'rejected';

/** 每次保存形成一张变更单；同字段冲突时进入待裁决区 */
export interface ChangeOrder {
  id: string;
  author: string;
  note: string;
  createdAt: string;
  /** 变更单基于的正式表版本（updatedAt），用于判定同字段覆盖 */
  baseVersion: string;
  changes: FieldChange[];
  status: ChangeOrderStatus;
  /** 被拦下的原因（锁定场次 / 字段冲突），便于场务审阅 */
  reason: string;
  /** 已自动并入正式表的变更数 */
  mergedCount: number;
  /** 与既有未决变更冲突、转入待裁决区的变更数 */
  pendingCount: number;
  /** 场务采纳 / 驳回计数 */
  acceptedCount: number;
  rejectedCount: number;
}

/** 待裁决条目：同字段两边都改过，或落在已锁定场次上 */
export interface PendingItem {
  id: string;
  orderId: string;
  orderLabel: string;
  author: string;
  createdAt: string;
  /** 收到该外部改动时场次是否已锁定 */
  locked: boolean;
  /** 转入待裁决区的原因（锁定场次 / 同字段冲突 / 目标已删除） */
  reason: string;
  change: FieldChange;
}

/** 裁决结果 */
export interface PendingDecision {
  item: PendingItem;
  accepted: boolean;
}

/** 异常箱记录：旧版提示表载入时字段损坏的提示 */
export interface CorruptRecord {
  id: string;
  level: 'show' | 'scene' | 'cue';
  sceneId: string;
  sceneLabel: string;
  cueId: string;
  cueTitle: string;
  /** 原始在场内的位置，用于修复后归位 */
  index: number;
  fields: string[];
  detail: string;
  raw: unknown;
}

export interface LegacyLoadResult {
  data: ShowData;
  corrupt: CorruptRecord[];
  /** 旧版（无变更单结构）成功迁移的标记 */
  migrated: boolean;
}

export interface MergeContext {
  show: ShowData;
  /** 所有待裁决条目，用于同字段冲突判定 */
  pending: PendingItem[];
  /** 已并入正式表但仍代表“别人已改”的变更，用于新变更单冲突判定 */
  merged: FieldChange[];
}

export interface MergeOutcome {
  merged: FieldChange[];
  conflicts: PendingItem[];
}

/** 可编辑的可变目标：演出 / 场次 / 提示三层 */
export type ChangeTarget =
  | { level: 'show'; show: ShowData }
  | { level: 'scene'; scene: Scene }
  | { level: 'cue'; scene: Scene; cue: Cue };
