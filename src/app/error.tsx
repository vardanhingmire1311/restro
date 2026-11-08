"use client";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <h1 className="display text-4xl">That screen failed</h1>
      <p className="mt-3 text-[#b7b1a8]">{error.message || "Try it again."}</p>
      <button type="button" className="mt-4 rounded-full bg-[#ff9933] px-4 py-2 font-semibold text-[#1a1208]" onClick={reset}>Try again</button>
    </main>
  );
}
