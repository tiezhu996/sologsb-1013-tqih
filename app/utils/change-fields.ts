import type { Cue, Scene, ShowData } from 'stage-cue-editor/models/show';
import type { FieldChange } from 'stage-cue-editor/models/change';

export type FieldKind = 'string' | 'number' | 'list';

export interface FieldSpec<T> {
  key: Extract<keyof T, string>;
  label: string;
  kind: FieldKind;
}

export const SHOW_FIELDS: Array<FieldSpec<ShowData>> = [
  { key: 'title', label: '演出名称', kind: 'string' },
  { key: 'venue', label: '演出场地', kind: 'string' },
  { key: 'date', label: '演出日期', kind: 'string' },
];

export const SCENE_FIELDS: Array<FieldSpec<Scene>> = [
  { key: 'act', label: '幕', kind: 'string' },
  { key: 'name', label: '场号', kind: 'string' },
  { key: 'title', label: '场次标题', kind: 'string' },
  { key: 'startTime', label: '开场时间', kind: 'string' },
];

export const CUE_FIELDS: Array<FieldSpec<Cue>> = [
  { key: 'kind', label: '提示类型', kind: 'string' },
  { key: 'title', label: '提示标题', kind: 'string' },
  { key: 'duration', label: '时长（秒）', kind: 'number' },
  { key: 'owner', label: '负责人', kind: 'string' },
  { key: 'lighting', label: '灯光', kind: 'string' },
  { key: 'sound', label: '音响', kind: 'string' },
  { key: 'props', label: '道具', kind: 'list' },
  { key: 'cast', label: '演员', kind: 'list' },
  { key: 'notes', label: '备注', kind: 'string' },
  { key: 'dependsOn', label: '前置提示', kind: 'list' },
];

const LIST_SPLIT = /[、,，]/;

export function sceneLabel(scene: Pick<Scene, 'act' | 'name'>): string {
  return `${scene.act || '—'} ${scene.name || '—'}`;
}

/** 归一化为可比较/存储的字符串；输入不合法时返回 null */
export function canonical(value: unknown, kind: FieldKind): string | null {
  if (kind === 'list') {
    if (!Array.isArray(value)) return null;
    if (value.some((item) => typeof item !== 'string')) return null;
    const seen = new Set<string>();
    value.forEach((item) => {
      const text = item.trim();
      if (text) seen.add(text);
    });
    return Array.from(seen).join('、');
  }
  if (kind === 'number') {
    if (typeof value === 'boolean') return null;
    const num = Number(value);
    return Number.isFinite(num) ? String(num) : null;
  }
  return typeof value === 'string' ? value.trim() : null;
}

export function displayValue(value: string): string {
  return value === '' ? '（清空）' : value;
}

function diffFields<T>(
  before: T,
  after: T,
  specs: Array<FieldSpec<T>>,
): Array<{
  field: string;
  fieldLabel: string;
  oldValue: string;
  newValue: string;
}> {
  const result: Array<{
    field: string;
    fieldLabel: string;
    oldValue: string;
    newValue: string;
  }> = [];
  specs.forEach((spec) => {
    const oldCanonical = canonical(before[spec.key], spec.kind);
    const newCanonical = canonical(after[spec.key], spec.kind);
    if (oldCanonical === null || newCanonical === null) return;
    if (oldCanonical !== newCanonical) {
      result.push({
        field: spec.key,
        fieldLabel: spec.label,
        oldValue: oldCanonical,
        newValue: newCanonical,
      });
    }
  });
  return result;
}

export function diffShow(before: ShowData, after: ShowData): FieldChange[] {
  return diffFields(before, after, SHOW_FIELDS).map((item) => ({
    sceneLabel: '',
    sceneId: '',
    cueId: '',
    cueTitle: '',
    level: 'show' as const,
    ...item,
  }));
}

export function diffScene(before: Scene, after: Scene): FieldChange[] {
  return diffFields(before, after, SCENE_FIELDS).map((item) => ({
    sceneLabel: sceneLabel(after),
    sceneId: after.id,
    cueId: '',
    cueTitle: '',
    level: 'scene' as const,
    ...item,
  }));
}

export function diffCue(before: Cue, after: Cue, scene: Scene): FieldChange[] {
  return diffFields(before, after, CUE_FIELDS).map((item) => ({
    sceneLabel: sceneLabel(scene),
    sceneId: scene.id,
    cueId: after.id,
    cueTitle: after.title,
    level: 'cue' as const,
    ...item,
  }));
}

function cueSummary(cue: Cue): string {
  return `${cue.kind}「${cue.title}」 ${cue.duration}秒 · 负责人 ${cue.owner || '待指定'}`;
}

