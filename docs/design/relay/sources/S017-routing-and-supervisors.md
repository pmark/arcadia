# S017: Operator's direction on routing and supervisors, 2026-11-02

Verbatim, in the order given.

## Local model's job

> I'm encouraged by these results, but I want to make sure that what we're offering is actually useful. I'm thinking that the local model will be there mostly for routing and to use tools, especially the deterministic tools provided by Arcadia. So I think of it like I was saying before, it is basically a chatbot that understands how to find Arcadia related information. And is very context aware when discussing issues concerning the operator's projects, plans, and actions. It also should be able to use all of the tools and levers available for managing production, given that so far production is not finished or online, but it should be easy to manage through skills. Are we on the same page? Am I thinking of this properly? I'm honestly wanting to know what the best route forward is here.

## Streamlined language, Ask first, pluggable engines

> I think we're converging on the right idea. Something I want to throw out there is that if we make the relay local AI's job as easy as possible with a totally streamlined input-output language that does not even need to be very human-friendly or at all, then possibly we could use a larger Qwen model, or one that is good at using tools. That said, remember that the Arcadia ask functionality is already pretty good at extracting intent. And I'm thinking it should be the first part of the workflow, so that a purely deterministic and fast check can happen and maybe even route directly to a frontier model when necessary. So that's also where I think a tool like Jev or maybe Laya could come in to route these requests to either a fast local AI model or other deterministic scripts and programs and utilities, or all the way to a cloud model.
>
> But again, we will not be adding a decision engine like Laya or Jev in right now. But I think it makes sense for us to design this part of the Arcadia routing system with those powerful tools in mind as pluggable.

## Ask's reach and warm supervisors

> It just seems like we should be able to improve Arcadia Ask in important ways so that it's handling at least 50% and hopefully 80% of the requests.
>
> One idea I'd like to submit here is the idea that coding agents now have a handoff skill that they should be able to use reliably so that the operator doesn't need to worry as much, or hopefully at all, about long context management. Given that, then it seems like Relay could make use of some, I'll say, warm or hot coding agent sessions that act as a supervisor for each project. That way, there's a path for getting very rich data from a very context-aware coding agent in communication with a local model or interfacing directly from an Ask request.
