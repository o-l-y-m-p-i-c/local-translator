import { useEffect, useRef } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useFetcher, useLoaderData, useNavigation, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { isRetryableGeminiError, translateBatch } from "../lib/gemini.server";
import { getShopGeminiConfiguration } from "../lib/gemini-settings.server";
import {
  computeStatuses,
  flattenLocale,
  localeFilenameFor,
  localeFromFilename,
  parseLocaleJson,
  unflattenLocale,
  validatePlaceholders,
  type FlatLocale,
  type StatusMap,
} from "../lib/locale";
import {
  getDashboardData,
  getThemeLocaleFiles,
  upsertThemeLocale,
} from "../lib/shopify-theme.server";
import { authenticate } from "../shopify.server";

const workspaceKey = (shop: string, themeId: string, sourceFilename: string, targetLocale: string) => ({
  shop_themeId_sourceFilename_targetLocale: { shop, themeId, sourceFilename, targetLocale },
});

const jobSummary = (job: {
  id: string;
  status: string;
  totalItems: number;
  completedItems: number;
  promptTokenCount: number;
  candidatesTokenCount: number;
  thoughtsTokenCount: number;
  totalTokenCount: number;
  model: string;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}) => ({
  id: job.id,
  status: job.status,
  totalItems: job.totalItems,
  completedItems: job.completedItems,
  promptTokenCount: job.promptTokenCount,
  candidatesTokenCount: job.candidatesTokenCount,
  thoughtsTokenCount: job.thoughtsTokenCount,
  totalTokenCount: job.totalTokenCount,
  model: job.model,
  error: job.error,
  createdAt: job.createdAt.toISOString(),
  updatedAt: job.updatedAt.toISOString(),
  completedAt: job.completedAt?.toISOString() ?? null,
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const themeId = url.searchParams.get("theme") || "";
  const sourceFilename = url.searchParams.get("source") || "";
  const targetLocale = url.searchParams.get("target") || "";
  const [dashboard, settings] = await Promise.all([
    getDashboardData(admin),
    prisma.shopSettings.findUnique({ where: { shop: session.shop } }),
  ]);
  const gemini = {
    configured: Boolean(settings?.encryptedGeminiApiKey),
    model: settings?.geminiModel ?? null,
  };
  const theme = dashboard.themes.find(({ id }) => id === themeId);
  const files = theme ? await getThemeLocaleFiles(admin, theme.id) : [];

  if (!theme || !sourceFilename || !targetLocale) {
    return { ...dashboard, gemini, files: files.map(({ filename }) => filename), selection: null };
  }

  const sourceFile = files.find(({ filename }) => filename === sourceFilename);
  if (!sourceFile) throw new Response("Selected source locale no longer exists", { status: 404 });
  const sourceJson = parseLocaleJson(sourceFile.content);
  const source = flattenLocale(sourceJson);
  const existing = await prisma.translationWorkspace.findUnique({
    where: workspaceKey(session.shop, theme.id, sourceFilename, targetLocale),
  });
  const shopifyTarget = files.find(({ filename }) => filename === localeFilenameFor(sourceFilename, targetLocale));
  const target = existing
    ? (JSON.parse(existing.targetSnapshot) as FlatLocale)
    : shopifyTarget
      ? flattenLocale(parseLocaleJson(shopifyTarget.content))
      : {};
  const previousSource = existing
    ? (JSON.parse(existing.sourceSnapshot) as FlatLocale)
    : source;
  const previousStatuses = existing
    ? (JSON.parse(existing.statusSnapshot) as StatusMap)
    : {};
  const statuses = computeStatuses(source, target, previousSource);
  for (const key of Object.keys(statuses)) {
    if (
      statuses[key] === "translated" &&
      previousStatuses[key] === "stale" &&
      previousSource[key] === source[key]
    ) statuses[key] = "stale";
  }
  const now = new Date();
  const workspace = await prisma.translationWorkspace.upsert({
    where: workspaceKey(session.shop, theme.id, sourceFilename, targetLocale),
    create: {
      shop: session.shop,
      themeId: theme.id,
      themeName: theme.name,
      sourceFilename,
      sourceLocale: localeFromFilename(sourceFilename),
      targetLocale,
      sourceSnapshot: JSON.stringify(source),
      targetSnapshot: JSON.stringify(target),
      statusSnapshot: JSON.stringify(statuses),
      lastSyncedAt: now,
    },
    update: {
      themeName: theme.name,
      sourceSnapshot: JSON.stringify(source),
      statusSnapshot: JSON.stringify(statuses),
      lastSyncedAt: now,
    },
  });
  const latestJob = await prisma.translationJob.findFirst({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
  });

  return {
    ...dashboard,
    gemini,
    files: files.map(({ filename }) => filename),
    selection: {
      themeId,
      sourceFilename,
      targetLocale,
      targetFilename: localeFilenameFor(sourceFilename, targetLocale),
      source,
      target,
      statuses,
      lastSyncedAt: workspace.lastSyncedAt.toISOString(),
      lastUpdatedAt: workspace.lastUpdatedAt.toISOString(),
      job: latestJob ? jobSummary(latestJob) : null,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  if (intent === "refresh") return { ok: true, message: "Themes and locales refreshed" };

  const themeId = String(form.get("themeId") || "");
  const sourceFilename = String(form.get("sourceFilename") || "");
  const targetLocale = String(form.get("targetLocale") || "");
  if (!themeId || !sourceFilename || !targetLocale) {
    return Response.json({ ok: false, message: "Translation selection is incomplete" }, { status: 400 });
  }

  try {
    const workspace = await prisma.translationWorkspace.findFirstOrThrow({
      where: { shop: session.shop, themeId, sourceFilename, targetLocale },
    });
    const source = JSON.parse(workspace.sourceSnapshot) as FlatLocale;
    const target = JSON.parse(workspace.targetSnapshot) as FlatLocale;
    const statuses = JSON.parse(workspace.statusSnapshot) as StatusMap;

    if (intent === "save" || intent === "translate") {
      const key = String(form.get("key") || "");
      if (!(key in source)) throw new Error("Translation key is invalid");
      let translation = String(form.get("translation") || "");
      if (intent === "translate") {
        const configuration = await getShopGeminiConfiguration(session.shop);
        if (!configuration) throw new Error("Configure a Gemini API key in Settings first");
        const result = await translateBatch(
          [{ key, source: source[key] }],
          workspace.sourceLocale,
          targetLocale,
          configuration.apiKey,
          configuration.model,
        );
        translation = result.translations[key];
      }
      const invalid = translation.trim() ? validatePlaceholders(source[key], translation) : [];
      if (invalid.length) throw new Error(`Protected tokens changed: ${invalid.join(", ")}`);
      target[key] = translation;
      statuses[key] = translation.trim() ? "translated" : "missing";
      await prisma.translationWorkspace.update({
        where: { id: workspace.id },
        data: { targetSnapshot: JSON.stringify(target), statusSnapshot: JSON.stringify(statuses) },
      });
      return { ok: true, message: intent === "translate" ? "Translation generated" : "Translation saved" };
    }

    if (intent === "startJob") {
      const configuration = await getShopGeminiConfiguration(session.shop);
      if (!configuration) throw new Error("Configure a Gemini API key in Settings first");
      const existingJob = await prisma.translationJob.findFirst({
        where: {
          workspaceId: workspace.id,
          status: { in: ["pending", "active", "paused", "failed"] },
        },
        orderBy: { createdAt: "desc" },
      });
      if (existingJob) {
        return { ok: true, message: "Existing translation job opened", job: jobSummary(existingJob) };
      }
      const pendingKeys = Object.keys(source).filter(
        (key) => statuses[key] === "missing" || statuses[key] === "stale",
      );
      const job = await prisma.translationJob.create({
        data: {
          workspaceId: workspace.id,
          activeKey: pendingKeys.length ? workspace.id : null,
          pendingKeys,
          totalItems: pendingKeys.length,
          status: pendingKeys.length ? "pending" : "completed",
          completedAt: pendingKeys.length ? null : new Date(),
          model: configuration.model,
        },
      });
      return {
        ok: true,
        message: pendingKeys.length ? "Translation job started" : "No missing or stale strings",
        job: jobSummary(job),
      };
    }

    if (intent === "resumeJob") {
      const jobId = String(form.get("jobId") || "");
      const job = await prisma.translationJob.findFirstOrThrow({
        where: { id: jobId, workspace: { shop: session.shop, id: workspace.id } },
      });
      if (!["paused", "failed", "pending", "active"].includes(job.status)) {
        throw new Error("This translation job cannot be resumed");
      }
      const resumed = await prisma.translationJob.update({
        where: { id: job.id },
        data: { status: "active", error: null, processingStartedAt: null },
      });
      return { ok: true, message: "Translation job resumed", job: jobSummary(resumed) };
    }

    if (intent === "processJob") {
      const jobId = String(form.get("jobId") || "");
      const job = await prisma.translationJob.findFirstOrThrow({
        where: { id: jobId, workspace: { shop: session.shop, id: workspace.id } },
      });
      if (!["pending", "active"].includes(job.status)) {
        return { ok: true, message: "Translation job is not active", job: jobSummary(job) };
      }
      const staleLock = new Date(Date.now() - 5 * 60 * 1000);
      const claimed = await prisma.translationJob.updateMany({
        where: {
          id: job.id,
          status: { in: ["pending", "active"] },
          OR: [{ processingStartedAt: null }, { processingStartedAt: { lt: staleLock } }],
        },
        data: { status: "active", processingStartedAt: new Date(), error: null },
      });
      if (!claimed.count) {
        return Response.json({ ok: false, message: "A translation batch is already processing" }, { status: 409 });
      }

      const configuration = await getShopGeminiConfiguration(session.shop);
      if (!configuration) {
        const paused = await prisma.translationJob.update({
          where: { id: job.id },
          data: { status: "paused", error: "Gemini API key is not configured", processingStartedAt: null },
        });
        return Response.json(
          { ok: false, message: paused.error, job: jobSummary(paused) },
          { status: 400 },
        );
      }
      const pendingKeys = (job.pendingKeys as unknown as string[]).filter((key) => key in source);
      const batchKeys = pendingKeys.slice(0, configuration.batchSize);
      if (!batchKeys.length) {
        const completed = await prisma.translationJob.update({
          where: { id: job.id },
          data: { status: "completed", activeKey: null, pendingKeys: [], processingStartedAt: null, completedAt: new Date() },
        });
        return { ok: true, message: "Translation job completed", job: jobSummary(completed) };
      }

      try {
        const result = await translateBatch(
          batchKeys.map((key) => ({ key, source: source[key] })),
          workspace.sourceLocale,
          targetLocale,
          configuration.apiKey,
          job.model,
        );
        Object.assign(target, result.translations);
        batchKeys.forEach((key) => { statuses[key] = "translated"; });
        const remainingKeys = pendingKeys.slice(batchKeys.length);
        const completedAt = remainingKeys.length ? null : new Date();
        const [, updatedJob] = await prisma.$transaction([
          prisma.translationWorkspace.update({
            where: { id: workspace.id },
            data: {
              targetSnapshot: JSON.stringify(target),
              statusSnapshot: JSON.stringify(statuses),
            },
          }),
          prisma.translationJob.update({
            where: { id: job.id },
            data: {
              pendingKeys: remainingKeys,
              status: remainingKeys.length ? "active" : "completed",
              activeKey: remainingKeys.length ? workspace.id : null,
              completedItems: { increment: batchKeys.length },
              promptTokenCount: { increment: result.usage.promptTokenCount },
              candidatesTokenCount: { increment: result.usage.candidatesTokenCount },
              thoughtsTokenCount: { increment: result.usage.thoughtsTokenCount },
              totalTokenCount: { increment: result.usage.totalTokenCount },
              error: null,
              processingStartedAt: null,
              completedAt,
            },
          }),
        ]);
        return {
          ok: true,
          message: remainingKeys.length ? `Translated ${batchKeys.length} strings` : "Translation job completed",
          job: jobSummary(updatedJob),
        };
      } catch (error) {
        const retryable = isRetryableGeminiError(error);
        const errorMessage = retryable
          ? "Gemini is rate limited or temporarily unavailable. Continue the job to retry this batch."
          : error instanceof Error && (
              error.message.startsWith("Gemini changed protected tokens") ||
              error.message.startsWith("Gemini omitted") ||
              error.message === "Gemini returned an empty response"
            )
            ? error.message
            : "Gemini could not translate this batch. Retry after checking the configuration.";
        const failed = await prisma.translationJob.update({
          where: { id: job.id },
          data: {
            status: retryable ? "paused" : "failed",
            error: errorMessage,
            processingStartedAt: null,
          },
        });
        return Response.json(
          { ok: false, message: errorMessage, job: jobSummary(failed) },
          { status: retryable ? 503 : 400 },
        );
      }
    }

    if (intent === "publish") {
      const publishable = Object.fromEntries(
        Object.entries(target).filter(([, value]) => value.trim()),
      );
      const output = unflattenLocale(publishable);
      await upsertThemeLocale(admin, themeId, localeFilenameFor(sourceFilename, targetLocale), output);
      return { ok: true, message: `${localeFilenameFor(sourceFilename, targetLocale)} published to Shopify` };
    }
    throw new Error("Unknown action");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    const message = [
      "Translation key is invalid",
      "Configure a Gemini API key in Settings first",
      "This translation job cannot be resumed",
      "Unknown action",
    ].includes(detail) || detail.startsWith("Protected tokens changed") ||
      detail.startsWith("Gemini changed protected tokens") || detail.startsWith("Gemini omitted")
      ? detail
      : "The translation request could not be completed";
    return Response.json({ ok: false, message }, { status: 400 });
  }
};

export default function TranslatorDashboard() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const selection = data.selection;
  const busy = fetcher.state !== "idle" || navigation.state !== "idle";
  const fetcherJob = fetcher.data && "job" in fetcher.data
    ? fetcher.data.job as ReturnType<typeof jobSummary> | undefined
    : null;
  const job = fetcherJob ?? selection?.job ?? null;
  const refreshedJob = useRef<string | null>(null);

  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
  }, [fetcher.data, shopify]);

  useEffect(() => {
    if (
      !selection || !job || !["pending", "active"].includes(job.status) ||
      fetcher.state !== "idle" || (fetcher.data && !fetcher.data.ok)
    ) return;
    const timer = window.setTimeout(() => {
      fetcher.submit({
        intent: "processJob",
        jobId: job.id,
        themeId: selection.themeId,
        sourceFilename: selection.sourceFilename,
        targetLocale: selection.targetLocale,
      }, { method: "post" });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [fetcher, fetcher.data, job, selection]);

  useEffect(() => {
    if (job?.status === "completed" && refreshedJob.current !== job.id) {
      refreshedJob.current = job.id;
      revalidator.revalidate();
    }
  }, [job, revalidator]);

  const counts = selection
    ? Object.values(selection.statuses).reduce<Record<string, number>>((sum, status) => {
        sum[status] = (sum[status] ?? 0) + 1;
        return sum;
      }, {})
    : {};
  const percentage = job?.totalItems
    ? Math.round((job.completedItems / job.totalItems) * 100)
    : job?.status === "completed" ? 100 : 0;
  const submitJob = (intent: "startJob" | "resumeJob" | "processJob") => {
    if (!selection) return;
    fetcher.submit({
      intent,
      ...(job ? { jobId: job.id } : {}),
      themeId: selection.themeId,
      sourceFilename: selection.sourceFilename,
      targetLocale: selection.targetLocale,
    }, { method: "post" });
  };

  return (
    <s-page heading="Locale translator">
      <s-button
        slot="primary-action"
        onClick={() => fetcher.submit({ intent: "refresh" }, { method: "post" })}
        loading={busy || undefined}
      >
        Refresh / sync
      </s-button>

      <s-section heading="Gemini configuration">
        {data.gemini.configured ? (
          <s-paragraph>Configured model: {data.gemini.model}. <s-link href="/app/settings">Manage settings</s-link></s-paragraph>
        ) : (
          <s-banner tone="warning">Gemini is not configured. <s-link href="/app/settings">Add an API key in Settings</s-link>.</s-banner>
        )}
      </s-section>

      <s-section heading="Translation workspace">
        <Form method="get">
          <s-stack direction="block" gap="base">
            <label>
              <s-text>Theme</s-text>
              <select name="theme" defaultValue={selection?.themeId || ""} required style={{ display: "block", width: "100%", padding: 10, marginTop: 6 }}>
                <option value="">Select a theme</option>
                {data.themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name} ({theme.role})</option>)}
              </select>
            </label>
            <label>
              <s-text>Source locale file</s-text>
              <select name="source" defaultValue={selection?.sourceFilename || ""} style={{ display: "block", width: "100%", padding: 10, marginTop: 6 }}>
                <option value="">Select a locale file</option>
                {data.files.map((filename) => <option key={filename} value={filename}>{filename}</option>)}
              </select>
            </label>
            <label>
              <s-text>Target language</s-text>
              <select name="target" defaultValue={selection?.targetLocale || ""} style={{ display: "block", width: "100%", padding: 10, marginTop: 6 }}>
                <option value="">Select a target language</option>
                {data.shopLocales.map((locale) => <option key={locale.locale} value={locale.locale}>{locale.name} ({locale.locale}){locale.published ? " — published" : ""}</option>)}
              </select>
            </label>
            <s-button type="submit" loading={navigation.state !== "idle" || undefined}>Open workspace</s-button>
          </s-stack>
        </Form>
      </s-section>

      {selection && (
        <>
          <s-section heading="Progress">
            <s-stack direction="inline" gap="base">
              <s-badge tone="success">Translated: {counts.translated ?? 0}</s-badge>
              <s-badge tone="warning">Stale: {counts.stale ?? 0}</s-badge>
              <s-badge tone="critical">Missing: {counts.missing ?? 0}</s-badge>
            </s-stack>
            <s-paragraph>
              Last sync: {new Date(selection.lastSyncedAt).toLocaleString()}. Last update: {new Date(selection.lastUpdatedAt).toLocaleString()}. Target file: {selection.targetFilename}
            </s-paragraph>
            {job && (
              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-heading>Bulk translation job</s-heading>
                  <progress value={job.completedItems} max={Math.max(job.totalItems, 1)} style={{ width: "100%" }} aria-label="Translation progress" />
                  <s-paragraph>
                    {job.completedItems} / {job.totalItems} ({percentage}%) · Status: {job.status} · Model: {job.model}
                  </s-paragraph>
                  <s-paragraph>
                    Tokens — prompt: {job.promptTokenCount}, candidates: {job.candidatesTokenCount}, thoughts: {job.thoughtsTokenCount}, total: {job.totalTokenCount}
                  </s-paragraph>
                  {job.error && <s-banner tone="critical">{job.error}</s-banner>}
                </s-stack>
              </s-box>
            )}
            <s-stack direction="inline" gap="base">
              {(!job || job.status === "completed") && (
                <s-button onClick={() => submitJob("startJob")} loading={busy || undefined} disabled={!data.gemini.configured || undefined}>
                  Start translation
                </s-button>
              )}
              {job && ["pending", "active"].includes(job.status) && (
                <s-button onClick={() => submitJob("processJob")} loading={busy || undefined}>Continue</s-button>
              )}
              {job?.status === "paused" && (
                <s-button onClick={() => submitJob("resumeJob")} loading={busy || undefined}>Continue</s-button>
              )}
              {job?.status === "failed" && (
                <s-button onClick={() => submitJob("resumeJob")} loading={busy || undefined}>Retry</s-button>
              )}
              <s-button
                onClick={() => fetcher.submit({
                  intent: "publish",
                  themeId: selection.themeId,
                  sourceFilename: selection.sourceFilename,
                  targetLocale: selection.targetLocale,
                }, { method: "post" })}
                variant="primary"
                loading={busy || undefined}
              >
                Publish to Shopify
              </s-button>
            </s-stack>
          </s-section>

          <s-section heading="Strings">
            <s-stack direction="block" gap="base">
              {Object.entries(selection.source).map(([key, source]) => (
                <s-box key={key} padding="base" borderWidth="base" borderRadius="base">
                  <fetcher.Form method="post">
                    <input type="hidden" name="themeId" value={selection.themeId} />
                    <input type="hidden" name="sourceFilename" value={selection.sourceFilename} />
                    <input type="hidden" name="targetLocale" value={selection.targetLocale} />
                    <input type="hidden" name="key" value={key} />
                    <input type="hidden" name="intent" value="save" />
                    <s-stack direction="block" gap="small">
                      <s-stack direction="inline" gap="small">
                        <s-heading>{key}</s-heading>
                        <s-badge tone={selection.statuses[key] === "translated" ? "success" : selection.statuses[key] === "stale" ? "warning" : "critical"}>{selection.statuses[key]}</s-badge>
                      </s-stack>
                      <s-paragraph>{source}</s-paragraph>
                      <textarea name="translation" defaultValue={selection.target[key] ?? ""} rows={3} aria-label={`Translation for ${key}`} style={{ width: "100%", padding: 10, resize: "vertical" }} />
                      <s-stack direction="inline" gap="small">
                        <s-button type="submit" loading={busy || undefined}>Save</s-button>
                        <s-button
                          onClick={() => fetcher.submit({
                            intent: "translate",
                            themeId: selection.themeId,
                            sourceFilename: selection.sourceFilename,
                            targetLocale: selection.targetLocale,
                            key,
                          }, { method: "post" })}
                          loading={busy || undefined}
                          disabled={!data.gemini.configured || undefined}
                        >
                          Translate with Gemini
                        </s-button>
                      </s-stack>
                    </s-stack>
                  </fetcher.Form>
                </s-box>
              ))}
            </s-stack>
          </s-section>
        </>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
