import { module, test } from 'qunit';
import type { ShowData } from 'stage-cue-editor/models/show';
import {
  sanitizeShow,
  restoreCue,
  loadLegacyShow,
} from 'stage-cue-editor/utils/legacy-loader';

function fallback(): ShowData {
  return {
    title: '兜底',
    venue: '',
    date: '',
    updatedAt: '',
    scenes: [],
  };
}

function validCue(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'c1',
    kind: '灯光',
    title: '面光起',
    duration: 30,
    owner: '李岚',
    lighting: '面光 60%',
    sound: '',
    props: ['面光灯'],
    cast: [],
    notes: '',
    dependsOn: [],
    ...overrides,
  };
}

module('Unit | 旧版提示表载入', function () {
  test('完整场次按原顺序载入', function (assert) {
    const source = {
      title: '旧版演出',
      scenes: [
        {
          id: 's1',
          act: '第一幕',
          name: 'S1',
          title: '第一场',
          startTime: '19:30',
          locked: false,
          cues: [validCue(), validCue({ id: 'c2', title: '第二条' })],
        },
      ],
    };
    const { data, corrupt } = sanitizeShow(source, fallback());
    assert.strictEqual(corrupt.length, 0, '无异常');
    assert.deepEqual(
      data.scenes[0]!.cues.map((cue) => cue.id),
      ['c1', 'c2'],
      '原顺序保留',
    );
    assert.strictEqual(data.scenes[0]!.cues[1]!.offset, 30, '偏移重算');
  });

  test('单条提示字段损坏进入异常箱，其余照常载入', function (assert) {
    const source = {
      scenes: [
        {
          id: 's1',
          act: '第一幕',
          name: 'S1',
          title: '第一场',
          startTime: '19:30',
          cues: [
            validCue({ id: 'good' }),
            validCue({ id: 'bad', duration: '不是数字', owner: 42 }),
            validCue({ id: 'good2', title: '第三条' }),
          ],
        },
      ],
    };
    const { data, corrupt } = sanitizeShow(source, fallback());
    assert.strictEqual(corrupt.length, 1, '一条进异常箱');
    assert.deepEqual(
      corrupt[0]!.fields,
      ['时长（秒）', '负责人'],
      '记录损坏字段',
    );
    assert.strictEqual(corrupt[0]!.cueId, 'bad');
    assert.strictEqual(corrupt[0]!.index, 1, '保留原始位置');
    assert.deepEqual(
      data.scenes[0]!.cues.map((cue) => cue.id),
      ['good', 'good2'],
      '其余提示照常载入且顺序不乱',
    );
  });

  test('异常箱记录可用默认值修复归位', function (assert) {
    const raw = validCue({ id: 'bad', duration: '损坏' });
    const restored = restoreCue(raw);
    assert.ok(restored, '可重建');
    assert.strictEqual(restored!.id, 'bad', '保留原 ID');
    assert.strictEqual(restored!.duration, 60, '损坏字段回退默认');
    assert.strictEqual(restored!.title, '面光起', '完好字段保留');
  });

  test('v1 存储结构（{ show, versions }）可迁移', function (assert) {
    const raw = JSON.stringify({
      show: { title: '旧表', scenes: [] },
      versions: [
        { id: 'v1', name: '锁定版 1', createdAt: '', data: { title: 'x' } },
      ],
    });
    const result = loadLegacyShow(raw, fallback());
    assert.true(result.migrated);
    assert.strictEqual(result.data.title, '旧表');
  });

  test('整份 JSON 损坏时回退初始数据，不抛异常', function (assert) {
    const result = loadLegacyShow('{不是合法JSON', fallback());
    assert.false(result.migrated);
    assert.strictEqual(result.data.title, '兜底');
  });
});
