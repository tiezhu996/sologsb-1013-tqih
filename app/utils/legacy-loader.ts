import type {
  CorruptRecord,
  LegacyLoadResult,
} from 'stage-cue-editor/models/change';
import type {
  Cue,
  CueKind,
  Scene,
  ShowData,
} from 'stage-cue-editor/models/show';
import { CUE_KINDS } from 'stage-cue-editor/models/show';
import {
  canonical,
  CUE_FIELDS,
  sceneLabel,
} from 'stage-cue-editor/utils/change-fields';
import { recalculateScene } from 'stage-cue-editor/utils/timeline';
import { uid } from 'stage-cue-editor/utils/id';

type Bag = { [key: string]: unknown };

const isString = (value: unknown): value is string => typeof value === 'string';
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => isString(item));
const asBag = (value: unknown): Bag =>
  value && typeof value === 'object' ? (value as Bag) : {};

function repairString(value: unknown, fallback = ''): string {
  return isString(value) ? value : fallback;
}

function buildCue(id: string): Cue {
  return {
    id,
    kind: '灯光',
    title: '',
    duration: 60,
    owner: '',
    lighting: '',
    sound: '',
    props: [],
    cast: [],
    notes: '',
    dependsOn: [],
    offset: 0,
  };
}

function cueDamage(raw: Bag): string[] {
  const damaged: string[] = [];
  const isKnownKind = (value: unknown): value is CueKind =>
    isString(value) && CUE_KINDS.includes(value as CueKind);
  if (!isKnownKind(raw['kind'])) damaged.push('提示类型');
  if (!isString(raw['title'])) damaged.push('提示标题');
  if (canonical(raw['duration'], 'number') === null) damaged.push('时长（秒）');
  if (!isString(raw['owner'])) damaged.push('负责人');
  if (!isString(raw['lighting'])) damaged.push('灯光');
  if (!isString(raw['sound'])) damaged.push('音响');
  if (!Array.isArray(raw['props']) || !isStringArray(raw['props']))
    damaged.push('道具');
  if (!Array.isArray(raw['cast']) || !isStringArray(raw['cast']))
    damaged.push('演员');
  if (!isString(raw['notes'])) damaged.push('备注');
  if (!Array.isArray(raw['dependsOn']) || !isStringArray(raw['dependsOn']))
    damaged.push('前置提示');
  return damaged;
}

/**
 * 按原顺序载入旧版提示表：
 * - 结构完整的场次与提示按原顺序保留，照常编辑；
 * - 字段损坏的提示整条移入异常箱，不阻断其余场次；
 * - 轻量损坏（ID、偏移、缺失的串/数组字段）就地修复。
 */
