import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

const ALL_RESOURCE_TYPES = ["PRODUCT", "COLLECTION", "PAGE", "BLOG", "ARTICLE", "LINK", "SHOP", "SHOP_POLICY", "METAOBJECT"];

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

  if (intent === "translateFull") {
    const { getShopGeminiConfiguration } = await import("../lib/gemini-settings.server");
    const configuration = await getShopGeminiConfiguration(session.shop);
    if (!configuration) throw new Error("Configure a Gemini API key in Settings first");

    // Create a job record for tracking
    const job = await prisma.contentTranslationJob.create({
      data: {
        shop: session.shop,
        targetLocale,
        resourceType: "ALL",
        status: "active",
        totalItems: ALL_RESOURCE_TYPES.length,
        completedItems: 0,
        model: configuration.model,
      },
    });

    // Start translation in the background (don't await)
    translateAllResources(admin, session.shop, targetLocale, configuration.apiKey, configuration.model, job.id)
      .catch((error) => {
        console.error("[translateFull] background error:", error);
        prisma.contentTranslationJob.update({
          where: { id: job.id },
          data: { status: "failed", error: error instanceof Error ? error.message : "Unknown error", completedAt: new Date() },
        }).catch(() => {});
      });

    return { ok: true, message: `Started full translation to ${targetLocale}` };
  }

  return Response.json({ ok: false, message: "Unknown action" }, { status: 400 });
};

async function translateAllResources(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  shop: string,
  targetLocale: string,
  apiKey: string,
  model: string,
  jobId: string,
) {
  const { getTranslatableResources, registerTranslations } = await import("../lib/shopify-translations.server");
  const { translateBatch } = await import("../lib/gemini.server");
  let completed = 0;
  let totalTranslated = 0;

  for (const resourceType of ALL_RESOURCE_TYPES) {
    // Check if job was cancelled
    const job = await prisma.contentTranslationJob.findUnique({ where: { id: jobId } });
    if (!job || job.status === "cancelled") break;

    try {
      let cursor: string | null = null;
      let hasMore = true;
      while (hasMore) {
        const result = await getTranslatableResources(admin, resourceType as never, cursor, 10);
        for (const resource of result.resources) {
          if (!resource.translatableContent.length) continue;
          try {
            const items = resource.translatableContent.map((c) => ({ key: c.key, source: c.value }));
            const geminiResult = await translateBatch(items, "en", targetLocale, apiKey, model);
            const translations = resource.translatableContent.map((c) => ({
              key: c.key,
              value: geminiResult.translations[c.key] || "",
              digest: c.digest,
            })).filter((t) => t.value && t.digest);
            if (translations.length) {
              await registerTranslations(admin, resource.resourceId, targetLocale, translations);
              totalTranslated += translations.length;
            }
          } catch (error) {
            console.error(`[translateAllResources] resource ${resource.resourceId} failed:`, error);
          }
        }
        hasMore = result.hasNextPage;
        cursor = result.endCursor;
      }
    } catch (error) {
      console.error(`[translateAllResources] type ${resourceType} failed:`, error);
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
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle" || navigation.state !== "idle";
  const [pollTick, setPollTick] = useState(0);

  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
  }, [fetcher.data, shopify]);

  // Poll for job status updates if any job is active
  const hasActiveJobs = data.jobs.some((j) => j.status === "active" || j.status === "pending");
  useEffect(() => {
    if (!hasActiveJobs) return;
    const interval = setInterval(() => {
      setPollTick((t) => t + 1);
      fetcher.load("/app/languages");
    }, 3000);
    return () => clearInterval(interval);
  }, [hasActiveJobs]); // eslint-disable-line react-hooks/exhaustive-deps

  const jobByLocale = new Map(data.jobs.map((j) => [j.targetLocale, j]));

  return (
    <s-page heading="Languages">
      <s-section heading="Translate full store">
        <s-paragraph>
          Start a full translation of all translatable content (products, collections, pages, blogs, menus, policies, metaobjects) to a target language.
          This runs in the background and may take several minutes.
        </s-paragraph>
        <s-stack direction="block" gap="base">
          {data.targetLocales.map((lang) => {
            const job = jobByLocale.get(lang.locale);
            const isActive = job?.status === "active" || job?.status === "pending";
            const isCompleted = job?.status === "completed";
            const isFailed = job?.status === "failed";
            const isCancelled = job?.status === "cancelled";
            const progress = job?.totalItems ? Math.round((job.completedItems / job.totalItems) * 100) : 0;

            return (
              <s-box key={lang.locale} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="inline" gap="base">
                  <s-stack direction="block" gap="small">
                    <s-heading>{lang.name} ({lang.locale}){lang.published ? "" : " — unpublished"}</s-heading>
                    {isActive && (
                      <s-stack direction="block" gap="small">
                        <s-paragraph>Translating... {job?.completedItems}/{job?.totalItems} resource types ({progress}%)</s-paragraph>
                        <progress value={job?.completedItems || 0} max={job?.totalItems || 1} style={{ width: "100%" }} />
                      </s-stack>
                    )}
                    {isCompleted && <s-paragraph tone="success">Completed — {job?.completedItems} resource types processed</s-paragraph>}
                    {isFailed && <s-paragraph tone="critical">Failed: {job?.error}</s-paragraph>}
                    {isCancelled && <s-paragraph>Cancelled</s-paragraph>}
                    {!job && <s-paragraph>Not translated yet</s-paragraph>}
                  </s-stack>
                  <s-stack direction="inline" gap="small">
                    {!isActive && (
                      <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="translateFull" />
                        <input type="hidden" name="targetLocale" value={lang.locale} />
                        <s-button
                          type="submit"
                          variant="primary"
                          loading={busy || undefined}
                        >
                          Translate full
                        </s-button>
                      </fetcher.Form>
                    )}
                    {isActive && (
                      <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="cancel" />
                        <input type="hidden" name="targetLocale" value={lang.locale} />
                        <s-button
                          type="submit"
                          tone="critical"
                          loading={busy || undefined}
                        >
                          Cancel
                        </s-button>
                      </fetcher.Form>
                    )}
                  </s-stack>
                </s-stack>
              </s-box>
            );
          })}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
