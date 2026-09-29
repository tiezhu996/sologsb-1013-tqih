import type {
  ChangeOrder,
  FieldChange,
  PendingDecision,
  PendingItem,
} from 'stage-cue-editor/models/change';
import type { ShowData } from 'stage-cue-editor/models/show';
import {
  applyChange,
  applyStructuralChange,
  readOfficial,
} from 'stage-cue-editor/utils/change-fields';
import { recalculateScene } from 'stage-cue-editor/utils/timeline';
import { uid } from 'stage-cue-editor/utils/id';

export function fieldKey(
  change: Pick<FieldChange, 'level' | 'sceneId' | 'cueId' | 'field'>,
): string {
  if (change.level === 'show') return `show|${change.field}`;
  if (change.level === 'scene')
    return `scene|${change.sceneId}|${change.field}`;
  return `cue|${change.sceneId}|${change.cueId}|${change.field}`;
}

export function pendingKey(item: Pick<PendingItem, 'change'>): string {
  return fieldKey(item.change);
}

/** 变更单简称，用于待裁决区显示来源 */
export function orderLabel(
  order: Pick<ChangeOrder, 'id' | 'author' | 'createdAt'>,
): string {
  return `${order.author} · ${new Date(order.createdAt).toLocaleString('zh-CN', { hour12: false })}`;
}

export interface IngestOptions {
  /** 收到变更单时正式表的最新状态（会被原地修改） */
  show: ShowData;
  /** 已存在的待裁决条目，同字段冲突时新改动转入此区 */
  pending: PendingItem[];
  order: ChangeOrder;
  /** 提交者工作版（本地提交时可用于结构性改动）；外部变更单使用自带 payload */
  source?: ShowData;
  /** 外部来源标记，仅影响提示文案 */
  external?: boolean;
}

export interface IngestResult {
  /** 自动合并（含已是新值）的字段变更数 */
  mergedCount: number;
  /** 实际写入正式表的变更（幂等命中除外），用于把他人改动跟进到脏工作副本 */
  mergedChanges: FieldChange[];
  /** 转入待裁决区的条目 */
  conflicts: PendingItem[];
  /** 自动合并后需要重算时间轴的场次 id */
  recalcSceneIds: string[];
  /** 无法处理的字段及原因，例如目标提示已删除 */
  errors: string[];
}

function isStructural(change: FieldChange): boolean {
  return !!change.op && change.op !== 'set';
}

/**
 * 合并一张变更单到正式表：
 * - 没碰同一字段的改动直接合并；
 * - 两边都改过同一字段（基准值与正式表现值不一致），或该字段已在待裁决区，转入待裁决区；
 * - 锁定场次收到的改动一律先留在待裁决区。
 */
export function ingestOrder(options: IngestOptions): IngestResult {
  const { show, pending, order, source, external } = options;
  const conflicts: PendingItem[] = [];
  const errors: string[] = [];
  const recalcSceneIds = new Set<string>();
  const mergedChanges: FieldChange[] = [];
  let mergedCount = 0;

  const pendingKeys = new Set(pending.map((item) => pendingKey(item)));

  // 新增场次先并入，后续该场次内的提示才能定位到目标
  const ordered = [...order.changes].sort((a, b) =>
    a.op === 'scene-add' ? -1 : b.op === 'scene-add' ? 1 : 0,
  );

  ordered.forEach((change) => {
    const key = fieldKey(change);
    const official = readOfficial(show, change);
    if (official === null) {
      errors.push(
        `${change.sceneLabel} ${change.cueTitle} · ${change.fieldLabel}：目标已不存在`,
      );
      conflicts.push(makePending(order, change, false, '目标场次或提示已删除'));
      pendingKeys.add(key);
      return;
    }

    const targetScene = show.scenes.find(
      (scene) => scene.id === change.sceneId,
    );
    // 随全新场次一起新增的提示视为“新增内容”；向已存在且锁定的场次新增仍需裁决
    const addsToNewScene = change.op === 'cue-add' && targetScene === undefined;
    const sceneLocked =
      change.level !== 'show' && !addsToNewScene && !!targetScene?.locked;
    if (sceneLocked) {
      conflicts.push(
        makePending(
          order,
          change,
          true,
          external ? '收到改动时场次已锁定' : '该场次已锁定',
        ),
      );
      pendingKeys.add(key);
      return;
    }

    if (pendingKeys.has(key)) {
      conflicts.push(
        makePending(order, change, false, '同一字段已有待裁决改动'),
      );
      return;
    }

    if (official === change.newValue) {
      // 已并入相同结果，视为已合并（幂等）
      mergedCount += 1;
      return;
    }

    if (official !== change.oldValue) {
      // 两边都改过同一字段：转入待裁决区
      conflicts.push(makePending(order, change, false, '两边都修改了同一字段'));
      pendingKeys.add(key);
      return;
    }

    let affected = false;
    if (isStructural(change)) {
      const scene = applyStructuralChange(show, change, source);
      affected = !!scene;
      if (scene) recalcSceneIds.add(scene.id);
    } else {
      const scene = applyChange(show, change);
      affected = change.level === 'show' || !!scene;
      if (scene) recalcSceneIds.add(scene.id);
    }
    if (!affected && change.level !== 'show') {
      errors.push(
        `${change.sceneLabel} ${change.cueTitle} · ${change.fieldLabel}：应用失败`,
      );
      conflicts.push(makePending(order, change, false, '目标场次或提示已删除'));
      pendingKeys.add(key);
      return;
    }
    if (official !== change.newValue) mergedChanges.push(change);
    mergedCount += 1;
  });

  Array.from(recalcSceneIds).forEach((id) => {
    const scene = show.scenes.find((item) => item.id === id);
    if (scene) recalculateScene(scene);
  });

  return {
    mergedCount,
    mergedChanges,
    conflicts,
    recalcSceneIds: Array.from(recalcSceneIds),
    errors,
  };
}

