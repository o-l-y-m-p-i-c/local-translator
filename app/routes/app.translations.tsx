import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useNavigation, Form } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

async function loadServerModules() {
  const [{ translateBatch }, { getShopGeminiConfiguration }, translationsLib] = await Promise.all([
    import("../lib/gemini.server"),
    import("../lib/gemini-settings.server"),
    import("../lib/shopify-translations.server"),
  ]);
  return { translateBatch, getShopGeminiConfiguration, translationsLib };
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

const TARGET_LANGUAGES = [
  { value: "lv", label: "Latvian (lv)" },
  { value: "de", label: "German (de)" },
  { value: "fr", label: "French (fr)" },
  { value: "es", label: "Spanish (es)" },
  { value: "ru", label: "Russian (ru)" },
  { value: "et", label: "Estonian (et)" },
  { value: "lt", label: "Lithuanian (lt)" },
  { value: "pl", label: "Polish (pl)" },
  { value: "fi", label: "Finnish (fi)" },
  { value: "sv", label: "Swedish (sv)" },
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
  const configuration = await getShopGeminiConfiguration(session.shop);
  const gemini = {
    configured: Boolean(configuration),
    model: configuration?.model ?? null,
  };

  if (!resourceType || !targetLocale) {
    return { gemini, resourceType: "", targetLocale: "", resources: [], hasNextPage: false, endCursor: null };
  }

  try {
    const result = await translationsLib.getTranslatableResources(admin, resourceType as never, after, 10);
    return {
      gemini,
      resourceType,
      targetLocale,
      resources: result.resources as unknown as ResourceData[],
      hasNextPage: result.hasNextPage,
      endCursor: result.endCursor,
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
  const resourceId = String(form.get("resourceId") || "");

  if (!targetLocale || !resourceId) {
    return Response.json({ ok: false, message: "Missing target locale or resource ID" }, { status: 400 });
  }

  const { translateBatch, getShopGeminiConfiguration, translationsLib } = await loadServerModules();

  try {
    if (intent === "translate") {
      const configuration = await getShopGeminiConfiguration(session.shop);
      if (!configuration) throw new Error("Configure a Gemini API key in Settings first");

      const keys = String(form.get("keys") || "").split("\n").filter(Boolean);
      const sources = String(form.get("sources") || "").split("\n").filter(Boolean);
      const digests = String(form.get("digests") || "").split("\n").filter(Boolean);

      if (!keys.length) throw new Error("No translation keys provided");

      const items = keys.map((key, i) => ({ key, source: sources[i] || "" }));
      const result = await translateBatch(
        items,
        "en",
        targetLocale,
        configuration.apiKey,
        configuration.model,
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

export default function TranslationsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle" || navigation.state !== "idle";
  const [editingResource, setEditingResource] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, Record<string, string>>>({});
  const [extraResources, setExtraResources] = useState<ResourceData[]>([]);
  const [moreCursor, setMoreCursor] = useState<string | null>(data.endCursor);
  const [hasMore, setHasMore] = useState(data.hasNextPage);
  const moreFetcher = useFetcher<typeof loader>();

  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
  }, [fetcher.data, shopify]);

  useEffect(() => {
    setEditingResource(null);
    setEditValues({});
    setExtraResources([]);
    setMoreCursor(data.endCursor);
    setHasMore(data.hasNextPage);
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

  const resources = [...(data.resources as unknown as ResourceData[]), ...extraResources];

  return (
    <s-page heading="Content translations">
      <s-section heading="Select content type">
        <Form method="get">
          <s-stack direction="block" gap="base">
            <label>
              <s-text>Content type</s-text>
              <select
                name="resourceType"
                defaultValue={data.resourceType || ""}
                required
                style={{ display: "block", width: "100%", padding: 10, marginTop: 6 }}
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
            </label>
            <label>
              <s-text>Target language</s-text>
              <select
                name="target"
                defaultValue={data.targetLocale || ""}
                required
                style={{ display: "block", width: "100%", padding: 10, marginTop: 6 }}
              >
                <option value="">Select a target language</option>
                {TARGET_LANGUAGES.map((lang) => (
                  <option key={lang.value} value={lang.value}>{lang.label}</option>
                ))}
              </select>
            </label>
            <s-button type="submit" loading={navigation.state !== "idle" || undefined}>
              Load translatable content
            </s-button>
          </s-stack>
        </Form>
      </s-section>

      {data.gemini.configured ? (
        <s-section heading="Gemini">
          <s-paragraph>Model: {data.gemini.model}. <s-link href="/app/settings">Manage settings</s-link></s-paragraph>
        </s-section>
      ) : (
        <s-section heading="Gemini">
          <s-banner tone="warning">Gemini is not configured. <s-link href="/app/settings">Add an API key in Settings</s-link>.</s-banner>
        </s-section>
      )}

      {resources.length > 0 && (
        <s-section heading={`Translatable content (${resources.length} loaded)`}>
          <s-stack direction="block" gap="base">
            {resources.map((resource) => {
              const isEditing = editingResource === resource.resourceId;
              const hasContent = resource.translatableContent.length > 0;
              return (
                <s-box key={resource.resourceId} padding="base" borderWidth="base" borderRadius="base">
                  <s-stack direction="block" gap="small">
                    <s-stack direction="inline" gap="small">
                      <s-heading>{resource.name}</s-heading>
                      <s-badge tone={hasContent ? "info" : "critical"}>
                        {hasContent ? `${resource.translatableContent.length} fields` : "no content"}
                      </s-badge>
                    </s-stack>

                    {hasContent && (
                      <>
                        <s-stack direction="inline" gap="small">
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
                          <fetcher.Form method="post" style={{ display: "inline" }}>
                            <input type="hidden" name="intent" value="translate" />
                            <input type="hidden" name="resourceId" value={resource.resourceId} />
                            <input type="hidden" name="targetLocale" value={data.targetLocale} />
                            <input
                              type="hidden"
                              name="keys"
                              value={resource.translatableContent.map((c) => c.key).join("\n")}
                            />
                            <input
                              type="hidden"
                              name="sources"
                              value={resource.translatableContent.map((c) => c.value).join("\n")}
                            />
                            <input
                              type="hidden"
                              name="digests"
                              value={resource.translatableContent.map((c) => c.digest).join("\n")}
                            />
                            <s-button
                              type="submit"
                              loading={busy || undefined}
                              disabled={!data.gemini.configured || undefined}
                            >
                              Translate all with Gemini
                            </s-button>
                          </fetcher.Form>
                        </s-stack>

                        {isEditing && (
                          <fetcher.Form method="post">
                            <input type="hidden" name="intent" value="save" />
                            <input type="hidden" name="resourceId" value={resource.resourceId} />
                            <input type="hidden" name="targetLocale" value={data.targetLocale} />
                            <input
                              type="hidden"
                              name="keys"
                              value={resource.translatableContent.map((c) => c.key).join("\n")}
                            />
                            <input
                              type="hidden"
                              name="digests"
                              value={resource.translatableContent.map((c) => c.digest).join("\n")}
                            />
                            <s-stack direction="block" gap="small">
                              {resource.translatableContent.map((content) => (
                                <s-box key={content.key} padding="small" borderWidth="base" borderRadius="base">
                                  <s-stack direction="block" gap="small">
                                    <s-text><strong>{content.key}</strong></s-text>
                                    <s-paragraph>{content.value}</s-paragraph>
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
                                      rows={3}
                                      placeholder={`Translation in ${data.targetLocale}...`}
                                      style={{ width: "100%", padding: 10, resize: "vertical" }}
                                    />
                                  </s-stack>
                                </s-box>
                              ))}
                              <input
                                type="hidden"
                                name="values"
                                value={resource.translatableContent
                                  .map((c) => editValues[resource.resourceId]?.[c.key] ?? "")
                                  .join("\n")}
                              />
                              <s-button type="submit" variant="primary" loading={busy || undefined}>
                                Save translations
                              </s-button>
                            </s-stack>
                          </fetcher.Form>
                        )}

                        {!isEditing && (
                          <s-stack direction="block" gap="small">
                            {resource.translatableContent.slice(0, 3).map((content) => (
                              <s-box key={content.key} padding="small" borderWidth="base" borderRadius="base">
                                <s-stack direction="block" gap="small">
                                  <s-text><strong>{content.key}</strong></s-text>
                                  <s-paragraph>{content.value.slice(0, 200)}{content.value.length > 200 ? "..." : ""}</s-paragraph>
                                </s-stack>
                              </s-box>
                            ))}
                            {resource.translatableContent.length > 3 && (
                              <s-paragraph>{resource.translatableContent.length - 3} more field(s) — click Edit to see all</s-paragraph>
                            )}
                          </s-stack>
                        )}
                      </>
                    )}
                  </s-stack>
                </s-box>
              );
            })}

            {hasMore && (
              <s-button onClick={loadMore} loading={moreFetcher.state !== "idle" || undefined}>
                Load more
              </s-button>
            )}
          </s-stack>
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
