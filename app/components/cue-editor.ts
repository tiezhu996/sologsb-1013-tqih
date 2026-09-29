import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import type {
  ChangeOrder,
  CorruptRecord,
  FieldChange,
  PendingDecision,
  PendingItem,
} from 'stage-cue-editor/models/change';
import type {
  Cue,
  CueDraft,
  CueIssue,
  CueKind,
  Scene,
  ShowData,
  VersionDiff,
  VersionSnapshot,
} from 'stage-cue-editor/models/show';
import { CUE_KINDS, OWNERS } from 'stage-cue-editor/models/show';
import {
  applyChange,
  diffShowData,
  readOfficial,
} from 'stage-cue-editor/utils/change-fields';
import {
  ingestOrder,
  normalizeOrder,
  orderLabel,
  resolvePending,
} from 'stage-cue-editor/utils/change-merge';
import {
  loadLegacyShow,
  restoreCue,
} from 'stage-cue-editor/utils/legacy-loader';
import {
  overlaps,
  recalculateScene,
  startSeconds,
  timeLabel,
} from 'stage-cue-editor/utils/timeline';
import { uid } from 'stage-cue-editor/utils/id';

const STORAGE_KEY = 'sologsb-1013-stage-cue-editor-v2';
const LEGACY_STORAGE_KEY = 'sologsb-1013-stage-cue-editor-v1';
const AUTHOR_KEY = 'sologsb-1013-stage-cue-editor-author';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function cue(
  id: string,
  kind: CueKind,
  title: string,
  duration: number,
  owner: string,
  extra: Partial<Cue> = {},
): Cue {
  return {
    id,
    kind,
    title,
    duration,
    owner,
    lighting: '',
    sound: '',
    props: [],
    cast: [],
    notes: '',
    dependsOn: [],
    offset: 0,
    ...extra,
  };
}

function initialShow(): ShowData {
  const scenes: Scene[] = [
    {
      id: 'scene-1',
      act: '第一幕',
      name: 'S1',
      title: '月下序场',
      startTime: '19:30',
      locked: false,
      cues: [
        cue('cue-light-1', '灯光', '观众席渐暗 · 面光起', 45, '李岚', {
          lighting: 'FOH 1 号面光 65%，侧光暖白 40%',
          notes: '开演铃后 10 秒执行',
        }),
        cue('cue-actor-1', '演员', '说书人自左台入场', 90, '赵一帆', {
          cast: ['说书人／周启'],
          props: ['折扇'],
          notes: '追光跟随；入场后停留台中',
        }),
        cue('cue-sound-1', '音响', '古琴引子淡入', 120, '陈默', {
          sound: 'Q1 古琴引子，-18dB 淡入 6 秒',
          dependsOn: ['cue-deleted-old'],
          notes: '旧版依赖保留用于检查示例',
        }),
        cue('cue-prop-1', '道具', '月牙灯升至舞台中线', 75, '孙禾', {
          props: ['月牙灯'],
          lighting: '顶排 3 号定点',
        }),
      ],
    },
    {
      id: 'scene-2',
      act: '第一幕',
      name: 'S2',
      title: '宫门夜宴',
      startTime: '19:40',
      locked: false,
      cues: [
        cue('cue-stage-2', '舞台', '中景屏风换为朱红', 60, '', {
          notes: '负责人尚未确认',
        }),
        cue('cue-actor-2', '演员', '群臣列队入场', 110, '赵一帆', {
          cast: ['群演 6 人', '侍女 4 人'],
          props: ['宫灯'],
        }),
        cue('cue-light-2', '灯光', '暖金顶光覆盖后区', 80, '李岚', {
          lighting: '顶光 4、5 号 70%，色温 3200K',
        }),
      ],
    },
  ];
  scenes.forEach((scene) => recalculateScene(scene));
  return {
    title: '《长夜行》首演提示表',
    venue: '实验剧场 A 厅',
    date: '2026-10-18',
    scenes,
    updatedAt: new Date().toISOString(),
  };
}

interface StoredState {
  official: ShowData;
  working: ShowData;
  orders: ChangeOrder[];
  pending: PendingItem[];
  versions: VersionSnapshot[];
  corrupt: CorruptRecord[];
  loadNotice: string;
}

