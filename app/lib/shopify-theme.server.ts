import { parseLocaleJson, type LocaleJson } from "./locale";

type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type GraphqlPayload<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

export type ThemeSummary = { id: string; name: string; role: string };
export type ShopLocale = {
  locale: string;
  name: string;
  primary: boolean;
  published: boolean;
};
export type ThemeLocaleFile = { filename: string; content: string };

type ThemeLocaleFilesData = {
  theme: null | {
    files: {
      nodes: Array<{
        filename: string;
        body: null | { content?: string };
      }>;
      pageInfo: { endCursor: string | null; hasNextPage: boolean };
      userErrors: Array<{ code: string; filename: string | null }>;
    };
  };
};

async function graphql<T>(
  admin: AdminClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const payload = (await response.json()) as GraphqlPayload<T>;
  if (!response.ok || payload.errors?.length || !payload.data) {
    throw new Error(
      payload.errors?.map(({ message }) => message).join("; ") ||
      `Shopify Admin API returned ${response.status}`,
    );
  }
  return payload.data;
}

export async function getDashboardData(admin: AdminClient) {
  const data = await graphql<{
    themes: { nodes: ThemeSummary[] };
    shopLocales: ShopLocale[];
  }>(
    admin,
    `#graphql
      query TranslatorDashboard {
        themes(first: 50) { nodes { id name role } }
        shopLocales { locale name primary published }
      }`,
  );
  return { themes: data.themes.nodes, shopLocales: data.shopLocales };
}

export async function getThemeLocaleFiles(
  admin: AdminClient,
  themeId: string,
): Promise<ThemeLocaleFile[]> {
  const localeFiles: ThemeLocaleFile[] = [];
  let after: string | null = null;

  do {
    const data: ThemeLocaleFilesData = await graphql<ThemeLocaleFilesData>(
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
      { id: themeId, after },
    );
    if (!data.theme) throw new Error("Theme not found");
    if (data.theme.files.userErrors.length) {
      throw new Error(
        data.theme.files.userErrors
          .map(({ code, filename }) => `${code}${filename ? `: ${filename}` : ""}`)
          .join("; "),
      );
    }
    const localeNodes = data.theme.files.nodes.filter(
      (file) =>
        file.filename.startsWith("locales/") &&
        file.filename.endsWith(".json") &&
        !file.filename.endsWith(".schema.json"),
    );
    console.log("[getThemeLocaleFiles] found", localeNodes.length, "locale files:",
      localeNodes.map((f) => f.filename).join(", "));
    for (const file of localeNodes) {
      const content = file.body?.content;
      if (typeof content !== "string") {
        console.log("[getThemeLocaleFiles]", file.filename, "has no text content, skipping");
        continue;
      }
      console.log("[getThemeLocaleFiles]", file.filename, "starts with:", JSON.stringify(content.slice(0, 80)));
      localeFiles.push({ filename: file.filename, content });
    }
    after = data.theme.files.pageInfo.hasNextPage
      ? data.theme.files.pageInfo.endCursor
      : null;
  } while (after);

  return localeFiles;
}

export async function readThemeLocale(
  admin: AdminClient,
  themeId: string,
  filename: string,
): Promise<LocaleJson> {
  const files = await getThemeLocaleFiles(admin, themeId);
  const file = files.find((candidate) => candidate.filename === filename);
  if (!file) throw new Error(`Locale file ${filename} was not found`);
  return parseLocaleJson(file.content);
}

export async function upsertThemeLocale(
  admin: AdminClient,
  themeId: string,
  filename: string,
  locale: LocaleJson,
) {
  const data = await graphql<{
    themeFilesUpsert: {
      upsertedThemeFiles: Array<{ filename: string }>;
      job: null | { id: string };
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(
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
          body: { type: "TEXT", value: JSON.stringify(locale, null, 2) },
        },
      ],
    },
  );
  const errors = data.themeFilesUpsert.userErrors;
  if (errors.length) throw new Error(errors.map(({ message }) => message).join("; "));
  if (
    !data.themeFilesUpsert.upsertedThemeFiles.length &&
    !data.themeFilesUpsert.job
  ) {
    throw new Error("Shopify did not confirm or queue the locale file update");
  }
  return data.themeFilesUpsert;
}