export function sanitizeShow(
  source: unknown,
  fallback: ShowData,
): { data: ShowData; corrupt: CorruptRecord[] } {
  const root = asBag(source);
  const corrupt: CorruptRecord[] = [];

  const data: ShowData = {
    title: repairString(root['title'], fallback.title),
    venue: repairString(root['venue'], fallback.venue),
    date: repairString(root['date'], fallback.date),
    scenes: [],
    updatedAt: isString(root['updatedAt'])
      ? root['updatedAt']
      : new Date().toISOString(),
  };

  const rawScenes = Array.isArray(root['scenes'])
    ? (root['scenes'] as unknown[])
    : [];
  const sceneIds = new Set<string>();

  rawScenes.forEach((rawScene, sceneIndex) => {
    if (!rawScene || typeof rawScene !== 'object') {
      corrupt.push({
        id: uid('corrupt'),
        level: 'scene',
        sceneId: '',
        sceneLabel: `第 ${sceneIndex + 1} 个场次`,
        cueId: '',
        cueTitle: '',
        index: sceneIndex,
        fields: ['整段场次'],
        detail: '场次结构不是对象，无法载入，已移入异常箱。',
        raw: rawScene,
      });
      return;
    }

    const record = asBag(rawScene);
    let sceneId = isString(record['id']) ? record['id'] : uid('scene');
    if (sceneIds.has(sceneId)) sceneId = uid('scene');
    sceneIds.add(sceneId);

    const scene: Scene = {
      id: sceneId,
      act: repairString(record['act'], `第${sceneIndex + 1}幕`),
      name: repairString(record['name'], `S${sceneIndex + 1}`),
      title: repairString(record['title'], '未命名场次'),
      startTime: repairString(record['startTime'], '19:30'),
      locked: record['locked'] === true,
      cues: [],
    };

    if (!Array.isArray(record['cues'])) {
      corrupt.push({
        id: uid('corrupt'),
        level: 'scene',
        sceneId,
        sceneLabel: sceneLabel(scene),
        cueId: '',
        cueTitle: '',
        index: sceneIndex,
        fields: ['提示列表'],
        detail: `「${scene.title}」提示列表损坏，本场无提示；原始记录在异常箱。`,
        raw: record['cues'],
      });
    } else {
      const cueIds = new Set<string>();
      (record['cues'] as unknown[]).forEach((rawCue, cueIndex) => {
        if (!rawCue || typeof rawCue !== 'object') {
          corrupt.push({
            id: uid('corrupt'),
            level: 'cue',
            sceneId,
            sceneLabel: sceneLabel(scene),
            cueId: '',
            cueTitle: '',
            index: cueIndex,
            fields: ['整条提示'],
            detail: '提示结构不是对象，已移入异常箱。',
            raw: rawCue,
          });
          return;
        }

        const cueRecord = asBag(rawCue);
        const damaged = cueDamage(cueRecord);
        if (damaged.length) {
          corrupt.push({
            id: uid('corrupt'),
            level: 'cue',
            sceneId,
            sceneLabel: sceneLabel(scene),
            cueId: isString(cueRecord['id'])
              ? cueRecord['id']
              : `位置 ${cueIndex + 1}`,
            cueTitle: isString(cueRecord['title'])
              ? cueRecord['title']
              : `位置 ${cueIndex + 1}`,
            index: cueIndex,
            fields: damaged,
            detail: `损坏字段：${damaged.join('、')}`,
            raw: rawCue,
          });
          return;
        }

        let cueId = cueRecord['id'] as string;
        if (cueIds.has(cueId)) cueId = uid('cue');
        cueIds.add(cueId);

        scene.cues.push({
          id: cueId,
          kind: cueRecord['kind'] as CueKind,
          title: (cueRecord['title'] as string).trim(),
          duration: Number(cueRecord['duration']) || 60,
          owner: cueRecord['owner'] as string,
          lighting: cueRecord['lighting'] as string,
          sound: cueRecord['sound'] as string,
          props: cueRecord['props'] as string[],
          cast: cueRecord['cast'] as string[],
          notes: cueRecord['notes'] as string,
          dependsOn: cueRecord['dependsOn'] as string[],
          offset: 0,
        });
      });
    }

    recalculateScene(scene);
    data.scenes.push(scene);
  });

  return { data, corrupt };
}

/** 从异常箱原始记录重建一条可编辑提示（损坏字段按默认值修复） */
export function restoreCue(raw: unknown): Cue | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = asBag(raw);
  const cue = buildCue(isString(record['id']) ? record['id'] : uid('cue'));
  CUE_FIELDS.forEach((spec) => {
    const value = record[spec.key];
    const canonicalValue = canonical(value, spec.kind);
    if (canonicalValue === null) return;
    const target = cue as unknown as Bag;
    if (spec.kind === 'number') target[spec.key] = Number(canonicalValue);
    else if (spec.kind === 'list')
      target[spec.key] = canonicalValue.split('、').filter(Boolean);
    else target[spec.key] = canonicalValue;
  });
  cue.offset = 0;
  return cue;
}

/** 载入旧版本地数据（v1 结构 { show, versions } 或裸 ShowData） */
export function loadLegacyShow(
  raw: string | null,
  fallback: ShowData,
): LegacyLoadResult {
  if (!raw) return { data: fallback, corrupt: [], migrated: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { data: fallback, corrupt: [], migrated: false };
  }
  if (!parsed || typeof parsed !== 'object')
    return { data: fallback, corrupt: [], migrated: false };

  const container = asBag(parsed);
  const embedded = container['show'];
  const bareScenes = Array.isArray(container['scenes']);
  if (!embedded && !bareScenes)
    return { data: fallback, corrupt: [], migrated: false };

  const source = embedded ?? parsed;
  const { data, corrupt } = sanitizeShow(source, fallback);
  return { data, corrupt, migrated: true };
}
