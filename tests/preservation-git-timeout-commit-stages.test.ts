import { describeStageStalls } from "./preservationTimeoutFixture.js";

describeStageStalls("a stalled git call at every replay, recheck and commit stage", [
  ["preserve.replay"], ["preserve.replay", "HEAD^{tree}"],
  ["preserve.recheck-snapshot"], ["preserve.recheck-binding"],
  ["preserve.commit"], ["preserve.commit", "commit-tree"], ["preserve.commit", "update-ref"]
]);
