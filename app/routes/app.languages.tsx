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
  { label: "Theme", types: ["THEME"] },
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
  THEME: "Theme content (app embeds, sections, templates, settings)",
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

// Theme locale file top-level sections that correspond to the categories the user sees
const THEME_SECTION_LABELS: Record<string, string> = {
  general: "General UI strings",
  sections: "Sections",
  templates: "Templates",
  theme_settings: "Theme settings",
  customer: "Customer account",
  products: "Product strings",
  collections: "Collection strings",
  blogs: "Blog strings",
  articles: "Article strings",
  pages: "Page strings",
  cart: "Cart",
  search: "Search",
  contact: "Contact forms",
  social: "Social media",
  gift_cards: "Gift cards",
  accessibility: "Accessibility",
  date_formats: "Date formats",
  number_formats: "Number formats",
  shop: "Shop settings",
};

async function translateThemeContent(
  getAdmin: () => Promise<{ graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> }>,
  shop: string,
  targetLocale: string,
  apiKey: string,
  model: string,
  jobId: string,
  mode: "all" | "force" | "missing",
) {
  const { getDashboardData, getThemeLocaleFiles, getThemeJsonFiles, readThemeLocale, upsertThemeLocale, extractTranslatableFromThemeJson } = await import("../lib/shopify-theme.server");
  const { translateBatch, isRetryableGeminiError, buildGlossary } = await import("../lib/gemini.server");
  const { flattenLocale, mergeLocale, localeFilenameFor, localeFromFilename, parseLocaleJson } = await import("../lib/locale");

  let admin = await getAdmin();
  let glossary: Record<string, string> = {};
  const dashboard = await getDashboardData(admin);
  const primaryLocale = dashboard.shopLocales.find((l) => l.primary);
  if (!primaryLocale) throw new Error("No primary locale found");

  // Find the main theme (published theme)
  const theme = dashboard.themes.find((t) => t.role === "main") || dashboard.themes[0];
  if (!theme) throw new Error("No theme found");

  // Update job with current resource type
  await prisma.contentTranslationJob.update({
    where: { id: jobId },
    data: { currentResourceType: "THEME", currentResourceCount: 0, totalResourceCount: 0 },
  });

  const files = await getThemeLocaleFiles(admin, theme.id);

  // Find all source files for the primary locale (main + schema + any others)
  const primaryPrefix = `locales/${primaryLocale.locale}`;
  const sourceFiles = files.filter((f) =>
    f.filename === `${primaryPrefix}.default.json` ||
    f.filename === `${primaryPrefix}.json` ||
    f.filename === `${primaryPrefix}.default.schema.json` ||
    f.filename === `${primaryPrefix}.schema.json`
  );
  if (!sourceFiles.length) throw new Error(`No source locale files found for ${primaryLocale.locale}`);
  if (!sourceFiles.some((f) => !f.filename.endsWith(".schema.json"))) {
    throw new Error(`Source locale file ${primaryPrefix}.default.json not found`);
  }
  const filesToTranslate = sourceFiles;
  console.log("[translateThemeContent] files to translate:", filesToTranslate.map((f) => f.filename).join(", "));
  let fileCount = 0;

  for (const file of filesToTranslate) {
    const isSchema = file.filename.endsWith(".schema.json");
    const sourceLocale = localeFromFilename(file.filename);
    const targetFilename = localeFilenameFor(file.filename, targetLocale);
    console.log(`[translateThemeContent] processing ${file.filename} → ${targetFilename} (${isSchema ? "schema" : "content"})`);

    // Read source content (use parseLocaleJson to handle comment headers)
    const sourceJson = parseLocaleJson(file.content) as Record<string, unknown>;
    const flatSource = flattenLocale(sourceJson);
    console.log(`[translateThemeContent] ${file.filename}: ${Object.keys(flatSource).length} strings to translate`);

    // Read existing target file if it exists (for "missing" mode)
    let existingTarget: Record<string, string> = {};
    const targetFile = files.find((f) => f.filename === targetFilename);
    if (targetFile) {
      const targetJson = parseLocaleJson(targetFile.content) as Record<string, unknown>;
      existingTarget = flattenLocale(targetJson);
    }

    // Filter keys based on mode
    let keysToTranslate = Object.entries(flatSource);
    if (mode === "missing") {
      keysToTranslate = keysToTranslate.filter(([key]) => !existingTarget[key]?.trim());
    }

    if (!keysToTranslate.length) {
      fileCount++;
      continue;
    }

    // Group by top-level section for batched translation with context
    const sections = new Map<string, Array<[string, string]>>();
    for (const [key, value] of keysToTranslate) {
      const section = key.split("/")[1] || "other"; // first segment after leading /
      if (!sections.has(section)) sections.set(section, []);
      sections.get(section)!.push([key, value]);
    }

    const translations: Record<string, string> = {};
    let sectionCount = 0;
    const totalSections = sections.size;

    for (const [section, entries] of sections) {
      const jobCheck = await prisma.contentTranslationJob.findUnique({ where: { id: jobId } });
      if (!jobCheck || jobCheck.status === "cancelled") return;

      const sectionLabel = THEME_SECTION_LABELS[section] || section;
      const items = entries.map(([key, source]) => ({ key, source }));
      const context = {
        resourceType: "THEME",
        resourceName: `${isSchema ? "Theme settings schema" : "Theme content"} — ${sectionLabel}`,
        fields: [section],
        glossary: Object.keys(glossary).length ? glossary : undefined,
      };

      try {
        let geminiResult;
        try {
          geminiResult = await translateBatch(items, sourceLocale, targetLocale, apiKey, model, context);
        } catch (retryableError) {
          if (isRetryableGeminiError(retryableError)) {
            console.log("[translateThemeContent] Rate limited, waiting 60s before retry...");
            await new Promise((resolve) => setTimeout(resolve, 60000));
            geminiResult = await translateBatch(items, sourceLocale, targetLocale, apiKey, model, context);
          } else {
            throw retryableError;
          }
        }
        Object.assign(translations, geminiResult.translations);
        // Build glossary from this section for consistency
        const sourceTargetPairs = entries.map(([key, source]) => ({
          source,
          target: geminiResult.translations[key] || "",
        }));
        glossary = buildGlossary(sourceTargetPairs, glossary);
      } catch (error) {
        console.error(`[translateThemeContent] section ${section} failed:`, error);
      }

      sectionCount++;
      await prisma.contentTranslationJob.update({
        where: { id: jobId },
        data: { currentResourceCount: sectionCount, totalResourceCount: totalSections },
      });
    }

    // Merge translations into existing target (if any) and write back
    const baseJson = targetFile ? parseLocaleJson(targetFile.content) as Record<string, unknown> : structuredClone(sourceJson);
    const merged = mergeLocale(baseJson, translations);
    try {
      await upsertThemeLocale(admin, theme.id, targetFilename, merged);
    } catch (error: unknown) {
      // Re-authenticate on 401 and retry
      const is401 = error instanceof Error && ("response" in error) && (error as { response?: { code?: number } }).response?.code === 401;
      if (is401) {
        console.log("[translateThemeContent] Token expired (401), re-authenticating...");
        admin = await getAdmin();
        await upsertThemeLocale(admin, theme.id, targetFilename, merged);
      } else {
        throw error;
      }
    }
    fileCount++;
  }

  // Now translate template and section group JSON files (app embeds, section groups, static sections, templates)
  // The text is hardcoded in template files, but we DON'T modify the templates — instead we write
  // translations as overrides into the target locale file (e.g., locales/lv.json).
  // Shopify's rendering engine checks the locale file first and uses it instead of the hardcoded value.
  console.log("[translateThemeContent] Fetching template and section group JSON files...");
  const jsonFiles = await getThemeJsonFiles(admin, theme.id);
  console.log(`[translateThemeContent] Found ${jsonFiles.length} template/section JSON files`);

  // We'll collect all translations and merge them into the target locale file at the end
  const templateTranslations: Record<string, string> = {}; // flat key → translated value

  for (const jsonFile of jsonFiles) {
    const jobCheck = await prisma.contentTranslationJob.findUnique({ where: { id: jobId } });
    if (!jobCheck || jobCheck.status === "cancelled") return;

    try {
      const sourceJson = parseLocaleJson(jsonFile.content) as Record<string, unknown>;
      const translatableFields = extractTranslatableFromThemeJson(sourceJson);

      if (!translatableFields.length) {
        continue;
      }

      console.log(`[translateThemeContent] ${jsonFile.filename}: ${translatableFields.length} translatable strings`);

      // Translate in batches of 30 fields
      const BATCH_SIZE = 30;

      for (let i = 0; i < translatableFields.length; i += BATCH_SIZE) {
        const batch = translatableFields.slice(i, i + BATCH_SIZE);
        const items = batch.map((f, idx) => ({ key: String(idx), source: f.value }));
        const context = {
          resourceType: "THEME",
          resourceName: `Theme template — ${jsonFile.filename}`,
          fields: batch.map((f) => f.key),
          glossary: Object.keys(glossary).length ? glossary : undefined,
        };

        try {
          let geminiResult;
          try {
            geminiResult = await translateBatch(items, "en", targetLocale, apiKey, model, context);
          } catch (retryableError) {
            if (isRetryableGeminiError(retryableError)) {
              console.log("[translateThemeContent] Rate limited, waiting 60s before retry...");
              await new Promise((resolve) => setTimeout(resolve, 60000));
              geminiResult = await translateBatch(items, "en", targetLocale, apiKey, model, context);
            } else {
              throw retryableError;
            }
          }

          // Convert each field's path to a locale file key and store the translation
          for (let j = 0; j < batch.length; j++) {
            const translatedValue = geminiResult.translations[String(j)];
            if (translatedValue && translatedValue !== batch[j].value) {
              // Convert path array to locale file flat key: ["sections","foo","settings","text"] → "/sections/foo/settings/text"
              const localeKey = "/" + batch[j].path.map((s) => s.replaceAll("~", "~0").replaceAll("/", "~1")).join("/");
              templateTranslations[localeKey] = translatedValue;
            }
          }

          // Build glossary
          const sourceTargetPairs = batch.map((f, idx) => ({
            source: f.value,
            target: geminiResult.translations[String(idx)] || "",
          }));
          glossary = buildGlossary(sourceTargetPairs, glossary);
        } catch (error) {
          console.error(`[translateThemeContent] ${jsonFile.filename} batch ${i} failed:`, error);
        }
      }
    } catch (error) {
      console.error(`[translateThemeContent] ${jsonFile.filename} failed:`, error);
    }
  }

  // Merge template translations into the target locale file and write it
  if (Object.keys(templateTranslations).length) {
    console.log(`[translateThemeContent] Merging ${Object.keys(templateTranslations).length} template translations into locale file`);
    const targetLocaleFilename = `locales/${targetLocale}.json`;
    const targetLocaleFile = files.find((f) => f.filename === targetLocaleFilename);
    const baseLocaleJson = targetLocaleFile ? parseLocaleJson(targetLocaleFile.content) as Record<string, unknown> : {};
    const mergedLocale = mergeLocale(baseLocaleJson, templateTranslations);

    try {
      await upsertThemeLocale(admin, theme.id, targetLocaleFilename, mergedLocale);
      console.log(`[translateThemeContent] Wrote ${targetLocaleFilename} with template translations`);
    } catch (error: unknown) {
      const is401 = error instanceof Error && ("response" in error) && (error as { response?: { code?: number } }).response?.code === 401;
      if (is401) {
        console.log("[translateThemeContent] Token expired (401), re-authenticating...");
        admin = await getAdmin();
        await upsertThemeLocale(admin, theme.id, targetLocaleFilename, mergedLocale);
      } else {
        throw error;
      }
    }
  }

  console.log(`[translateThemeContent] Done. Processed locale files + ${jsonFiles.length} template/section files`);
}

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
  const { translateBatch, isRetryableGeminiError, buildGlossary } = await import("../lib/gemini.server");
  let completed = 0;
  let totalSkipped = 0;
  let glossary: Record<string, string> = {};

  // Re-authenticate to get a fresh admin client that isn't tied to the request lifecycle.
  // Tokens expire during long jobs, so we use a mutable admin ref and re-authenticate on 401.
  let admin = (await unauthenticated.admin(shop)).admin;

  // Helper: run a function with admin, re-authenticating on 401 Unauthorized
  type AdminClient = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };
  async function withAdmin<T>(fn: (admin: AdminClient) => Promise<T>): Promise<T> {
    try {
      return await fn(admin);
    } catch (error: unknown) {
      const is401 = error instanceof Error &&
        ("response" in error) && (error as { response?: { code?: number } }).response?.code === 401;
      if (!is401) throw error;
      console.log("[translateResources] Token expired (401), re-authenticating...");
      admin = (await unauthenticated.admin(shop)).admin;
      return await fn(admin);
    }
  }

  for (const resourceType of resourceTypes) {
    const job = await prisma.contentTranslationJob.findUnique({ where: { id: jobId } });
    if (!job || job.status === "cancelled") break;

    // Theme content is translated differently — via locale JSON files, not the TranslatableResource API
    if (resourceType === "THEME") {
      try {
        await translateThemeContent(async () => admin, shop, targetLocale, apiKey, model, jobId, mode);
      } catch (error) {
        console.error("[translateResources] THEME failed:", error);
      }
      completed++;
      await prisma.contentTranslationJob.update({
        where: { id: jobId },
        data: { completedItems: completed, currentResourceType: null },
      });
      continue;
    }
    // Update current resource type being processed
    await prisma.contentTranslationJob.update({
      where: { id: jobId },
      data: { currentResourceType: resourceType, currentResourceCount: 0, totalResourceCount: 0 },
    });

    try {
      let cursor: string | null = null;
      let hasMore = true;
      let resourceCount = 0;
      while (hasMore) {
        const result = await withAdmin((a) => getTranslatableResources(a, resourceType as never, cursor, 10));
        // Set total resource count on first page
        if (cursor === null && result.resources.length > 0) {
          // Estimate: if there's a next page, we don't know total yet
          // We'll just track how many we've processed
        }
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
            const context = {
              resourceType,
              resourceName: resource.name,
              fields: fieldsToTranslate.map((c) => c.key),
              glossary: Object.keys(glossary).length ? glossary : undefined,
            };
            let geminiResult;
            try {
              geminiResult = await translateBatch(items, "en", targetLocale, apiKey, model, context);
            } catch (retryableError) {
              if (isRetryableGeminiError(retryableError)) {
                // Wait 60s and retry once for rate limits
                console.log("[translateResources] Rate limited, waiting 60s before retry...");
                await new Promise((resolve) => setTimeout(resolve, 60000));
                geminiResult = await translateBatch(items, "en", targetLocale, apiKey, model, context);
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
              await withAdmin((a) => registerTranslations(a, resource.resourceId, targetLocale, translations));
              // Build glossary from this translation for consistency in subsequent batches
              const sourceTargetPairs = fieldsToTranslate.map((c) => ({
                source: c.value,
                target: geminiResult.translations[c.key] || "",
              }));
              glossary = buildGlossary(sourceTargetPairs, glossary);
            }
          } catch (error) {
            console.error(`[translateResources] resource ${resource.resourceId} failed:`, error);
          }
          resourceCount++;
          // Update progress every 5 resources to avoid too many DB writes
          if (resourceCount % 5 === 0) {
            await prisma.contentTranslationJob.update({
              where: { id: jobId },
              data: { currentResourceCount: resourceCount },
            });
          }
        }
        hasMore = result.hasNextPage;
        cursor = result.endCursor;
      }
      // Final update for this resource type
      await prisma.contentTranslationJob.update({
        where: { id: jobId },
        data: { currentResourceCount: resourceCount, totalResourceCount: resourceCount },
      });
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
    data: { status: "completed", completedAt: new Date(), currentResourceType: null },
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

  // Clear submitting state when fetcher returns to idle, and immediately refresh job data
  useEffect(() => {
    if (fetcher.state === "idle") {
      setSubmittingForm(null);
      // If we just submitted a form, immediately poll for fresh job data
      if (fetcher.data) {
        poller.load("/app/languages");
      }
    }
  }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Use poller data when available, otherwise fall back to initial loader data
  const liveJobs = poller.data?.jobs ?? data.jobs;
  const liveTargetLocales = poller.data?.targetLocales ?? data.targetLocales;

  // Poll for job status updates if any job is active — uses separate fetcher to avoid button loading states
  const hasActiveJobs = liveJobs.some((j) => j.status === "active" || j.status === "pending");
  useEffect(() => {
    if (!hasActiveJobs) return;
    const interval = setInterval(() => {
      poller.load("/app/languages");
    }, 3000);
    return () => clearInterval(interval);
  }, [hasActiveJobs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Get the latest job per (locale, resourceType) combination
  // liveJobs is ordered by updatedAt desc (newest first), so only keep the first (newest) entry per key
  const jobByKey = new Map<string, typeof liveJobs[number]>();
  for (const j of liveJobs) {
    const key = `${j.targetLocale}:${j.resourceType}`;
    if (!jobByKey.has(key)) jobByKey.set(key, j);
  }
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
            {liveTargetLocales.map((lang) => {
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
                            {fullJob.currentResourceType && (isActive || anyCategoryActive) && (
                              <span style={{ color: "#0066cc" }}> · translating {RESOURCE_LABELS[fullJob.currentResourceType] || fullJob.currentResourceType}...</span>
                            )}
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
                                const catCompleted = catJob?.status === "completed";
                                const catFailed = catJob?.status === "failed";

                                // Determine status from full job if a full job is running
                                let fullJobStatus: "pending" | "active" | "done" | null = null;
                                let fullJobResourceCount = 0;
                                if (fullJob && (isActive || anyCategoryActive)) {
                                  const completedTypes = fullJob.completedItems;
                                  const allTypes = ALL_RESOURCE_TYPES;
                                  const rtIndex = allTypes.indexOf(rt as typeof ALL_RESOURCE_TYPES[number]);
                                  if (rtIndex < completedTypes) {
                                    fullJobStatus = "done";
                                  } else if (rtIndex === completedTypes) {
                                    fullJobStatus = "active";
                                    fullJobResourceCount = fullJob.currentResourceCount || 0;
                                  } else {
                                    fullJobStatus = "pending";
                                  }
                                }

                                // For single-category jobs, catJob directly tells us the status
                                const isThisCategoryActive = catActive || fullJobStatus === "active";
                                const isThisCategoryDone = catCompleted || fullJobStatus === "done";
                                const isThisCategoryQueued = fullJobStatus === "pending";
                                const isThisCategoryFailed = catFailed;

                                return (
                                  <tr key={`${category.label}-${rt}`}>
                                    <td style={TABLE_STYLES.td}>
                                      {idx === 0 ? <strong style={{ fontSize: 13 }}>{category.label}</strong> : ""}
                                    </td>
                                    <td style={TABLE_STYLES.td}><span style={{ fontSize: 13 }}>{RESOURCE_LABELS[rt]}</span></td>
                                    <td style={TABLE_STYLES.td}>
                                      {isThisCategoryActive ? <span style={{ ...TABLE_STYLES.badge, ...TABLE_STYLES.badgeInfo }}>translating</span> :
                                        isThisCategoryDone ? <span style={{ ...TABLE_STYLES.badge, ...TABLE_STYLES.badgeSuccess }}>done</span> :
                                        isThisCategoryFailed ? <span style={{ ...TABLE_STYLES.badge, ...TABLE_STYLES.badgeCritical }}>failed</span> :
                                        isThisCategoryQueued ? <span style={{ ...TABLE_STYLES.badge, ...TABLE_STYLES.badgeNeutral }}>queued</span> :
                                        <span style={{ ...TABLE_STYLES.badge, ...TABLE_STYLES.badgeNeutral }}>not started</span>}
                                    </td>
                                    <td style={TABLE_STYLES.td}>
                                      {isThisCategoryActive ? (
                                        <div>
                                          <div style={TABLE_STYLES.progressBar}>
                                            <div style={TABLE_STYLES.progressFill(catActive ? catProgress : 100)} />
                                          </div>
                                          <div style={{ fontSize: 11, color: "#616161", marginTop: 2 }}>
                                            {catActive
                                              ? `${catJob!.completedItems} / ${catJob!.totalItems} (${catProgress}%)`
                                              : `${fullJobResourceCount} resources processed...`}
                                          </div>
                                        </div>
                                      ) : isThisCategoryDone ? (
                                        <span style={{ color: "#107c10", fontSize: 12 }}>✓ Completed</span>
                                      ) : isThisCategoryFailed ? (
                                        <span style={{ color: "#c50f0f", fontSize: 12 }}>Failed: {catJob?.error}</span>
                                      ) : isThisCategoryQueued ? (
                                        <span style={{ color: "#999", fontSize: 12 }}>Waiting...</span>
                                      ) : <span style={{ color: "#999", fontSize: 12 }}>—</span>}
                                    </td>
                                    <td style={TABLE_STYLES.td}>
                                      {!isThisCategoryActive && !isThisCategoryQueued && (
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
