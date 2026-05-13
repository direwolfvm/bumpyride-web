export default function Home() {
  return (
    <main style={{ maxWidth: 640 }}>
      <h1 style={{ marginTop: 0 }}>BumpyRide</h1>
      <p>
        Companion web app for the BumpyRide iOS app. Sign-in, ride list, route
        view, and bump map are coming in later phases. The sync API is wired up.
      </p>
      <ul>
        <li>
          <code>GET /api/health</code> — liveness check
        </li>
        <li>
          <code>POST /api/sync/ride</code> — accepts a single ride payload
          (schema in <code>bumpy-ride/docs/SCHEMA.md</code>)
        </li>
      </ul>
    </main>
  );
}
