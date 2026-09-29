import { module, test } from 'qunit';
import type {
  ChangeOrder,
  FieldChange,
  PendingDecision,
} from 'stage-cue-editor/models/change';
import type { ShowData } from 'stage-cue-editor/models/show';
import {
  ingestOrder,
  resolvePending,
} from 'stage-cue-editor/utils/change-merge';
import { uid } from 'stage-cue-editor/utils/id';

function cue(id: string, owner = '李岚', duration = 60) {
  return {
    id,
    kind: '灯光' as const,
    title: `提示 ${id}`,
    duration,
    owner,
    lighting: '',
    sound: '',
    props: [],
    cast: [],
    notes: '',
    dependsOn: [],
    offset: 0,
  };
}

function show(): ShowData {
  return {
    title: '演出',
    venue: 'A 厅',
    date: '2026-10-18',
    updatedAt: 'base',
    scenes: [
      {
        id: 'scene-1',
        act: '第一幕',
        name: 'S1',
        title: '第一场',
        startTime: '19:30',
        locked: false,
        cues: [cue('c1'), cue('c2', '陈默', 90)],
      },
    ],
  };
}

function order(changes: FieldChange[], author = '周启'): ChangeOrder {
  return {
    id: uid('order'),
    author,
    note: '',
    createdAt: new Date(0).toISOString(),
    baseVersion: 'base',
    changes,
    status: 'pending',
    reason: '',
    mergedCount: 0,
    pendingCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
  };
}

const ownerChange = (oldValue: string, newValue: string): FieldChange => ({
  sceneLabel: '第一幕 S1',
  sceneId: 'scene-1',
  cueId: 'c1',
  cueTitle: '提示 c1',
  level: 'cue',
  field: 'owner',
  fieldLabel: '负责人',
  oldValue,
  newValue,
});

const titleChange = (oldValue: string, newValue: string): FieldChange => ({
  sceneLabel: '第一幕 S1',
  sceneId: 'scene-1',
  cueId: 'c1',
  cueTitle: '提示 c1',
  level: 'cue',
  field: 'title',
  fieldLabel: '提示标题',
  oldValue,
  newValue,
});

module('Unit | 变更单合并', function () {
  test('没碰同一字段的改动直接合并', function (assert) {
    const official = show();
    const result = ingestOrder({
      show: official,
      pending: [],
      order: order([titleChange('提示 c1', '新标题')]),
    });
    assert.strictEqual(result.mergedCount, 1, '一项合并');
    assert.strictEqual(result.conflicts.length, 0, '无冲突');
    assert.strictEqual(
      official.scenes[0]!.cues[0]!.title,
      '新标题',
      '正式表已更新',
    );
  });

  test('后一张单改了已被前单改过的字段，转入待裁决区', function (assert) {
    const official = show();
    const first = ingestOrder({
      show: official,
      pending: [],
      order: order([ownerChange('李岚', '赵一帆')]),
    });
    assert.strictEqual(first.conflicts.length, 0);

    const second = ingestOrder({
      show: official,
      pending: first.conflicts,
      order: order([ownerChange('李岚', '孙禾')], '陈默'),
    });
    assert.strictEqual(second.mergedCount, 0, '同字段不合并');
    assert.strictEqual(second.conflicts.length, 1, '进入待裁决');
    assert.strictEqual(
      official.scenes[0]!.cues[0]!.owner,
      '赵一帆',
      '正式表保留先合并的值',
    );
  });

  test('同一张单里不同字段互不影响', function (assert) {
    const official = show();
    const first = ingestOrder({
      show: official,
      pending: [],
      order: order([ownerChange('李岚', '赵一帆')]),
    });
    const second = ingestOrder({
      show: official,
      pending: first.conflicts,
      order: order([titleChange('提示 c1', '另一个标题')], '陈默'),
    });
    assert.strictEqual(second.mergedCount, 1, '另一字段直接合并');
    assert.strictEqual(official.scenes[0]!.cues[0]!.title, '另一个标题');
    assert.strictEqual(official.scenes[0]!.cues[0]!.owner, '赵一帆');
  });

  test('锁定场次收到的外部改动留在待裁决区', function (assert) {
    const official = show();
    official.scenes[0]!.locked = true;
    const result = ingestOrder({
      show: official,
      pending: [],
      order: order([ownerChange('李岚', '赵一帆')]),
      external: true,
    });
    assert.strictEqual(result.mergedCount, 0, '锁定场次不自动合并');
    assert.strictEqual(result.conflicts.length, 1);
    assert.true(result.conflicts[0]!.locked, '条目标记为锁定来源');
    assert.strictEqual(
      official.scenes[0]!.cues[0]!.owner,
      '李岚',
      '正式表未变',
    );
  });

  test('场务采纳后才写入正式表，驳回不写入', function (assert) {
    const official = show();
    const first = ingestOrder({
      show: official,
      pending: [],
      order: order([ownerChange('李岚', '赵一帆')]),
    });
    const allPending = [...first.conflicts];
    const second = ingestOrder({
      show: official,
      pending: allPending,
      order: order([ownerChange('李岚', '孙禾')], '陈默'),
    });
    allPending.push(...second.conflicts);
    assert.strictEqual(allPending.length, 1, '只有第二张单的同字段改动待裁决');

    const decisions: PendingDecision[] = [
      { item: allPending[0]!, accepted: false },
    ];
    const rejected = resolvePending(official, allPending, decisions);
    assert.strictEqual(rejected.accepted.length, 0);
    assert.strictEqual(
      official.scenes[0]!.cues[0]!.owner,
      '赵一帆',
      '驳回后保留先合并值',
    );

    const accepted = resolvePending(official, allPending, [
      { item: allPending[0]!, accepted: true },
    ]);
    assert.strictEqual(accepted.accepted.length, 1);
    assert.strictEqual(
      official.scenes[0]!.cues[0]!.owner,
      '孙禾',
      '采纳后写入正式表',
    );
  });

  test('相同结果重复到达时幂等合并', function (assert) {
    const official = show();
    const first = ingestOrder({
      show: official,
      pending: [],
      order: order([ownerChange('李岚', '赵一帆')]),
    });
    assert.strictEqual(first.mergedCount, 1);
    const second = ingestOrder({
      show: official,
      pending: [],
      order: order([ownerChange('李岚', '赵一帆')], '陈默'),
    });
    assert.strictEqual(second.conflicts.length, 0, '相同新值不构成冲突');
    assert.strictEqual(second.mergedCount, 1, '计为已合并');
  });

  test('合并字段改动后场内偏移自动重算', function (assert) {
    const official = show();
    const durationChange: FieldChange = {
      ...ownerChange('60', '120'),
      cueId: 'c1',
      field: 'duration',
      fieldLabel: '时长（秒）',
      oldValue: '60',
      newValue: '120',
    };
    ingestOrder({
      show: official,
      pending: [],
      order: order([durationChange]),
    });
    assert.strictEqual(
      official.scenes[0]!.cues[1]!.offset,
      120,
      '后续提示顺延',
    );
  });
});
