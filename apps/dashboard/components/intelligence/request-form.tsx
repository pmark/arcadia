"use client";

import { useMemo, useState } from "react";
import { STRUCTURED_TEXT_PRESETS } from "../../lib/intelligence-presets";
import type {
  AdminOutputMode,
  AdminSubmission,
  IntelligenceOffering,
} from "../../lib/intelligence-types";

type Mode = "text" | "image";

export function RequestForm({
  textOfferings,
  imageOfferings,
  disabled,
  onSubmit,
}: {
  textOfferings: IntelligenceOffering[];
  imageOfferings: IntelligenceOffering[];
  disabled: boolean;
  onSubmit: (submission: AdminSubmission) => void;
}) {
  const [mode, setMode] = useState<Mode>("text");

  return (
    <section className="rounded-md border border-line bg-panel p-4 shadow-soft">
      <div className="flex gap-2">
        <ModeButton active={mode === "text"} onClick={() => setMode("text")}>
          Text generation
        </ModeButton>
        <ModeButton active={mode === "image"} onClick={() => setMode("image")}>
          Image generation
        </ModeButton>
      </div>

      {mode === "text" ? (
        <TextForm offerings={textOfferings} disabled={disabled} onSubmit={onSubmit} />
      ) : (
        <ImageForm offerings={imageOfferings} disabled={disabled} onSubmit={onSubmit} />
      )}
    </section>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-9 rounded-md border px-3 text-sm font-semibold transition ${
        active ? "border-moss/40 bg-moss/10 text-moss" : "border-line text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function TextForm({
  offerings,
  disabled,
  onSubmit,
}: {
  offerings: IntelligenceOffering[];
  disabled: boolean;
  onSubmit: (submission: AdminSubmission) => void;
}) {
  const [offeringId, setOfferingId] = useState(offerings[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [outputMode, setOutputMode] = useState<AdminOutputMode>("structured");
  const [presetId, setPresetId] = useState(STRUCTURED_TEXT_PRESETS[0]!.id);
  const [label, setLabel] = useState("");
  const [paidConfirmed, setPaidConfirmed] = useState(false);

  const offering = useMemo(() => offerings.find((item) => item.id === offeringId), [offerings, offeringId]);
  const requiresPaidConfirmation = Boolean(offering?.requiresPaidUsage);
  const canSubmit = Boolean(offering) && prompt.trim().length > 0 && (!requiresPaidConfirmation || paidConfirmed) && !disabled;

  if (offerings.length === 0) {
    return <p className="mt-4 text-sm text-muted">No text-generation offerings are currently available to test.</p>;
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!offering || !canSubmit) return;
    onSubmit({
      capability: "text.generate",
      offeringId: offering.id,
      execution: offering.location === "local" ? "local-required" : "cloud-required",
      profile: offering.profile,
      prompt,
      outputMode,
      presetId: outputMode === "structured" ? presetId : undefined,
      label: label.trim() || undefined,
      allowPaidUsage: requiresPaidConfirmation && paidConfirmed,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 grid gap-3">
      <Field label="Offering">
        <select
          value={offeringId}
          onChange={(event) => {
            setOfferingId(event.target.value);
            setPaidConfirmed(false);
          }}
          className="min-h-10 rounded-md border border-line bg-canvas px-3 text-sm"
        >
          {offerings.map((item) => (
            <option key={item.id} value={item.id}>
              {item.id} ({item.location}/{item.profile}{item.executor === "codex-cli" ? ", Codex" : ""}
              {item.requiresPaidUsage ? ", paid" : ""})
            </option>
          ))}
        </select>
      </Field>

      <Field label="Prompt">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          className="rounded-md border border-line bg-canvas px-3 py-2 text-sm"
          placeholder="Enter a test prompt…"
        />
      </Field>

      <Field label="Output mode">
        <div className="flex gap-2">
          <RadioPill checked={outputMode === "structured"} onClick={() => setOutputMode("structured")}>
            Structured JSON
          </RadioPill>
          <RadioPill checked={outputMode === "plain"} onClick={() => setOutputMode("plain")}>
            Plain text
          </RadioPill>
        </div>
      </Field>

      {outputMode === "structured" ? (
        <Field label="Schema preset">
          <select
            value={presetId}
            onChange={(event) => setPresetId(event.target.value)}
            className="min-h-10 rounded-md border border-line bg-canvas px-3 text-sm"
          >
            {STRUCTURED_TEXT_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label} — {preset.description}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <Field label="Label / note (optional)">
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          className="min-h-10 rounded-md border border-line bg-canvas px-3 text-sm"
          placeholder="e.g. local fast-route smoke test"
        />
      </Field>

      {requiresPaidConfirmation ? <PaidUsageConfirm checked={paidConfirmed} onChange={setPaidConfirmed} /> : null}

      <SubmitButton disabled={!canSubmit} />
    </form>
  );
}

function ImageForm({
  offerings,
  disabled,
  onSubmit,
}: {
  offerings: IntelligenceOffering[];
  disabled: boolean;
  onSubmit: (submission: AdminSubmission) => void;
}) {
  const [offeringId, setOfferingId] = useState(offerings[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(1);
  const [label, setLabel] = useState("");
  const [paidConfirmed, setPaidConfirmed] = useState(false);

  const offering = useMemo(() => offerings.find((item) => item.id === offeringId), [offerings, offeringId]);
  const requiresPaidConfirmation = Boolean(offering?.requiresPaidUsage);
  const canSubmit = Boolean(offering) && prompt.trim().length > 0 && (!requiresPaidConfirmation || paidConfirmed) && !disabled;

  if (offerings.length === 0) {
    return <p className="mt-4 text-sm text-muted">No image-generation offerings are currently available to test.</p>;
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!offering || !canSubmit) return;
    onSubmit({
      capability: "image.generate",
      offeringId: offering.id,
      execution: offering.location === "local" ? "local-required" : "cloud-required",
      profile: offering.profile,
      prompt,
      count,
      label: label.trim() || undefined,
      allowPaidUsage: requiresPaidConfirmation && paidConfirmed,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 grid gap-3">
      <Field label="Offering">
        <select
          value={offeringId}
          onChange={(event) => {
            setOfferingId(event.target.value);
            setPaidConfirmed(false);
          }}
          className="min-h-10 rounded-md border border-line bg-canvas px-3 text-sm"
        >
          {offerings.map((item) => (
            <option key={item.id} value={item.id}>
              {item.id} ({item.location}/{item.profile}{item.executor === "codex-cli" ? ", Codex" : ""}
              {item.requiresPaidUsage ? ", paid" : ""})
            </option>
          ))}
        </select>
      </Field>

      <Field label="Image prompt">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={2}
          className="rounded-md border border-line bg-canvas px-3 py-2 text-sm"
          placeholder="Describe the image to generate…"
        />
      </Field>

      <Field label="Image count (max 4)">
        <input
          type="number"
          min={1}
          max={4}
          value={count}
          onChange={(event) => setCount(Math.min(4, Math.max(1, Number(event.target.value) || 1)))}
          className="min-h-10 w-24 rounded-md border border-line bg-canvas px-3 text-sm"
        />
      </Field>

      <Field label="Label / note (optional)">
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          className="min-h-10 rounded-md border border-line bg-canvas px-3 text-sm"
          placeholder="e.g. Codex image executor smoke test"
        />
      </Field>

      {requiresPaidConfirmation ? <PaidUsageConfirm checked={paidConfirmed} onChange={setPaidConfirmed} /> : null}

      <SubmitButton disabled={!canSubmit} />
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

function RadioPill({
  checked,
  onClick,
  children,
}: {
  checked: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-9 rounded-md border px-3 text-sm font-medium transition ${
        checked ? "border-steel/40 bg-steel/10 text-steel" : "border-line text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function PaidUsageConfirm({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 rounded-md border border-gold/30 bg-gold/10 p-3 text-sm text-gold">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5" />
      <span>
        This offering requires <strong>paid usage</strong>. I confirm I want to spend paid cloud capacity to run this test.
      </span>
    </label>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="min-h-10 rounded-md border border-moss/30 bg-moss/10 px-3 text-sm font-semibold text-moss transition hover:border-moss disabled:cursor-not-allowed disabled:opacity-60"
    >
      Submit test job
    </button>
  );
}
