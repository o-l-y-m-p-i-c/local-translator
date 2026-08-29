import { Fragment, useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { TABLE_STYLES } from "../components/tableStyles";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { authenticate } from "../shopify.server";

const RESOURCE_CATEGORIES = [
  { label: "Products", types: ["PRODUCT", "COLLECTION"] },
  { label: "Online store", types: ["ARTICLE", "BLOG", "PAGE", "METAOBJECT", "SHOP", "SHOP_POLICY"] },
  { label: "Content", types: ["LINK"] },
] as const;

const ALL_RESOURCE_TYPES = RESOURCE_CATEGORIES.flatMap((c) => c.types);

const RESOURCE_LABELS: Record<string, string> = {
  PRODUCT: "Products",
  COLLECTION: "Collections",
  ARTICLE: "Blog posts",
  BLOG: "Blog titles",
  PAGE: "Pages",
  METAOBJECT: "Metaobjects & filters",
  SHOP: "Store metadata, cookie banner, notifications, shipping",
  SHOP_POLICY: "Policies",
  LINK: "Menu items",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { getDashboardData } = await import("../lib/shopify-theme.server");
  const { shopLocales } = await getDashboardData(admin);
  const targetLocales = shopLocales.filter((l) => !l.primary);
  const jobs = await prisma.contentTranslationJob.findMany({
    where: { shop: session.shop },
    orderBy: { updatedAt: "desc" },
  });
  return { jobs, shop: session.shop, targetLocales };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const targetLocale = String(form.get("targetLocale") || "");
  const resourceType = String(form.get("resourceType") || "");

  if (!targetLocale) {
    return Response.json({ ok: false, message: "Missing target locale" }, { status: 400 });
  }

  if (intent === "cancel") {
    await prisma.contentTranslationJob.updateMany({
      where: { shop: session.shop, targetLocale, status: { in: ["pending", "active"] } },
      data: { status: "cancelled", completedAt: new Date() },
    });
    return { ok: true, message: `Cancelled translation jobs for ${targetLocale}` };
  }

  if (intent === "translateFull" || intent === "translateCategory" || intent === "forceTranslate" || intent === "translateMissing") {
    const { getShopGeminiConfiguration } = await import("../lib/gemini-settings.server");
    const configuration = await getShopGeminiConfiguration(session.shop);
    if (!configuration) throw new Error("Configure a Gemini API key in Settings first");

    const isFull = intent === "translateFull" || intent === "forceTranslate" || intent === "translateMissing";
    const typesToTranslate = isFull
      ? ALL_RESOURCE_TYPES
      : resourceType ? [resourceType] : [];

    if (!typesToTranslate.length) {
      return Response.json({ ok: false, message: "No resource type specified" }, { status: 400 });
    }

    // forceTranslate = re-translate everything (mode: "force")
    // translateMissing = only translate fields with no existing translation (mode: "missing")
    // translateFull/translateCategory = translate everything (mode: "all", same as force but semantically "first pass")
    const mode: "all" | "force" | "missing" =
      intent === "forceTranslate" ? "force" :
      intent === "translateMissing" ? "missing" : "all";

    const jobLabel = intent === "forceTranslate" ? "ALL_FORCE" :
      intent === "translateMissing" ? "ALL_MISSING" :
      intent === "translateFull" ? "ALL" : resourceType;

    const job = await prisma.contentTranslationJob.create({
      data: {
        shop: session.shop,
        targetLocale,
        resourceType: jobLabel,
        status: "active",
        totalItems: typesToTranslate.length,
        completedItems: 0,
        model: configuration.model,
      },
    });

    // Start translation in the background — re-authenticate inside to avoid token expiry
    translateResources(session.shop, targetLocale, typesToTranslate, configuration.apiKey, configuration.model, job.id, mode)
      .catch((error) => {
        console.error("[translate] background error:", error);
        prisma.contentTranslationJob.update({
          where: { id: job.id },
          data: { status: "failed", error: error instanceof Error ? error.message : "Unknown error", completedAt: new Date() },
        }).catch(() => {});
      });

    const label = intent === "forceTranslate" ? "full store (force re-translate)"
      : intent === "translateMissing" ? "missing content"
      : intent === "translateFull" ? "full store"
      : RESOURCE_LABELS[resourceType] || resourceType;
    return { ok: true, message: `Started translation of ${label} to ${targetLocale}` };
  }

  return Response.json({ ok: false, message: "Unknown action" }, { status: 400 });
};

// Fields that should not be translated (handles must be unique across the store)
const SKIP_KEYS = new Set(["handle"]);

async function translateResources(
  shop: string,
  targetLocale: string,
  resourceTypes: readonly string[],
  apiKey: string,
  model: string,
  jobId: string,
  mode: "all" | "force" | "missing" = "all",
) {
  const { getTranslatableResources, registerTranslations } = await import("../lib/shopify-translations.server");
  const { translateBatch, isRetryableGeminiError } = await import("../lib/gemini.server");
  let completed = 0;
  let totalSkipped = 0;

  // Re-authenticate to get a fresh admin client that isn't tied to the request lifecycle
  const { admin } = await unauthenticated.admin(shop);

  for (const resourceType of resourceTypes) {
    const job = await prisma.contentTranslationJob.findUnique({ where: { id: jobId } });
    if (!job || job.status === "cancelled") break;

    try {
      let cursor: string | null = null;
      let hasMore = true;
      while (hasMore) {
        const result = await getTranslatableResources(admin, resourceType as never, cursor, 10);
        for (const resource of result.resources) {
          if (!resource.translatableContent.length) continue;

          // Skip fields that shouldn't be translated (e.g., handles — they must be unique store-wide)
          let fieldsToTranslate = resource.translatableContent.filter((c) => !SKIP_KEYS.has(c.key));

          // In "missing" mode, skip fields that already have a translation in the target locale
          if (mode === "missing") {
            fieldsToTranslate = fieldsToTranslate.filter((c) => {
              const targetTranslation = resource.translatableContent.find(
                (tc) => tc.key === c.key && tc.locale === targetLocale && tc.value.trim()
              );
              return !targetTranslation;
            });
          }

          if (!fieldsToTranslate.length) {
            totalSkipped++;
            continue;
          }

          try {
            const items = fieldsToTranslate.map((c) => ({ key: c.key, source: c.value }));
            let geminiResult;
            try {
              geminiResult = await translateBatch(items, "en", targetLocale, apiKey, model);
            } catch (retryableError) {
              if (isRetryableGeminiError(retryableError)) {
                // Wait 60s and retry once for rate limits
                console.log("[translateResources] Rate limited, waiting 60s before retry...");
                await new Promise((resolve) => setTimeout(resolve, 60000));
                geminiResult = await translateBatch(items, "en", targetLocale, apiKey, model);
              } else {
                throw retryableError;
              }
            }
            const translations = fieldsToTranslate.map((c) => ({
              key: c.key,
              value: geminiResult.translations[c.key] || "",
              digest: c.digest,
            })).filter((t) => t.value && t.digest);
            if (translations.length) {
              await registerTranslations(admin, resource.resourceId, targetLocale, translations);
            }
          } catch (error) {
            console.error(`[translateResources] resource ${resource.resourceId} failed:`, error);
          }
        }
        hasMore = result.hasNextPage;
        cursor = result.endCursor;
      }
    } catch (error) {
      console.error(`[translateResources] type ${resourceType} failed:`, error);
    }

    completed++;
    await prisma.contentTranslationJob.update({
      where: { id: jobId },
      data: { completedItems: completed },
    });
  }

  await prisma.contentTranslationJob.update({
    where: { id: jobId },
    data: { status: "completed", completedAt: new Date() },
  });
}

export default function LanguagesPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const poller = useFetcher<typeof loader>();
  const shopify = useAppBridge();
  const [expandedLocale, setExpandedLocale] = useState<string | null>(null);
  const [submittingForm, setSubmittingForm] = useState<string | null>(null);

  // Only "busy" when a form is actually being submitted, not when polling
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
  }, [fetcher.data, shopify]);

  // Clear submitting state when fetcher returns to idle
  useEffect(() => {
    if (fetcher.state === "idle") setSubmittingForm(null);
  }, [fetcher.state]);

  // Poll for job status updates if any job is active — uses separate fetcher to avoid button loading states
  const hasActiveJobs = data.jobs.some((j) => j.status === "active" || j.status === "pending");
  useEffect(() => {
    if (!hasActiveJobs) return;
    const interval = setInterval(() => {
      poller.load("/app/languages");
    }, 3000);
    return () => clearInterval(interval);
  }, [hasActiveJobs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Get the latest job per (locale, resourceType) combination
  const jobByKey = new Map(
    data.jobs.map((j) => [`${j.targetLocale}:${j.resourceType}`, j]),
  );
  const getJob = (locale: string, resourceType: string) =>
    jobByKey.get(`${locale}:${resourceType}`) ||
    jobByKey.get(`${locale}:ALL`) ||
    jobByKey.get(`${locale}:ALL_FORCE`) ||
    jobByKey.get(`${locale}:ALL_MISSING`);

  const statusBadge = (status: string | undefined) => {
    if (!status) return <span style={{ ...TABLE_STYLES.badge, ...TABLE_STYLES.badgeNeutral }}>Not started</span>;
    const styles = status === "completed" ? TABLE_STYLES.badgeSuccess
      : status === "active" || status === "pending" ? TABLE_STYLES.badgeInfo
      : status === "failed" ? TABLE_STYLES.badgeCritical
      : status === "cancelled" ? TABLE_STYLES.badgeWarning
      : TABLE_STYLES.badgeNeutral;
    return <span style={{ ...TABLE_STYLES.badge, ...styles }}>{status}</span>;
  };

  return (
    <s-page heading="Languages">
      <s-section heading="Translate store content">
        <s-paragraph>
          Translate all translatable content to a target language. Expand a language to translate individual categories, or use "Translate full" for everything.
        </s-paragraph>

        <table style={TABLE_STYLES.table}>
          <thead style={TABLE_STYLES.thead}>
            <tr>
              <th style={{ ...TABLE_STYLES.th, width: "20%" }}>Language</th>
              <th style={{ ...TABLE_STYLES.th, width: "15%" }}>Status</th>
              <th style={{ ...TABLE_STYLES.th, width: "30%" }}>Progress</th>
              <th style={{ ...TABLE_STYLES.th, width: "35%" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.targetLocales.map((lang) => {
              const fullJob = getJob(lang.locale, "ALL");
              const isActive = fullJob?.status === "active" || fullJob?.status === "pending";
              const isExpanded = expandedLocale === lang.locale;
              const progress = fullJob?.totalItems ? Math.round((fullJob.completedItems / fullJob.totalItems) * 100) : 0;
              const anyCategoryActive = RESOURCE_CATEGORIES.some((cat) =>
                cat.types.some((t) => {
                  const j = getJob(lang.locale, t);
                  return j?.status === "active" || j?.status === "pending";
                }),
              );

              return (
                <Fragment key={lang.locale}>
                  <tr style={TABLE_STYLES.trHover}>
                    <td style={TABLE_STYLES.td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button
                          onClick={() => setExpandedLocale(isExpanded ? null : lang.locale)}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, padding: 0 }}
                        >
                          {isExpanded ? "▼" : "▶"}
                        </button>
                        <div>
                          <strong style={{ fontSize: 14 }}>{lang.name}</strong>
                          <div style={{ fontSize: 12, color: "#616161" }}>{lang.locale}{lang.published ? "" : " · unpublished"}</div>
                        </div>
                      </div>
                    </td>
                    <td style={TABLE_STYLES.td}>{statusBadge(fullJob?.status)}</td>
                    <td style={TABLE_STYLES.td}>
                      {fullJob ? (
                        <div>
                          <div style={TABLE_STYLES.progressBar}>
                            <div style={TABLE_STYLES.progressFill(progress)} />
                          </div>
                          <div style={{ fontSize: 12, color: "#616161", marginTop: 4 }}>
                            {fullJob.completedItems} / {fullJob.totalItems} ({progress}%)
                            {fullJob.error && <span style={{ color: "#c50f0f" }}> · {fullJob.error}</span>}
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: "#999", fontSize: 13 }}>—</span>
                      )}
                    </td>
                    <td style={TABLE_STYLES.td}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {!isActive && !anyCategoryActive && (
                          <>
                            <fetcher.Form method="post" style={{ display: "inline" }} onSubmit={() => setSubmittingForm(`missing-${lang.locale}`)}>
                              <input type="hidden" name="intent" value="translateMissing" />
                              <input type="hidden" name="targetLocale" value={lang.locale} />
                              <s-button type="submit" variant="primary" loading={(submittingForm === `missing-${lang.locale}` && isSubmitting) || undefined}>
                                Translate missing
                              </s-button>
                            </fetcher.Form>
                            <fetcher.Form method="post" style={{ display: "inline" }} onSubmit={() => setSubmittingForm(`force-${lang.locale}`)}>
                              <input type="hidden" name="intent" value="forceTranslate" />
                              <input type="hidden" name="targetLocale" value={lang.locale} />
                              <s-button type="submit" loading={(submittingForm === `force-${lang.locale}` && isSubmitting) || undefined}>
                                Force translate
                              </s-button>
                            </fetcher.Form>
                          </>
                        )}
                        {(isActive || anyCategoryActive) && (
                          <fetcher.Form method="post" style={{ display: "inline" }} onSubmit={() => setSubmittingForm(`cancel-${lang.locale}`)}>
                            <input type="hidden" name="intent" value="cancel" />
                            <input type="hidden" name="targetLocale" value={lang.locale} />
                            <s-button type="submit" tone="critical" loading={(submittingForm === `cancel-${lang.locale}` && isSubmitting) || undefined}>
                              Cancel
                            </s-button>
                          </fetcher.Form>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${lang.locale}-expand`}>
                      <td colSpan={4} style={{ ...TABLE_STYLES.td, background: "#fafafa", padding: 16 }}>
                        <table style={TABLE_STYLES.table}>
                          <thead style={TABLE_STYLES.thead}>
                            <tr>
                              <th style={{ ...TABLE_STYLES.th, width: "15%" }}>Category</th>
                              <th style={{ ...TABLE_STYLES.th, width: "25%" }}>Resource type</th>
                              <th style={{ ...TABLE_STYLES.th, width: "15%" }}>Status</th>
                              <th style={{ ...TABLE_STYLES.th, width: "25%" }}>Progress</th>
                              <th style={{ ...TABLE_STYLES.th, width: "20%" }}>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {RESOURCE_CATEGORIES.map((category) =>
                              category.types.map((rt, idx) => {
                                const catJob = getJob(lang.locale, rt);
                                const catActive = catJob?.status === "active" || catJob?.status === "pending";
                                const catProgress = catJob?.totalItems ? Math.round((catJob.completedItems / catJob.totalItems) * 100) : 0;
                                return (
                                  <tr key={`${category.label}-${rt}`}>
                                    <td style={TABLE_STYLES.td}>
                                      {idx === 0 ? <strong style={{ fontSize: 13 }}>{category.label}</strong> : ""}
                                    </td>
                                    <td style={TABLE_STYLES.td}><span style={{ fontSize: 13 }}>{RESOURCE_LABELS[rt]}</span></td>
                                    <td style={TABLE_STYLES.td}>{statusBadge(catJob?.status)}</td>
                                    <td style={TABLE_STYLES.td}>
                                      {catJob ? (
                                        <div>
                                          <div style={TABLE_STYLES.progressBar}>
                                            <div style={TABLE_STYLES.progressFill(catProgress)} />
                                          </div>
                                          <div style={{ fontSize: 11, color: "#616161", marginTop: 2 }}>
                                            {catJob.completedItems} / {catJob.totalItems} ({catProgress}%)
                                          </div>
                                        </div>
                                      ) : <span style={{ color: "#999", fontSize: 12 }}>—</span>}
                                    </td>
                                    <td style={TABLE_STYLES.td}>
                                      {!catActive && (
                                        <fetcher.Form method="post" style={{ display: "inline" }} onSubmit={() => setSubmittingForm(`cat-${lang.locale}-${rt}`)}>
                                          <input type="hidden" name="intent" value="translateCategory" />
                                          <input type="hidden" name="targetLocale" value={lang.locale} />
                                          <input type="hidden" name="resourceType" value={rt} />
                                          <s-button
                                            type="submit"
                                            loading={(submittingForm === `cat-${lang.locale}-${rt}` && isSubmitting) || undefined}
                                            disabled={(isActive || anyCategoryActive) || undefined}
                                          >
                                            Translate
                                          </s-button>
                                        </fetcher.Form>
                                      )}
                                    </td>
                                  </tr>
                                );
                              }),
                            )}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
