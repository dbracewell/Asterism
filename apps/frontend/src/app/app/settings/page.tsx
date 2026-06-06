"use client";

export default function SettingsPage() {
  return (
    <>
      {Array.from({ length: 20000 }).map((_, i) => (
        <div className="h-10" key={i}>
          {i}
        </div>
      ))}
    </>
  );
}
