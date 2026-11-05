"""How often would a short deterministic menu contain the right tool? Vocabulary written from the dev set only."""
import importlib.util, json, re, sys

src = open(sys.argv[1]).read().split("for path in sys.argv")[0]
ns = {}
exec(src, ns)
route = ns["route"]
STOP = set("a an the i me my we us our is are was were be been do does did to of on in at for with and or it its this that what whats what's how why can could would should you your any anything got have has had just so ok please pls about from up out get give show tell".split())
VOCAB = {
    "todo": "need needs waiting approve sign off attention decide pending review owe blocked me today",
    "next": "next lined after tackle coming upcoming then queue",
    "prod_status": "prod production machine running alive stuck quit stopped overnight moving builders status down up on",
    "capacity": "tokens limit fuel left allowance quota usage budget claude credits",
    "project": "project rundown deal about site app details overview",
    "plan": "plan progress far along blocking rewrite migration status done finished where",
    "action": "action task one details exactly id ticket item",
    "trail": "happened became request asked idea sent earlier last week come ever",
    "way": "how process work works approvals arcadia what mean explain pause add setup rule",
    "prs": "pr prs pull requests review green merge merged open",
    "prepare_off": "stop shut down turn off pause halt vacation bed",
    "prepare_start": "start fire kick begin turn on resume again ready",
    "answer_decision": "decision option pick choose go with answer approve reject defer",
    "capture": "build make add create want new would cool idea toggle page landing feature need site app",
    "reason": "why figure should compare slow failing investigate afford split keep diagnose",
    "chat": "thanks hey hello morning lol capital joke recommend",
}
V = {t: set(w for w in s.split()) for t, s in VOCAB.items()}


def stem(w):
    return re.sub(r"(ing|ed|es|s)$", "", w) if len(w) > 4 else w


def rank(text):
    toks = [stem(w) for w in re.findall(r"[a-z0-9']+", text.lower()) if w not in STOP]
    scores = {}
    for tool, words in V.items():
        ws = {stem(w) for w in words}
        scores[tool] = sum(1 for t in toks if t in ws)
    return sorted((t for t, s in scores.items() if s > 0), key=lambda t: (-scores[t], t))


data = json.load(open(sys.argv[2]))
ab = [p for p in data if not route(p["text"])]
wrongrule = [p for p in data if route(p["text"]) and not (route(p["text"]) == p["expect"] or route(p["text"]) in p.get("also", []))]
for name, rows in (("rules abstained", ab), ("rules wrong", wrongrule), ("all", data)):
    res = {1: 0, 2: 0, 3: 0, 4: 0}
    empty = 0
    for p in rows:
        r = rank(p["text"])
        if not r:
            empty += 1
        good = {p["expect"], *p.get("also", [])}
        for k in res:
            res[k] += bool(good & set(r[:k]))
    print(name, "n", len(rows), "top1..4", [f"{res[k]/max(1,len(rows)):.0%}" for k in res], "no candidate", empty)
print("examples:", [(p["text"][:40], rank(p["text"])[:3], p["expect"]) for p in ab[:6]])