function diffCueOrder(beforeScene: Scene, afterScene: Scene): FieldChange[] {
  const beforeIds = beforeScene.cues.map((cue) => cue.id);
  const afterIds = afterScene.cues
    .filter((cue) => beforeIds.includes(cue.id))
    .map((cue) => cue.id);
  const baseline = beforeIds.filter((id) => afterIds.includes(id));
  if (
    baseline.length === afterIds.length &&
    baseline.every((id, index) => id === afterIds[index])
  )
    return [];
  return [
    {
      op: 'cue-order',
      sceneLabel: sceneLabel(afterScene),
      sceneId: afterScene.id,
      cueId: '',
      cueTitle: '',
      level: 'cue',
      field: 'cue-order',
      fieldLabel: '提示顺序',
      oldValue: baseline.join(','),
      newValue: afterIds.join(','),
    },
  ];
}

function diffCuesStructural(
  beforeScene: Scene,
  afterScene: Scene,
): FieldChange[] {
  const changes: FieldChange[] = [];
  afterScene.cues.forEach((cue) => {
    if (!beforeScene.cues.some((item) => item.id === cue.id)) {
      changes.push({
        op: 'cue-add',
        sceneLabel: sceneLabel(afterScene),
        sceneId: afterScene.id,
        cueId: cue.id,
        cueTitle: cue.title,
        level: 'cue',
        field: 'cue-add',
        fieldLabel: '新增提示',
        oldValue: '',
        newValue: cueSummary(cue),
        payload: JSON.parse(JSON.stringify(cue)) as Cue,
      });
    }
  });
  beforeScene.cues.forEach((cue) => {
    if (!afterScene.cues.some((item) => item.id === cue.id)) {
      changes.push({
        op: 'cue-remove',
        sceneLabel: sceneLabel(beforeScene),
        sceneId: afterScene.id,
        cueId: cue.id,
        cueTitle: cue.title,
        level: 'cue',
        field: 'cue-remove',
        fieldLabel: '删除提示',
        oldValue: cueSummary(cue),
        newValue: '',
      });
    }
  });
  changes.push(...diffCueOrder(beforeScene, afterScene));
  return changes;
}

/** 比较基准版与当前工作版，按场次/提示原顺序产出字段级变更 */
export function diffShowData(before: ShowData, after: ShowData): FieldChange[] {
  const changes: FieldChange[] = [...diffShow(before, after)];
  after.scenes.forEach((afterScene) => {
    const beforeScene = before.scenes.find(
      (scene) => scene.id === afterScene.id,
    );
    if (!beforeScene) {
      changes.push({
        op: 'scene-add',
        sceneLabel: sceneLabel(afterScene),
        sceneId: afterScene.id,
        cueId: '',
        cueTitle: '',
        level: 'scene',
        field: 'scene-add',
        fieldLabel: '新增场次',
        oldValue: '',
        newValue: `${sceneLabel(afterScene)}「${afterScene.title}」`,
        payload: JSON.parse(JSON.stringify(afterScene)) as Scene,
      });
      afterScene.cues.forEach((cue) => {
        changes.push({
          op: 'cue-add',
          sceneLabel: sceneLabel(afterScene),
          sceneId: afterScene.id,
          cueId: cue.id,
          cueTitle: cue.title,
          level: 'cue',
          field: 'cue-add',
          fieldLabel: '新增提示',
          oldValue: '',
          newValue: cueSummary(cue),
          payload: JSON.parse(JSON.stringify(cue)) as Cue,
        });
      });
      return;
    }
    changes.push(...diffScene(beforeScene, afterScene));
    changes.push(...diffCuesStructural(beforeScene, afterScene));
    afterScene.cues.forEach((afterCue) => {
      const beforeCue = beforeScene.cues.find((cue) => cue.id === afterCue.id);
      if (beforeCue) changes.push(...diffCue(beforeCue, afterCue, afterScene));
    });
  });
  return changes;
}

export function findSpec(
  change: Pick<FieldChange, 'level' | 'field'>,
): FieldSpec<ShowData & Scene & Cue> | undefined {
  const specs =
    change.level === 'show'
      ? SHOW_FIELDS
      : change.level === 'scene'
        ? SCENE_FIELDS
        : CUE_FIELDS;
  return specs.find((spec) => spec.key === change.field) as
    FieldSpec<ShowData & Scene & Cue> | undefined;
}

