import { describe, expect, it } from "vitest";
import { sortPullRequestsNewestFirst } from "./pull-request-order";

const pr = (number: number, createdAt: string | null, updatedAt: string | null, repository = "owner/repo") => ({ number, createdAt, updatedAt, repository });

describe("newest-first PR display", () => {
  it("uses creation date instead of recent CI activity and leaves the source inventory untouched", () => {
    const older = Object.freeze(pr(1, "2026-10-12T12:00:00Z", "2026-10-14T12:00:00Z"));
    const newer = Object.freeze(pr(2, "2026-10-13T12:00:00Z", "2026-10-13T12:01:00Z"));
    const inventory = Object.freeze([older, newer]);
    const displayed = sortPullRequestsNewestFirst(inventory);
    expect(displayed).toEqual([newer, older]);
    expect(displayed).not.toBe(inventory);
    expect(inventory).toEqual([older, newer]);
  });

  it("falls back to update date for null/invalid creation dates and places undated PRs last", () => {
    expect(sortPullRequestsNewestFirst([
      pr(1, null, null), pr(2, "not a date", "2026-10-13T12:00:00Z"),
      pr(3, "2026-10-12T12:00:00Z", null), pr(4, null, "2026-10-14T12:00:00Z"),
      pr(5, null, "not a date")
    ]).map(pr => pr.number)).toEqual([4, 2, 3, 1, 5]);
  });

  it("breaks equal timestamps by repository then PR number regardless of input order", () => {
    const date = "2026-10-13T12:00:00Z";
    const inventory = [pr(10, date, null, "z/repo"), pr(9, date, null, "a/repo"), pr(2, date, "2026-10-15T12:00:00Z", "a/repo")];
    const expected = [inventory[2], inventory[1], inventory[0]];
    expect(sortPullRequestsNewestFirst(inventory)).toEqual(expected);
    expect(sortPullRequestsNewestFirst([...inventory].reverse())).toEqual(expected);
  });
});