function bootstrapState(): StoredState {
  const fallback = initialShow();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<StoredState>;
      if (parsed.official && parsed.working) {
        return {
          official: parsed.official,
          working: parsed.working,
          orders: parsed.orders ?? [],
          pending: parsed.pending ?? [],
          versions: parsed.versions ?? [],
          corrupt: parsed.corrupt ?? [],
          loadNotice: parsed.loadNotice ?? '',
        };
      }
    } catch {
      // 落盘损坏：回落至旧版/初始载入
    }
  }

  // 旧版提示表按原顺序载入，字段损坏记录进异常箱
  let legacyRaw: string | null = null;
  try {
    legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    legacyRaw = null;
  }
  const legacy = loadLegacyShow(legacyRaw, fallback);
  const base = legacy.data;
  const notice = legacy.corrupt.length
    ? `旧版提示表已按原顺序载入，${legacy.corrupt.length} 条字段损坏的记录移入异常箱。`
    : legacy.migrated
      ? '旧版提示表已按原顺序载入。'
      : '';
  return {
    official: clone(base),
    working: clone(base),
    orders: [],
    pending: [],
    versions: loadLegacyVersions(legacyRaw),
    corrupt: legacy.corrupt,
    loadNotice: notice,
  };
}

function loadLegacyVersions(legacyRaw: string | null): VersionSnapshot[] {
  if (!legacyRaw) return [];
  try {
    const parsed = JSON.parse(legacyRaw) as { versions?: VersionSnapshot[] };
    return Array.isArray(parsed.versions) ? parsed.versions : [];
  } catch {
    return [];
  }
}

export default class CueEditorComponent extends Component {
  @tracked official: ShowData;
  @tracked working: ShowData;
  @tracked orders: ChangeOrder[];
  @tracked pending: PendingItem[];
  @tracked versions: VersionSnapshot[];
  @tracked corrupt: CorruptRecord[];
  @tracked activeSceneId: string;
  @tracked selectedCueId: string;
  @tracked draft: CueDraft | null = null;
  @tracked compareVersionId = '';
  @tracked message = '';
  @tracked search = '';
  @tracked author: string;
  @tracked orderNote = '';
  @tracked importText = '';
  @tracked loadNotice: string;

  private undoStack: ShowData[] = [];
  private redoStack: ShowData[] = [];
  private dragCueId = '';

  constructor(owner: unknown, args: Record<string, unknown>) {
    super(owner, args);
    const state = bootstrapState();
    this.official = state.official;
    this.working = state.working;
    this.orders = state.orders;
    this.pending = state.pending;
    this.versions = state.versions;
    this.corrupt = state.corrupt;
    this.loadNotice = state.loadNotice;
    this.compareVersionId = this.versions[0]?.id ?? '';
    this.activeSceneId = this.working.scenes[0]?.id ?? '';
    this.selectedCueId = this.working.scenes[0]?.cues[0]?.id ?? '';
    this.author = this.readAuthor();
    window.addEventListener('keydown', this.handleKeyboard);
    window.addEventListener('storage', this.handleStorage);
    if (this.loadNotice) this.notify(this.loadNotice, 5200);
  }

  // ---------- 基础视图 ----------

  get activeScene(): Scene | undefined {
    return this.working.scenes.find((scene) => scene.id === this.activeSceneId);
  }

  get selectedCue(): Cue | undefined {
    return this.activeScene?.cues.find(
      (item) => item.id === this.selectedCueId,
    );
  }

  get isDirty(): boolean {
    return JSON.stringify(this.working) !== JSON.stringify(this.official);
  }

  get pendingChangeCount(): number {
    return diffShowData(this.official, this.working).length;
  }

  get workingTitle(): string {
    return this.working.title;
  }

  get cueRows() {
    if (!this.activeScene) return [];
    return this.activeScene.cues.map((item, index) => ({
      ...item,
      index,
      start: timeLabel(this.activeScene as Scene, item.offset),
      end: timeLabel(this.activeScene as Scene, item.offset + item.duration),
      selected: item.id === this.selectedCueId,
      hasIssue: this.issues.some((issue) => issue.cueId === item.id),
      kindClass:
        item.kind === '灯光'
          ? 'light'
          : item.kind === '音响'
            ? 'sound'
            : item.kind === '道具'
              ? 'prop'
              : item.kind === '演员'
                ? 'cast'
                : item.kind === '字幕'
                  ? 'caption'
                  : 'stage',
      propsLabel: item.props.join('、'),
      castLabel: item.cast.join('、'),
    }));
  }

