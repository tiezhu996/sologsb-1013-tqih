import type {
  Cue,
  CueKind,
  ExceptionRecord,
  Scene,
  ShowData,
} from 'stage-cue-editor/models/show';
import { CUE_KINDS } from 'stage-cue-editor/models/show';
import { isCueKind, makeException, nowIso, sceneLabelOf } from './collab';

export interface LegacyLoadResult {
  show: ShowData;
  exceptions: ExceptionRecord[];
  sceneCount: number;
  cueCount: number;
}

const DEFAULT_START_TIME = '20:00';

function splitList(value: string): string[] {
  return value
    .split(/[、,，;；]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

interface CueValidation {
  cue?: Cue;
  reasons: string[];
  cueId?: string;
  cueTitle?: string;
}

/** 校验单条提示；字段损坏时返回原因，记录进异常箱 */
function validateCue(raw: unknown): CueValidation {
  const reasons: string[] = [];
  if (typeof raw !== 'object' || raw === null) {
    return { reasons: ['记录不是对象'], cueId: undefined, cueTitle: undefined };
  }
  const record = raw as Record<string, unknown>;

  const cueId =
    typeof record['id'] === 'string' && record['id'].trim()
      ? record['id']
      : undefined;
  const cueTitle =
    typeof record['title'] === 'string' ? record['title'] : undefined;

  if (!cueId) reasons.push('id 缺失或不是字符串');
  if (!isCueKind(record['kind']))
    reasons.push(
      `kind「${String(record['kind'])}」不是合法提示类型（${CUE_KINDS.join('/')}）`,
    );
  if (typeof record['title'] !== 'string' || !record['title'].trim())
    reasons.push('title 缺失或为空');

  const duration = Number(record['duration']);
  if (!Number.isFinite(duration) || duration < 0) {
    reasons.push(`duration「${String(record['duration'])}」不是非负数字`);
  }

  if (record['owner'] !== undefined && typeof record['owner'] !== 'string')
    reasons.push('owner 不是字符串');
  for (const field of ['lighting', 'sound', 'notes'] as const) {
    if (record[field] !== undefined && typeof record[field] !== 'string') {
      reasons.push(`${field} 不是字符串`);
    }
  }

  const listFields = ['props', 'cast', 'dependsOn'] as const;
  const lists: Record<string, string[]> = {};
  for (const field of listFields) {
    const value = record[field];
    if (value === undefined) {
      lists[field] = [];
    } else if (Array.isArray(value)) {
      if (value.every((entry) => typeof entry === 'string')) {
        lists[field] = value.map((entry) => entry.trim()).filter(Boolean);
      } else {
        reasons.push(`${field} 数组中混有非字符串元素`);
      }
    } else if (typeof value === 'string') {
      lists[field] = splitList(value);
    } else {
      reasons.push(`${field} 不是数组或字符串`);
    }
  }

  if (reasons.length) {
    return { reasons, cueId, cueTitle };
  }

  const cue: Cue = {
    id: cueId as string,
    kind: record['kind'] as CueKind,
    title: (record['title'] as string).trim(),
    duration: Math.max(1, Math.round(duration)),
    owner: typeof record['owner'] === 'string' ? record['owner'] : '',
    lighting: typeof record['lighting'] === 'string' ? record['lighting'] : '',
    sound: typeof record['sound'] === 'string' ? record['sound'] : '',
    props: lists['props'] ?? [],
    cast: lists['cast'] ?? [],
    notes: typeof record['notes'] === 'string' ? record['notes'] : '',
    dependsOn: lists['dependsOn'] ?? [],
    offset: 0,
  };
  return { cue, reasons: [] };
}

function cleanString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function recalc(scene: Scene): void {
  let elapsed = 0;
  scene.cues.forEach((cue) => {
    cue.offset = elapsed;
    elapsed += Number(cue.duration) || 0;
  });
}

/**
 * 载入旧版提示表：按原顺序保留场次与提示；
 * 字段损坏的记录抽进异常箱，其余场次照常编辑。
 */
export function loadLegacySheet(
  raw: unknown,
  source = '旧版提示表',
): LegacyLoadResult {
  const exceptions: ExceptionRecord[] = [];
  const scenes: Scene[] = [];
  let cueCount = 0;

  if (
    typeof raw !== 'object' ||
    raw === null ||
    !Array.isArray((raw as ShowData).scenes)
  ) {
    exceptions.push(
      makeException({
        source,
        sceneLabel: '整场文件',
        reason: '旧版文件缺少 scenes 数组或不是有效对象',
        raw,
      }),
    );
    return {
      show: {
        title: '未命名演出',
        venue: '',
        date: '',
        scenes: [],
        updatedAt: nowIso(),
      },
      exceptions,
      sceneCount: 0,
      cueCount: 0,
    };
  }

  const data = raw as Partial<ShowData>;

  (data.scenes as Scene[]).forEach((rawScene, sceneIndex) => {
    if (typeof rawScene !== 'object' || rawScene === null) {
      exceptions.push(
        makeException({
          source,
          sceneLabel: `第 ${sceneIndex + 1} 场`,
          reason: '场次记录不是对象',
          raw: rawScene,
        }),
      );
      return;
    }
    const record = rawScene as unknown as Record<string, unknown>;
    const sceneId =
      typeof record['id'] === 'string' && record['id'].trim()
        ? record['id']
        : undefined;
    if (!sceneId || !Array.isArray(record['cues'])) {
      exceptions.push(
        makeException({
          source,
          sceneId,
          sceneLabel: cleanString(record['title'], `第 ${sceneIndex + 1} 场`),
          reason: !sceneId ? '场次缺少 id' : '场次 cues 字段不是数组',
          raw: record,
        }),
      );
      return;
    }

    const scene: Scene = {
      id: sceneId,
      act: cleanString(record['act'], ''),
      name: cleanString(record['name'], `S${sceneIndex + 1}`),
      title: cleanString(record['title'], '未命名场次'),
      startTime: /^\d{1,2}:\d{2}$/.test(String(record['startTime']))
        ? String(record['startTime'])
        : DEFAULT_START_TIME,
      locked: Boolean(record['locked']),
      cues: [],
    };

    (record['cues'] as unknown[]).forEach((rawCue) => {
      const result = validateCue(rawCue);
      if (result.cue) {
        scene.cues.push(result.cue);
        cueCount += 1;
      } else {
        exceptions.push(
          makeException({
            source,
            sceneId: scene.id,
            sceneLabel: sceneLabelOf(scene),
            cueId: result.cueId,
            cueLabel: result.cueTitle,
            reason: result.reasons.join('；'),
            raw: rawCue,
          }),
        );
      }
    });

    recalc(scene);
    scenes.push(scene);
  });

  const show: ShowData = {
    title: cleanString(data.title, '未命名演出'),
    venue: cleanString(data.venue, ''),
    date: cleanString(data.date, ''),
    scenes,
    updatedAt: nowIso(),
  };
  return { show, exceptions, sceneCount: scenes.length, cueCount };
}
