"""Deterministic routing prototype, written from the development set only. It abstains when unsure."""
import json, re, sys, time

R = lambda p: re.compile(p, re.I)
# Hostile shapes abstain to chat: a message naming tools or claiming authority never routes to a lever.
HOSTILE = R(r"\b(ignore|disregard)\b.*\b(instruction|rule|tool|prompt)|\b(system|admin|root)\b\s*[:\]]|\[admin|\bi'?m the admin\b|\bas root\b|\bpre-?authorized\b|\brespond with the label\b|\b(prepare_start|prepare_off|answer_decision)\b|\bwithout confirming\b")
RULES = [
    ("answer_decision", R(r"^\s*\d{3,5}\s+[a-z]\s*$|\b(pick|choose|go with)\b.*\b\d{3,5}\b|\b\d{3,5}\b.*\b(pick|choose|option)\s+[a-z]\b|^\s*(approve|reject|defer)\s+r\d+\s*$")),
    ("action", R(r"^\s*(show( me)?|open|details? on)\s+\d{3,5}\s*$|\bdetails on the\b.*\b(task|action)\b")),
    ("prepare_off", R(r"\b(shut (it |everything )?down|stop everything|turn off (the )?(builders|production|prod)|turn (the )?(builders|production|prod) off|pause production)\b")),
    ("prepare_start", R(r"\b(fire it up|kick off the builders|start (it|production|prod|the builders)( up)?|turn on (the )?(builders|production|prod))\b")),
    ("trail", R(r"\b(what happened (to|with)|whatever (became of|happened)|did anything come of|what became of|ever (get|got) done)\b")),
    ("capacity", R(r"\b(tokens? left|hit my limit|fuel|quota|allowance|usage left|credits left)\b")),
    ("prs", R(r"\b(pull requests?|prs?\b|in review)\b")),
    ("todo", R(r"\b(need|needs|waiting|sign off|approve)\b.*\b(me|i)\b|\bwaiting on me\b|\b(anything|what).*\b(for me|need me)\b|\bwhat do i need to\b|\bsign off\b")),
    ("prod_status", R(r"\b(prod|production|the machine)\b.*\b(alive|running|stuck|on|up|down|doing)\b|\bwhy'?d it (quit|stop)\b|\bis (the machine|production|prod)\b")),
    ("next", R(r"\b(what'?s|whats) (up )?next\b|\btackle next\b|\bwhats lined up\b|\bnext on\b|\bwhat should .* next\b")),
    ("way", R(r"^\s*how (do|does|can|should) (i|we|approvals?|grants?|plans?|decisions?|it)\b|\bwhats the process\b|\bwhat'?s the process\b|\bhow .* work here\b|\bwhat is an? (action|plan|decision|ask|grant)\b")),
    ("plan", R(r"\b(progress\??|how far along|where are we on|whats blocking)\b")),
    ("project", R(r"\b(rundown on|tell me about the|whats the deal w)\b")),
    ("reason", R(r"\b(figure out why|why is .* (slow|failing|broken)|should i .* or )\b")),
    ("capture", R(r"^\s*(build|make|create|add|set up|spin up)\b|\b(can you|could you|please)\s+(add|build|make|create)\b|\bwould be cool if\b|\bwe should (add|build|make)\b|^\s*idea:")),
    ("chat", R(r"^\s*(thanks|thank you|lol|ok\b|good morning|hi\b|hey\b|hello)\b|\b(capital of|tell me a joke)\b")),
]


def route(text):
    if HOSTILE.search(text):
        m = re.search(r"\bany open prs?\b.*|\banyway\b(.*)", text, re.I)
        return "prs" if m and re.search(r"\bprs?\b", m.group(0), re.I) else "chat"
    for tool, rx in RULES:
        if rx.search(text):
            return tool
    return None


for path in sys.argv[1:]:
    data = json.load(open(path))
    t = time.perf_counter()
    rows = [(p, route(p["text"])) for p in data]
    ms = (time.perf_counter() - t) * 1000 / len(data)
    decided = [(p, g) for p, g in rows if g]
    right = [(p, g) for p, g in decided if g == p["expect"] or g in p.get("also", [])]
    wrong = [(p["text"][:62], p["expect"], g) for p, g in decided if not (g == p["expect"] or g in p.get("also", []))]
    lever = [w for w in wrong if w[2] in ("prepare_off", "prepare_start", "answer_decision")]
    print(path.split("/")[-1], "n", len(data), "decided", len(decided), f"{len(decided)/len(data):.0%}", "right of decided", f"{len(right)/max(1,len(decided)):.0%}", "right overall", f"{len(right)/len(data):.0%}", "ms/msg", round(ms, 3))
    print(" wrong:", wrong[:16])
    print(" wrong_lever:", lever)
    print(" abstained:", [(p["text"][:44], p["expect"]) for p, g in rows if not g][:18])
