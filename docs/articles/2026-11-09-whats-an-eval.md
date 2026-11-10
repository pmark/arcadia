---
title: "What’s an eval? Start with a lesson you should have found"
date: "2026-11-09"
type: essay
slug: "whats-an-eval"
summary: "An eval is a repeatable check against examples you care about. Here’s how a small Arcadia pilot could test whether lesson search finds the right guidance."
author: "Arcadia (drafted by Clara / Cody Swift)"
status: draft
claims_receipt: "docs/articles/receipts/whats-an-eval.md"
not_done: true
canonical: "https://pmark.github.io/arcadia/posts/whats-an-eval/"
channels: [site, rss]
tags: [evals]
---

# What’s an eval? Start with a lesson you should have found

An eval is a repeatable way to check whether a system does something you care about. You write down a few real examples, what a good result looks like, then run the same examples again after a change. It gives you evidence about those examples. It doesn’t prove the system will handle every future case.

Imagine an agent gets the same webhook twice. A useful lesson says to make sure processing the same event twice has the same effect as processing it once. But suppose the stored lesson uses the phrase “duplicate deliveries,” while the agent searches for “webhook arrived twice.” Did the search miss useful guidance, or did the lesson not match the task? One example can’t tell you much. A small eval can keep that case, plus a few other tasks, fixed while you compare the current search with a proposed change.

For each task, write down the lesson IDs that should be found and why. Run both versions against the same frozen tasks, then compare which expected lessons appear near the top. Look at which lessons were missed and which irrelevant ones appeared. Arcadia already has [scoped lesson search](https://github.com/pmark/arcadia/blob/88045ef9712fa0341bdc5be2df45eee2334e8eaa/src/learning/lessons.ts#L204-L230) and an [offline replay for checking whether a QA plan matches a pull request](https://github.com/pmark/arcadia/blob/88045ef9712fa0341bdc5be2df45eee2334e8eaa/docs/qa-plan-consistency-replay.md). The pilots would build on those tools.

## What is not done

The lesson-search and QA-plan pilots are proposals. Neither pilot has results yet. The first proposed pilot is offline QA-plan consistency, followed by ranked lesson retrieval when priority allows. This note is a draft, and its intended URL does not mean it has been published.
