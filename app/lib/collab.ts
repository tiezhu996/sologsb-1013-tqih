import type {
  ChangeOrder,
  Cue,
  ExceptionRecord,
  FieldChange,
  PendingItem,
  Scene,
  ShowData,
} from 'stage-cue-editor/models/show';
import { CUE_KINDS } from 'stage-cue-editor/models/show';

export const SCENE_FIELDS = ['act', 'name', 'title', 'startTime'] as const;
export const CUE_FIELDS = [
  'kind',
  'title',
  'duration',
  'owner',
  'lighting',
  'sound',
  'props',
  'cast',
  'notes',
  'dependsOn',
] as const;

export const SCENE_FIELD_LABELS: Record<string, string> = {
  act: '幕',
  name: '场次',
  title: '标题',
  startTime: '开场时间',
};

export const CUE_FIELD_LABELS: Record<string, string> = {
  kind: '提示类型',
  title: '提示标题',
  duration: '时长',
  owner: '负责人',
  lighting: '灯光',
  sound: '音响',
  props: '道具',
  cast: '演员',
  notes: '备注',
  dependsOn: '前置提示',
};

export const KIND_LABELS: Record<ChangeOrder['kind'], string> = {
  save: '保存',
  merge: '合并',
  decision: '裁决',
  import: '导入',
  structural: '结构',
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 把字段值格式化成可展示的文本 */
export function formatFieldValue(field: string, value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (field === '*') return value ? '整条提示' : '—';
  if (Array.isArray(value)) return value.length ? value.join('、') : '（空）';
  if (field === 'duration') return `${Number(value) || 0} 秒`;
  if (typeof value === 'string') return value.trim() ? value : '（空）';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  return JSON.stringify(value);
}

export function sceneLabelOf(scene: Scene | undefined): string {
  if (!scene) return '未知场次';
  return `${scene.act || '未标幕'} ${scene.name || ''} · ${scene.title || '未命名场次'}`.trim();
}

export function cueLabelOf(cue: Cue | undefined): string {
  if (!cue) return '';
  return cue.title || cue.kind || '未命名提示';
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 单字段三路合并判定。
 * 返回 'incoming' 采用外部改动 / 'local' 保留正式表 / 'same' 两边改得一致 / 'conflict' 冲突。
 */
function decideField(
  base: unknown,
  local: unknown,
  incoming: unknown,
): 'incoming' | 'local' | 'same' | 'conflict' {
  if (sameValue(incoming, base)) return 'local';
  if (sameValue(local, base)) return 'incoming';
  if (sameValue(local, incoming)) return 'same';
  return 'conflict';
}

function buildPending(
  reason: PendingItem['reason'],
  scene: Scene,
  field: string,
  baseRaw: unknown,
  localRaw: unknown,
  incomingRaw: unknown,
  cue?: Cue,
): PendingItem {
  const isCue = Boolean(cue) || field === '*';
  return {
    id: uid('pending'),
    createdAt: nowIso(),
    reason,
    sceneId: scene.id,
    sceneLabel: sceneLabelOf(scene),
    cueId: cue?.id,
    cueLabel: cue ? cueLabelOf(cue) : undefined,
    field,
    fieldLabel:
      field === '*'
        ? '整条提示'
        : isCue
          ? (CUE_FIELD_LABELS[field] ?? field)
          : (SCENE_FIELD_LABELS[field] ?? field),
    baseRaw,
    localRaw,
    incomingRaw,
    baseValue: formatFieldValue(field, baseRaw),
    localValue: formatFieldValue(field, localRaw),
    incomingValue: formatFieldValue(field, incomingRaw),
  };
}

export interface MergeResult {
  merged: ShowData;
  autoChanges: FieldChange[];
  pending: PendingItem[];
}

/**
 * 三路合并：base 为上次同步点，local 为正式表当前值，incoming 为协作者发来的版本。
 * 没碰同一字段的改动直接并进正式表；两边都改过同一字段 → 待裁决；
 * 锁定场次收到的外部改动 → 一律待裁决。
 */
export function threeWayMerge(
  base: ShowData,
  local: ShowData,
  incoming: ShowData,
): MergeResult {
  const merged: ShowData = clone(local);
  const autoChanges: FieldChange[] = [];
  const pending: PendingItem[] = [];

  const baseScenes = new Map(base.scenes.map((scene) => [scene.id, scene]));

  incoming.scenes.forEach((inScene) => {
    const baseScene = baseScenes.get(inScene.id);
    let localScene = merged.scenes.find((scene) => scene.id === inScene.id);

    if (!baseScene) {
      // 协作者新增的场次：直接并入（锁定场次不可能由外部新增到本地锁定表，仍按常规处理）
      if (!localScene) {
        merged.scenes.push(clone(inScene));
        localScene = merged.scenes[merged.scenes.length - 1]!;
        autoChanges.push({
          sceneId: inScene.id,
          sceneLabel: sceneLabelOf(inScene),
          field: '*',
          fieldLabel: '新增场次',
          oldValue: '—',
          newValue: sceneLabelOf(inScene),
        });
      }
    } else if (!localScene) {
      // 本地删除了场次、外部仍保留：结构差异，记入异常箱而非字段冲突
      return;
    } else {
      // 场次级字段合并
      SCENE_FIELDS.forEach((field) => {
        const baseValue = (baseScene as unknown as Record<string, unknown>)[
          field
        ];
        const localValue = (localScene as unknown as Record<string, unknown>)[
          field
        ];
        const incomingValue = (inScene as unknown as Record<string, unknown>)[
          field
        ];
        const decision = decideField(baseValue, localValue, incomingValue);
        if (decision === 'incoming') {
          if (localScene!.locked) {
            pending.push(
              buildPending(
                'locked-scene',
                localScene!,
                field,
                baseValue,
                localValue,
                incomingValue,
              ),
            );
          } else {
            (localScene as unknown as Record<string, unknown>)[field] =
              incomingValue;
            autoChanges.push({
              sceneId: localScene!.id,
              sceneLabel: sceneLabelOf(localScene),
              field,
              fieldLabel: SCENE_FIELD_LABELS[field] ?? field,
              oldValue: formatFieldValue(field, localValue),
              newValue: formatFieldValue(field, incomingValue),
            });
          }
        } else if (decision === 'conflict') {
          pending.push(
            buildPending(
              localScene!.locked ? 'locked-scene' : 'conflict',
              localScene!,
              field,
              baseValue,
              localValue,
              incomingValue,
            ),
          );
        }
      });
    }

    if (!localScene) return;

    const baseCues = new Map(
      (baseScene?.cues ?? []).map((cue) => [cue.id, cue]),
    );
    const localCues = new Map(localScene.cues.map((cue) => [cue.id, cue]));
    const incomingCues = new Map(inScene.cues.map((cue) => [cue.id, cue]));

    // 外部新增的提示
    inScene.cues.forEach((inCue) => {
      if (baseCues.has(inCue.id)) return;
      if (localCues.has(inCue.id)) return; // 两边各自新增了同 id（碰撞），交给下面的字段合并
      if (localScene!.locked) {
        pending.push(
          buildPending(
            'locked-scene',
            localScene!,
            '*',
            undefined,
            undefined,
            clone(inCue),
            inCue,
          ),
        );
      } else {
        localScene!.cues.push(clone(inCue));
        autoChanges.push({
          sceneId: localScene!.id,
          sceneLabel: sceneLabelOf(localScene),
          cueId: inCue.id,
          cueLabel: cueLabelOf(inCue),
          field: '*',
          fieldLabel: '新增提示',
          oldValue: '—',
          newValue: cueLabelOf(inCue),
        });
      }
    });

    // 外部删除的提示
    baseScene?.cues.forEach((baseCue) => {
      if (incomingCues.has(baseCue.id)) return;
      const localCue = localCues.get(baseCue.id);
      if (!localCue) return; // 两边都删了
      // 外部删除、本地改过 → 删除/修改冲突
      pending.push(
        buildPending(
          localScene!.locked ? 'locked-scene' : 'conflict',
          localScene!,
          '*',
          clone(baseCue),
          clone(localCue),
          undefined,
          localCue,
        ),
      );
    });

    // 两边都存在的提示：逐字段合并
    inScene.cues.forEach((inCue) => {
      const baseCue = baseCues.get(inCue.id);
      const localCue = localCues.get(inCue.id);
      if (!baseCue) {
        // 外部新增；若本地也有同 id（碰撞），按字段冲突处理
        if (!localCue) return;
      } else if (!localCue) {
        // 本地删除、外部改过 → 删除/修改冲突
        pending.push(
          buildPending(
            localScene!.locked ? 'locked-scene' : 'conflict',
            localScene!,
            '*',
            clone(baseCue),
            undefined,
            clone(inCue),
            inCue,
          ),
        );
        return;
      }
      if (!localCue) return;

      CUE_FIELDS.forEach((field) => {
        const baseValue = baseCue
          ? (baseCue as unknown as Record<string, unknown>)[field]
          : undefined;
        const localValue = (localCue as unknown as Record<string, unknown>)[
          field
        ];
        const incomingValue = (inCue as unknown as Record<string, unknown>)[
          field
        ];
        const decision = decideField(baseValue, localValue, incomingValue);
        if (decision === 'incoming') {
          if (localScene!.locked) {
            pending.push(
              buildPending(
                'locked-scene',
                localScene!,
                field,
                baseValue,
                localValue,
                incomingValue,
                localCue,
              ),
            );
          } else {
            (localCue as unknown as Record<string, unknown>)[field] =
              clone(incomingValue);
            autoChanges.push({
              sceneId: localScene!.id,
              sceneLabel: sceneLabelOf(localScene),
              cueId: localCue.id,
              cueLabel: cueLabelOf(localCue),
              field,
              fieldLabel: CUE_FIELD_LABELS[field] ?? field,
              oldValue: formatFieldValue(field, localValue),
              newValue: formatFieldValue(field, incomingValue),
            });
          }
        } else if (decision === 'conflict') {
          pending.push(
            buildPending(
              localScene!.locked ? 'locked-scene' : 'conflict',
              localScene!,
              field,
              baseValue,
              localValue,
              incomingValue,
              localCue,
            ),
          );
        }
      });
    });

    recalcSceneOffsets(localScene);
  });

  // 外部场次顺序不强行覆盖正式表；只把新增场次追加到末尾
  merged.updatedAt = new Date().toISOString();
  return { merged, autoChanges, pending };
}

function recalcSceneOffsets(scene: Scene): void {
  let elapsed = 0;
  scene.cues.forEach((cue) => {
    cue.offset = elapsed;
    elapsed += Number(cue.duration) || 0;
  });
}

/** 对比两个场次的字段差异（用于变更单） */
export function diffScenes(
  before: Scene | undefined,
  after: Scene | undefined,
): FieldChange[] {
  const changes: FieldChange[] = [];
  if (!before && after) {
    changes.push({
      sceneId: after.id,
      sceneLabel: sceneLabelOf(after),
      field: '*',
      fieldLabel: '新增场次',
      oldValue: '—',
      newValue: sceneLabelOf(after),
    });
    return changes;
  }
  if (before && !after) {
    changes.push({
      sceneId: before.id,
      sceneLabel: sceneLabelOf(before),
      field: '*',
      fieldLabel: '删除场次',
      oldValue: sceneLabelOf(before),
      newValue: '—',
    });
    return changes;
  }
  if (!before || !after) return changes;
  SCENE_FIELDS.forEach((field) => {
    const oldValue = (before as unknown as Record<string, unknown>)[field];
    const newValue = (after as unknown as Record<string, unknown>)[field];
    if (!sameValue(oldValue, newValue)) {
      changes.push({
        sceneId: after.id,
        sceneLabel: sceneLabelOf(after),
        field,
        fieldLabel: SCENE_FIELD_LABELS[field] ?? field,
        oldValue: formatFieldValue(field, oldValue),
        newValue: formatFieldValue(field, newValue),
      });
    }
  });
  return changes;
}

/** 对比两条提示的字段差异（用于变更单） */
export function diffCues(
  before: Cue | undefined,
  after: Cue | undefined,
  scene: Scene,
): FieldChange[] {
  const changes: FieldChange[] = [];
  if (!before && after) {
    changes.push({
      sceneId: scene.id,
      sceneLabel: sceneLabelOf(scene),
      cueId: after.id,
      cueLabel: cueLabelOf(after),
      field: '*',
      fieldLabel: '新增提示',
      oldValue: '—',
      newValue: cueLabelOf(after),
    });
    return changes;
  }
  if (before && !after) {
    changes.push({
      sceneId: scene.id,
      sceneLabel: sceneLabelOf(scene),
      cueId: before.id,
      cueLabel: cueLabelOf(before),
      field: '*',
      fieldLabel: '删除提示',
      oldValue: cueLabelOf(before),
      newValue: '—',
    });
    return changes;
  }
  if (!before || !after) return changes;
  CUE_FIELDS.forEach((field) => {
    const oldValue = (before as unknown as Record<string, unknown>)[field];
    const newValue = (after as unknown as Record<string, unknown>)[field];
    if (!sameValue(oldValue, newValue)) {
      changes.push({
        sceneId: scene.id,
        sceneLabel: sceneLabelOf(scene),
        cueId: after.id,
        cueLabel: cueLabelOf(after),
        field,
        fieldLabel: CUE_FIELD_LABELS[field] ?? field,
        oldValue: formatFieldValue(field, oldValue),
        newValue: formatFieldValue(field, newValue),
      });
    }
  });
  return changes;
}

/** 整场演出的字段级差异（变更单汇总用） */
export function diffShow(before: ShowData, after: ShowData): FieldChange[] {
  const changes: FieldChange[] = [];
  const beforeScenes = new Map(before.scenes.map((scene) => [scene.id, scene]));
  const afterScenes = new Map(after.scenes.map((scene) => [scene.id, scene]));

  after.scenes.forEach((afterScene) => {
    const beforeScene = beforeScenes.get(afterScene.id);
    changes.push(...diffScenes(beforeScene, afterScene));
    const beforeCues = new Map(
      (beforeScene?.cues ?? []).map((cue) => [cue.id, cue]),
    );
    const afterCues = new Map(afterScene.cues.map((cue) => [cue.id, cue]));
    afterScene.cues.forEach((afterCue) => {
      changes.push(
        ...diffCues(beforeCues.get(afterCue.id), afterCue, afterScene),
      );
    });
    beforeScene?.cues.forEach((beforeCue) => {
      if (!afterCues.has(beforeCue.id))
        changes.push(...diffCues(beforeCue, undefined, afterScene));
    });
  });
  before.scenes.forEach((beforeScene) => {
    if (!afterScenes.has(beforeScene.id))
      changes.push(...diffScenes(beforeScene, undefined));
  });
  return changes;
}

/** 把待裁决项的选定值写回场次 / 提示 */
export function applyPendingToShow(
  show: ShowData,
  item: PendingItem,
  side: 'local' | 'incoming',
): void {
  const scene = show.scenes.find((entry) => entry.id === item.sceneId);
  if (!scene) return;
  const value = side === 'local' ? item.localRaw : item.incomingRaw;

  if (item.field === '*') {
    const idx = scene.cues.findIndex((cue) => cue.id === item.cueId);
    if (value === undefined) {
      if (idx >= 0) scene.cues.splice(idx, 1);
    } else if (idx >= 0) {
      scene.cues[idx] = clone(value) as Cue;
    } else {
      scene.cues.push(clone(value) as Cue);
    }
  } else if (item.cueId) {
    const cue = scene.cues.find((entry) => entry.id === item.cueId);
    if (cue)
      (cue as unknown as Record<string, unknown>)[item.field] = clone(value);
  } else {
    (scene as unknown as Record<string, unknown>)[item.field] = clone(value);
  }

  let elapsed = 0;
  scene.cues.forEach((cue) => {
    cue.offset = elapsed;
    elapsed += Number(cue.duration) || 0;
  });
}

export function isCueKind(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (CUE_KINDS as readonly string[]).includes(value)
  );
}

export function makeException(partial: {
  reason: string;
  raw: unknown;
  source?: string;
  sceneId?: string;
  sceneLabel?: string;
  cueId?: string;
  cueLabel?: string;
}): ExceptionRecord {
  return {
    id: uid('ex'),
    createdAt: nowIso(),
    source: partial.source ?? '旧版提示表',
    sceneId: partial.sceneId,
    sceneLabel: partial.sceneLabel ?? '未定位场次',
    cueId: partial.cueId,
    cueLabel: partial.cueLabel,
    reason: partial.reason,
    raw:
      typeof partial.raw === 'string'
        ? partial.raw
        : JSON.stringify(partial.raw),
  };
}
