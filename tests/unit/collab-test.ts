import { module, test } from 'qunit';
import {
  applyPendingToShow,
  diffShow,
  formatFieldValue,
  threeWayMerge,
} from 'stage-cue-editor/lib/collab';
import type {
  Cue,
  PendingItem,
  Scene,
  ShowData,
} from 'stage-cue-editor/models/show';

function cue(id: string, title: string, extra: Partial<Cue> = {}): Cue {
  return {
    id,
    kind: '灯光',
    title,
    duration: 60,
    owner: '李岚',
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

function scene(
  id: string,
  title: string,
  cues: Cue[],
  extra: Partial<Scene> = {},
): Scene {
  return {
    id,
    act: '第一幕',
    name: 'S1',
    title,
    startTime: '19:30',
    locked: false,
    cues,
    ...extra,
  };
}

function show(scenes: Scene[]): ShowData {
  return {
    title: '提示表',
    venue: '剧场',
    date: '2026-10-18',
    scenes,
    updatedAt: '2026-10-18T00:00:00.000Z',
  };
}

module('Unit | lib/collab | threeWayMerge', () => {
  test('没碰同一字段的改动直接合并进正式表', (assert) => {
    const base = show([scene('s1', '第一场', [cue('c1', '原标题')])]);
    const local = show([
      scene('s1', '第一场', [cue('c1', '原标题', { lighting: '面光 60%' })]),
    ]);
    const incoming = show([
      scene('s1', '第一场', [cue('c1', '原标题', { sound: '古琴淡入' })]),
    ]);

    const result = threeWayMerge(base, local, incoming);

    assert.strictEqual(result.pending.length, 0, '无待裁决项');
    assert.strictEqual(
      result.merged.scenes[0]!.cues[0]!.lighting,
      '面光 60%',
      '本地灯光保留',
    );
    assert.strictEqual(
      result.merged.scenes[0]!.cues[0]!.sound,
      '古琴淡入',
      '外部音响并入',
    );
    assert.strictEqual(result.autoChanges.length, 1, '一条自动合并变更');
  });

  test('两边都改过同一字段且不一致 → 待裁决冲突', (assert) => {
    const base = show([scene('s1', '第一场', [cue('c1', '原标题')])]);
    const local = show([scene('s1', '第一场', [cue('c1', '本地标题')])]);
    const incoming = show([scene('s1', '第一场', [cue('c1', '外部标题')])]);

    const result = threeWayMerge(base, local, incoming);

    assert.strictEqual(result.pending.length, 1, '一条待裁决');
    assert.strictEqual(result.pending[0]!.reason, 'conflict', '原因是冲突');
    assert.strictEqual(result.pending[0]!.field, 'title', '字段是标题');
    assert.strictEqual(result.pending[0]!.localValue, '本地标题');
    assert.strictEqual(result.pending[0]!.incomingValue, '外部标题');
    assert.strictEqual(
      result.merged.scenes[0]!.cues[0]!.title,
      '本地标题',
      '未裁决前正式表保持本地值',
    );
  });

  test('两边把同一字段改成相同值 → 不冲突', (assert) => {
    const base = show([scene('s1', '第一场', [cue('c1', '原标题')])]);
    const local = show([scene('s1', '第一场', [cue('c1', '新标题')])]);
    const incoming = show([scene('s1', '第一场', [cue('c1', '新标题')])]);

    const result = threeWayMerge(base, local, incoming);

    assert.strictEqual(result.pending.length, 0);
    assert.strictEqual(result.merged.scenes[0]!.cues[0]!.title, '新标题');
  });

  test('只有外部改过 → 直接采用外部', (assert) => {
    const base = show([scene('s1', '第一场', [cue('c1', '原标题')])]);
    const local = show([scene('s1', '第一场', [cue('c1', '原标题')])]);
    const incoming = show([
      scene('s1', '第一场', [cue('c1', '外部标题', { owner: '陈默' })]),
    ]);

    const result = threeWayMerge(base, local, incoming);

    assert.strictEqual(result.pending.length, 0);
    assert.strictEqual(result.merged.scenes[0]!.cues[0]!.title, '外部标题');
    assert.strictEqual(result.merged.scenes[0]!.cues[0]!.owner, '陈默');
  });

  test('锁定场次收到的外部改动 → 进待裁决区', (assert) => {
    const base = show([
      scene('s1', '第一场', [cue('c1', '原标题')], { locked: true }),
    ]);
    const local = show([
      scene('s1', '第一场', [cue('c1', '原标题')], { locked: true }),
    ]);
    const incoming = show([
      scene('s1', '第一场', [cue('c1', '外部标题')], { locked: true }),
    ]);

    const result = threeWayMerge(base, local, incoming);

    assert.strictEqual(result.pending.length, 1);
    assert.strictEqual(
      result.pending[0]!.reason,
      'locked-scene',
      '原因是锁定场次',
    );
    assert.strictEqual(
      result.merged.scenes[0]!.cues[0]!.title,
      '原标题',
      '锁定场次未裁决前不动',
    );
  });

  test('锁定场次即使只改外部未碰字段也进待裁决', (assert) => {
    const base = show([
      scene('s1', '第一场', [cue('c1', '原标题')], { locked: true }),
    ]);
    const local = show([
      scene('s1', '第一场', [cue('c1', '原标题')], { locked: true }),
    ]);
    const incoming = show([
      scene('s1', '第一场', [cue('c1', '原标题', { sound: '外部音响' })], {
        locked: true,
      }),
    ]);

    const result = threeWayMerge(base, local, incoming);

    assert.strictEqual(result.pending.length, 1);
    assert.strictEqual(result.pending[0]!.reason, 'locked-scene');
    assert.strictEqual(
      result.merged.scenes[0]!.cues[0]!.sound,
      '',
      '锁定场次未裁决前不合并',
    );
  });

  test('外部新增的提示直接并入', (assert) => {
    const base = show([scene('s1', '第一场', [cue('c1', '原标题')])]);
    const local = show([scene('s1', '第一场', [cue('c1', '原标题')])]);
    const incoming = show([
      scene('s1', '第一场', [cue('c1', '原标题'), cue('c2', '新增提示')]),
    ]);

    const result = threeWayMerge(base, local, incoming);

    assert.strictEqual(result.pending.length, 0);
    assert.deepEqual(
      result.merged.scenes[0]!.cues.map((item) => item.id),
      ['c1', 'c2'],
    );
    assert.true(
      result.autoChanges.some((change) => change.fieldLabel === '新增提示'),
    );
  });

  test('外部新增场次直接并入', (assert) => {
    const base = show([scene('s1', '第一场', [])]);
    const local = show([scene('s1', '第一场', [])]);
    const incoming = show([
      scene('s1', '第一场', []),
      scene('s2', '第二场', []),
    ]);

    const result = threeWayMerge(base, local, incoming);

    assert.strictEqual(result.merged.scenes.length, 2);
    assert.strictEqual(result.merged.scenes[1]!.title, '第二场');
  });

  test('外部删除本地改过的提示 → 删除/修改冲突', (assert) => {
    const base = show([scene('s1', '第一场', [cue('c1', '原标题')])]);
    const local = show([scene('s1', '第一场', [cue('c1', '本地改过')])]);
    const incoming = show([scene('s1', '第一场', [])]);

    const result = threeWayMerge(base, local, incoming);

    assert.strictEqual(result.pending.length, 1);
    assert.strictEqual(result.pending[0]!.field, '*', '整条提示冲突');
    assert.strictEqual(
      result.merged.scenes[0]!.cues.length,
      1,
      '未裁决前保留本地提示',
    );
  });

  test('本地删除外部改过的提示 → 冲突且带提示定位，裁决采用外部后恢复', (assert) => {
    const base = show([scene('s1', '第一场', [cue('c1', '原标题')])]);
    const local = show([scene('s1', '第一场', [])]);
    const incoming = show([scene('s1', '第一场', [cue('c1', '外部改过')])]);

    const result = threeWayMerge(base, local, incoming);

    assert.strictEqual(result.pending.length, 1);
    assert.strictEqual(result.pending[0]!.field, '*');
    assert.strictEqual(result.pending[0]!.cueId, 'c1', '带提示 ID 定位');
    assert.strictEqual(
      result.pending[0]!.cueLabel,
      '外部改过',
      '带提示标题定位',
    );
    assert.strictEqual(
      result.merged.scenes[0]!.cues.length,
      0,
      '未裁决前不恢复',
    );

    applyPendingToShow(result.merged, result.pending[0]!, 'incoming');
    assert.strictEqual(result.merged.scenes[0]!.cues.length, 1);
    assert.strictEqual(result.merged.scenes[0]!.cues[0]!.title, '外部改过');
  });
});

module('Unit | lib/collab | applyPendingToShow', () => {
  test('裁决采用外部 → 写回外部值', (assert) => {
    const base = show([scene('s1', '第一场', [cue('c1', '原标题')])]);
    const local = show([scene('s1', '第一场', [cue('c1', '本地标题')])]);
    const incoming = show([scene('s1', '第一场', [cue('c1', '外部标题')])]);
    const result = threeWayMerge(base, local, incoming);
    const item = result.pending[0]!;

    applyPendingToShow(result.merged, item, 'incoming');

    assert.strictEqual(result.merged.scenes[0]!.cues[0]!.title, '外部标题');
  });

  test('裁决采用本地 → 保留正式表值', (assert) => {
    const base = show([scene('s1', '第一场', [cue('c1', '原标题')])]);
    const local = show([scene('s1', '第一场', [cue('c1', '本地标题')])]);
    const incoming = show([scene('s1', '第一场', [cue('c1', '外部标题')])]);
    const result = threeWayMerge(base, local, incoming);
    const item = result.pending[0]!;

    applyPendingToShow(result.merged, item, 'local');

    assert.strictEqual(result.merged.scenes[0]!.cues[0]!.title, '本地标题');
  });

  test('锁定场次裁决采用外部 → 外部值写回但仍锁定', (assert) => {
    const base = show([
      scene('s1', '第一场', [cue('c1', '原标题')], { locked: true }),
    ]);
    const local = show([
      scene('s1', '第一场', [cue('c1', '原标题')], { locked: true }),
    ]);
    const incoming = show([
      scene('s1', '第一场', [cue('c1', '外部标题')], { locked: true }),
    ]);
    const result = threeWayMerge(base, local, incoming);
    const item = result.pending[0]!;

    applyPendingToShow(result.merged, item, 'incoming');

    assert.strictEqual(result.merged.scenes[0]!.cues[0]!.title, '外部标题');
    assert.true(result.merged.scenes[0]!.locked, '场次仍保持锁定');
  });
});

module('Unit | lib/collab | diffShow', () => {
  test('记录字段级新旧值', (assert) => {
    const before = show([
      scene('s1', '第一场', [cue('c1', '原标题', { owner: '李岚' })]),
    ]);
    const after = show([
      scene('s1', '第一场', [cue('c1', '新标题', { owner: '陈默' })]),
    ]);

    const changes = diffShow(before, after);

    const titleChange = changes.find((change) => change.field === 'title');
    const ownerChange = changes.find((change) => change.field === 'owner');
    assert.ok(titleChange, '有标题变更');
    assert.strictEqual(titleChange!.oldValue, '原标题');
    assert.strictEqual(titleChange!.newValue, '新标题');
    assert.ok(ownerChange, '有负责人变更');
    assert.strictEqual(ownerChange!.oldValue, '李岚');
    assert.strictEqual(ownerChange!.newValue, '陈默');
  });

  test('无改动时返回空', (assert) => {
    const before = show([scene('s1', '第一场', [cue('c1', '原标题')])]);
    const after = show([scene('s1', '第一场', [cue('c1', '原标题')])]);

    assert.strictEqual(diffShow(before, after).length, 0);
  });
});

module('Unit | lib/collab | formatFieldValue', () => {
  test('数组用顿号连接，时长带秒', (assert) => {
    assert.strictEqual(
      formatFieldValue('props', ['折扇', '宫灯']),
      '折扇、宫灯',
    );
    assert.strictEqual(formatFieldValue('duration', 45), '45 秒');
    assert.strictEqual(formatFieldValue('owner', ''), '（空）');
    assert.strictEqual(formatFieldValue('title', null), '—');
  });
});

module('Unit | lib/collab | pending 结构', () => {
  test('待裁决项携带场次与提示定位', (assert) => {
    const base = show([scene('s1', '第一场', [cue('c1', '原标题')])]);
    const local = show([scene('s1', '第一场', [cue('c1', '本地')])]);
    const incoming = show([scene('s1', '第一场', [cue('c1', '外部')])]);
    const result = threeWayMerge(base, local, incoming);
    const item: PendingItem = result.pending[0]!;

    assert.strictEqual(item.sceneId, 's1');
    assert.strictEqual(item.cueId, 'c1');
    assert.strictEqual(item.fieldLabel, '提示标题');
    assert.ok(item.sceneLabel.includes('第一场'));
  });
});
