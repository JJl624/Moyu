const { test } = require("node:test"), assert = require("node:assert/strict");
const { compareText } = require("../shared/content-diff.mjs"),
  { diffAnchors, mapDiffOffset } = require("../shared/diff-anchors.mjs");
test("Diff scrolling aligns common text through inserted, deleted, replaced and Unicode runs", () => {
  for (
    const [left, right] of [["a\nb\nc\n", "a\nc\n"], ["a\nc\n", "a\nb\nc\n"], ["same\nold\nend", "same\nnew\nend"], [
      "中文🙂\nold\n末尾",
      "中文🙂\n末尾",
    ], ["old", "new"]]
  ) {
    const anchors = diffAnchors(compareText(left, right));
    for (const anchor of anchors) {
      assert.equal(left.slice(anchor.a, anchor.a + anchor.length), right.slice(anchor.b, anchor.b + anchor.length));
      for (let i = 0; i < anchor.length; i++) {
        assert.equal(mapDiffOffset(anchors, anchor.a + i), anchor.b + i);
        assert.equal(mapDiffOffset(anchors, anchor.b + i, "b"), anchor.a + i);
      }
    }
    let previous = -1;
    for (let i = 0; i <= left.length; i++) {
      const mapped = mapDiffOffset(anchors, i);
      if (mapped === undefined) continue;
      assert(mapped >= previous && mapped <= right.length);
      previous = mapped;
    }
  }
});
