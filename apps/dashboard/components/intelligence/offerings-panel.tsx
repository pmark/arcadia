import type { IntelligenceOffering } from "../../lib/intelligence-types";

export function OfferingsPanel({
  textOfferings,
  imageOfferings,
}: {
  textOfferings: IntelligenceOffering[];
  imageOfferings: IntelligenceOffering[];
}) {
  return (
    <section className="grid gap-3 sm:grid-cols-2">
      <OfferingGroup title="Text generation" offerings={textOfferings} emptyText="No text-generation offerings are currently available." />
      <OfferingGroup title="Image generation" offerings={imageOfferings} emptyText="No image-generation offerings are currently available." />
    </section>
  );
}

function OfferingGroup({
  title,
  offerings,
  emptyText,
}: {
  title: string;
  offerings: IntelligenceOffering[];
  emptyText: string;
}) {
  return (
    <div className="rounded-md border border-line bg-panel p-4 shadow-soft">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {offerings.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{emptyText}</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {offerings.map((offering) => (
            <li key={offering.id} className="rounded-md border border-line p-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs text-ink">{offering.id}</span>
                <div className="flex flex-wrap gap-1.5">
                  <Badge>{offering.location}</Badge>
                  <Badge>{offering.profile}</Badge>
                  <Badge>{offering.executor === "codex-cli" ? "Codex" : "local model"}</Badge>
                  {offering.requiresPaidUsage ? <Badge tone="gold">paid usage</Badge> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Badge({ children, tone = "steel" }: { children: React.ReactNode; tone?: "steel" | "gold" }) {
  const toneClass =
    tone === "gold" ? "border-gold/30 bg-gold/10 text-gold" : "border-steel/30 bg-steel/10 text-steel";
  return (
    <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${toneClass}`}>{children}</span>
  );
}
