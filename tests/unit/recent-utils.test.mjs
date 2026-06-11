import test from "node:test";
import assert from "node:assert/strict";
import { mergeUniqueIds } from "../../assets/utils/recent-utils.js";

const cases = [
  {
    name: "preserves order and removes duplicates",
    primary: ["a", "b", "a"],
    secondary: ["b", "c", "d"],
    expected: ["a", "b", "c", "d"]
  },
  {
    name: "skips null/undefined",
    primary: ["a", null, "b"],
    secondary: [undefined, "c"],
    expected: ["a", "b", "c"]
  },
  {
    name: "handles empty arrays",
    primary: [],
    secondary: [],
    expected: []
  },
  {
    name: "handles only primary",
    primary: ["x", "y"],
    secondary: [],
    expected: ["x", "y"]
  },
  {
    name: "handles only secondary",
    primary: [],
    secondary: ["x", "y"],
    expected: ["x", "y"]
  },
  {
    name: "dedupes within primary",
    primary: ["x", "x", "x"],
    secondary: [],
    expected: ["x"]
  },
  {
    name: "dedupes within secondary",
    primary: [],
    secondary: ["x", "x", "y"],
    expected: ["x", "y"]
  },
  {
    name: "dedupes across arrays",
    primary: ["x", "y"],
    secondary: ["y", "z"],
    expected: ["x", "y", "z"]
  },
  {
    name: "keeps falsy but valid values",
    primary: ["", 0, false],
    secondary: ["", 0, true],
    expected: ["", 0, false, true]
  },
  {
    name: "handles numeric ids",
    primary: [1, 2, 3],
    secondary: [3, 4],
    expected: [1, 2, 3, 4]
  },
  {
    name: "handles mixed types",
    primary: ["1", 1],
    secondary: ["1", 2],
    expected: ["1", 1, 2]
  },
  {
    name: "preserves order of first occurrence",
    primary: ["b", "a"],
    secondary: ["a", "b", "c"],
    expected: ["b", "a", "c"]
  },
  {
    name: "handles long duplicates",
    primary: ["a", "b", "c", "a", "b"],
    secondary: ["b", "d", "a", "e"],
    expected: ["a", "b", "c", "d", "e"]
  },
  {
    name: "drops null in secondary only",
    primary: ["a"],
    secondary: [null, "b"],
    expected: ["a", "b"]
  },
  {
    name: "drops undefined in primary only",
    primary: [undefined, "a"],
    secondary: ["b"],
    expected: ["a", "b"]
  },
  {
    name: "keeps unicode strings",
    primary: ["привет", "мир"],
    secondary: ["мир", "код"],
    expected: ["привет", "мир", "код"]
  },
  {
    name: "handles zero length strings",
    primary: [""],
    secondary: [""],
    expected: [""]
  },
  {
    name: "does not coerce ids",
    primary: ["0"],
    secondary: [0],
    expected: ["0", 0]
  },
  {
    name: "keeps boolean true/false",
    primary: [true],
    secondary: [false, true],
    expected: [true, false]
  },
  {
    name: "handles NaN as value",
    primary: [NaN],
    secondary: [NaN],
    expected: [NaN]
  },
  {
    name: "handles repeated NaN with others",
    primary: [NaN, "a"],
    secondary: ["a", NaN, "b"],
    expected: [NaN, "a", "b"]
  },
  {
    name: "handles whitespace strings",
    primary: [" ", "  "],
    secondary: [" ", "\t"],
    expected: [" ", "  ", "\t"]
  },
  {
    name: "handles ids with spaces",
    primary: ["a b", "c"],
    secondary: ["a b", "d"],
    expected: ["a b", "c", "d"]
  },
  {
    name: "handles ids with punctuation",
    primary: ["a-1", "b_2"],
    secondary: ["b_2", "c.3"],
    expected: ["a-1", "b_2", "c.3"]
  },
  {
    name: "handles large lists without mutation",
    primary: ["a", "b", "c"],
    secondary: ["c", "d", "e"],
    expected: ["a", "b", "c", "d", "e"]
  },
  {
    name: "ignores nulls in both arrays",
    primary: [null, "a"],
    secondary: [null, "b"],
    expected: ["a", "b"]
  },
  {
    name: "ignores undefined in both arrays",
    primary: [undefined, "a"],
    secondary: [undefined, "b"],
    expected: ["a", "b"]
  },
  {
    name: "keeps negative numbers",
    primary: [-1, -2],
    secondary: [-2, -3],
    expected: [-1, -2, -3]
  },
  {
    name: "handles floats",
    primary: [1.1, 2.2],
    secondary: [2.2, 3.3],
    expected: [1.1, 2.2, 3.3]
  },
  {
    name: "handles duplicate booleans",
    primary: [false, false],
    secondary: [false, true],
    expected: [false, true]
  },
  {
    name: "keeps first occurrence from primary when duplicate in secondary",
    primary: ["x", "y"],
    secondary: ["x", "z"],
    expected: ["x", "y", "z"]
  }
];

cases.forEach(({ name, primary, secondary, expected }) => {
  test(`mergeUniqueIds ${name}`, () => {
    const result = mergeUniqueIds(primary, secondary);
    assert.notEqual(result, primary);
    assert.notEqual(result, secondary);
    if (expected.some((value) => Number.isNaN(value))) {
      assert.equal(result.length, expected.length);
      expected.forEach((value, index) => {
        if (Number.isNaN(value)) {
          assert.ok(Number.isNaN(result[index]));
        } else {
          assert.equal(result[index], value);
        }
      });
      return;
    }
    assert.deepEqual(result, expected);
  });
});
