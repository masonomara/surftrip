import type { MetaFunction } from "react-router";

export const meta: MetaFunction = () => {
  return [
    { title: "Docket" },
    { name: "description", content: "AI case management for law firms" },
  ];
};

export default function Index() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>Docket</h1>
      <p>AI case management for law firms using Clio.</p>
    </main>
  );
}