  get sceneRows() {
    return this.working.scenes.map((scene) => ({
      ...scene,
      active: scene.id === this.activeSceneId,
      issueCount: this.issues.filter((issue) => issue.sceneId === scene.id)
        .length,
      duration: scene.cues.reduce((total, item) => total + item.duration, 0),
    }));
  }

  get cueKindOptions(): CueKind[] {
    return CUE_KINDS;
  }

  get ownerOptions(): string[] {
    return OWNERS;
  }

  get allCues(): Array<{ cue: Cue; scene: Scene }> {
    return this.working.scenes.flatMap((scene) =>
      scene.cues.map((item) => ({ cue: item, scene })),
    );
  }

  get issues(): CueIssue[] {
    const issues: CueIssue[] = [];
    this.allCues.forEach(({ cue: item, scene }) => {
      if (!item.owner) {
        issues.push({
          id: `owner-${item.id}`,
          severity: 'error',
          title: '负责人空缺',
          detail: `${scene.act} ${scene.name}「${item.title}」尚未指定负责人。`,
          sceneId: scene.id,
          cueId: item.id,
        });
      }
      item.dependsOn.forEach((reference) => {
        if (!this.allCues.some((entry) => entry.cue.id === reference)) {
          issues.push({
            id: `ref-${item.id}-${reference}`,
            severity: 'error',
            title: '提示被引用但已删除',
            detail: `「${item.title}」仍依赖已删除的提示 ${reference}。`,
            sceneId: scene.id,
            cueId: item.id,
          });
        }
      });
      const previous = scene.cues[scene.cues.indexOf(item) - 1];
      if (previous && item.offset < previous.offset + previous.duration) {
        issues.push({
          id: `overlap-${item.id}`,
          severity: 'error',
          title: '同场时间冲突',
          detail: `「${item.title}」与上一条提示重叠。`,
          sceneId: scene.id,
          cueId: item.id,
        });
      }
    });

    const allCues = this.allCues;
    for (let index = 0; index < allCues.length; index += 1) {
      for (let next = index + 1; next < allCues.length; next += 1) {
        const left = allCues[index]!;
        const right = allCues[next]!;
        if (left.cue.id === right.cue.id || left.scene.id === right.scene.id)
          continue;
        const leftStart = startSeconds(left.scene.startTime) + left.cue.offset;
        const rightStart =
          startSeconds(right.scene.startTime) + right.cue.offset;
        if (
          !overlaps(
            leftStart,
            left.cue.duration,
            rightStart,
            right.cue.duration,
          )
        )
          continue;
        const sharedProps = left.cue.props.filter((value) =>
          right.cue.props.includes(value),
        );
        const sharedCast = left.cue.cast.filter((value) =>
          right.cue.cast.includes(value),
        );
        if (sharedProps.length) {
          issues.push({
            id: `prop-${left.cue.id}-${right.cue.id}`,
            severity: 'warning',
            title: '道具撞场',
            detail: `「${left.cue.title}」与「${right.cue.title}」同时使用：${sharedProps.join('、')}。`,
            sceneId: right.scene.id,
            cueId: right.cue.id,
          });
        }
        if (sharedCast.length) {
          issues.push({
            id: `cast-${left.cue.id}-${right.cue.id}`,
            severity: 'warning',
            title: '演员撞场',
            detail: `「${left.cue.title}」与「${right.cue.title}」同时需要：${sharedCast.join('、')}。`,
            sceneId: right.scene.id,
            cueId: right.cue.id,
          });
        }
      }
    }
    return issues.map((issue) => ({
      ...issue,
      icon: issue.severity === 'error' ? '!' : 'i',
    }));
  }

  get selectedProps(): string {
    return this.selectedCue?.props.join('、') ?? '';
  }

  get selectedCast(): string {
    return this.selectedCue?.cast.join('、') ?? '';
  }

  get errors(): number {
    return this.issues.filter((issue) => issue.severity === 'error').length;
  }

  get filteredScenes() {
    const term = this.search.trim().toLowerCase();
    return this.sceneRows.filter(
      (scene) =>
        !term ||
        `${scene.act}${scene.name}${scene.title}`.toLowerCase().includes(term),
    );
  }

  // ---------- 变更单 ----------

  get pendingChanges(): FieldChange[] {
    return diffShowData(this.official, this.working);
  }

