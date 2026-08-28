import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useEffect, useState } from "react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Fetch active content translation jobs
  const activeJobs = await prisma.contentTranslationJob.findMany({
    where: { shop: session.shop, status: { in: ["active", "pending"] } },
    orderBy: { updatedAt: "desc" },
  });

  // eslint-disable-next-line no-undef
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    activeJobs: activeJobs.map((j) => ({
      id: j.id,
      targetLocale: j.targetLocale,
      resourceType: j.resourceType,
      status: j.status,
      completedItems: j.completedItems,
      totalItems: j.totalItems,
    })),
  };
};

function ActiveJobsWidget({ jobs }: { jobs: Array<{ id: string; targetLocale: string; resourceType: string; status: string; completedItems: number; totalItems: number }> }) {
  const [open, setOpen] = useState(false);
  const activeCount = jobs.length;

  if (activeCount === 0 && !open) return null;

  const progress = (job: { completedItems: number; totalItems: number }) =>
    job.totalItems ? Math.round((job.completedItems / job.totalItems) * 100) : 0;

  const resourceLabel = (rt: string) => {
    if (rt === "ALL") return "Full store";
    if (rt === "ALL_FORCE") return "Force re-translate";
    if (rt === "ALL_MISSING") return "Missing only";
    return rt;
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          width: 56,
          height: 56,
          borderRadius: "50%",
          border: "none",
          background: activeCount > 0 ? "#0066cc" : "#616161",
          color: "#fff",
          fontSize: 20,
          cursor: "pointer",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        aria-label="Active translations"
      >
        {activeCount > 0 ? (
          <span style={{ position: "relative" }}>
            ⟳
            <span style={{
              position: "absolute",
              top: -8,
              right: -10,
              background: "#c50f0f",
              color: "#fff",
              fontSize: 11,
              fontWeight: 700,
              borderRadius: "50%",
              width: 18,
              height: 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>{activeCount}</span>
          </span>
        ) : "✓"}
      </button>

      {/* Popup */}
      {open && (
        <div style={{
          position: "fixed",
          bottom: 90,
          right: 20,
          width: 360,
          maxHeight: 400,
          overflowY: "auto",
          background: "#fff",
          borderRadius: 12,
          boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
          border: "1px solid #ebebeb",
          zIndex: 1000,
          padding: 16,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <strong style={{ fontSize: 15 }}>Translation status</strong>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#999" }}>×</button>
          </div>

          {activeCount === 0 ? (
            <p style={{ color: "#616161", fontSize: 13, textAlign: "center", padding: "20px 0" }}>No active translations.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {jobs.map((job) => (
                <div key={job.id} style={{ border: "1px solid #ebebeb", borderRadius: 8, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <strong style={{ fontSize: 14 }}>{job.targetLocale}</strong>
                    <span style={{ fontSize: 11, color: "#0066cc", fontWeight: 600, textTransform: "uppercase" }}>{job.status}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#616161", marginBottom: 6 }}>{resourceLabel(job.resourceType)}</div>
                  <div style={{ width: "100%", height: 6, background: "#ebebeb", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{
                      width: `${progress(job)}%`,
                      height: "100%",
                      background: "#0066cc",
                      transition: "width 0.3s ease",
                    }} />
                  </div>
                  <div style={{ fontSize: 11, color: "#616161", marginTop: 4 }}>
                    {job.completedItems} / {job.totalItems} ({progress(job)}%)
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default function App() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof loader>();

  // Poll for active job updates every 3 seconds when there are active jobs
  const hasActive = data.activeJobs.length > 0;
  useEffect(() => {
    if (!hasActive) return;
    const interval = setInterval(() => {
      fetcher.load("/app");
    }, 3000);
    return () => clearInterval(interval);
  }, [hasActive]); // eslint-disable-line react-hooks/exhaustive-deps

  const jobs = fetcher.data?.activeJobs ?? data.activeJobs;

  return (
    <AppProvider embedded apiKey={data.apiKey}>
      <s-app-nav>
        <s-link href="/app/languages">Languages</s-link>
        <s-link href="/app?view=locales">Locale files</s-link>
        <s-link href="/app/translations">Content</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet />
      <ActiveJobsWidget jobs={jobs} />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
