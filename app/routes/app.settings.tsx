import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { TABLE_STYLES } from "../components/tableStyles";
import prisma from "../db.server";
import { countTranslationTokens } from "../lib/gemini.server";
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GLM_MODEL,
  DEFAULT_AI_PROVIDER,
  DEFAULT_LAZY_LOAD_PAGE_SIZE,
  GEMINI_MODELS,
  GLM_MODELS,
  AI_PROVIDERS,
  MAX_BATCH_SIZE,
  MAX_LAZY_LOAD_PAGE_SIZE,
  MIN_BATCH_SIZE,
  MIN_LAZY_LOAD_PAGE_SIZE,
  parseBatchSize,
  parseGeminiModel,
  parseLazyLoadPageSize,
} from "../lib/gemini-settings";
import {
  decryptGeminiApiKey,
  encryptGeminiApiKey,
} from "../lib/gemini-settings.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
  const provider = (settings?.aiProvider as "gemini" | "glm") || DEFAULT_AI_PROVIDER;
  return {
    provider,
    configured: provider === "glm"
      ? Boolean(settings?.encryptedGlmApiKey)
      : Boolean(settings?.encryptedGeminiApiKey),
    model: provider === "glm"
      ? (settings?.glmModel ?? DEFAULT_GLM_MODEL)
      : (settings?.geminiModel ?? DEFAULT_GEMINI_MODEL),
    batchSize: settings?.batchSize ?? DEFAULT_BATCH_SIZE,
    lazyLoadPageSize: settings?.lazyLoadPageSize ?? DEFAULT_LAZY_LOAD_PAGE_SIZE,
    brandName: settings?.brandName ?? "",
    // Include both keys' configured state for UI
    geminiConfigured: Boolean(settings?.encryptedGeminiApiKey),
    glmConfigured: Boolean(settings?.encryptedGlmApiKey),
    geminiModel: settings?.geminiModel ?? DEFAULT_GEMINI_MODEL,
    glmModel: settings?.glmModel ?? DEFAULT_GLM_MODEL,
    updatedAt: settings?.updatedAt.toISOString() ?? null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const current = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });

  try {
    const provider = String(form.get("provider") || "gemini") as "gemini" | "glm";

    if (intent === "clear") {
      if (provider === "glm") {
        await prisma.shopSettings.upsert({
          where: { shop: session.shop },
          create: { shop: session.shop, aiProvider: "glm", encryptedGlmApiKey: null },
          update: { encryptedGlmApiKey: null },
        });
        return { ok: true, message: "GLM API key cleared" };
      }
      await prisma.shopSettings.upsert({
        where: { shop: session.shop },
        create: { shop: session.shop, encryptedGeminiApiKey: null },
        update: { encryptedGeminiApiKey: null },
      });
      return { ok: true, message: "Gemini API key cleared" };
    }

    const batchSize = parseBatchSize(String(form.get("batchSize") || ""));
    const lazyLoadPageSize = parseLazyLoadPageSize(String(form.get("lazyLoadPageSize") || ""));
    const brandName = String(form.get("brandName") || "").trim();
    const replacementKey = String(form.get("apiKey") || "").trim();

    // Determine which model + key to use based on provider
    const model = parseGeminiModel(String(form.get("model") || ""));

    // Get the appropriate API key
    let apiKey: string;
    if (provider === "glm") {
      apiKey = replacementKey || (
        current?.encryptedGlmApiKey
          ? decryptGeminiApiKey(current.encryptedGlmApiKey)
          : ""
      );
      if (!apiKey) throw new Error("Enter a GLM API key");
    } else {
      apiKey = replacementKey || (
        current?.encryptedGeminiApiKey
          ? decryptGeminiApiKey(current.encryptedGeminiApiKey)
          : ""
      );
      if (!apiKey) throw new Error("Enter a Gemini API key");
    }

    if (intent === "test") {
      const tokenCount = await countTranslationTokens(
        [{ key: "/test", source: "Hello {{ name }}" }],
        "en",
        "fr",
        apiKey,
        model,
      );
      return {
        ok: true,
        message: `${provider === "glm" ? "GLM" : "Gemini"} configuration is valid. Test prompt: ${tokenCount} tokens`,
      };
    }
    if (intent !== "save") throw new Error("Unknown settings action");

    // Build update data for the selected provider
    const updateData: Record<string, unknown> = {
      aiProvider: provider,
      batchSize,
      lazyLoadPageSize,
      brandName: brandName || null,
    };

    if (provider === "glm") {
      updateData.glmModel = model;
      if (replacementKey) {
        updateData.encryptedGlmApiKey = encryptGeminiApiKey(replacementKey);
      }
    } else {
      updateData.geminiModel = model;
      if (replacementKey) {
        updateData.encryptedGeminiApiKey = encryptGeminiApiKey(replacementKey);
      }
    }

    await prisma.shopSettings.upsert({
      where: { shop: session.shop },
      create: {
        shop: session.shop,
        aiProvider: provider,
        ...(provider === "glm"
          ? { encryptedGlmApiKey: encryptGeminiApiKey(apiKey), glmModel: model }
          : { encryptedGeminiApiKey: encryptGeminiApiKey(apiKey), geminiModel: model }),
        batchSize,
        lazyLoadPageSize,
        brandName: brandName || null,
      },
      update: updateData,
    });
    return { ok: true, message: `${provider === "glm" ? "GLM" : "Gemini"} settings saved` };
  } catch (error) {
    const message = error instanceof Error && [
      "Enter a Gemini API key",
      "Enter a GLM API key",
      "Enter a Gemini model name",
      `Batch size must be between ${MIN_BATCH_SIZE} and ${MAX_BATCH_SIZE}`,
      `Page size must be between ${MIN_LAZY_LOAD_PAGE_SIZE} and ${MAX_LAZY_LOAD_PAGE_SIZE}`,
      "Unknown settings action",
    ].includes(error.message)
      ? error.message
      : "Configuration could not be verified";
    return Response.json({ ok: false, message }, { status: 400 });
  }
};

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const formRef = useRef<HTMLFormElement>(null);
  const [provider, setProvider] = useState<"gemini" | "glm">(data.provider);
  const [modelValue, setModelValue] = useState(data.model);

  useEffect(() => {
    setProvider(data.provider);
    setModelValue(data.model);
  }, [data.provider, data.model]);

  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
  }, [fetcher.data, shopify]);

  const submit = (intent: "test" | "save" | "clear") => {
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    formData.set("intent", intent);
    formData.set("provider", provider);
    fetcher.submit(formData, { method: "post" });
  };

  const models = provider === "glm" ? GLM_MODELS : GEMINI_MODELS;
  const isConfigured = provider === "glm" ? data.glmConfigured : data.geminiConfigured;
  const providerLabel = provider === "glm" ? "GLM (Z.ai)" : "Gemini (Google)";
  const apiKeyPlaceholder = provider === "glm"
    ? "Enter your Z.ai API key"
    : "Enter your Gemini API key";
  const apiKeyHelp = provider === "glm"
    ? "Get a free API key at https://z.ai/ — GLM-4.5-Flash is free with no daily request cap."
    : "Get a free API key at https://aistudio.google.com/apikey — Free tier: 250 req/day.";

  return (
    <s-page heading="Settings">
      {/* Status banner */}
      <s-banner tone={isConfigured ? "success" : "warning"}>
        {isConfigured
          ? `${providerLabel} is configured · Model: ${modelValue} · Last updated ${data.updatedAt ? new Date(data.updatedAt).toLocaleString() : "never"}`
          : `${providerLabel} is not configured. Enter an API key below to start translating.`}
      </s-banner>

      <s-section heading="AI Provider">
        <fetcher.Form method="post" ref={formRef}>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Provider selector */}
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                AI Provider
              </label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {AI_PROVIDERS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    style={TABLE_STYLES.tabButton(provider === p)}
                    onClick={() => {
                      setProvider(p as "gemini" | "glm");
                      setModelValue(p === "glm" ? DEFAULT_GLM_MODEL : DEFAULT_GEMINI_MODEL);
                    }}
                  >
                    {p === "glm" ? "GLM (Z.ai)" : "Gemini (Google)"}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 12, color: "#616161", marginTop: 4 }}>
                {provider === "glm"
                  ? "GLM-4.5-Flash is free with no daily request limit (1 concurrent request). Best for large translation jobs."
                  : "Gemini 3.5 Flash is free but limited to 250 requests/day. Good for small jobs."}
              </p>
            </div>

            <input type="hidden" name="provider" value={provider} />

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                {isConfigured ? "Replace API key (leave blank to keep)" : "API key"}
              </label>
              <s-password-field
                name="apiKey"
                autocomplete="off"
                placeholder={isConfigured ? "••••••••••••" : apiKeyPlaceholder}
              />
              <p style={{ fontSize: 12, color: "#616161", marginTop: 4 }}>
                {apiKeyHelp}
              </p>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Model</label>
              <s-text-field
                name="model"
                value={modelValue}
                onChange={(e) => setModelValue((e.currentTarget as unknown as HTMLInputElement).value)}
                autocomplete="off"
                placeholder={provider === "glm" ? "e.g. glm-4.5-flash" : "e.g. gemini-3.5-flash"}
                required
              />
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                {models.map((model) => (
                  <button
                    key={model}
                    type="button"
                    style={TABLE_STYLES.tabButton(modelValue === model)}
                    onClick={() => setModelValue(model)}
                  >
                    {model}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  Brand name (never translate)
                </label>
                <s-text-field
                  name="brandName"
                  defaultValue={data.brandName}
                  autocomplete="off"
                  placeholder="e.g. Noonchi Organic"
                />
                <p style={{ fontSize: 12, color: "#616161", marginTop: 4 }}>
                  Your store's brand name. It will be kept untranslated in all languages.
                </p>
              </div>
            </div>

            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  Items per request (batch size)
                </label>
                <s-number-field
                  name="batchSize"
                  defaultValue={String(data.batchSize)}
                  min={MIN_BATCH_SIZE}
                  max={MAX_BATCH_SIZE}
                  step={1}
                  required
                />
                <p style={{ fontSize: 12, color: "#616161", marginTop: 4 }}>
                  How many strings to send to the AI in one request. {MIN_BATCH_SIZE}–{MAX_BATCH_SIZE}.
                </p>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  Items per page (lazy load)
                </label>
                <s-number-field
                  name="lazyLoadPageSize"
                  defaultValue={String(data.lazyLoadPageSize)}
                  min={MIN_LAZY_LOAD_PAGE_SIZE}
                  max={MAX_LAZY_LOAD_PAGE_SIZE}
                  step={1}
                  required
                />
                <p style={{ fontSize: 12, color: "#616161", marginTop: 4 }}>
                  How many items to show before "Load more". {MIN_LAZY_LOAD_PAGE_SIZE}–{MAX_LAZY_LOAD_PAGE_SIZE}.
                </p>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <s-button onClick={() => submit("test")} loading={fetcher.state !== "idle" || undefined}>
                Test configuration
              </s-button>
              <s-button onClick={() => submit("save")} variant="primary" loading={fetcher.state !== "idle" || undefined}>
                Save settings
              </s-button>
              {isConfigured && (
                <s-button onClick={() => submit("clear")} tone="critical" loading={fetcher.state !== "idle" || undefined}>
                  Clear API key
                </s-button>
              )}
            </div>
          </div>
        </fetcher.Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
