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

export type ResourceType =
  | "PRODUCT"
  | "COLLECTION"
  | "PAGE"
  | "BLOG"
  | "ARTICLE"
  | "MENU"
  | "SHOP";

export type TranslatableContent = {
  key: string;
  value: string;
  digest: string;
  locale: string;
};

export type TranslatableResource = {
  resourceId: string;
  name: string;
  translatableContent: TranslatableContent[];
};

type TranslatableResourcesData = {
  translatableResources: {
    nodes: Array<{
      resourceId: string;
      translatableContent: Array<{
        key: string;
        value: string;
        digest: string;
        locale: string;
      }>;
    }>;
    pageInfo: { endCursor: string | null; hasNextPage: boolean };
  };
};

type ProductData = { products: { nodes: Array<{ id: string; title: string }> } };
type CollectionData = { collections: { nodes: Array<{ id: string; title: string }> } };
type PageData = { pages: { nodes: Array<{ id: string; title: string }> } };
type BlogData = { blogs: { nodes: Array<{ id: string; title: string }> } };
type ArticleData = { articles: { nodes: Array<{ id: string; title: string }> } };
type MenuData = { menus: { nodes: Array<{ id: string; handle: string }> } };

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

export const RESOURCE_TYPES: Array<{ value: ResourceType; label: string }> = [
  { value: "PRODUCT", label: "Products" },
  { value: "COLLECTION", label: "Collections" },
  { value: "PAGE", label: "Pages" },
  { value: "BLOG", label: "Blogs" },
  { value: "ARTICLE", label: "Blog articles" },
];

export async function listResourceNames(
  admin: AdminClient,
  resourceType: ResourceType,
): Promise<Array<{ id: string; name: string }>> {
  switch (resourceType) {
    case "PRODUCT": {
      const data = await graphql<ProductData>(
        admin,
        `query { products(first: 250) { nodes { id title } } }`,
      );
      return data.products.nodes.map((p) => ({ id: p.id, name: p.title }));
    }
    case "COLLECTION": {
      const data = await graphql<CollectionData>(
        admin,
        `query { collections(first: 250) { nodes { id title } } }`,
      );
      return data.collections.nodes.map((c) => ({ id: c.id, name: c.title }));
    }
    case "PAGE": {
      const data = await graphql<PageData>(
        admin,
        `query { pages(first: 250) { nodes { id title } } }`,
      );
      return data.pages.nodes.map((p) => ({ id: p.id, name: p.title }));
    }
    case "BLOG": {
      const data = await graphql<BlogData>(
        admin,
        `query { blogs(first: 250) { nodes { id title } } }`,
      );
      return data.blogs.nodes.map((b) => ({ id: b.id, name: b.title }));
    }
    case "ARTICLE": {
      const data = await graphql<ArticleData>(
        admin,
        `query { articles(first: 250) { nodes { id title } } }`,
      );
      return data.articles.nodes.map((a) => ({ id: a.id, name: a.title }));
    }
    case "MENU": {
      const data = await graphql<MenuData>(
        admin,
        `query { menus(first: 250) { nodes { id handle } } }`,
      );
      return data.menus.nodes.map((m) => ({ id: m.id, name: m.handle }));
    }
    default:
      return [];
  }
}

/**
 * Fetch one page of translatable resources (max 25 per page to keep responses small).
 * Returns resources with their translatable content (all locales, not filtered).
 */
export async function getTranslatableResources(
  admin: AdminClient,
  resourceType: ResourceType,
  after: string | null = null,
  pageSize = 25,
): Promise<{ resources: TranslatableResource[]; hasNextPage: boolean; endCursor: string | null }> {
  const data = await graphql<TranslatableResourcesData>(
    admin,
    `#graphql
      query TranslatableResources($resourceType: TranslatableResourceType!, $first: Int!, $after: String) {
        translatableResources(first: $first, resourceType: $resourceType, after: $after) {
          nodes {
            resourceId
            translatableContent {
              key
              value
              digest
              locale
            }
          }
          pageInfo { endCursor hasNextPage }
        }
      }`,
    { resourceType, first: pageSize, after },
  );

  // Fetch names for this page only
  const names = await listResourceNames(admin, resourceType);
  const nameMap = new Map(names.map((n) => [n.id, n.name]));

  const resources = data.translatableResources.nodes.map((node) => ({
    resourceId: node.resourceId,
    name: nameMap.get(node.resourceId) || node.resourceId,
    // Keep only the first locale's content per key (usually the source language)
    translatableContent: dedupeByLocale(node.translatableContent),
  }));

  return {
    resources,
    hasNextPage: data.translatableResources.pageInfo.hasNextPage,
    endCursor: data.translatableResources.pageInfo.endCursor,
  };
}

/** Keep only one entry per key — prefer the first locale (source language). */
function dedupeByLocale(content: TranslatableContent[]): TranslatableContent[] {
  const seen = new Map<string, TranslatableContent>();
  for (const c of content) {
    if (!seen.has(c.key)) {
      seen.set(c.key, c);
    }
  }
  return Array.from(seen.values());
}

type TranslationsRegisterData = {
  translationsRegister: {
    translations: Array<{ key: string; value: string }>;
    userErrors: Array<{ message: string; key: string }>;
  };
};

export async function registerTranslations(
  admin: AdminClient,
  resourceId: string,
  locale: string,
  translations: Array<{ key: string; value: string; digest: string }>,
) {
  if (!translations.length) return { registered: 0, errors: [] };

  const data = await graphql<TranslationsRegisterData>(
    admin,
    `#graphql
      mutation RegisterTranslations(
        $resourceId: ID!
        $translations: [TranslationInput!]!
      ) {
        translationsRegister(resourceId: $resourceId, translations: $translations) {
          translations { key value }
          userErrors { message key }
        }
      }`,
    {
      resourceId,
      translations: translations.map((t) => ({
        key: t.key,
        value: t.value,
        locale,
        translatableContentDigest: t.digest,
      })),
    },
  );

  return {
    registered: data.translationsRegister.translations.length,
    errors: data.translationsRegister.userErrors.map((e) => `${e.key}: ${e.message}`),
  };
}
