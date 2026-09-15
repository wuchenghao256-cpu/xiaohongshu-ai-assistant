import assert from "node:assert/strict";
import test from "node:test";
import {
  canUseSystemShare,
  classifyShareOutcome,
  composeFinalCopy,
  coverCandidates,
  FALLBACK_NOTICE,
  missingSelection,
  prepareButtonLabel,
  shareVideoFileName,
} from "./xiaohongshu-publish.ts";

test("最终文案按 标题 / 正文 / 话题 三段拼装", () => {
  assert.equal(
    composeFinalCopy({ title: "标题", body: "正文", hashtags: ["好物", "#分享"] }),
    "标题\n\n正文\n\n#好物 #分享",
  );
});

test("最终文案跳过空段落，单个井号不会被重复添加", () => {
  assert.equal(composeFinalCopy({ title: "", body: "只有正文", hashtags: [] }), "只有正文");
  assert.equal(composeFinalCopy({ title: "标题", body: "", hashtags: ["#好物"] }), "标题\n\n#好物");
});

test("视频文件名是 ASCII 且以 .mp4 结尾", () => {
  const name = shareVideoFileName("a1b2c3d4-1111-2222-3333-444455556666");
  assert.equal(name, "xiaohongshu-video-a1b2c3d4.mp4");
  assert.match(name, /^[\x20-\x7e]+$/);
});

test("任务 ID 不含可用字符时仍然给出合法的文件名", () => {
  assert.equal(shareVideoFileName("----"), "xiaohongshu-video-clip.mp4");
});

test("必须同时具备 share 与 canShare 才算支持系统分享", () => {
  assert.equal(canUseSystemShare(() => {}, () => true), true);
  assert.equal(canUseSystemShare(() => {}, undefined), false);
  assert.equal(canUseSystemShare(undefined, () => true), false);
  assert.equal(canUseSystemShare(null, null), false);
});

test("成功分享没有 error", () => {
  assert.deepEqual(classifyShareOutcome(null), { kind: "shared" });
  assert.deepEqual(classifyShareOutcome(undefined), { kind: "shared" });
});

test("用户取消分享面板不算失败", () => {
  // 真正的 DOMException 在 node 里可以直接构造，形状与浏览器一致。
  assert.deepEqual(classifyShareOutcome(new DOMException("cancelled", "AbortError")), { kind: "cancelled" });
  // 有些实现抛的是普通对象，只能按 name 判断。
  assert.deepEqual(classifyShareOutcome({ name: "AbortError" }), { kind: "cancelled" });
});

test("分享面板打不开时回退成下载", () => {
  assert.deepEqual(classifyShareOutcome({ name: "NotAllowedError", message: "需要用户手势" }), {
    kind: "fallback",
    reason: "需要用户手势",
  });
  // 没有 message 时也要给出一句可读的原因，不能显示 undefined。
  assert.deepEqual(classifyShareOutcome({ name: "NotAllowedError" }), {
    kind: "fallback",
    reason: "系统分享面板无法打开。",
  });
});

test("主按钮从不写「自动发布」", () => {
  for (const state of ["idle", "preparing", "sharing"] as const) {
    const label = prepareButtonLabel(state);
    assert.doesNotMatch(label, /自动发布/);
    assert.ok(label.length > 0);
  }
  assert.equal(prepareButtonLabel("idle"), "一键准备发布");
});

test("缺少选择时给出可执行的提示", () => {
  assert.equal(missingSelection(null, "copy"), "请先选择一条已生成的视频。");
  assert.equal(missingSelection("video", null), "请先选择一条已生成的文案。");
  assert.equal(missingSelection(null, null), "请先选择一条已生成的视频。");
  assert.equal(missingSelection("video", "copy"), null);
});

test("回退提示同时说明视频与文案的去向", () => {
  assert.match(FALLBACK_NOTICE, /视频已保存/);
  assert.match(FALLBACK_NOTICE, /文案已复制/);
  assert.match(FALLBACK_NOTICE, /小红书/);
});

test("封面候选合并视频首帧与文案配图，视频排在前面", () => {
  const covers = coverCandidates({
    videoFrames: [{ id: "v1", url: "https://x/v1.jpg", label: "首帧" }],
    copyImages: [{ id: "c1", url: "https://x/c1.jpg", label: "配图" }],
  });
  assert.deepEqual(covers.map((cover) => [cover.id, cover.source]), [["v1", "video"], ["c1", "copy"]]);
});

test("封面候选去重，且丢弃没有地址的项", () => {
  const covers = coverCandidates({
    videoFrames: [
      { id: "same", url: "https://x/a.jpg", label: "首帧" },
      { id: "gone", url: "", label: "签名失败" },
    ],
    copyImages: [{ id: "same", url: "https://x/a.jpg", label: "重复" }],
  });
  assert.deepEqual(covers.map((cover) => cover.id), ["same"]);
});

test("没有任何候选时封面列表为空（界面据此收起整个区块）", () => {
  assert.deepEqual(coverCandidates({}), []);
});
