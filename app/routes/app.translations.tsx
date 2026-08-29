import { Fragment, useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useNavigation, Form } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { HighlightText } from "../components/HighlightText";
import { TABLE_STYLES } from "../components/tableStyles";
import { authenticate } from "../shopify.server";

async function loadServerModules() {
  const [{ translateBatch, buildGlossary }, { getShopGeminiConfiguration }, translationsLib] = await Promise.all([
    import("../lib/gemini.server"),
    import("../lib/gemini-settings.server"),
    import("../lib/shopify-translations.server"),
  ]);
  return { translateBatch, buildGlossary, getShopGeminiConfiguration, translationsLib };
}

const RESOURCE_CATEGORIES: Array<{ label: string; types: Array<{ value: string; label: string }> }> = [
  {
    label: "Products",
    types: [
      { value: "PRODUCT", label: "Products" },
      { value: "COLLECTION", label: "Collections" },
    ],
  },
  {
    label: "Online store",
    types: [
      { value: "ARTICLE", label: "Blog posts" },
      { value: "BLOG", label: "Blog titles" },
      { value: "PAGE", label: "Pages" },
      { value: "METAOBJECT", label: "Metaobjects & filters" },
      { value: "SHOP", label: "Store metadata, cookie banner, notifications, shipping" },
      { value: "SHOP_POLICY", label: "Policies (refund, privacy, terms, shipping)" },
    ],
  },
  {
    label: "Content",
    types: [
      { value: "MENU", label: "Navigation menus" },
      { value: "LINK", label: "Menu items (links)" },
    ],
  },
];

