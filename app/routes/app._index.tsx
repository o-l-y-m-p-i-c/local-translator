import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useFetcher, useLoaderData, useNavigation, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { HighlightText } from "../components/HighlightText";
import { TABLE_STYLES } from "../components/tableStyles";
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
  const targetLocale = url.searchParams.get("target") || "";

  // Redirect to Languages page when visiting /app without a view param
  if (!url.searchParams.has("view") && !themeId && !targetLocale) {
    throw new Response(null, {
      status: 302,
      headers: { Location: "/app/languages" },
    });
  }
  console.log("[loader] shop:", session.shop, "theme:", themeId, "target:", targetLocale);
  let dashboard, settings;
  try {
    [dashboard, settings] = await Promise.all([
      getDashboardData(admin),
      prisma.shopSettings.findUnique({ where: { shop: session.shop } }),
    ]);
  } catch (err) {
    console.error("[loader] dashboard/settings error:", err);
    throw err;
  }
  const gemini = {
    configured: Boolean(settings?.encryptedGeminiApiKey),
    model: settings?.geminiModel ?? null,
  };
  const primaryLocale = dashboard.shopLocales.find((l) => l.primary);
  const theme = dashboard.themes.find(({ id }) => id === themeId);
  let files: { filename: string; content: string }[] = [];
  if (theme) {
    try {
      files = await getThemeLocaleFiles(admin, theme.id);
    } catch (err) {
      console.error("[loader] getThemeLocaleFiles error:", err);
      throw err;
    }
  }

  // Auto-detect source file from the primary locale
  let sourceFilename = "";
  if (theme && primaryLocale && files.length) {
    // Primary locale files are typically named like "locales/en.default.json" or "locales/en.json"
    const possibleNames = [
      `locales/${primaryLocale.locale}.default.json`,
      `locales/${primaryLocale.locale}.json`,
    ];
    const found = files.find((f) => possibleNames.includes(f.filename));
    if (found) sourceFilename = found.filename;
  }

  if (!theme || !sourceFilename || !targetLocale) {
    return { ...dashboard, gemini, lazyLoadPageSize: settings?.lazyLoadPageSize ?? 20, files: files.map(({ filename }) => filename), primaryLocale: primaryLocale?.locale ?? null, selection: null };
  }

  const sourceFile = files.find(({ filename }) => filename === sourceFilename);
  if (!sourceFile) throw new Response("Selected source locale no longer exists", { status: 404 });
  let sourceJson: ReturnType<typeof parseLocaleJson>;
  try {
    sourceJson = parseLocaleJson(sourceFile.content);
  } catch (err) {
    console.error("[loader] parseLocaleJson error for", sourceFilename, err);
    throw new Response(`Could not parse ${sourceFilename}: ${err instanceof Error ? err.message : "invalid JSON"}`, { status: 422 });
  }
  const source = flattenLocale(sourceJson);
  let existing;
  try {
    existing = await prisma.translationWorkspace.findUnique({
      where: workspaceKey(session.shop, theme.id, sourceFilename, targetLocale),
    });
  } catch (err) {
    console.error("[loader] prisma findUnique error:", err);
    throw err;
  }
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
  let workspace;
  try {
    workspace = await prisma.translationWorkspace.upsert({
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
  } catch (err) {
    console.error("[loader] prisma upsert error:", err);
    throw err;
  }
  const latestJob = await prisma.translationJob.findFirst({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
  });

  return {
    ...dashboard,
    gemini,
    lazyLoadPageSize: settings?.lazyLoadPageSize ?? 20,
    primaryLocale: primaryLocale?.locale ?? null,
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
      return { ok: true, message: intent === "translate" ? "Translation generated" : "Translation saved", key, translation };
    }

    if (intent === "translateAllVisible") {
      const configuration = await getShopGeminiConfiguration(session.shop);
      if (!configuration) throw new Error("Configure a Gemini API key in Settings first");
      const keysToTranslate = String(form.get("keysToTranslate") || "").split("\n").filter(Boolean);
      if (!keysToTranslate.length) throw new Error("No keys to translate");

      // Translate in batches
      const BATCH = 30;
      let totalTranslated = 0;
      for (let i = 0; i < keysToTranslate.length; i += BATCH) {
        const batch = keysToTranslate.slice(i, i + BATCH);
        const items = batch.map((key) => ({ key, source: source[key] }));
        const result = await translateBatch(
          items,
          workspace.sourceLocale,
          targetLocale,
          configuration.apiKey,
          configuration.model,
        );
        for (const key of batch) {
          const translation = result.translations[key];
          if (translation) {
            const invalid = validatePlaceholders(source[key], translation);
            if (!invalid.length) {
              target[key] = translation;
              statuses[key] = "translated";
              totalTranslated++;
            }
          }
        }
      }
      await prisma.translationWorkspace.update({
        where: { id: workspace.id },
        data: { targetSnapshot: JSON.stringify(target), statusSnapshot: JSON.stringify(statuses) },
      });
      return { ok: true, message: `Translated ${totalTranslated} string(s)` };
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
    console.error("[action] intent:", intent, "error:", error);
    const message = [
      "Translation key is invalid",
      "Configure a Gemini API key in Settings first",
      "This translation job cannot be resumed",
      "Unknown action",
    ].includes(detail) || detail.startsWith("Protected tokens changed") ||
      detail.startsWith("Gemini changed protected tokens") || detail.startsWith("Gemini omitted")
      ? detail
      : "The translation request could not be completed";
    return Response.json({ ok: false, message, detail }, { status: 400 });
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
  const [activeTab, setActiveTab] = useState<"all" | "missing" | "stale" | "translated">("missing");
  const [searchQuery, setSearchQuery] = useState("");
  const [translationOverrides, setTranslationOverrides] = useState<Record<string, string>>({});
  const [visibleCount, setVisibleCount] = useState(data.lazyLoadPageSize ?? 20);

  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
  }, [fetcher.data, shopify]);

  // After a successful translate action, update the input and revalidate.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      const d = fetcher.data as { message?: string; key?: string; translation?: string };
      if (d.message === "Translation generated" && d.key && typeof d.translation === "string") {
        setTranslationOverrides((prev) => ({ ...prev, [d.key!]: d.translation! }));
      }
      if (d.message === "Translation generated" || d.message === "Translation saved") {
        revalidator.revalidate();
      }
    }
  }, [fetcher.state, fetcher.data, revalidator]);

  // Clear overrides when selection changes
  useEffect(() => {
    setTranslationOverrides({});
    setActiveTab("missing");
    setSearchQuery("");
    setVisibleCount(data.lazyLoadPageSize ?? 20);
  }, [selection?.themeId, selection?.sourceFilename, selection?.targetLocale, data.lazyLoadPageSize]);

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

  const statusBadge = (status: string) => {
    const styles = status === "translated" ? TABLE_STYLES.badgeSuccess
      : status === "stale" ? TABLE_STYLES.badgeWarning
      : TABLE_STYLES.badgeCritical;
    return <span style={{ ...TABLE_STYLES.badge, ...styles }}>{status}</span>;
  };

  return (
    <s-page heading="Locale files">
      <s-button
        slot="primary-action"
        onClick={() => fetcher.submit({ intent: "refresh" }, { method: "post" })}
        loading={busy || undefined}
      >
        Refresh
      </s-button>

      {!data.gemini.configured && (
        <s-banner tone="warning">
          Gemini is not configured. <s-link href="/app/settings">Add an API key in Settings</s-link>.
        </s-banner>
      )}

      {/* Workspace selector */}
      <s-section heading="Translation workspace">
        <Form method="get">
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Theme</label>
              <select name="theme" defaultValue={selection?.themeId || ""} required style={TABLE_STYLES.select}>
                <option value="">Select a theme</option>
                {data.themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name} ({theme.role})</option>)}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                Source language {data.primaryLocale && <span style={{ color: "#616161", fontWeight: 400 }}>(default: {data.primaryLocale})</span>}
              </label>
              <div style={{ ...TABLE_STYLES.select, background: "#f6f6f7", color: "#616161", cursor: "default" }}>
                {data.primaryLocale ? `${data.primaryLocale} (auto-detected from store default)` : "Select a theme first"}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Target language</label>
              <select name="target" defaultValue={selection?.targetLocale || ""} style={TABLE_STYLES.select}>
                <option value="">Select target</option>
                {data.shopLocales.filter((l) => !l.primary).map((locale) => <option key={locale.locale} value={locale.locale}>{locale.name} ({locale.locale}){locale.published ? "" : " — unpublished"}</option>)}
              </select>
            </div>
            <s-button type="submit" loading={navigation.state !== "idle" || undefined}>Open</s-button>
          </div>
        </Form>
      </s-section>

      {selection && (
        <>
          {/* Stats row */}
          <s-section>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={TABLE_STYLES.statCard}>
                <p style={TABLE_STYLES.statNumber}>{counts.translated ?? 0}</p>
                <p style={TABLE_STYLES.statLabel}>Translated</p>
              </div>
              <div style={TABLE_STYLES.statCard}>
                <p style={TABLE_STYLES.statNumber}>{counts.stale ?? 0}</p>
                <p style={TABLE_STYLES.statLabel}>Stale</p>
              </div>
              <div style={TABLE_STYLES.statCard}>
                <p style={TABLE_STYLES.statNumber}>{counts.missing ?? 0}</p>
                <p style={TABLE_STYLES.statLabel}>Missing</p>
              </div>
              <div style={TABLE_STYLES.statCard}>
                <p style={TABLE_STYLES.statNumber}>{Object.keys(selection.source).length}</p>
                <p style={TABLE_STYLES.statLabel}>Total</p>
              </div>
            </div>
          </s-section>

          {/* Job progress + actions */}
          {job && (
            <s-section heading="Bulk translation job">
              <div style={TABLE_STYLES.cardRow}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <strong>{job.status}</strong>
                  <span style={{ color: "#616161", fontSize: 13 }}>{job.completedItems} / {job.totalItems} ({percentage}%) · {job.model}</span>
                </div>
                <div style={TABLE_STYLES.progressBar}>
                  <div style={TABLE_STYLES.progressFill(percentage)} />
                </div>
                {job.error && <s-banner tone="critical">{job.error}</s-banner>}
                <div style={{ display: "flex", gap: 8, marginTop: 12, fontSize: 12, color: "#616161" }}>
                  <span>Tokens: {job.totalTokenCount}</span>
                  <span>·</span>
                  <span>Prompt: {job.promptTokenCount}</span>
                  <span>·</span>
                  <span>Candidates: {job.candidatesTokenCount}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                {(!job || job.status === "completed") && (
                  <s-button onClick={() => submitJob("startJob")} loading={busy || undefined} disabled={!data.gemini.configured || undefined}>
                    Start bulk translation
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
              </div>
            </s-section>
          )}

          {/* Strings table */}
          <s-section heading="Strings">
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <button style={TABLE_STYLES.tabButton(activeTab === "missing")} onClick={() => setActiveTab("missing")}>
                Missing ({counts.missing ?? 0})
              </button>
              <button style={TABLE_STYLES.tabButton(activeTab === "stale")} onClick={() => setActiveTab("stale")}>
                Stale ({counts.stale ?? 0})
              </button>
              <button style={TABLE_STYLES.tabButton(activeTab === "translated")} onClick={() => setActiveTab("translated")}>
                Translated ({counts.translated ?? 0})
              </button>
              <button style={TABLE_STYLES.tabButton(activeTab === "all")} onClick={() => setActiveTab("all")}>
                All ({Object.keys(selection.source).length})
              </button>
            </div>

            <div style={TABLE_STYLES.toolbar}>
              <input
                type="search"
                placeholder="Search by key or source text..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.currentTarget.value)}
                style={TABLE_STYLES.searchInput}
              />
              <fetcher.Form method="post" style={{ display: "inline" }}>
                <input type="hidden" name="intent" value="translateAllVisible" />
                <input type="hidden" name="themeId" value={selection.themeId} />
                <input type="hidden" name="sourceFilename" value={selection.sourceFilename} />
                <input type="hidden" name="targetLocale" value={selection.targetLocale} />
                <input
                  type="hidden"
                  name="keysToTranslate"
                  value={Object.entries(selection.source)
                    .filter(([key]) => {
                      if (activeTab !== "all" && selection.statuses[key] !== activeTab) return false;
                      if (searchQuery.trim()) {
                        const q = searchQuery.toLowerCase();
                        return key.toLowerCase().includes(q) || selection.source[key].toLowerCase().includes(q);
                      }
                      return true;
                    })
                    .map(([key]) => key)
                    .join("\n")}
                />
                <s-button type="submit" variant="primary" loading={busy || undefined} disabled={!data.gemini.configured || undefined}>
                  Translate all visible
                </s-button>
              </fetcher.Form>
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
            </div>

            {(() => {
              const entries = Object.entries(selection.source).filter(([key, source]) => {
                if (activeTab !== "all" && selection.statuses[key] !== activeTab) return false;
                if (searchQuery.trim()) {
                  const q = searchQuery.toLowerCase();
                  return key.toLowerCase().includes(q) || source.toLowerCase().includes(q);
                }
                return true;
              });
              if (!entries.length) {
                return <div style={TABLE_STYLES.cardRow}><p style={{ color: "#616161", textAlign: "center" }}>No strings match this filter.</p></div>;
              }
              const visible = entries.slice(0, visibleCount);
              return (
                <>
                  <p style={{ color: "#616161", fontSize: 13, margin: "12px 0 8px" }}>
                    Showing {visible.length} of {entries.length} strings
                  </p>
                  <table style={TABLE_STYLES.table}>
                    <thead style={TABLE_STYLES.thead}>
                      <tr>
                        <th style={{ ...TABLE_STYLES.th, width: "25%" }}>Key</th>
                        <th style={{ ...TABLE_STYLES.th, width: "25%" }}>Source</th>
                        <th style={{ ...TABLE_STYLES.th, width: "30%" }}>Translation</th>
                        <th style={{ ...TABLE_STYLES.th, width: "8%" }}>Status</th>
                        <th style={{ ...TABLE_STYLES.th, width: "12%" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map(([key, source]) => {
                        const currentValue = translationOverrides[key] ?? selection.target[key] ?? "";
                        return (
                          <tr key={key}>
                            <td style={TABLE_STYLES.td}>
                              <strong style={{ fontSize: 13, wordBreak: "break-all" }}>
                                <HighlightText text={key} query={searchQuery} />
                              </strong>
                            </td>
                            <td style={{ ...TABLE_STYLES.td, fontSize: 13, color: "#444" }}>
                              <HighlightText text={source} query={searchQuery} />
                            </td>
                            <td style={TABLE_STYLES.td}>
                              <fetcher.Form method="post">
                                <input type="hidden" name="themeId" value={selection.themeId} />
                                <input type="hidden" name="sourceFilename" value={selection.sourceFilename} />
                                <input type="hidden" name="targetLocale" value={selection.targetLocale} />
                                <input type="hidden" name="key" value={key} />
                                <input type="hidden" name="intent" value="save" />
                                <textarea
                                  name="translation"
                                  value={currentValue}
                                  onChange={(e) => setTranslationOverrides((prev) => ({ ...prev, [key]: e.currentTarget.value }))}
                                  rows={2}
                                  aria-label={`Translation for ${key}`}
                                  style={TABLE_STYLES.textarea}
                                />
                              </fetcher.Form>
                            </td>
                            <td style={TABLE_STYLES.td}>{statusBadge(selection.statuses[key])}</td>
                            <td style={TABLE_STYLES.td}>
                              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                <s-button
                                  onClick={() => {
                                    fetcher.submit({
                                      intent: "save",
                                      themeId: selection.themeId,
                                      sourceFilename: selection.sourceFilename,
                                      targetLocale: selection.targetLocale,
                                      key,
                                      translation: currentValue,
                                    }, { method: "post" });
                                  }}
                                  loading={busy || undefined}
                                >
                                  Save
                                </s-button>
                                <s-button
                                  onClick={() => {
                                    fetcher.submit({
                                      intent: "translate",
                                      themeId: selection.themeId,
                                      sourceFilename: selection.sourceFilename,
                                      targetLocale: selection.targetLocale,
                                      key,
                                    }, { method: "post" });
                                  }}
                                  loading={busy || undefined}
                                  disabled={!data.gemini.configured || undefined}
                                >
                                  AI
                                </s-button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {visibleCount < entries.length && (
                    <div style={{ textAlign: "center", marginTop: 12 }}>
                      <s-button onClick={() => setVisibleCount((c) => c + (data.lazyLoadPageSize ?? 20))}>
                        Load more ({entries.length - visibleCount} remaining)
                      </s-button>
                    </div>
                  )}
                </>
              );
            })()}
          </s-section>
        </>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