function makePending(
  order: ChangeOrder,
  change: FieldChange,
  locked: boolean,
  reason: string,
): PendingItem {
  return {
    id: uid('pending'),
    orderId: order.id,
    orderLabel: orderLabel(order),
    author: order.author,
    createdAt: order.createdAt,
    locked,
    reason,
    change,
  };
}

export interface DecisionOutcome {
  accepted: PendingItem[];
  rejected: PendingItem[];
  recalcSceneIds: string[];
}

/**
 * 场务对一批待裁决条目作出选择：采纳则写入正式表，驳回则仅丢弃。
 * 采纳后按场次重算时间轴。
 */
export function resolvePending(
  show: ShowData,
  items: PendingItem[],
  decisions: PendingDecision[],
  source?: ShowData,
): DecisionOutcome {
  const accepted: PendingItem[] = [];
  const rejected: PendingItem[] = [];
  const recalcSceneIds = new Set<string>();

  const sorted = [...decisions].sort((a, b) =>
    a.item.change.op === 'scene-add'
      ? -1
      : b.item.change.op === 'scene-add'
        ? 1
        : 0,
  );

  sorted.forEach((decision) => {
    const { item, accepted: take } = decision;
    if (!take) {
      rejected.push(item);
      return;
    }
    let scene: Scene | null;
    if (isStructural(item.change))
      scene = applyStructuralChange(show, item.change, source);
    else scene = applyChange(show, item.change);
    if (item.change.level === 'show' && !isStructural(item.change))
      scene = null;
    if (scene) recalcSceneIds.add(scene.id);
    accepted.push(item);
  });

  Array.from(recalcSceneIds).forEach((id) => {
    const scene = show.scenes.find((item) => item.id === id);
    if (scene) recalculateScene(scene);
  });

  return { accepted, rejected, recalcSceneIds: Array.from(recalcSceneIds) };
}

type Scene = ShowData['scenes'][number];

/** 校验并规整外部导入的变更单；不合法返回 null */
export function normalizeOrder(raw: unknown): ChangeOrder | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { [key: string]: unknown };
  if (
    !isString(r['id']) ||
    !isString(r['author']) ||
    !Array.isArray(r['changes'])
  )
    return null;
  const changes: FieldChange[] = [];
  (r['changes'] as unknown[]).forEach((rawChange) => {
    if (!rawChange || typeof rawChange !== 'object') return;
    const c = rawChange as { [key: string]: unknown };
    if (
      isString(c['sceneId']) &&
      isString(c['cueId']) &&
      isString(c['field']) &&
      isString(c['fieldLabel']) &&
      isString(c['oldValue']) &&
      isString(c['newValue']) &&
      (c['level'] === 'show' || c['level'] === 'scene' || c['level'] === 'cue')
    ) {
      changes.push({
        op:
          c['op'] === 'cue-add' ||
          c['op'] === 'cue-remove' ||
          c['op'] === 'scene-add' ||
          c['op'] === 'cue-order'
            ? c['op']
            : 'set',
        sceneLabel: isString(c['sceneLabel']) ? c['sceneLabel'] : '',
        sceneId: c['sceneId'],
        cueId: c['cueId'],
        cueTitle: isString(c['cueTitle']) ? c['cueTitle'] : '',
        level: c['level'],
        field: c['field'],
        fieldLabel: c['fieldLabel'],
        oldValue: c['oldValue'],
        newValue: c['newValue'],
        payload: c['payload'],
      });
    }
  });
  if (!changes.length) return null;
  return {
    id: r['id'],
    author: r['author'],
    note: isString(r['note']) ? r['note'] : '',
    createdAt: isString(r['createdAt'])
      ? r['createdAt']
      : new Date().toISOString(),
    baseVersion: isString(r['baseVersion']) ? r['baseVersion'] : '',
    changes,
    status: 'pending',
    reason: '',
    mergedCount: 0,
    pendingCount: changes.length,
    acceptedCount: 0,
    rejectedCount: 0,
  };
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
