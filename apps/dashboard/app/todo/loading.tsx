/** Shown at once while a to-do page loads, which can take a while. */
export default function Loading() {
  return <main style={{ padding: "24px 16px", fontFamily: "system-ui, sans-serif" }}>
    <p role="status" aria-live="polite">Opening your to-do list...</p>
  </main>;
}
