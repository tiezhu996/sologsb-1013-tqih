import { module, test } from 'qunit';
import { loadLegacySheet } from 'stage-cue-editor/lib/legacy';

interface LegacyFixtureScene {
  id?: string;
  act?: string;
  name?: string;
  title?: string;
  startTime?: string;
  locked?: boolean;
  cues: unknown[];
}

interface LegacyFixture {
  title?: string;
  venue?: string;
  date?: string;
  scenes: LegacyFixtureScene[];
}

function validSheet(): LegacyFixture {
  return {
    title: '旧版提示表',
    venue: '老剧场',
    date: '2026-09-01',
    scenes: [
      {
        id: 'old-s1',
        act: '第一幕',
        name: 'S1',
        title: '序场',
        startTime: '19:00',
        locked: false,
        cues: [
          {
            id: 'old-c1',
            kind: '灯光',
            title: '面光起',
            duration: 30,
            owner: '李岚',
            props: [],
            cast: [],
          },
          {
            id: 'old-c2',
            kind: '音响',
            title: '古琴入',
            duration: 60,
            owner: '陈默',
            props: '',
            cast: '',
          },
        ],
      },
    ],
  };
}

module('Unit | lib/legacy | loadLegacySheet', () => {
  test('旧版提示表按原顺序载入', (assert) => {
    const result = loadLegacySheet(validSheet(), '测试');

    assert.strictEqual(result.sceneCount, 1);
    assert.strictEqual(result.cueCount, 2);
    assert.strictEqual(result.exceptions.length, 0);
    assert.strictEqual(result.show.scenes[0]!.id, 'old-s1');
    assert.deepEqual(
      result.show.scenes[0]!.cues.map((cue) => cue.id),
      ['old-c1', 'old-c2'],
      '提示顺序保持不变',
    );
    assert.strictEqual(result.show.title, '旧版提示表');
  });

  test('字段损坏的提示进异常箱，其余提示照常载入', (assert) => {
    const raw = validSheet();
    raw.scenes[0]!.cues = [
      {
        id: 'ok-1',
        kind: '灯光',
        title: '正常提示',
        duration: 30,
        owner: '李岚',
      },
      { id: 'bad-1', kind: '不存在的类型', title: '损坏提示', duration: 30 },
      { id: 'bad-2', kind: '音响', title: '时长损坏', duration: '三十秒' },
      { kind: '道具', title: '缺 id', duration: 20 },
      {
        id: 'ok-2',
        kind: '演员',
        title: '另一条正常',
        duration: 45,
        owner: '赵一帆',
      },
    ];

    const result = loadLegacySheet(raw, '测试');

    assert.strictEqual(result.cueCount, 2, '只有两条正常提示进正式表');
    assert.deepEqual(
      result.show.scenes[0]!.cues.map((cue) => cue.id),
      ['ok-1', 'ok-2'],
      '损坏提示被抽走，正常提示顺序不变',
    );
    assert.strictEqual(result.exceptions.length, 3, '三条损坏记录进异常箱');
    const reasons = result.exceptions.map((ex) => ex.reason).join('|');
    assert.ok(reasons.includes('kind'), '异常原因包含 kind');
    assert.ok(reasons.includes('duration'), '异常原因包含 duration');
    assert.ok(reasons.includes('id'), '异常原因包含 id');
    assert.ok(
      result.exceptions.every((ex) => ex.sceneLabel.includes('序场')),
      '异常记录带场次定位',
    );
  });

  test('场次缺少 id 时整场进异常箱', (assert) => {
    const raw: LegacyFixture = {
      title: '旧版',
      scenes: [
        {
          title: '无 id 场次',
          cues: [{ id: 'c1', kind: '灯光', title: '提示', duration: 10 }],
        },
        { id: 's-ok', title: '正常场次', cues: [] },
      ],
    };

    const result = loadLegacySheet(raw, '测试');

    assert.strictEqual(result.sceneCount, 1, '只有正常场次载入');
    assert.strictEqual(result.show.scenes[0]!.id, 's-ok');
    assert.strictEqual(result.exceptions.length, 1);
    assert.ok(result.exceptions[0]!.reason.includes('id'));
  });

  test('props 为字符串时按顿号拆分', (assert) => {
    const raw = validSheet();
    raw.scenes[0]!.cues = [
      {
        id: 'c1',
        kind: '道具',
        title: '道具提示',
        duration: 20,
        props: '折扇、宫灯',
        cast: '侍女甲，侍女乙',
      },
    ];

    const result = loadLegacySheet(raw, '测试');

    assert.strictEqual(result.cueCount, 1);
    assert.deepEqual(result.show.scenes[0]!.cues[0]!.props, ['折扇', '宫灯']);
    assert.deepEqual(result.show.scenes[0]!.cues[0]!.cast, [
      '侍女甲',
      '侍女乙',
    ]);
  });

  test('duration 为数字字符串时按数字载入', (assert) => {
    const raw = validSheet();
    raw.scenes[0]!.cues = [
      { id: 'c1', kind: '灯光', title: '提示', duration: '90' },
    ];

    const result = loadLegacySheet(raw, '测试');

    assert.strictEqual(result.show.scenes[0]!.cues[0]!.duration, 90);
  });

  test('完全无效的文件返回空表并记异常', (assert) => {
    const result = loadLegacySheet({ foo: 'bar' }, '测试');

    assert.strictEqual(result.sceneCount, 0);
    assert.strictEqual(result.exceptions.length, 1);
    assert.ok(result.exceptions[0]!.raw.includes('foo'));
  });

  test('载入后重算提示偏移', (assert) => {
    const raw = validSheet();
    raw.scenes[0]!.cues = [
      { id: 'c1', kind: '灯光', title: '第一条', duration: 30 },
      { id: 'c2', kind: '音响', title: '第二条', duration: 45 },
    ];

    const result = loadLegacySheet(raw, '测试');

    assert.strictEqual(result.show.scenes[0]!.cues[0]!.offset, 0);
    assert.strictEqual(result.show.scenes[0]!.cues[1]!.offset, 30);
  });
});