type ResourceData = {
  resourceId: string;
  name: string;
  translatableContent: Array<{ key: string; value: string; digest: string; locale: string }>;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const resourceType = url.searchParams.get("resourceType") || "";
  const targetLocale = url.searchParams.get("target") || "";
  const after = url.searchParams.get("after") || null;

  const { getShopGeminiConfiguration, translationsLib } = await loadServerModules();
  const { getDashboardData } = await import("../lib/shopify-theme.server");
  const { shopLocales } = await getDashboardData(admin);
  const targetLocales = shopLocales.filter((l) => !l.primary);

  const configuration = await getShopGeminiConfiguration(session.shop);
  const gemini = {
    configured: Boolean(configuration),
    model: configuration?.model ?? null,
  };
  const lazyLoadPageSize = configuration?.lazyLoadPageSize ?? 10;

  if (!resourceType || !targetLocale) {
    return { gemini, resourceType: "", targetLocale: "", resources: [], hasNextPage: false, endCursor: null, targetLocales, lazyLoadPageSize };
  }

  try {
    const result = await translationsLib.getTranslatableResources(admin, resourceType as never, after, lazyLoadPageSize);
    return {
      gemini,
      resourceType,
      targetLocale,
      resources: result.resources as unknown as ResourceData[],
      hasNextPage: result.hasNextPage,
      endCursor: result.endCursor,
      targetLocales,
      lazyLoadPageSize,
    };
  } catch (error) {
    console.error("[translations loader] error:", error);
    throw new Response(
      error instanceof Error ? error.message : "Failed to load translatable resources",
      { status: 500 },
    );
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const targetLocale = String(form.get("targetLocale") || "");
  const resourceType = String(form.get("resourceType") || "");
  const resourceId = String(form.get("resourceId") || "");

  const { translateBatch, buildGlossary, getShopGeminiConfiguration, translationsLib } = await loadServerModules();

  try {
    if (intent === "translateAll") {
      if (!targetLocale || !resourceType) throw new Error("Missing target locale or resource type");
      const configuration = await getShopGeminiConfiguration(session.shop);
      if (!configuration) throw new Error("Configure a Gemini API key in Settings first");

      const SKIP_KEYS = new Set(["handle"]);
      let cursor: string | null = null;
      let hasMore = true;
      let totalTranslated = 0;
      let totalErrors = 0;
      let glossary: Record<string, string> = {};

      while (hasMore) {
        const result = await translationsLib.getTranslatableResources(admin, resourceType as never, cursor, 10);
        for (const resource of result.resources) {
          if (!resource.translatableContent.length) continue;
          try {
            const translatable = resource.translatableContent.filter((c) => !SKIP_KEYS.has(c.key));
            if (!translatable.length) continue;
            const items = translatable.map((c) => ({ key: c.key, source: c.value }));
            const context = {
              resourceType,
              resourceName: resource.name,
              fields: translatable.map((c) => c.key),
              glossary: Object.keys(glossary).length ? glossary : undefined,
            };
            const geminiResult = await translateBatch(items, "en", targetLocale, configuration.apiKey, configuration.model, context);
            const translations = translatable.map((c) => ({
              key: c.key,
              value: geminiResult.translations[c.key] || "",
              digest: c.digest,
            })).filter((t) => t.value && t.digest);
            if (translations.length) {
              await translationsLib.registerTranslations(admin, resource.resourceId, targetLocale, translations);
              totalTranslated += translations.length;
              // Build glossary for consistency
              const sourceTargetPairs = translatable.map((c) => ({
                source: c.value,
                target: geminiResult.translations[c.key] || "",
              }));
              glossary = buildGlossary(sourceTargetPairs, glossary);
            }
          } catch (error) {
            console.error(`[translateAll] resource ${resource.resourceId} failed:`, error);
            totalErrors++;
          }
        }
        hasMore = result.hasNextPage;
        cursor = result.endCursor;
        if (totalTranslated > 5000) break;
      }
      return { ok: true, message: `Translated ${totalTranslated} field(s)${totalErrors ? `, ${totalErrors} errors` : ""}` };
    }

    if (!targetLocale || !resourceId) {
      return Response.json({ ok: false, message: "Missing target locale or resource ID" }, { status: 400 });
    }

    if (intent === "translate") {
      const configuration = await getShopGeminiConfiguration(session.shop);
      if (!configuration) throw new Error("Configure a Gemini API key in Settings first");

      const SKIP_KEYS = new Set(["handle"]);
      const allKeys = String(form.get("keys") || "").split("\n").filter(Boolean);
      const allSources = String(form.get("sources") || "").split("\n").filter(Boolean);
      const allDigests = String(form.get("digests") || "").split("\n").filter(Boolean);

      // Filter out handle fields
      const filteredIndices = allKeys.map((key, i) => ({ key, i })).filter(({ key }) => !SKIP_KEYS.has(key));
      const keys = filteredIndices.map(({ key }) => key);
      const sources = filteredIndices.map(({ i }) => allSources[i] || "");
      const digests = filteredIndices.map(({ i }) => allDigests[i] || "");

      if (!keys.length) throw new Error("No translatable fields (handle fields are skipped)");

      const items = keys.map((key, i) => ({ key, source: sources[i] || "" }));
      const result = await translateBatch(
        items,
        "en",
        targetLocale,
        configuration.apiKey,
        configuration.model,
        { resourceType, fields: keys },
      );

      const translations = keys.map((key, i) => ({
        key,
        value: result.translations[key] || "",
        digest: digests[i] || "",
      })).filter((t) => t.value && t.digest);

      if (!translations.length) throw new Error("Gemini returned no translations");

      const { registered, errors } = await translationsLib.registerTranslations(
        admin,
        resourceId,
        targetLocale,
        translations,
      );

      if (errors.length) throw new Error(errors.join("; "));
      return { ok: true, message: `Translated ${registered} field(s)`, resourceId };
    }

    if (intent === "save") {
      const keys = String(form.get("keys") || "").split("\n").filter(Boolean);
      const values = String(form.get("values") || "").split("\n").filter(Boolean);
      const digests = String(form.get("digests") || "").split("\n").filter(Boolean);

      const translations = keys.map((key, i) => ({
        key,
        value: values[i] || "",
        digest: digests[i] || "",
      })).filter((t) => t.value && t.digest);

      if (!translations.length) throw new Error("No translations to save");

      const { registered, errors } = await translationsLib.registerTranslations(
        admin,
        resourceId,
        targetLocale,
        translations,
      );

      if (errors.length) throw new Error(errors.join("; "));
      return { ok: true, message: `Saved ${registered} field(s)`, resourceId };
    }

    throw new Error("Unknown action");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    console.error("[translations action] error:", error);
    const message = [
      "Configure a Gemini API key in Settings first",
      "Missing target locale or resource ID",
      "No translation keys provided",
      "No translations to save",
      "Unknown action",
    ].includes(detail) ? detail : "The translation request could not be completed";
    return Response.json({ ok: false, message, detail }, { status: 400 });
  }
};

type AdminClientType = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export default function TranslationsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const isSubmitting = fetcher.state !== "idle";
  const [submittingForm, setSubmittingForm] = useState<string | null>(null);
  const [editingResource, setEditingResource] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, Record<string, string>>>({});
  const [extraResources, setExtraResources] = useState<ResourceData[]>([]);
  const [moreCursor, setMoreCursor] = useState<string | null>(data.endCursor);
  const [hasMore, setHasMore] = useState(data.hasNextPage);
  const [searchQuery, setSearchQuery] = useState("");
  const [translatingAll, setTranslatingAll] = useState(false);
  const moreFetcher = useFetcher<typeof loader>();

  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    if (fetcher.state === "idle" && translatingAll) setTranslatingAll(false);
    if (fetcher.state === "idle") setSubmittingForm(null);
  }, [fetcher.data, fetcher.state, shopify, translatingAll]);

  useEffect(() => {
    setEditingResource(null);
    setEditValues({});
    setExtraResources([]);
    setMoreCursor(data.endCursor);
    setHasMore(data.hasNextPage);
    setSearchQuery("");
  }, [data.resourceType, data.targetLocale]);

  useEffect(() => {
    if (moreFetcher.state === "idle" && moreFetcher.data?.resources) {
      const newResources = moreFetcher.data.resources as unknown as ResourceData[];
      setExtraResources((prev) => [...prev, ...newResources]);
      setMoreCursor(moreFetcher.data.endCursor);
      setHasMore(moreFetcher.data.hasNextPage);
    }
  }, [moreFetcher.state, moreFetcher.data]);

  const loadMore = () => {
    if (!moreCursor || !data.resourceType || !data.targetLocale) return;
    const params = new URLSearchParams({
      resourceType: data.resourceType,
      target: data.targetLocale,
      after: moreCursor,
    });
    moreFetcher.load(`/app/translations?${params.toString()}`);
  };

  const pageSize = data.lazyLoadPageSize ?? 10;

  const resources = [...(data.resources as unknown as ResourceData[]), ...extraResources];

  return (
    <s-page heading="Content">
      {!data.gemini.configured && (
        <s-banner tone="warning">
          Gemini is not configured. <s-link href="/app/settings">Add an API key in Settings</s-link>.
        </s-banner>
      )}

      {/* Selector */}
      <s-section heading="Select content type">
        <Form method="get">
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Content type</label>
              <select
                name="resourceType"
                defaultValue={data.resourceType || ""}
                required
                style={TABLE_STYLES.select}
              >
                <option value="">Select a content type</option>
                {RESOURCE_CATEGORIES.map((cat) => (
                  <optgroup key={cat.label} label={cat.label}>
                    {cat.types.map((rt) => (
                      <option key={rt.value} value={rt.value}>{rt.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Target language</label>
              <select
                name="target"
                defaultValue={data.targetLocale || ""}
                required
                style={TABLE_STYLES.select}
              >
                <option value="">Select target</option>
                {data.targetLocales.map((locale) => (
                  <option key={locale.locale} value={locale.locale}>{locale.name} ({locale.locale}){locale.published ? "" : " — unpublished"}</option>
                ))}
              </select>
            </div>
            <s-button type="submit" loading={navigation.state !== "idle" || undefined}>Load</s-button>
          </div>
        </Form>
      </s-section>

      {resources.length > 0 && (
        <s-section heading={`Translatable content (${resources.length} loaded)`}>
          <div style={TABLE_STYLES.toolbar}>
            <input
              type="search"
              placeholder="Search by name or content..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.currentTarget.value)}
              style={TABLE_STYLES.searchInput}
            />
            <fetcher.Form method="post" style={{ display: "inline" }} onSubmit={() => setSubmittingForm("translateAll")}>
              <input type="hidden" name="intent" value="translateAll" />
              <input type="hidden" name="resourceType" value={data.resourceType} />
              <input type="hidden" name="targetLocale" value={data.targetLocale} />
              <s-button
                type="submit"
                variant="primary"
                loading={translatingAll || (submittingForm === "translateAll" && isSubmitting) || undefined}
                disabled={!data.gemini.configured || undefined}
                onClick={() => setTranslatingAll(true)}
              >
                Translate all with AI
              </s-button>
            </fetcher.Form>
          </div>

          {translatingAll && (
            <s-banner tone="info">Translating all content... This may take a while.</s-banner>
          )}

          {(() => {
            const filtered = searchQuery.trim()
              ? resources.filter((r) => {
                  const q = searchQuery.toLowerCase();
                  return r.name.toLowerCase().includes(q) ||
                    r.translatableContent.some((c) => c.value.toLowerCase().includes(q) || c.key.toLowerCase().includes(q));
                })
              : resources;
            if (!filtered.length) return <div style={TABLE_STYLES.cardRow}><p style={{ color: "#616161", textAlign: "center" }}>No resources match your search.</p></div>;

            return (
              <>
                <p style={{ color: "#616161", fontSize: 13, margin: "12px 0 8px" }}>
                  Showing {filtered.length} of {resources.length} resources
                </p>
                <table style={TABLE_STYLES.table}>
                  <thead style={TABLE_STYLES.thead}>
                    <tr>
                      <th style={{ ...TABLE_STYLES.th, width: "30%" }}>Name</th>
                      <th style={{ ...TABLE_STYLES.th, width: "10%" }}>Fields</th>
                      <th style={{ ...TABLE_STYLES.th, width: "40%" }}>Preview</th>
                      <th style={{ ...TABLE_STYLES.th, width: "20%" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((resource) => {
                      const isEditing = editingResource === resource.resourceId;
                      const hasContent = resource.translatableContent.length > 0;
                      return (
                        <Fragment key={resource.resourceId}>
                          <tr style={TABLE_STYLES.trHover}>
                            <td style={TABLE_STYLES.td}>
                              <strong style={{ fontSize: 14 }}>
                                <HighlightText text={resource.name} query={searchQuery} />
                              </strong>
                            </td>
                            <td style={TABLE_STYLES.td}>
                              {hasContent ? (
                                <span style={{ ...TABLE_STYLES.badge, ...TABLE_STYLES.badgeInfo }}>
                                  {resource.translatableContent.length} fields
                                </span>
                              ) : (
                                <span style={{ ...TABLE_STYLES.badge, ...TABLE_STYLES.badgeCritical }}>empty</span>
                              )}
                            </td>
                            <td style={{ ...TABLE_STYLES.td, fontSize: 13, color: "#444" }}>
                              {hasContent ? (
                                <HighlightText
                                  text={resource.translatableContent[0].value.slice(0, 80) + (resource.translatableContent[0].value.length > 80 ? "..." : "")}
                                  query={searchQuery}
                                />
                              ) : "—"}
                            </td>
                            <td style={TABLE_STYLES.td}>
                              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                {hasContent && (
                                  <s-button
                                    onClick={() => {
                                      if (isEditing) {
                                        setEditingResource(null);
                                      } else {
                                        setEditingResource(resource.resourceId);
                                        setEditValues((prev) => ({
                                          ...prev,
                                          [resource.resourceId]: Object.fromEntries(
                                            resource.translatableContent.map((c) => [c.key, c.value]),
                                          ),
                                        }));
                                      }
                                    }}
                                  >
                                    {isEditing ? "Close" : "Edit"}
                                  </s-button>
                                )}
                                {hasContent && (
                                  <fetcher.Form method="post" style={{ display: "inline" }} onSubmit={() => setSubmittingForm(`ai-${resource.resourceId}`)}>
                                    <input type="hidden" name="intent" value="translate" />
                                    <input type="hidden" name="resourceId" value={resource.resourceId} />
                                    <input type="hidden" name="targetLocale" value={data.targetLocale} />
                                    <input type="hidden" name="keys" value={resource.translatableContent.map((c) => c.key).join("\n")} />
                                    <input type="hidden" name="sources" value={resource.translatableContent.map((c) => c.value).join("\n")} />
                                    <input type="hidden" name="digests" value={resource.translatableContent.map((c) => c.digest).join("\n")} />
                                    <s-button type="submit" loading={(submittingForm === `ai-${resource.resourceId}` && isSubmitting) || undefined} disabled={!data.gemini.configured || undefined}>
                                      AI
                                    </s-button>
                                  </fetcher.Form>
                                )}
                              </div>
                            </td>
                          </tr>
                          {isEditing && hasContent && (
                            <tr key={`${resource.resourceId}-edit`}>
                              <td colSpan={4} style={{ ...TABLE_STYLES.td, background: "#fafafa" }}>
                                <fetcher.Form method="post" onSubmit={() => setSubmittingForm(`save-${resource.resourceId}`)}>
                                  <input type="hidden" name="intent" value="save" />
                                  <input type="hidden" name="resourceId" value={resource.resourceId} />
                                  <input type="hidden" name="targetLocale" value={data.targetLocale} />
                                  <input type="hidden" name="keys" value={resource.translatableContent.map((c) => c.key).join("\n")} />
                                  <input type="hidden" name="digests" value={resource.translatableContent.map((c) => c.digest).join("\n")} />
                                  <table style={TABLE_STYLES.table}>
                                    <thead style={TABLE_STYLES.thead}>
                                      <tr>
                                        <th style={{ ...TABLE_STYLES.th, width: "20%" }}>Field</th>
                                        <th style={{ ...TABLE_STYLES.th, width: "35%" }}>Source</th>
                                        <th style={{ ...TABLE_STYLES.th, width: "35%" }}>Translation</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {resource.translatableContent.map((content) => (
                                        <tr key={content.key}>
                                          <td style={TABLE_STYLES.td}><strong style={{ fontSize: 13 }}>{content.key}</strong></td>
                                          <td style={{ ...TABLE_STYLES.td, fontSize: 13, color: "#444" }}>{content.value.slice(0, 200)}{content.value.length > 200 ? "..." : ""}</td>
                                          <td style={TABLE_STYLES.td}>
                                            <textarea
                                              value={editValues[resource.resourceId]?.[content.key] ?? ""}
                                              onChange={(e) =>
                                                setEditValues((prev) => ({
                                                  ...prev,
                                                  [resource.resourceId]: {
                                                    ...prev[resource.resourceId],
                                                    [content.key]: (e.currentTarget as unknown as HTMLTextAreaElement).value,
                                                  },
                                                }))
                                              }
                                              rows={2}
                                              placeholder={`Translation in ${data.targetLocale}...`}
                                              style={TABLE_STYLES.textarea}
                                            />
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  <input
                                    type="hidden"
                                    name="values"
                                    value={resource.translatableContent
                                      .map((c) => editValues[resource.resourceId]?.[c.key] ?? "")
                                      .join("\n")}
                                  />
                                  <div style={{ marginTop: 8 }}>
                                    <s-button type="submit" variant="primary" loading={(submittingForm === `save-${resource.resourceId}` && isSubmitting) || undefined}>
                                      Save translations
                                    </s-button>
                                  </div>
                                </fetcher.Form>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
                {hasMore && (
                  <div style={{ textAlign: "center", marginTop: 12 }}>
                    <s-button onClick={loadMore} loading={moreFetcher.state !== "idle" || undefined}>
                      Load more
                    </s-button>
                  </div>
                )}
              </>
            );
          })()}
        </s-section>
      )}

      {data.resourceType && data.targetLocale && resources.length === 0 && navigation.state === "idle" && (
        <s-section heading="No content">
          <s-paragraph>No translatable content found for this content type.</s-paragraph>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
