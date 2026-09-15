import assert from "node:assert/strict";
import test from "node:test";
import { isWellFormedRange, parseByteRange } from "./range.ts";

const SIZE = 1000;

test("iOS 的 0-1 探测必须解析成两字节区间", () => {
  // Safari / iOS Chrome 播放前都会先发这一条，拿不到 206 就直接不播。
  assert.deepEqual(parseByteRange("bytes=0-1", SIZE), { start: 0, end: 1 });
});

test("开区间 `bytes=N-` 取到文件末尾", () => {
  assert.deepEqual(parseByteRange("bytes=500-", SIZE), { start: 500, end: 999 });
});

test("闭区间原样保留，末尾越界会被夹到最后一字节", () => {
  assert.deepEqual(parseByteRange("bytes=0-99", SIZE), { start: 0, end: 99 });
  assert.deepEqual(parseByteRange("bytes=900-5000", SIZE), { start: 900, end: 999 });
});

test("后缀写法 `bytes=-N` 取最后 N 个字节", () => {
  assert.deepEqual(parseByteRange("bytes=-200", SIZE), { start: 800, end: 999 });
  // N 大于文件长度时取整份，而不是算出负数起点。
  assert.deepEqual(parseByteRange("bytes=-5000", SIZE), { start: 0, end: 999 });
});

test("起点越界返回 null（调用方据此回 416）", () => {
  assert.equal(parseByteRange("bytes=1000-", SIZE), null);
  assert.equal(parseByteRange("bytes=9999-10000", SIZE), null);
});

test("多段 Range 退化成整文件，而不是只回第一段", () => {
  // 规范允许忽略多段请求；只回第一段会让 Content-Length 与实际字节对不上。
  assert.equal(parseByteRange("bytes=0-1,5-6", SIZE), null);
});

test("畸形与非字节单位一律忽略", () => {
  assert.equal(parseByteRange("bytes=abc", SIZE), null);
  assert.equal(parseByteRange("bytes=-", SIZE), null);
  assert.equal(parseByteRange("items=0-1", SIZE), null);
  assert.equal(parseByteRange(null, SIZE), null);
  assert.equal(parseByteRange("", SIZE), null);
});

test("起止倒序视为不可满足", () => {
  assert.equal(parseByteRange("bytes=500-100", SIZE), null);
});

test("长度为 0 时一律不按区间响应，避免算出非法区间", () => {
  assert.equal(parseByteRange("bytes=0-1", 0), null);
});

test("只有格式正确但不可满足的 Range 才该回 416", () => {
  assert.equal(isWellFormedRange("bytes=9999-"), true);
  assert.equal(isWellFormedRange("bytes=0-1"), true);
  // 畸形输入应当被忽略并回整文件，而不是 416。
  assert.equal(isWellFormedRange("bytes=abc"), false);
  assert.equal(isWellFormedRange("bytes=0-1,5-6"), false);
  assert.equal(isWellFormedRange(null), false);
});
