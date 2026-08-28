import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { countTranslationTokens } from "../lib/gemini.server";
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_LAZY_LOAD_PAGE_SIZE,
  GEMINI_MODELS,
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
  return {
    configured: Boolean(settings?.encryptedGeminiApiKey),
    model: settings?.geminiModel ?? DEFAULT_GEMINI_MODEL,
    batchSize: settings?.batchSize ?? DEFAULT_BATCH_SIZE,
    lazyLoadPageSize: settings?.lazyLoadPageSize ?? DEFAULT_LAZY_LOAD_PAGE_SIZE,
    updatedAt: settings?.updatedAt.toISOString() ?? null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const current = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });

  try {
    if (intent === "clear") {
      await prisma.shopSettings.upsert({
        where: { shop: session.shop },
        create: { shop: session.shop, encryptedGeminiApiKey: null },
        update: { encryptedGeminiApiKey: null },
      });
      return { ok: true, message: "Gemini API key cleared" };
    }

    const model = parseGeminiModel(String(form.get("model") || ""));
    const batchSize = parseBatchSize(String(form.get("batchSize") || ""));
    const lazyLoadPageSize = parseLazyLoadPageSize(String(form.get("lazyLoadPageSize") || ""));
    const replacementKey = String(form.get("apiKey") || "").trim();
    const apiKey = replacementKey || (
      current?.encryptedGeminiApiKey
        ? decryptGeminiApiKey(current.encryptedGeminiApiKey)
        : ""
    );
    if (!apiKey) throw new Error("Enter a Gemini API key");

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
        message: `Gemini configuration is valid. Test prompt: ${tokenCount} tokens`,
      };
    }
    if (intent !== "save") throw new Error("Unknown settings action");

    await prisma.shopSettings.upsert({
      where: { shop: session.shop },
      create: {
        shop: session.shop,
        encryptedGeminiApiKey: encryptGeminiApiKey(apiKey),
        geminiModel: model,
        batchSize,
        lazyLoadPageSize,
      },
      update: {
        encryptedGeminiApiKey: replacementKey
          ? encryptGeminiApiKey(replacementKey)
          : current?.encryptedGeminiApiKey,
        geminiModel: model,
        batchSize,
        lazyLoadPageSize,
      },
    });
    return { ok: true, message: "Gemini settings saved" };
  } catch (error) {
    const message = error instanceof Error && [
      "Enter a Gemini API key",
      "Enter a Gemini model name",
      `Batch size must be between ${MIN_BATCH_SIZE} and ${MAX_BATCH_SIZE}`,
      `Page size must be between ${MIN_LAZY_LOAD_PAGE_SIZE} and ${MAX_LAZY_LOAD_PAGE_SIZE}`,
      "Unknown settings action",
    ].includes(error.message)
      ? error.message
      : "Gemini configuration could not be verified";
    return Response.json({ ok: false, message }, { status: 400 });
  }
};

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const formRef = useRef<HTMLFormElement>(null);
  const [modelValue, setModelValue] = useState(data.model);

  useEffect(() => {
    setModelValue(data.model);
  }, [data.model]);

  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
  }, [fetcher.data, shopify]);

  const submit = (intent: "test" | "save" | "clear") => {
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    formData.set("intent", intent);
    fetcher.submit(formData, { method: "post" });
  };

  return (
    <s-page heading="Gemini settings">
      <s-section heading="Shop configuration">
        <fetcher.Form method="post" ref={formRef}>
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Status: {data.configured ? "API key configured" : "API key not configured"}.
              {data.updatedAt ? ` Last updated ${new Date(data.updatedAt).toLocaleString()}.` : ""}
            </s-paragraph>
            <s-password-field
              label={data.configured ? "Replace Gemini API key" : "Gemini API key"}
              name="apiKey"
              autocomplete="off"
              placeholder={data.configured ? "Leave blank to keep the stored key" : "Enter API key"}
            />
            <s-text-field
              label="Gemini model"
              name="model"
              value={modelValue}
              onChange={(e) => setModelValue((e.currentTarget as unknown as HTMLInputElement).value)}
              autocomplete="off"
              placeholder="e.g. gemini-2.5-flash"
              required
            />
            <s-stack direction="inline" gap="small">
              {GEMINI_MODELS.map((model) => (
                <s-button
                  key={model}
                  variant={modelValue === model ? "primary" : "secondary"}
                  onClick={() => setModelValue(model)}
                >
                  {model}
                </s-button>
              ))}
            </s-stack>
            <s-number-field
              label="Items per request"
              name="batchSize"
              defaultValue={String(data.batchSize)}
              min={MIN_BATCH_SIZE}
              max={MAX_BATCH_SIZE}
              step={1}
              required
            />
            <s-number-field
              label="Items per page (lazy load)"
              name="lazyLoadPageSize"
              defaultValue={String(data.lazyLoadPageSize)}
              min={MIN_LAZY_LOAD_PAGE_SIZE}
              max={MAX_LAZY_LOAD_PAGE_SIZE}
              step={1}
              required
            />
            <s-paragraph>
              Controls how many strings or resources are shown at once on the Locale files and Content pages before clicking "Load more".
            </s-paragraph>
            <s-paragraph>
              The API key is encrypted on the server and is never displayed after submission.
            </s-paragraph>
            <s-stack direction="inline" gap="base">
              <s-button
                onClick={() => submit("test")}
                loading={fetcher.state !== "idle" || undefined}
              >
                Test configuration
              </s-button>
              <s-button
                onClick={() => submit("save")}
                variant="primary"
                loading={fetcher.state !== "idle" || undefined}
              >
                Save
              </s-button>
              {data.configured && (
                <s-button
                  onClick={() => submit("clear")}
                  tone="critical"
                  loading={fetcher.state !== "idle" || undefined}
                >
                  Clear key
                </s-button>
              )}
            </s-stack>
          </s-stack>
        </fetcher.Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
