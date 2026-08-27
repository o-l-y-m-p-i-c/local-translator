import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter, UNSAFE_withComponentProps, Meta, Links, Outlet, ScrollRestoration, Scripts, useLoaderData, useActionData, Form, redirect, UNSAFE_withErrorBoundaryProps, useRouteError, useFetcher, useNavigation, useRevalidator } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import "@shopify/shopify-app-react-router/adapters/node";
import { shopifyApp, AppDistribution, ApiVersion, LoginErrorType, boundary } from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { PrismaClient } from "@prisma/client";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState, useRef, useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { GoogleGenAI, ApiError } from "@google/genai";
import { createDecipheriv, randomBytes, createCipheriv, createHash } from "node:crypto";
if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}
const prisma = global.prismaGlobal ?? new PrismaClient();
const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true
  },
  ...process.env.SHOP_CUSTOM_DOMAIN ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] } : {}
});
ApiVersion.October25;
const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
const authenticate = shopify.authenticate;
shopify.unauthenticated;
const login = shopify.login;
shopify.registerWebhooks;
shopify.sessionStorage;
const streamTimeout = 5e3;
async function handleRequest(request, responseStatusCode, responseHeaders, reactRouterContext) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";
  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      /* @__PURE__ */ jsx(
        ServerRouter,
        {
          context: reactRouterContext,
          url: request.url
        }
      ),
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        }
      }
    );
    setTimeout(abort, streamTimeout + 1e3);
  });
}
const entryServer = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: handleRequest,
  streamTimeout
}, Symbol.toStringTag, { value: "Module" }));
const root = UNSAFE_withComponentProps(function App() {
  return /* @__PURE__ */ jsxs("html", {
    lang: "en",
    children: [/* @__PURE__ */ jsxs("head", {
      children: [/* @__PURE__ */ jsx("meta", {
        charSet: "utf-8"
      }), /* @__PURE__ */ jsx("meta", {
        name: "viewport",
        content: "width=device-width,initial-scale=1"
      }), /* @__PURE__ */ jsx("link", {
        rel: "preconnect",
        href: "https://cdn.shopify.com/"
      }), /* @__PURE__ */ jsx("link", {
        rel: "stylesheet",
        href: "https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
      }), /* @__PURE__ */ jsx(Meta, {}), /* @__PURE__ */ jsx(Links, {})]
    }), /* @__PURE__ */ jsxs("body", {
      children: [/* @__PURE__ */ jsx(Outlet, {}), /* @__PURE__ */ jsx(ScrollRestoration, {}), /* @__PURE__ */ jsx(Scripts, {})]
    })]
  });
});
const route0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: root
}, Symbol.toStringTag, { value: "Module" }));
const action$7 = async ({
  request
}) => {
  await authenticate.webhook(request);
  return new Response();
};
const route1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$7
}, Symbol.toStringTag, { value: "Module" }));
const action$6 = async ({
  request
}) => {
  const {
    payload,
    session,
    topic,
    shop
  } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  const current = payload.current;
  if (session) {
    await prisma.session.update({
      where: {
        id: session.id
      },
      data: {
        scope: current.toString()
      }
    });
  }
  return new Response();
};
const route2 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$6
}, Symbol.toStringTag, { value: "Module" }));
const action$5 = async ({
  request
}) => {
  await authenticate.webhook(request);
  return new Response();
};
const route3 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$5
}, Symbol.toStringTag, { value: "Module" }));
const action$4 = async ({
  request
}) => {
  const {
    shop,
    session,
    topic
  } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  await prisma.$transaction([prisma.translationWorkspace.deleteMany({
    where: {
      shop
    }
  }), prisma.shopSettings.deleteMany({
    where: {
      shop
    }
  }), ...session ? [prisma.session.deleteMany({
    where: {
      shop
    }
  })] : []]);
  return new Response();
};
const route4 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$4
}, Symbol.toStringTag, { value: "Module" }));
const action$3 = async ({
  request
}) => {
  const {
    shop
  } = await authenticate.webhook(request);
  await prisma.$transaction([prisma.translationWorkspace.deleteMany({
    where: {
      shop
    }
  }), prisma.shopSettings.deleteMany({
    where: {
      shop
    }
  }), prisma.session.deleteMany({
    where: {
      shop
    }
  })]);
  return new Response();
};
const route5 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$3
}, Symbol.toStringTag, { value: "Module" }));
function loginErrorMessage(loginErrors) {
  if (loginErrors?.shop === LoginErrorType.MissingShop) {
    return { shop: "Please enter your shop domain to log in" };
  } else if (loginErrors?.shop === LoginErrorType.InvalidShop) {
    return { shop: "Please enter a valid shop domain to log in" };
  }
  return {};
}
const loader$6 = async ({
  request
}) => {
  const errors = loginErrorMessage(await login(request));
  return {
    errors
  };
};
const action$2 = async ({
  request
}) => {
  const errors = loginErrorMessage(await login(request));
  return {
    errors
  };
};
const route$1 = UNSAFE_withComponentProps(function Auth() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const [shop, setShop] = useState("");
  const {
    errors
  } = actionData || loaderData;
  return /* @__PURE__ */ jsx(AppProvider, {
    embedded: false,
    children: /* @__PURE__ */ jsx("s-page", {
      children: /* @__PURE__ */ jsx(Form, {
        method: "post",
        children: /* @__PURE__ */ jsxs("s-section", {
          heading: "Log in",
          children: [/* @__PURE__ */ jsx("s-text-field", {
            name: "shop",
            label: "Shop domain",
            details: "example.myshopify.com",
            value: shop,
            onChange: (e) => setShop(e.currentTarget.value),
            autocomplete: "on",
            error: errors.shop
          }), /* @__PURE__ */ jsx("s-button", {
            type: "submit",
            children: "Log in"
          })]
        })
      })
    })
  });
});
const route6 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$2,
  default: route$1,
  loader: loader$6
}, Symbol.toStringTag, { value: "Module" }));
const index = "_index_12o3y_1";
const heading = "_heading_12o3y_11";
const text = "_text_12o3y_12";
const content = "_content_12o3y_22";
const form = "_form_12o3y_27";
const label = "_label_12o3y_35";
const input = "_input_12o3y_43";
const button = "_button_12o3y_47";
const list = "_list_12o3y_51";
const styles = {
  index,
  heading,
  text,
  content,
  form,
  label,
  input,
  button,
  list
};
const loader$5 = async ({
  request
}) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return {
    showForm: Boolean(login)
  };
};
const route = UNSAFE_withComponentProps(function App2() {
  const {
    showForm
  } = useLoaderData();
  return /* @__PURE__ */ jsx("div", {
    className: styles.index,
    children: /* @__PURE__ */ jsxs("div", {
      className: styles.content,
      children: [/* @__PURE__ */ jsx("h1", {
        className: styles.heading,
        children: "Shopify Locale Translator"
      }), /* @__PURE__ */ jsx("p", {
        className: styles.text,
        children: "Translate and publish theme locale files with reviewable Gemini-assisted workflows."
      }), showForm && /* @__PURE__ */ jsxs(Form, {
        className: styles.form,
        method: "post",
        action: "/auth/login",
        children: [/* @__PURE__ */ jsxs("label", {
          className: styles.label,
          children: [/* @__PURE__ */ jsx("span", {
            children: "Shop domain"
          }), /* @__PURE__ */ jsx("input", {
            className: styles.input,
            type: "text",
            name: "shop"
          }), /* @__PURE__ */ jsx("span", {
            children: "e.g: my-shop-domain.myshopify.com"
          })]
        }), /* @__PURE__ */ jsx("button", {
          className: styles.button,
          type: "submit",
          children: "Log in"
        })]
      }), /* @__PURE__ */ jsxs("ul", {
        className: styles.list,
        children: [/* @__PURE__ */ jsxs("li", {
          children: [/* @__PURE__ */ jsx("strong", {
            children: "Review every key"
          }), " before publishing to a theme."]
        }), /* @__PURE__ */ jsxs("li", {
          children: [/* @__PURE__ */ jsx("strong", {
            children: "Protect Liquid and placeholders"
          }), " during AI translation."]
        }), /* @__PURE__ */ jsxs("li", {
          children: [/* @__PURE__ */ jsx("strong", {
            children: "Track missing and stale strings"
          }), " in an app-owned workspace."]
        })]
      })]
    })
  });
});
const route7 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: route,
  loader: loader$5
}, Symbol.toStringTag, { value: "Module" }));
const loader$4 = async ({
  request
}) => {
  await authenticate.admin(request);
  return null;
};
const headers$3 = (headersArgs) => {
  return boundary.headers(headersArgs);
};
const route8 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  headers: headers$3,
  loader: loader$4
}, Symbol.toStringTag, { value: "Module" }));
const loader$3 = async ({
  request
}) => {
  await authenticate.admin(request);
  return {
    apiKey: process.env.SHOPIFY_API_KEY || ""
  };
};
const app = UNSAFE_withComponentProps(function App3() {
  const {
    apiKey
  } = useLoaderData();
  return /* @__PURE__ */ jsxs(AppProvider, {
    embedded: true,
    apiKey,
    children: [/* @__PURE__ */ jsxs("s-app-nav", {
      children: [/* @__PURE__ */ jsx("s-link", {
        href: "/app",
        children: "Translator"
      }), /* @__PURE__ */ jsx("s-link", {
        href: "/app/settings",
        children: "Settings"
      })]
    }), /* @__PURE__ */ jsx(Outlet, {})]
  });
});
const ErrorBoundary = UNSAFE_withErrorBoundaryProps(function ErrorBoundary2() {
  return boundary.error(useRouteError());
});
const headers$2 = (headersArgs) => {
  return boundary.headers(headersArgs);
};
const route9 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  ErrorBoundary,
  default: app,
  headers: headers$2,
  loader: loader$3
}, Symbol.toStringTag, { value: "Module" }));
async function loader$2({
  request
}) {
  const {
    redirect: redirect2
  } = await authenticate.admin(request);
  return redirect2("/app");
}
const app_additional = UNSAFE_withComponentProps(function AdditionalPage() {
  return null;
});
const route10 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: app_additional,
  loader: loader$2
}, Symbol.toStringTag, { value: "Module" }));
const encodeSegment = (segment) => segment.replaceAll("~", "~0").replaceAll("/", "~1");
const decodeSegment = (segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~");
function flattenLocale(value, path = "") {
  if (typeof value === "string") return { [path || "/"]: value };
  if (!value || typeof value !== "object") return {};
  return Object.entries(value).reduce((result, [key, child]) => {
    const childPath = `${path}/${encodeSegment(key)}`;
    return Object.assign(result, flattenLocale(child, childPath));
  }, {});
}
function setLocaleValue(root2, pointer, value) {
  const segments = pointer.split("/").slice(1).map(decodeSegment);
  if (!segments.length) return root2;
  let current = root2;
  segments.forEach((segment, index2) => {
    if (index2 === segments.length - 1) {
      current[segment] = value;
      return;
    }
    const child = current[segment];
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      current[segment] = {};
    }
    current = current[segment];
  });
  return root2;
}
function mergeLocale(source, translations) {
  const merged = structuredClone(source);
  Object.entries(translations).forEach(
    ([key, value]) => setLocaleValue(merged, key, value)
  );
  return merged;
}
function unflattenLocale(flat) {
  return mergeLocale({}, flat);
}
function computeStatuses(source, target, previousSource = {}) {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => {
      const translation = target[key]?.trim();
      if (!translation) return [key, "missing"];
      if (key in previousSource && previousSource[key] !== value) {
        return [key, "stale"];
      }
      return [key, "translated"];
    })
  );
}
const TOKEN_PATTERNS = [
  /{{-?[\s\S]*?-?}}/g,
  /{%[-]?[\s\S]*?[-]?%}/g,
  /%\{[^}]+}/g,
  /<\/?[a-zA-Z][^>]*>/g
];
function extractPlaceholders(value) {
  return TOKEN_PATTERNS.flatMap((pattern) => value.match(pattern) ?? []).sort();
}
function validatePlaceholders(source, translation) {
  const expected = extractPlaceholders(source);
  const actual = extractPlaceholders(translation);
  const errors = [];
  const counts = (tokens) => tokens.reduce((map, token) => {
    map[token] = (map[token] ?? 0) + 1;
    return map;
  }, {});
  const expectedCounts = counts(expected);
  const actualCounts = counts(actual);
  for (const [token, count] of Object.entries(expectedCounts)) {
    if ((actualCounts[token] ?? 0) !== count) errors.push(token);
  }
  for (const token of Object.keys(actualCounts)) {
    if (!(token in expectedCounts)) errors.push(token);
  }
  return [...new Set(errors)];
}
function parseLocaleJson(content2) {
  const parsed = JSON.parse(content2);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Locale file must contain a JSON object");
  }
  return parsed;
}
function localeFilenameFor(sourceFilename, locale) {
  return `locales/${locale}${sourceFilename.endsWith(".schema.json") ? ".schema" : ""}.json`;
}
function localeFromFilename(filename) {
  return filename.split("/").pop()?.replace(/\.json$/, "").replace(/\.schema$/, "").replace(/\.default$/, "") ?? "";
}
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          translation: { type: "string" }
        },
        required: ["key", "translation"],
        additionalProperties: false
      }
    }
  },
  required: ["translations"],
  additionalProperties: false
};
function promptFor(items, sourceLocale, targetLocale) {
  return `Translate Shopify theme locale strings from ${sourceLocale} to ${targetLocale}. Return every key exactly once. Preserve all Liquid expressions, {{ placeholders }}, %{placeholders}, HTML tags, whitespace meaning, and brand names. Do not translate keys.

${JSON.stringify(items)}`;
}
async function translateBatch(items, sourceLocale, targetLocale, apiKey, model) {
  if (!items.length) {
    return {
      translations: {},
      usage: { promptTokenCount: 0, candidatesTokenCount: 0, thoughtsTokenCount: 0, totalTokenCount: 0 }
    };
  }
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: promptFor(items, sourceLocale, targetLocale),
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: RESPONSE_SCHEMA,
      temperature: 0.2
    }
  });
  if (!response.text) throw new Error("Gemini returned an empty response");
  const parsed = JSON.parse(response.text);
  const requested = new Map(items.map((item) => [item.key, item.source]));
  const translations = {};
  for (const result of parsed.translations ?? []) {
    if (typeof result.key !== "string" || typeof result.translation !== "string") continue;
    const source = requested.get(result.key);
    if (source === void 0 || result.key in translations) continue;
    const invalid = validatePlaceholders(source, result.translation);
    if (invalid.length) {
      throw new Error(`Gemini changed protected tokens for ${result.key}: ${invalid.join(", ")}`);
    }
    translations[result.key] = result.translation;
  }
  const missing = items.filter(({ key }) => !(key in translations));
  if (missing.length) throw new Error(`Gemini omitted ${missing.length} translation(s)`);
  const metadata = response.usageMetadata;
  return {
    translations,
    usage: {
      promptTokenCount: metadata?.promptTokenCount ?? 0,
      candidatesTokenCount: metadata?.candidatesTokenCount ?? 0,
      thoughtsTokenCount: metadata?.thoughtsTokenCount ?? 0,
      totalTokenCount: metadata?.totalTokenCount ?? 0
    }
  };
}
async function countTranslationTokens(items, sourceLocale, targetLocale, apiKey, model) {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.countTokens({
    model,
    contents: promptFor(items, sourceLocale, targetLocale)
  });
  return response.totalTokens ?? 0;
}
function isRetryableGeminiError(error) {
  return error instanceof ApiError && (error.status === 429 || error.status >= 500);
}
const GEMINI_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-flash-lite-latest",
  "gemini-flash-latest"
];
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_BATCH_SIZE = 30;
const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 50;
function parseGeminiModel(value) {
  if (!GEMINI_MODELS.includes(value)) {
    throw new Error("Select a supported Gemini model");
  }
  return value;
}
function parseBatchSize(value) {
  const batchSize = Number(value);
  if (!Number.isInteger(batchSize) || batchSize < MIN_BATCH_SIZE || batchSize > MAX_BATCH_SIZE) {
    throw new Error(
      `Batch size must be between ${MIN_BATCH_SIZE} and ${MAX_BATCH_SIZE}`
    );
  }
  return batchSize;
}
function encryptionKey() {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error("SHOPIFY_API_SECRET is not configured");
  return createHash("sha256").update("shopify-locale-translator:gemini-key:v1").update(secret).digest();
}
function encryptGeminiApiKey(apiKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}
function decryptGeminiApiKey(payload) {
  const [version, iv, tag, ciphertext] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Stored Gemini API key is invalid");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}
async function getShopGeminiConfiguration(shop) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings?.encryptedGeminiApiKey) return null;
  return {
    apiKey: decryptGeminiApiKey(settings.encryptedGeminiApiKey),
    model: parseGeminiModel(settings.geminiModel),
    batchSize: settings.batchSize
  };
}
const loader$1 = async ({
  request
}) => {
  const {
    session
  } = await authenticate.admin(request);
  const settings = await prisma.shopSettings.findUnique({
    where: {
      shop: session.shop
    }
  });
  return {
    configured: Boolean(settings?.encryptedGeminiApiKey),
    model: settings?.geminiModel ?? DEFAULT_GEMINI_MODEL,
    batchSize: settings?.batchSize ?? DEFAULT_BATCH_SIZE,
    updatedAt: settings?.updatedAt.toISOString() ?? null
  };
};
const action$1 = async ({
  request
}) => {
  const {
    session
  } = await authenticate.admin(request);
  const form2 = await request.formData();
  const intent = String(form2.get("intent") || "");
  const current = await prisma.shopSettings.findUnique({
    where: {
      shop: session.shop
    }
  });
  try {
    if (intent === "clear") {
      await prisma.shopSettings.upsert({
        where: {
          shop: session.shop
        },
        create: {
          shop: session.shop,
          encryptedGeminiApiKey: null
        },
        update: {
          encryptedGeminiApiKey: null
        }
      });
      return {
        ok: true,
        message: "Gemini API key cleared"
      };
    }
    const model = parseGeminiModel(String(form2.get("model") || ""));
    const batchSize = parseBatchSize(String(form2.get("batchSize") || ""));
    const replacementKey = String(form2.get("apiKey") || "").trim();
    const apiKey = replacementKey || (current?.encryptedGeminiApiKey ? decryptGeminiApiKey(current.encryptedGeminiApiKey) : "");
    if (!apiKey) throw new Error("Enter a Gemini API key");
    if (intent === "test") {
      const tokenCount = await countTranslationTokens([{
        key: "/test",
        source: "Hello {{ name }}"
      }], "en", "fr", apiKey, model);
      return {
        ok: true,
        message: `Gemini configuration is valid. Test prompt: ${tokenCount} tokens`
      };
    }
    if (intent !== "save") throw new Error("Unknown settings action");
    await prisma.shopSettings.upsert({
      where: {
        shop: session.shop
      },
      create: {
        shop: session.shop,
        encryptedGeminiApiKey: encryptGeminiApiKey(apiKey),
        geminiModel: model,
        batchSize
      },
      update: {
        encryptedGeminiApiKey: replacementKey ? encryptGeminiApiKey(replacementKey) : current?.encryptedGeminiApiKey,
        geminiModel: model,
        batchSize
      }
    });
    return {
      ok: true,
      message: "Gemini settings saved"
    };
  } catch (error) {
    const message = error instanceof Error && ["Enter a Gemini API key", "Select a supported Gemini model", `Batch size must be between ${MIN_BATCH_SIZE} and ${MAX_BATCH_SIZE}`, "Unknown settings action"].includes(error.message) ? error.message : "Gemini configuration could not be verified";
    return Response.json({
      ok: false,
      message
    }, {
      status: 400
    });
  }
};
const app_settings = UNSAFE_withComponentProps(function Settings() {
  const data = useLoaderData();
  const fetcher = useFetcher();
  const shopify2 = useAppBridge();
  const formRef = useRef(null);
  useEffect(() => {
    if (fetcher.data?.message) shopify2.toast.show(fetcher.data.message, {
      isError: !fetcher.data.ok
    });
  }, [fetcher.data, shopify2]);
  const submit = (intent) => {
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    formData.set("intent", intent);
    fetcher.submit(formData, {
      method: "post"
    });
  };
  return /* @__PURE__ */ jsx("s-page", {
    heading: "Gemini settings",
    children: /* @__PURE__ */ jsx("s-section", {
      heading: "Shop configuration",
      children: /* @__PURE__ */ jsx(fetcher.Form, {
        method: "post",
        ref: formRef,
        children: /* @__PURE__ */ jsxs("s-stack", {
          direction: "block",
          gap: "base",
          children: [/* @__PURE__ */ jsxs("s-paragraph", {
            children: ["Status: ", data.configured ? "API key configured" : "API key not configured", ".", data.updatedAt ? ` Last updated ${new Date(data.updatedAt).toLocaleString()}.` : ""]
          }), /* @__PURE__ */ jsx("s-password-field", {
            label: data.configured ? "Replace Gemini API key" : "Gemini API key",
            name: "apiKey",
            autocomplete: "off",
            placeholder: data.configured ? "Leave blank to keep the stored key" : "Enter API key"
          }), /* @__PURE__ */ jsx("s-select", {
            label: "Gemini model",
            name: "model",
            value: data.model,
            children: GEMINI_MODELS.map((model) => /* @__PURE__ */ jsx("s-option", {
              value: model,
              children: model
            }, model))
          }), /* @__PURE__ */ jsx("s-number-field", {
            label: "Items per request",
            name: "batchSize",
            defaultValue: String(data.batchSize),
            min: MIN_BATCH_SIZE,
            max: MAX_BATCH_SIZE,
            step: 1,
            required: true
          }), /* @__PURE__ */ jsx("s-paragraph", {
            children: "The API key is encrypted on the server and is never displayed after submission."
          }), /* @__PURE__ */ jsxs("s-stack", {
            direction: "inline",
            gap: "base",
            children: [/* @__PURE__ */ jsx("s-button", {
              onClick: () => submit("test"),
              loading: fetcher.state !== "idle" || void 0,
              children: "Test configuration"
            }), /* @__PURE__ */ jsx("s-button", {
              onClick: () => submit("save"),
              variant: "primary",
              loading: fetcher.state !== "idle" || void 0,
              children: "Save"
            }), data.configured && /* @__PURE__ */ jsx("s-button", {
              onClick: () => submit("clear"),
              tone: "critical",
              loading: fetcher.state !== "idle" || void 0,
              children: "Clear key"
            })]
          })]
        })
      })
    })
  });
});
const headers$1 = (headersArgs) => boundary.headers(headersArgs);
const route11 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$1,
  default: app_settings,
  headers: headers$1,
  loader: loader$1
}, Symbol.toStringTag, { value: "Module" }));
async function graphql(admin, query, variables) {
  const response = await admin.graphql(query, { variables });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length || !payload.data) {
    throw new Error(
      payload.errors?.map(({ message }) => message).join("; ") || `Shopify Admin API returned ${response.status}`
    );
  }
  return payload.data;
}
async function getDashboardData(admin) {
  const data = await graphql(
    admin,
    `#graphql
      query TranslatorDashboard {
        themes(first: 50) { nodes { id name role } }
        shopLocales { locale name primary published }
      }`
  );
  return { themes: data.themes.nodes, shopLocales: data.shopLocales };
}
async function getThemeLocaleFiles(admin, themeId) {
  const localeFiles = [];
  let after = null;
  do {
    const data = await graphql(
      admin,
      `#graphql
        query ThemeLocaleFiles($id: ID!, $after: String) {
          theme(id: $id) {
            files(first: 250, after: $after) {
              nodes {
                filename
                body { ... on OnlineStoreThemeFileBodyText { content } }
              }
              pageInfo { endCursor hasNextPage }
              userErrors { code filename }
            }
          }
        }`,
      { id: themeId, after }
    );
    if (!data.theme) throw new Error("Theme not found");
    if (data.theme.files.userErrors.length) {
      throw new Error(
        data.theme.files.userErrors.map(({ code, filename }) => `${code}${filename ? `: ${filename}` : ""}`).join("; ")
      );
    }
    localeFiles.push(
      ...data.theme.files.nodes.filter(
        (file) => file.filename.startsWith("locales/") && file.filename.endsWith(".json") && typeof file.body?.content === "string"
      ).map((file) => ({ filename: file.filename, content: file.body.content }))
    );
    after = data.theme.files.pageInfo.hasNextPage ? data.theme.files.pageInfo.endCursor : null;
  } while (after);
  return localeFiles;
}
async function upsertThemeLocale(admin, themeId, filename, locale) {
  const data = await graphql(
    admin,
    `#graphql
      mutation PublishThemeLocale($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
        themeFilesUpsert(themeId: $themeId, files: $files) {
          upsertedThemeFiles { filename }
          job { id }
          userErrors { field message }
        }
      }`,
    {
      themeId,
      files: [
        {
          filename,
          body: { type: "TEXT", value: JSON.stringify(locale, null, 2) }
        }
      ]
    }
  );
  const errors = data.themeFilesUpsert.userErrors;
  if (errors.length) throw new Error(errors.map(({ message }) => message).join("; "));
  if (!data.themeFilesUpsert.upsertedThemeFiles.length && !data.themeFilesUpsert.job) {
    throw new Error("Shopify did not confirm or queue the locale file update");
  }
  return data.themeFilesUpsert;
}
const workspaceKey = (shop, themeId, sourceFilename, targetLocale) => ({
  shop_themeId_sourceFilename_targetLocale: {
    shop,
    themeId,
    sourceFilename,
    targetLocale
  }
});
const jobSummary = (job) => ({
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
  completedAt: job.completedAt?.toISOString() ?? null
});
const loader = async ({
  request
}) => {
  const {
    admin,
    session
  } = await authenticate.admin(request);
  const url = new URL(request.url);
  const themeId = url.searchParams.get("theme") || "";
  const sourceFilename = url.searchParams.get("source") || "";
  const targetLocale = url.searchParams.get("target") || "";
  const [dashboard, settings] = await Promise.all([getDashboardData(admin), prisma.shopSettings.findUnique({
    where: {
      shop: session.shop
    }
  })]);
  const gemini = {
    configured: Boolean(settings?.encryptedGeminiApiKey),
    model: settings?.geminiModel ?? null
  };
  const theme = dashboard.themes.find(({
    id
  }) => id === themeId);
  const files = theme ? await getThemeLocaleFiles(admin, theme.id) : [];
  if (!theme || !sourceFilename || !targetLocale) {
    return {
      ...dashboard,
      gemini,
      files: files.map(({
        filename
      }) => filename),
      selection: null
    };
  }
  const sourceFile = files.find(({
    filename
  }) => filename === sourceFilename);
  if (!sourceFile) throw new Response("Selected source locale no longer exists", {
    status: 404
  });
  const sourceJson = parseLocaleJson(sourceFile.content);
  const source = flattenLocale(sourceJson);
  const existing = await prisma.translationWorkspace.findUnique({
    where: workspaceKey(session.shop, theme.id, sourceFilename, targetLocale)
  });
  const shopifyTarget = files.find(({
    filename
  }) => filename === localeFilenameFor(sourceFilename, targetLocale));
  const target = existing ? JSON.parse(existing.targetSnapshot) : shopifyTarget ? flattenLocale(parseLocaleJson(shopifyTarget.content)) : {};
  const previousSource = existing ? JSON.parse(existing.sourceSnapshot) : source;
  const previousStatuses = existing ? JSON.parse(existing.statusSnapshot) : {};
  const statuses = computeStatuses(source, target, previousSource);
  for (const key of Object.keys(statuses)) {
    if (statuses[key] === "translated" && previousStatuses[key] === "stale" && previousSource[key] === source[key]) statuses[key] = "stale";
  }
  const now = /* @__PURE__ */ new Date();
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
      lastSyncedAt: now
    },
    update: {
      themeName: theme.name,
      sourceSnapshot: JSON.stringify(source),
      statusSnapshot: JSON.stringify(statuses),
      lastSyncedAt: now
    }
  });
  const latestJob = await prisma.translationJob.findFirst({
    where: {
      workspaceId: workspace.id
    },
    orderBy: {
      createdAt: "desc"
    }
  });
  return {
    ...dashboard,
    gemini,
    files: files.map(({
      filename
    }) => filename),
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
      job: latestJob ? jobSummary(latestJob) : null
    }
  };
};
const action = async ({
  request
}) => {
  const {
    admin,
    session
  } = await authenticate.admin(request);
  const form2 = await request.formData();
  const intent = String(form2.get("intent") || "");
  if (intent === "refresh") return {
    ok: true,
    message: "Themes and locales refreshed"
  };
  const themeId = String(form2.get("themeId") || "");
  const sourceFilename = String(form2.get("sourceFilename") || "");
  const targetLocale = String(form2.get("targetLocale") || "");
  if (!themeId || !sourceFilename || !targetLocale) {
    return Response.json({
      ok: false,
      message: "Translation selection is incomplete"
    }, {
      status: 400
    });
  }
  try {
    const workspace = await prisma.translationWorkspace.findFirstOrThrow({
      where: {
        shop: session.shop,
        themeId,
        sourceFilename,
        targetLocale
      }
    });
    const source = JSON.parse(workspace.sourceSnapshot);
    const target = JSON.parse(workspace.targetSnapshot);
    const statuses = JSON.parse(workspace.statusSnapshot);
    if (intent === "save" || intent === "translate") {
      const key = String(form2.get("key") || "");
      if (!(key in source)) throw new Error("Translation key is invalid");
      let translation = String(form2.get("translation") || "");
      if (intent === "translate") {
        const configuration = await getShopGeminiConfiguration(session.shop);
        if (!configuration) throw new Error("Configure a Gemini API key in Settings first");
        const result = await translateBatch([{
          key,
          source: source[key]
        }], workspace.sourceLocale, targetLocale, configuration.apiKey, configuration.model);
        translation = result.translations[key];
      }
      const invalid = translation.trim() ? validatePlaceholders(source[key], translation) : [];
      if (invalid.length) throw new Error(`Protected tokens changed: ${invalid.join(", ")}`);
      target[key] = translation;
      statuses[key] = translation.trim() ? "translated" : "missing";
      await prisma.translationWorkspace.update({
        where: {
          id: workspace.id
        },
        data: {
          targetSnapshot: JSON.stringify(target),
          statusSnapshot: JSON.stringify(statuses)
        }
      });
      return {
        ok: true,
        message: intent === "translate" ? "Translation generated" : "Translation saved"
      };
    }
    if (intent === "startJob") {
      const configuration = await getShopGeminiConfiguration(session.shop);
      if (!configuration) throw new Error("Configure a Gemini API key in Settings first");
      const existingJob = await prisma.translationJob.findFirst({
        where: {
          workspaceId: workspace.id,
          status: {
            in: ["pending", "active", "paused", "failed"]
          }
        },
        orderBy: {
          createdAt: "desc"
        }
      });
      if (existingJob) {
        return {
          ok: true,
          message: "Existing translation job opened",
          job: jobSummary(existingJob)
        };
      }
      const pendingKeys = Object.keys(source).filter((key) => statuses[key] === "missing" || statuses[key] === "stale");
      const job = await prisma.translationJob.create({
        data: {
          workspaceId: workspace.id,
          activeKey: pendingKeys.length ? workspace.id : null,
          pendingKeys,
          totalItems: pendingKeys.length,
          status: pendingKeys.length ? "pending" : "completed",
          completedAt: pendingKeys.length ? null : /* @__PURE__ */ new Date(),
          model: configuration.model
        }
      });
      return {
        ok: true,
        message: pendingKeys.length ? "Translation job started" : "No missing or stale strings",
        job: jobSummary(job)
      };
    }
    if (intent === "resumeJob") {
      const jobId = String(form2.get("jobId") || "");
      const job = await prisma.translationJob.findFirstOrThrow({
        where: {
          id: jobId,
          workspace: {
            shop: session.shop,
            id: workspace.id
          }
        }
      });
      if (!["paused", "failed", "pending", "active"].includes(job.status)) {
        throw new Error("This translation job cannot be resumed");
      }
      const resumed = await prisma.translationJob.update({
        where: {
          id: job.id
        },
        data: {
          status: "active",
          error: null,
          processingStartedAt: null
        }
      });
      return {
        ok: true,
        message: "Translation job resumed",
        job: jobSummary(resumed)
      };
    }
    if (intent === "processJob") {
      const jobId = String(form2.get("jobId") || "");
      const job = await prisma.translationJob.findFirstOrThrow({
        where: {
          id: jobId,
          workspace: {
            shop: session.shop,
            id: workspace.id
          }
        }
      });
      if (!["pending", "active"].includes(job.status)) {
        return {
          ok: true,
          message: "Translation job is not active",
          job: jobSummary(job)
        };
      }
      const staleLock = new Date(Date.now() - 5 * 60 * 1e3);
      const claimed = await prisma.translationJob.updateMany({
        where: {
          id: job.id,
          status: {
            in: ["pending", "active"]
          },
          OR: [{
            processingStartedAt: null
          }, {
            processingStartedAt: {
              lt: staleLock
            }
          }]
        },
        data: {
          status: "active",
          processingStartedAt: /* @__PURE__ */ new Date(),
          error: null
        }
      });
      if (!claimed.count) {
        return Response.json({
          ok: false,
          message: "A translation batch is already processing"
        }, {
          status: 409
        });
      }
      const configuration = await getShopGeminiConfiguration(session.shop);
      if (!configuration) {
        const paused = await prisma.translationJob.update({
          where: {
            id: job.id
          },
          data: {
            status: "paused",
            error: "Gemini API key is not configured",
            processingStartedAt: null
          }
        });
        return Response.json({
          ok: false,
          message: paused.error,
          job: jobSummary(paused)
        }, {
          status: 400
        });
      }
      const pendingKeys = job.pendingKeys.filter((key) => key in source);
      const batchKeys = pendingKeys.slice(0, configuration.batchSize);
      if (!batchKeys.length) {
        const completed = await prisma.translationJob.update({
          where: {
            id: job.id
          },
          data: {
            status: "completed",
            activeKey: null,
            pendingKeys: [],
            processingStartedAt: null,
            completedAt: /* @__PURE__ */ new Date()
          }
        });
        return {
          ok: true,
          message: "Translation job completed",
          job: jobSummary(completed)
        };
      }
      try {
        const result = await translateBatch(batchKeys.map((key) => ({
          key,
          source: source[key]
        })), workspace.sourceLocale, targetLocale, configuration.apiKey, job.model);
        Object.assign(target, result.translations);
        batchKeys.forEach((key) => {
          statuses[key] = "translated";
        });
        const remainingKeys = pendingKeys.slice(batchKeys.length);
        const completedAt = remainingKeys.length ? null : /* @__PURE__ */ new Date();
        const [, updatedJob] = await prisma.$transaction([prisma.translationWorkspace.update({
          where: {
            id: workspace.id
          },
          data: {
            targetSnapshot: JSON.stringify(target),
            statusSnapshot: JSON.stringify(statuses)
          }
        }), prisma.translationJob.update({
          where: {
            id: job.id
          },
          data: {
            pendingKeys: remainingKeys,
            status: remainingKeys.length ? "active" : "completed",
            activeKey: remainingKeys.length ? workspace.id : null,
            completedItems: {
              increment: batchKeys.length
            },
            promptTokenCount: {
              increment: result.usage.promptTokenCount
            },
            candidatesTokenCount: {
              increment: result.usage.candidatesTokenCount
            },
            thoughtsTokenCount: {
              increment: result.usage.thoughtsTokenCount
            },
            totalTokenCount: {
              increment: result.usage.totalTokenCount
            },
            error: null,
            processingStartedAt: null,
            completedAt
          }
        })]);
        return {
          ok: true,
          message: remainingKeys.length ? `Translated ${batchKeys.length} strings` : "Translation job completed",
          job: jobSummary(updatedJob)
        };
      } catch (error) {
        const retryable = isRetryableGeminiError(error);
        const errorMessage = retryable ? "Gemini is rate limited or temporarily unavailable. Continue the job to retry this batch." : error instanceof Error && (error.message.startsWith("Gemini changed protected tokens") || error.message.startsWith("Gemini omitted") || error.message === "Gemini returned an empty response") ? error.message : "Gemini could not translate this batch. Retry after checking the configuration.";
        const failed = await prisma.translationJob.update({
          where: {
            id: job.id
          },
          data: {
            status: retryable ? "paused" : "failed",
            error: errorMessage,
            processingStartedAt: null
          }
        });
        return Response.json({
          ok: false,
          message: errorMessage,
          job: jobSummary(failed)
        }, {
          status: retryable ? 503 : 400
        });
      }
    }
    if (intent === "publish") {
      const publishable = Object.fromEntries(Object.entries(target).filter(([, value]) => value.trim()));
      const output = unflattenLocale(publishable);
      await upsertThemeLocale(admin, themeId, localeFilenameFor(sourceFilename, targetLocale), output);
      return {
        ok: true,
        message: `${localeFilenameFor(sourceFilename, targetLocale)} published to Shopify`
      };
    }
    throw new Error("Unknown action");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    const message = ["Translation key is invalid", "Configure a Gemini API key in Settings first", "This translation job cannot be resumed", "Unknown action"].includes(detail) || detail.startsWith("Protected tokens changed") || detail.startsWith("Gemini changed protected tokens") || detail.startsWith("Gemini omitted") ? detail : "The translation request could not be completed";
    return Response.json({
      ok: false,
      message
    }, {
      status: 400
    });
  }
};
const app__index = UNSAFE_withComponentProps(function TranslatorDashboard() {
  const data = useLoaderData();
  const fetcher = useFetcher();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const shopify2 = useAppBridge();
  const selection = data.selection;
  const busy = fetcher.state !== "idle" || navigation.state !== "idle";
  const fetcherJob = fetcher.data && "job" in fetcher.data ? fetcher.data.job : null;
  const job = fetcherJob ?? selection?.job ?? null;
  const refreshedJob = useRef(null);
  useEffect(() => {
    if (fetcher.data?.message) shopify2.toast.show(fetcher.data.message, {
      isError: !fetcher.data.ok
    });
  }, [fetcher.data, shopify2]);
  useEffect(() => {
    if (!selection || !job || !["pending", "active"].includes(job.status) || fetcher.state !== "idle" || fetcher.data && !fetcher.data.ok) return;
    const timer = window.setTimeout(() => {
      fetcher.submit({
        intent: "processJob",
        jobId: job.id,
        themeId: selection.themeId,
        sourceFilename: selection.sourceFilename,
        targetLocale: selection.targetLocale
      }, {
        method: "post"
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [fetcher, fetcher.data, job, selection]);
  useEffect(() => {
    if (job?.status === "completed" && refreshedJob.current !== job.id) {
      refreshedJob.current = job.id;
      revalidator.revalidate();
    }
  }, [job, revalidator]);
  const counts = selection ? Object.values(selection.statuses).reduce((sum, status) => {
    sum[status] = (sum[status] ?? 0) + 1;
    return sum;
  }, {}) : {};
  const percentage = job?.totalItems ? Math.round(job.completedItems / job.totalItems * 100) : job?.status === "completed" ? 100 : 0;
  const submitJob = (intent) => {
    if (!selection) return;
    fetcher.submit({
      intent,
      ...job ? {
        jobId: job.id
      } : {},
      themeId: selection.themeId,
      sourceFilename: selection.sourceFilename,
      targetLocale: selection.targetLocale
    }, {
      method: "post"
    });
  };
  return /* @__PURE__ */ jsxs("s-page", {
    heading: "Locale translator",
    children: [/* @__PURE__ */ jsx("s-button", {
      slot: "primary-action",
      onClick: () => fetcher.submit({
        intent: "refresh"
      }, {
        method: "post"
      }),
      loading: busy || void 0,
      children: "Refresh / sync"
    }), /* @__PURE__ */ jsx("s-section", {
      heading: "Gemini configuration",
      children: data.gemini.configured ? /* @__PURE__ */ jsxs("s-paragraph", {
        children: ["Configured model: ", data.gemini.model, ". ", /* @__PURE__ */ jsx("s-link", {
          href: "/app/settings",
          children: "Manage settings"
        })]
      }) : /* @__PURE__ */ jsxs("s-banner", {
        tone: "warning",
        children: ["Gemini is not configured. ", /* @__PURE__ */ jsx("s-link", {
          href: "/app/settings",
          children: "Add an API key in Settings"
        }), "."]
      })
    }), /* @__PURE__ */ jsx("s-section", {
      heading: "Translation workspace",
      children: /* @__PURE__ */ jsx(Form, {
        method: "get",
        children: /* @__PURE__ */ jsxs("s-stack", {
          direction: "block",
          gap: "base",
          children: [/* @__PURE__ */ jsxs("label", {
            children: [/* @__PURE__ */ jsx("s-text", {
              children: "Theme"
            }), /* @__PURE__ */ jsxs("select", {
              name: "theme",
              defaultValue: selection?.themeId || "",
              required: true,
              style: {
                display: "block",
                width: "100%",
                padding: 10,
                marginTop: 6
              },
              children: [/* @__PURE__ */ jsx("option", {
                value: "",
                children: "Select a theme"
              }), data.themes.map((theme) => /* @__PURE__ */ jsxs("option", {
                value: theme.id,
                children: [theme.name, " (", theme.role, ")"]
              }, theme.id))]
            })]
          }), /* @__PURE__ */ jsxs("label", {
            children: [/* @__PURE__ */ jsx("s-text", {
              children: "Source locale file"
            }), /* @__PURE__ */ jsxs("select", {
              name: "source",
              defaultValue: selection?.sourceFilename || "",
              style: {
                display: "block",
                width: "100%",
                padding: 10,
                marginTop: 6
              },
              children: [/* @__PURE__ */ jsx("option", {
                value: "",
                children: "Select a locale file"
              }), data.files.map((filename) => /* @__PURE__ */ jsx("option", {
                value: filename,
                children: filename
              }, filename))]
            })]
          }), /* @__PURE__ */ jsxs("label", {
            children: [/* @__PURE__ */ jsx("s-text", {
              children: "Target language"
            }), /* @__PURE__ */ jsxs("select", {
              name: "target",
              defaultValue: selection?.targetLocale || "",
              style: {
                display: "block",
                width: "100%",
                padding: 10,
                marginTop: 6
              },
              children: [/* @__PURE__ */ jsx("option", {
                value: "",
                children: "Select a target language"
              }), data.shopLocales.map((locale) => /* @__PURE__ */ jsxs("option", {
                value: locale.locale,
                children: [locale.name, " (", locale.locale, ")", locale.published ? " — published" : ""]
              }, locale.locale))]
            })]
          }), /* @__PURE__ */ jsx("s-button", {
            type: "submit",
            loading: navigation.state !== "idle" || void 0,
            children: "Open workspace"
          })]
        })
      })
    }), selection && /* @__PURE__ */ jsxs(Fragment, {
      children: [/* @__PURE__ */ jsxs("s-section", {
        heading: "Progress",
        children: [/* @__PURE__ */ jsxs("s-stack", {
          direction: "inline",
          gap: "base",
          children: [/* @__PURE__ */ jsxs("s-badge", {
            tone: "success",
            children: ["Translated: ", counts.translated ?? 0]
          }), /* @__PURE__ */ jsxs("s-badge", {
            tone: "warning",
            children: ["Stale: ", counts.stale ?? 0]
          }), /* @__PURE__ */ jsxs("s-badge", {
            tone: "critical",
            children: ["Missing: ", counts.missing ?? 0]
          })]
        }), /* @__PURE__ */ jsxs("s-paragraph", {
          children: ["Last sync: ", new Date(selection.lastSyncedAt).toLocaleString(), ". Last update: ", new Date(selection.lastUpdatedAt).toLocaleString(), ". Target file: ", selection.targetFilename]
        }), job && /* @__PURE__ */ jsx("s-box", {
          padding: "base",
          borderWidth: "base",
          borderRadius: "base",
          children: /* @__PURE__ */ jsxs("s-stack", {
            direction: "block",
            gap: "small",
            children: [/* @__PURE__ */ jsx("s-heading", {
              children: "Bulk translation job"
            }), /* @__PURE__ */ jsx("progress", {
              value: job.completedItems,
              max: Math.max(job.totalItems, 1),
              style: {
                width: "100%"
              },
              "aria-label": "Translation progress"
            }), /* @__PURE__ */ jsxs("s-paragraph", {
              children: [job.completedItems, " / ", job.totalItems, " (", percentage, "%) · Status: ", job.status, " · Model: ", job.model]
            }), /* @__PURE__ */ jsxs("s-paragraph", {
              children: ["Tokens — prompt: ", job.promptTokenCount, ", candidates: ", job.candidatesTokenCount, ", thoughts: ", job.thoughtsTokenCount, ", total: ", job.totalTokenCount]
            }), job.error && /* @__PURE__ */ jsx("s-banner", {
              tone: "critical",
              children: job.error
            })]
          })
        }), /* @__PURE__ */ jsxs("s-stack", {
          direction: "inline",
          gap: "base",
          children: [(!job || job.status === "completed") && /* @__PURE__ */ jsx("s-button", {
            onClick: () => submitJob("startJob"),
            loading: busy || void 0,
            disabled: !data.gemini.configured || void 0,
            children: "Start translation"
          }), job && ["pending", "active"].includes(job.status) && /* @__PURE__ */ jsx("s-button", {
            onClick: () => submitJob("processJob"),
            loading: busy || void 0,
            children: "Continue"
          }), job?.status === "paused" && /* @__PURE__ */ jsx("s-button", {
            onClick: () => submitJob("resumeJob"),
            loading: busy || void 0,
            children: "Continue"
          }), job?.status === "failed" && /* @__PURE__ */ jsx("s-button", {
            onClick: () => submitJob("resumeJob"),
            loading: busy || void 0,
            children: "Retry"
          }), /* @__PURE__ */ jsx("s-button", {
            onClick: () => fetcher.submit({
              intent: "publish",
              themeId: selection.themeId,
              sourceFilename: selection.sourceFilename,
              targetLocale: selection.targetLocale
            }, {
              method: "post"
            }),
            variant: "primary",
            loading: busy || void 0,
            children: "Publish to Shopify"
          })]
        })]
      }), /* @__PURE__ */ jsx("s-section", {
        heading: "Strings",
        children: /* @__PURE__ */ jsx("s-stack", {
          direction: "block",
          gap: "base",
          children: Object.entries(selection.source).map(([key, source]) => /* @__PURE__ */ jsx("s-box", {
            padding: "base",
            borderWidth: "base",
            borderRadius: "base",
            children: /* @__PURE__ */ jsxs(fetcher.Form, {
              method: "post",
              children: [/* @__PURE__ */ jsx("input", {
                type: "hidden",
                name: "themeId",
                value: selection.themeId
              }), /* @__PURE__ */ jsx("input", {
                type: "hidden",
                name: "sourceFilename",
                value: selection.sourceFilename
              }), /* @__PURE__ */ jsx("input", {
                type: "hidden",
                name: "targetLocale",
                value: selection.targetLocale
              }), /* @__PURE__ */ jsx("input", {
                type: "hidden",
                name: "key",
                value: key
              }), /* @__PURE__ */ jsx("input", {
                type: "hidden",
                name: "intent",
                value: "save"
              }), /* @__PURE__ */ jsxs("s-stack", {
                direction: "block",
                gap: "small",
                children: [/* @__PURE__ */ jsxs("s-stack", {
                  direction: "inline",
                  gap: "small",
                  children: [/* @__PURE__ */ jsx("s-heading", {
                    children: key
                  }), /* @__PURE__ */ jsx("s-badge", {
                    tone: selection.statuses[key] === "translated" ? "success" : selection.statuses[key] === "stale" ? "warning" : "critical",
                    children: selection.statuses[key]
                  })]
                }), /* @__PURE__ */ jsx("s-paragraph", {
                  children: source
                }), /* @__PURE__ */ jsx("textarea", {
                  name: "translation",
                  defaultValue: selection.target[key] ?? "",
                  rows: 3,
                  "aria-label": `Translation for ${key}`,
                  style: {
                    width: "100%",
                    padding: 10,
                    resize: "vertical"
                  }
                }), /* @__PURE__ */ jsxs("s-stack", {
                  direction: "inline",
                  gap: "small",
                  children: [/* @__PURE__ */ jsx("s-button", {
                    type: "submit",
                    loading: busy || void 0,
                    children: "Save"
                  }), /* @__PURE__ */ jsx("s-button", {
                    onClick: () => fetcher.submit({
                      intent: "translate",
                      themeId: selection.themeId,
                      sourceFilename: selection.sourceFilename,
                      targetLocale: selection.targetLocale,
                      key
                    }, {
                      method: "post"
                    }),
                    loading: busy || void 0,
                    disabled: !data.gemini.configured || void 0,
                    children: "Translate with Gemini"
                  })]
                })]
              })]
            })
          }, key))
        })
      })]
    })]
  });
});
const headers = (headersArgs) => boundary.headers(headersArgs);
const route12 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action,
  default: app__index,
  headers,
  loader
}, Symbol.toStringTag, { value: "Module" }));
const serverManifest = { "entry": { "module": "/assets/entry.client-Bixr_BSR.js", "imports": ["/assets/jsx-runtime--H_w9gqB.js", "/assets/chunk-62JRHF6Z-DJKmK32Q.js"], "css": [] }, "routes": { "root": { "id": "root", "parentId": void 0, "path": "", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/root-zEpml0qU.js", "imports": ["/assets/jsx-runtime--H_w9gqB.js", "/assets/chunk-62JRHF6Z-DJKmK32Q.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/webhooks.customers.data_request": { "id": "routes/webhooks.customers.data_request", "parentId": "root", "path": "webhooks/customers/data_request", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/webhooks.customers.data_request-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/webhooks.app.scopes_update": { "id": "routes/webhooks.app.scopes_update", "parentId": "root", "path": "webhooks/app/scopes_update", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/webhooks.app.scopes_update-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/webhooks.customers.redact": { "id": "routes/webhooks.customers.redact", "parentId": "root", "path": "webhooks/customers/redact", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/webhooks.customers.redact-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/webhooks.app.uninstalled": { "id": "routes/webhooks.app.uninstalled", "parentId": "root", "path": "webhooks/app/uninstalled", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/webhooks.app.uninstalled-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/webhooks.shop.redact": { "id": "routes/webhooks.shop.redact", "parentId": "root", "path": "webhooks/shop/redact", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/webhooks.shop.redact-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/auth.login": { "id": "routes/auth.login", "parentId": "root", "path": "auth/login", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/route-DzsnO4eJ.js", "imports": ["/assets/chunk-62JRHF6Z-DJKmK32Q.js", "/assets/jsx-runtime--H_w9gqB.js", "/assets/AppProxyLink-CU0Op_4p.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/_index": { "id": "routes/_index", "parentId": "root", "path": void 0, "index": true, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/route-C_zgCFpC.js", "imports": ["/assets/chunk-62JRHF6Z-DJKmK32Q.js", "/assets/jsx-runtime--H_w9gqB.js"], "css": ["/assets/route-Xpdx9QZl.css"], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/auth.$": { "id": "routes/auth.$", "parentId": "root", "path": "auth/*", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/auth._-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/app": { "id": "routes/app", "parentId": "root", "path": "app", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": true, "module": "/assets/app-3cRqGTSv.js", "imports": ["/assets/chunk-62JRHF6Z-DJKmK32Q.js", "/assets/jsx-runtime--H_w9gqB.js", "/assets/AppProxyLink-CU0Op_4p.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/app.additional": { "id": "routes/app.additional", "parentId": "routes/app", "path": "additional", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/app.additional-BVhaIvCa.js", "imports": ["/assets/chunk-62JRHF6Z-DJKmK32Q.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/app.settings": { "id": "routes/app.settings", "parentId": "routes/app", "path": "settings", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/app.settings-l-qWcfK5.js", "imports": ["/assets/chunk-62JRHF6Z-DJKmK32Q.js", "/assets/jsx-runtime--H_w9gqB.js", "/assets/useAppBridge-Bj34gXAL.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/app._index": { "id": "routes/app._index", "parentId": "routes/app", "path": void 0, "index": true, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/app._index-p5KXMMgf.js", "imports": ["/assets/chunk-62JRHF6Z-DJKmK32Q.js", "/assets/jsx-runtime--H_w9gqB.js", "/assets/useAppBridge-Bj34gXAL.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 } }, "url": "/assets/manifest-12d9d1b9.js", "version": "12d9d1b9", "sri": void 0 };
const assetsBuildDirectory = "build/client";
const basename = "/";
const future = { "unstable_optimizeDeps": false, "v8_passThroughRequests": false, "v8_trailingSlashAwareDataRequests": false, "unstable_previewServerPrerendering": false, "v8_middleware": false, "v8_splitRouteModules": false, "v8_viteEnvironmentApi": false };
const ssr = true;
const isSpaMode = false;
const prerender = [];
const routeDiscovery = { "mode": "lazy", "manifestPath": "/__manifest" };
const publicPath = "/";
const entry = { module: entryServer };
const routes = {
  "root": {
    id: "root",
    parentId: void 0,
    path: "",
    index: void 0,
    caseSensitive: void 0,
    module: route0
  },
  "routes/webhooks.customers.data_request": {
    id: "routes/webhooks.customers.data_request",
    parentId: "root",
    path: "webhooks/customers/data_request",
    index: void 0,
    caseSensitive: void 0,
    module: route1
  },
  "routes/webhooks.app.scopes_update": {
    id: "routes/webhooks.app.scopes_update",
    parentId: "root",
    path: "webhooks/app/scopes_update",
    index: void 0,
    caseSensitive: void 0,
    module: route2
  },
  "routes/webhooks.customers.redact": {
    id: "routes/webhooks.customers.redact",
    parentId: "root",
    path: "webhooks/customers/redact",
    index: void 0,
    caseSensitive: void 0,
    module: route3
  },
  "routes/webhooks.app.uninstalled": {
    id: "routes/webhooks.app.uninstalled",
    parentId: "root",
    path: "webhooks/app/uninstalled",
    index: void 0,
    caseSensitive: void 0,
    module: route4
  },
  "routes/webhooks.shop.redact": {
    id: "routes/webhooks.shop.redact",
    parentId: "root",
    path: "webhooks/shop/redact",
    index: void 0,
    caseSensitive: void 0,
    module: route5
  },
  "routes/auth.login": {
    id: "routes/auth.login",
    parentId: "root",
    path: "auth/login",
    index: void 0,
    caseSensitive: void 0,
    module: route6
  },
  "routes/_index": {
    id: "routes/_index",
    parentId: "root",
    path: void 0,
    index: true,
    caseSensitive: void 0,
    module: route7
  },
  "routes/auth.$": {
    id: "routes/auth.$",
    parentId: "root",
    path: "auth/*",
    index: void 0,
    caseSensitive: void 0,
    module: route8
  },
  "routes/app": {
    id: "routes/app",
    parentId: "root",
    path: "app",
    index: void 0,
    caseSensitive: void 0,
    module: route9
  },
  "routes/app.additional": {
    id: "routes/app.additional",
    parentId: "routes/app",
    path: "additional",
    index: void 0,
    caseSensitive: void 0,
    module: route10
  },
  "routes/app.settings": {
    id: "routes/app.settings",
    parentId: "routes/app",
    path: "settings",
    index: void 0,
    caseSensitive: void 0,
    module: route11
  },
  "routes/app._index": {
    id: "routes/app._index",
    parentId: "routes/app",
    path: void 0,
    index: true,
    caseSensitive: void 0,
    module: route12
  }
};
const allowedActionOrigins = false;
export {
  allowedActionOrigins,
  serverManifest as assets,
  assetsBuildDirectory,
  basename,
  entry,
  future,
  isSpaMode,
  prerender,
  publicPath,
  routeDiscovery,
  routes,
  ssr
};