/** 读取变更字段在正式表中的当前值（归一化）；结构性变更返回状态标记 */
export function readOfficial(
  show: ShowData,
  change: FieldChange,
): string | null {
  if (change.op && change.op !== 'set')
    return readOfficialStructural(show, change);
  const spec = findSpec(change);
  if (!spec) return null;
  if (change.level === 'show')
    return canonical(show[spec.key as keyof ShowData], spec.kind);
  const scene = show.scenes.find((item) => item.id === change.sceneId);
  if (!scene) return null;
  if (change.level === 'scene')
    return canonical(scene[spec.key as keyof Scene], spec.kind);
  const cue = scene.cues.find((item) => item.id === change.cueId);
  return cue ? canonical(cue[spec.key as keyof Cue], spec.kind) : null;
}

/** 结构性变更在正式表中的当前状态：空串＝尚未应用，非空串＝已应用 */
export function readOfficialStructural(
  show: ShowData,
  change: FieldChange,
): string | null {
  const scene = show.scenes.find((item) => item.id === change.sceneId);
  if (change.op === 'scene-add') return scene ? change.newValue : '';
  if (!scene) return null;
  if (change.op === 'cue-add')
    return scene.cues.some((item) => item.id === change.cueId)
      ? change.newValue
      : '';
  if (change.op === 'cue-remove')
    return scene.cues.some((item) => item.id === change.cueId)
      ? change.oldValue
      : '';
  if (change.op === 'cue-order') {
    const shared = scene.cues
      .filter((cue) => change.oldValue.split(',').includes(cue.id))
      .map((cue) => cue.id);
    return shared.join(',');
  }
  return null;
}

function parseValue(
  value: string,
  kind: FieldKind,
): string | number | string[] {
  if (kind === 'number') return Number(value) || 0;
  if (kind === 'list') {
    const seen = new Set<string>();
    value
      .split(LIST_SPLIT)
      .map((item) => item.trim())
      .forEach((item) => item && seen.add(item));
    return Array.from(seen);
  }
  return value;
}

/**
 * 将一条字段变更写入正式表；返回受影响的场次（需重算时间轴），找不到目标返回 null。
 */
export function applyChange(show: ShowData, change: FieldChange): Scene | null {
  if (change.op && change.op !== 'set') return null;
  const spec = findSpec(change);
  if (!spec) return null;
  if (change.level === 'show') {
    Object.assign(show, { [spec.key]: parseValue(change.newValue, spec.kind) });
    return null;
  }
  const scene = show.scenes.find((item) => item.id === change.sceneId);
  if (!scene) return null;
  if (change.level === 'scene') {
    Object.assign(scene, {
      [spec.key]: parseValue(change.newValue, spec.kind),
    });
    return scene;
  }
  const cue = scene.cues.find((item) => item.id === change.cueId);
  if (!cue) return null;
  Object.assign(cue, { [spec.key]: parseValue(change.newValue, spec.kind) });
  return scene;
}

/**
 * 应用结构性变更；优先使用变更单携带的 payload，否则从提交者工作版 source 取完整数据。
 */
export function applyStructuralChange(
  show: ShowData,
  change: FieldChange,
  source?: ShowData,
): Scene | null {
  if (change.op === 'scene-add') {
    if (show.scenes.some((scene) => scene.id === change.sceneId)) return null;
    const fromPayload = change.payload as Scene | undefined;
    const sourceScene =
      fromPayload ??
      source?.scenes.find((scene) => scene.id === change.sceneId);
    if (!sourceScene) return null;
    show.scenes.push(JSON.parse(JSON.stringify(sourceScene)) as Scene);
    return null;
  }

  const scene = show.scenes.find((item) => item.id === change.sceneId);
  if (!scene) return null;
  const sourceScene = source?.scenes.find((item) => item.id === change.sceneId);

  if (change.op === 'cue-add') {
    if (scene.cues.some((cue) => cue.id === change.cueId)) return scene;
    const fromPayload = change.payload as Cue | undefined;
    const sourceCue =
      fromPayload ?? sourceScene?.cues.find((cue) => cue.id === change.cueId);
    if (!sourceCue) return null;
    scene.cues.push({ ...sourceCue, offset: 0 });
    return scene;
  }

  if (change.op === 'cue-remove') {
    scene.cues = scene.cues.filter((cue) => cue.id !== change.cueId);
    return scene;
  }

  if (change.op === 'cue-order' && sourceScene) {
    const wanted = change.newValue.split(',').filter(Boolean);
    const ordered = wanted
      .map((id) => scene.cues.find((cue) => cue.id === id))
      .filter((cue): cue is Cue => !!cue);
    const extras = scene.cues.filter((cue) => !wanted.includes(cue.id));
    scene.cues = [...ordered, ...extras];
    return scene;
  }

  return null;
}
