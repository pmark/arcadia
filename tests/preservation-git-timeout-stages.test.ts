import { describeStageStalls } from "./preservationTimeoutFixture.js";

describeStageStalls("a stalled git call at every binding, validation and pre-snapshot stage", [
  ["binding.resolve"], ["binding.manual"],
  ["validation.binding"], ["validation.snapshot"], ["validation.snapshot", "hash-object"],
  ["validation.check-definitions", "ls-tree"], ["validation.check-definitions", "cat-file"],
  ["validation.materialize", "cat-file"], ["validation.recheck-binding"], ["validation.recheck-snapshot"],
  ["preserve.preconditions"], ["preserve.snapshot"], ["preserve.snapshot", "write-tree"]
]);