  get pendingRows(): Array<PendingItem & { officialValue: string }> {
    // 最新的外部改动排在前面，便于场务优先处理；附带正式表当前值供对照
    const sorted = [...this.pending].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
    );
    return sorted.map((item) => {
      const value = readOfficial(this.official, item.change);
      return {
        ...item,
        officialValue:
          value === null || value === '' ? '（空 / 目标已删除）' : value,
      };
    });
  }

  get pendingGroups(): Array<{
    orderId: string;
    label: string;
    items: Array<PendingItem & { officialValue: string }>;
  }> {
    const groups = new Map<
      string,
      Array<PendingItem & { officialValue: string }>
    >();
    this.pendingRows.forEach((item) => {
      const list = groups.get(item.orderId) ?? [];
      list.push(item);
      groups.set(item.orderId, list);
    });
    return Array.from(groups.entries()).map(([orderId, items]) => ({
      orderId,
      label: items[0]?.orderLabel ?? orderId,
      items,
    }));
  }

  get corruptRows(): Array<CorruptRecord & { restorable: boolean }> {
    return this.corrupt.map((record) => ({
      ...record,
      restorable: record.level === 'cue',
    }));
  }

  get orderRows() {
    return this.orders.map((order) => ({
      ...order,
      label: orderLabel(order),
      statusLabel:
        order.status === 'merged'
          ? '已并入'
          : order.status === 'accepted'
            ? '裁决采纳'
            : order.status === 'rejected'
              ? '已驳回'
              : '待裁决',
    }));
  }

  // ---------- 版本比较 ----------

  get compareVersion(): VersionSnapshot | undefined {
    return this.versions.find(
      (version) => version.id === this.compareVersionId,
    );
  }

  get versionDiff(): VersionDiff[] {
    const version = this.compareVersion;
    if (!version) return [];
    const before = version.data.scenes.flatMap((scene) =>
      scene.cues.map(
        (item) =>
          `${scene.act}/${scene.name} · ${item.title} | ${item.owner || '未指定'} | ${item.duration}s`,
      ),
    );
    const after = this.official.scenes.flatMap((scene) =>
      scene.cues.map(
        (item) =>
          `${scene.act}/${scene.name} · ${item.title} | ${item.owner || '未指定'} | ${item.duration}s`,
      ),
    );
    return Array.from(
      { length: Math.max(before.length, after.length) },
      (_, index) => ({
        id: `diff-${index}`,
        changed: before[index] !== after[index],
        label: `提示 ${index + 1}`,
        before: before[index] ?? '—',
        after: after[index] ?? '—',
      }),
    );
  }

  // ---------- 编辑动作 ----------

  @action
  selectScene(id: string): void {
    this.activeSceneId = id;
    this.selectedCueId =
      this.working.scenes.find((scene) => scene.id === id)?.cues[0]?.id ?? '';
    this.draft = null;
  }

  @action
  selectCue(id: string): void {
    this.selectedCueId = id;
    this.draft = null;
  }

  @action
  updateShowTitle(value: string): void {
    this.mutate((show) => {
      show.title = value;
    });
  }

  @action
  createCueDraft(kind: CueKind = '灯光'): void {
    if (this.activeScene?.locked) {
      this.notify('该场次已锁定，改动将随变更单留待裁决');
    }
    this.draft = {
      kind,
      title: '',
      duration: 60,
      owner: '',
      lighting: '',
      sound: '',
      props: '',
      cast: '',
      notes: '',
      dependsOn: '',
    };
  }

  @action
  cancelDraft(): void {
    this.draft = null;
  }

  @action
  editSelectedCue(): void {
    const item = this.selectedCue;
    if (!item) return;
    this.draft = {
      id: item.id,
      kind: item.kind,
      title: item.title,
      duration: item.duration,
      owner: item.owner,
      lighting: item.lighting,
      sound: item.sound,
      props: item.props.join('、'),
      cast: item.cast.join('、'),
      notes: item.notes,
      dependsOn: item.dependsOn.join('、'),
    };
  }

  @action
  updateDraft<K extends keyof CueDraft>(field: K, value: CueDraft[K]): void {
    if (this.draft) this.draft = { ...this.draft, [field]: value };
  }

  @action
  saveDraft(): void {
    if (!this.draft || !this.draft.title.trim() || !this.activeScene) return;
    const draft = this.draft;
    this.mutate((show) => {
      const scene = show.scenes.find((item) => item.id === this.activeSceneId);
      if (!scene) return;
      const saved: Cue = {
        id: draft.id ?? uid('cue'),
        kind: draft.kind,
        title: draft.title.trim(),
        duration: Math.max(1, Number(draft.duration) || 1),
        owner: draft.owner,
        lighting: draft.lighting,
        sound: draft.sound,
        props: draft.props
          .split(/[、,，]/)
          .map((value) => value.trim())
          .filter(Boolean),
        cast: draft.cast
          .split(/[、,，]/)
          .map((value) => value.trim())
          .filter(Boolean),
        notes: draft.notes,
        dependsOn: draft.dependsOn
          .split(/[、,，]/)
          .map((value) => value.trim())
          .filter(Boolean),
        offset: 0,
      };
      const index = scene.cues.findIndex((item) => item.id === saved.id);
      if (index >= 0) scene.cues.splice(index, 1, saved);
      else scene.cues.push(saved);
      recalculateScene(scene);
      this.selectedCueId = saved.id;
    });
    this.draft = null;
  }

  @action
  removeCue(id: string): void {
    this.mutate((show) => {
      const scene = show.scenes.find((item) => item.id === this.activeSceneId);
      if (!scene) return;
      scene.cues = scene.cues.filter((item) => item.id !== id);
      recalculateScene(scene);
    });
    this.selectedCueId = this.activeScene?.cues[0]?.id ?? '';
    this.draft = null;
  }

  @action
  addScene(): void {
    const scene: Scene = {
      id: uid('scene'),
      act: `第${this.working.scenes.length + 1}幕`,
      name: `S${this.working.scenes.length + 1}`,
      title: '未命名场次',
      startTime: '20:00',
      locked: false,
      cues: [],
    };
    this.mutate((show) => show.scenes.push(scene));
    this.activeSceneId = scene.id;
    this.selectedCueId = '';
  }

  @action
  copyPreviousScene(): void {
    const index = this.working.scenes.findIndex(
      (scene) => scene.id === this.activeSceneId,
    );
    const previous = this.working.scenes[index - 1];
    if (!previous) {
      this.notify('当前已是第一场');
      return;
    }
    const copied: Scene = clone(previous);
    copied.id = uid('scene');
    copied.locked = false;
    copied.act = this.activeScene?.act ?? copied.act;
    copied.name = `${copied.name}-副本`;
    copied.title = `${copied.title}（复制）`;
    copied.cues = copied.cues.map((item) => ({
      ...item,
      id: uid('cue'),
      dependsOn: [],
    }));
    recalculateScene(copied);
    this.mutate((show) => show.scenes.splice(index + 1, 0, copied));
    this.activeSceneId = copied.id;
    this.selectedCueId = copied.cues[0]?.id ?? '';
    this.notify('已复制上一场流程，提交时将作为新增场次生成变更单');
  }

  @action
  updateSceneField(
    field: 'title' | 'startTime' | 'act' | 'name',
    value: string,
  ): void {
    this.mutate((show) => {
      const scene = show.scenes.find((item) => item.id === this.activeSceneId);
      if (scene) scene[field] = value;
    });
  }

  @action
  updateSelectedField(field: keyof Cue, value: unknown): void {
    const id = this.selectedCueId;
    this.mutate((show) => {
      const scene = show.scenes.find((item) => item.id === this.activeSceneId);
      const item = scene?.cues.find((entry) => entry.id === id);
      if (!scene || !item) return;
      if (field === 'duration') item.duration = Math.max(1, Number(value) || 1);
      else if (field === 'props' || field === 'cast')
        item[field] = String(value)
          .split(/[、,，]/)
          .map((entry) => entry.trim())
          .filter(Boolean);
      else Object.assign(item, { [field]: value });
      recalculateScene(scene);
    });
  }

  @action
  moveSelected(direction: -1 | 1): void {
    const cues = this.activeScene?.cues ?? [];
    const from = cues.findIndex((item) => item.id === this.selectedCueId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= cues.length) return;
    this.moveCue(cues[from]!.id, cues[to]!.id, false);
  }

  @action
  startDrag(id: string): void {
    this.dragCueId = id;
  }

  @action
  allowDrop(event: DragEvent): boolean {
    event.preventDefault();
    return false;
  }

  @action
  dropOn(id: string): void {
    if (this.dragCueId) this.moveCue(this.dragCueId, id, false);
    this.dragCueId = '';
  }

  @action
  moveCue(sourceId: string, targetId: string, silent = true): void {
    if (sourceId === targetId) return;
    this.mutate((show) => {
      const scene = show.scenes.find((item) => item.id === this.activeSceneId);
      if (!scene) return;
      const from = scene.cues.findIndex((item) => item.id === sourceId);
      const to = scene.cues.findIndex((item) => item.id === targetId);
      if (from < 0 || to < 0) return;
      const [moved] = scene.cues.splice(from, 1);
      scene.cues.splice(to, 0, moved!);
      recalculateScene(scene);
    });
    this.selectedCueId = sourceId;
    if (!silent)
      this.notify('顺序已更新，提交变更单后自动顺延他人版本的后续时间');
  }

  @action
  toggleSceneLock(): void {
    // 锁定/解锁属场务行政动作，直接作用于正式表，不产生字段覆盖
    const next = clone(this.official);
    next.updatedAt = new Date().toISOString();
    const scene = next.scenes.find((item) => item.id === this.activeSceneId);
    if (!scene) return;
    scene.locked = !scene.locked;
    this.official = next;
    this.syncWorkingIfClean();
    this.persist();
    this.notify(
      scene.locked ? '场次已锁定，此后外部改动先进入待裁决区' : '场次已解锁',
    );
  }

  @action
  lockVersion(): void {
    const snapshot: VersionSnapshot = {
      id: uid('version'),
      name: `锁定版 ${this.versions.length + 1}`,
      createdAt: new Date().toISOString(),
      data: clone(this.official),
    };
    this.versions = [snapshot, ...this.versions];
    this.compareVersionId = snapshot.id;
    this.persist();
    this.notify('已锁定当前正式表版本');
  }

  @action
  createRevision(): void {
    const next = clone(this.official);
    next.scenes.forEach((scene) => {
      scene.locked = false;
    });
    next.updatedAt = new Date().toISOString();
    this.official = next;
    this.syncWorkingIfClean();
    this.persist();
    this.notify('已解除全部场次锁定，可建立可编辑修订');
  }

  // ---------- 变更单提交与裁决 ----------

  @action
  setAuthor(value: string): void {
    this.author = value;
    try {
      localStorage.setItem(AUTHOR_KEY, value);
    } catch {
      // 忽略持久化失败
    }
  }

  @action
  setOrderNote(value: string): void {
    this.orderNote = value;
  }

  @action
  setImportText(value: string): void {
    this.importText = value;
  }

  @action
  submitChangeOrder(): void {
    const author = this.author.trim() || '未署名';
    const changes = diffShowData(this.official, this.working);
    if (!changes.length) {
      this.notify('没有需要提交的改动');
      return;
    }
    const source = clone(this.working);
    const officialNow = clone(this.official);
    const order: ChangeOrder = {
      id: uid('order'),
      author,
      note: this.orderNote.trim(),
      createdAt: new Date().toISOString(),
      baseVersion: this.official.updatedAt,
      changes,
      status: 'pending',
      reason: '',
      mergedCount: 0,
      pendingCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
    };
    const result = ingestOrder({
      show: officialNow,
      pending: this.pending,
      order,
      source,
      external: false,
    });
    officialNow.updatedAt = new Date().toISOString();
    order.mergedCount = result.mergedCount;
    order.pendingCount = result.conflicts.length;
    order.status = result.conflicts.length ? 'pending' : 'merged';
    order.reason = result.conflicts.length
      ? `${result.conflicts.length} 项转入待裁决区`
      : '已直接并入正式表';

    this.official = officialNow;
    this.pending = [...this.pending, ...result.conflicts];
    this.orders = [order, ...this.orders];
    this.working = clone(officialNow);
    this.undoStack = [];
    this.redoStack = [];
    this.orderNote = '';
    this.ensureSelection();
    this.persist();
    this.notify(
      result.conflicts.length
        ? `变更单已保存：${result.mergedCount} 项合并，${result.conflicts.length} 项转入待裁决区`
        : `变更单已保存，${result.mergedCount} 项改动全部并入正式表`,
    );
  }

  @action
  discardWorkingChanges(): void {
    if (!this.isDirty) return;
    this.working = clone(this.official);
    this.undoStack = [];
    this.redoStack = [];
    this.draft = null;
    this.ensureSelection();
    this.persist();
    this.notify('已放弃未提交改动，工作副本回到正式表');
  }

  @action
  decidePending(item: PendingItem, accepted: boolean): void {
    this.resolveItems([item], [{ item, accepted }]);
  }

  @action
  acceptOrderGroup(orderId: string): void {
    const items = this.pending.filter((item) => item.orderId === orderId);
    this.resolveItems(
      items,
      items.map((item) => ({ item, accepted: true })),
    );
  }

  @action
  rejectOrderGroup(orderId: string): void {
    const items = this.pending.filter((item) => item.orderId === orderId);
    this.resolveItems(
      items,
      items.map((item) => ({ item, accepted: false })),
    );
  }

  private resolveItems(
    items: PendingItem[],
    decisions: PendingDecision[],
  ): void {
    if (!items.length) return;
    const official = clone(this.official);
    const outcome = resolvePending(official, items, decisions, undefined);
    official.updatedAt = new Date().toISOString();
    this.official = official;

    const acceptedIds = new Set(outcome.accepted.map((item) => item.id));
    const resolvedIds = new Set(items.map((item) => item.id));
    this.pending = this.pending.filter((item) => !resolvedIds.has(item.id));

    const counts = new Map<string, { accepted: number; rejected: number }>();
    items.forEach((item) => {
      const entry = counts.get(item.orderId) ?? { accepted: 0, rejected: 0 };
      if (acceptedIds.has(item.id)) entry.accepted += 1;
      else entry.rejected += 1;
      counts.set(item.orderId, entry);
    });
    this.orders = this.orders.map((order) => {
      const delta = counts.get(order.id);
      if (!delta) return order;
      const acceptedCount = order.acceptedCount + delta.accepted;
      const rejectedCount = order.rejectedCount + delta.rejected;
      const stillPending = this.pending.some(
        (item) => item.orderId === order.id,
      );
      return {
        ...order,
        acceptedCount,
        rejectedCount,
        status: stillPending
          ? 'pending'
          : rejectedCount > 0 && acceptedCount === 0 && order.mergedCount === 0
            ? 'rejected'
            : acceptedCount > 0 || order.mergedCount > 0
              ? 'accepted'
              : 'rejected',
      };
    });

    this.rebaseWorking(outcome.accepted.map((item) => item.change));
    this.ensureSelection();
    this.persist();
    this.notify(
      outcome.accepted.length
        ? `已采纳 ${outcome.accepted.length} 项并写入正式表`
        : '已驳回所选改动',
    );
  }

  // ---------- 外部变更单（他端保存 / 手工导入） ----------

  @action
  importOrder(): void {
    const text = this.importText.trim();
    if (!text) {
      this.notify('请先粘贴变更单 JSON');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.notify('变更单 JSON 无法解析');
      return;
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    let imported = 0;
    list.forEach((raw) => {
      const order = normalizeOrder(raw);
      if (order && this.ingestExternal(order)) imported += 1;
    });
    if (imported) {
      this.importText = '';
      this.notify(`已接收并处理 ${imported} 张外部变更单`);
    } else {
      this.notify('未找到有效的新变更单（可能已接收过）');
    }
  }

  @action
  exportOrder(order: ChangeOrder): void {
    this.importText = JSON.stringify(order, null, 2);
    this.notify('变更单 JSON 已填入下方接收框，可复制给其他设备');
  }

  private ingestExternal(order: ChangeOrder): boolean {
    if (this.orders.some((existing) => existing.id === order.id)) return false;
    const officialNow = clone(this.official);
    const result = ingestOrder({
      show: officialNow,
      pending: this.pending,
      order,
      external: true,
    });
    officialNow.updatedAt = new Date().toISOString();
    order.mergedCount = result.mergedCount;
    order.pendingCount = result.conflicts.length;
    order.status = result.conflicts.length ? 'pending' : 'merged';
    order.reason = result.conflicts.length
      ? `${result.conflicts.length} 项转入待裁决区`
      : '外部改动已并入正式表';
    this.official = officialNow;
    this.pending = [...this.pending, ...result.conflicts];
    this.orders = [order, ...this.orders];
    this.rebaseWorking(result.mergedChanges);
    this.ensureSelection();
    this.persist();
    return true;
  }

  /**
   * 把已并入正式表的他人改动跟进到脏工作副本：
   * 用户没碰过的字段直接同步；用户也改过的字段保留其值，留待提交时裁决。
   */
  private rebaseWorking(changes: FieldChange[]): void {
    if (!changes.length) {
      this.syncWorkingIfClean();
      return;
    }
    if (!this.isDirty) {
      this.working = clone(this.official);
      return;
    }
    const next = clone(this.working);
    const recalcScenes = new Set<string>();
    changes
      .filter((change) => !change.op || change.op === 'set')
      .forEach((change) => {
        // 工作副本中该字段仍等于变更单的旧值，说明用户没碰，安全跟进新值
        const current = readOfficial(next, change);
        if (current !== change.oldValue) return;
        const scene = applyChange(next, change);
        if (scene) recalcScenes.add(scene.id);
      });
    Array.from(recalcScenes).forEach((id) => {
      const scene = next.scenes.find((item) => item.id === id);
      if (scene) recalculateScene(scene);
    });
    this.working = next;
  }

  private handleStorage = (event: StorageEvent): void => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue) as Partial<StoredState>;
      const incomingOrders = (parsed.orders ?? []).filter(
        (order) => !this.orders.some((existing) => existing.id === order.id),
      );
      incomingOrders.forEach((raw) => {
        const order = normalizeOrder(raw);
        if (order) this.ingestExternal(order);
      });
    } catch {
      // 忽略无法解析的他端写入
    }
  };

  // ---------- 异常箱 ----------

  @action
  restoreCorrupt(record: CorruptRecord): void {
    if (record.level !== 'cue') return;
    const restored = restoreCue(record.raw);
    if (!restored) {
      this.notify('该记录无法修复');
      return;
    }
    this.mutate((show) => {
      const scene = show.scenes.find((item) => item.id === record.sceneId);
      if (!scene) {
        show.scenes.push({
          id: record.sceneId || uid('scene'),
          act: record.sceneLabel.split(' ')[0] || '未命名幕',
          name: record.sceneLabel.split(' ')[1] || 'S?',
          title: '异常修复场次',
          startTime: '19:30',
          locked: false,
          cues: [restored],
        });
      } else {
        const insertAt = Math.min(record.index, scene.cues.length);
        scene.cues.splice(insertAt, 0, restored);
        recalculateScene(scene);
      }
    });
    this.corrupt = this.corrupt.filter((item) => item.id !== record.id);
    this.selectedCueId = restored.id;
    this.persist();
    this.notify('损坏记录已用默认值修复并按原位置归位，请核对后提交');
  }

  @action
  discardCorrupt(record: CorruptRecord): void {
    this.corrupt = this.corrupt.filter((item) => item.id !== record.id);
    this.persist();
    this.notify('已从异常箱移除该记录');
  }

  // ---------- 撤销/重做 ----------

  @action
  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(clone(this.working));
    this.working = previous;
    this.ensureSelection();
    this.persist();
  }

  @action
  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this.working));
    this.working = next;
    this.ensureSelection();
    this.persist();
  }

  @action
  setSearch(value: string): void {
    this.search = value;
  }

  @action
  selectCompareVersion(version: VersionSnapshot): void {
    this.compareVersionId = version.id;
  }

  willDestroy(): void {
    super.willDestroy();
    window.removeEventListener('keydown', this.handleKeyboard);
    window.removeEventListener('storage', this.handleStorage);
  }

  // ---------- 内部 ----------

  private mutate(mutator: (show: ShowData) => void): void {
    this.undoStack.push(clone(this.working));
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
    const next = clone(this.working);
    mutator(next);
    next.updatedAt = new Date().toISOString();
    this.working = next;
    this.ensureSelection();
    this.persist();
  }

  private syncWorkingIfClean(): void {
    if (!this.isDirty) this.working = clone(this.official);
  }

  private ensureSelection(): void {
    if (!this.working.scenes.some((scene) => scene.id === this.activeSceneId))
      this.activeSceneId = this.working.scenes[0]?.id ?? '';
    if (!this.activeScene?.cues.some((item) => item.id === this.selectedCueId))
      this.selectedCueId = this.activeScene?.cues[0]?.id ?? '';
  }

  private persist(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          official: this.official,
          working: this.working,
          orders: this.orders,
          pending: this.pending,
          versions: this.versions,
          corrupt: this.corrupt,
          loadNotice: '',
        }),
      );
    } catch {
      // 存储已满或被禁用时仍保持内存可编辑
    }
  }

  private readAuthor(): string {
    try {
      return localStorage.getItem(AUTHOR_KEY) ?? '场务';
    } catch {
      return '场务';
    }
  }

  private notify(value: string, lifespan = 2400): void {
    this.message = value;
    window.setTimeout(() => {
      if (this.message === value) this.message = '';
    }, lifespan);
  }

  private handleKeyboard = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    const inEditor =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.tagName === 'SELECT';
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? this.redo() : this.undo();
      return;
    }
    if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.redo();
      return;
    }
    if (inEditor) return;
    if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveSelected(-1);
    } else if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      this.moveSelected(1);
    } else if (event.key.toLowerCase() === 'n') {
      event.preventDefault();
      this.createCueDraft();
    }
  };
}
