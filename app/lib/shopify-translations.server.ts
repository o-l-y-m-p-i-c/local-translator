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
  | "LINK"
  | "SHOP"
  | "SHOP_POLICY"
  | "METAOBJECT";

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

export type ResourceCategory = {
  label: string;
  types: Array<{ value: ResourceType; label: string }>;
};

export const RESOURCE_CATEGORIES: ResourceCategory[] = [
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

/**
 * Try to fetch resource names for display. Returns empty array on error
 * (e.g. missing scope) — the UI will fall back to showing resourceId.
 */
async function listResourceNames(
  admin: AdminClient,
  resourceType: ResourceType,
): Promise<Array<{ id: string; name: string }>> {
  try {
    switch (resourceType) {
      case "PRODUCT": {
        const data = await graphql<{ products: { nodes: Array<{ id: string; title: string }> } }>(
          admin,
          `query { products(first: 250) { nodes { id title } } }`,
        );
        return data.products.nodes.map((p) => ({ id: p.id, name: p.title }));
      }
      case "COLLECTION": {
        const data = await graphql<{ collections: { nodes: Array<{ id: string; title: string }> } }>(
          admin,
          `query { collections(first: 250) { nodes { id title } } }`,
        );
        return data.collections.nodes.map((c) => ({ id: c.id, name: c.title }));
      }
      case "PAGE": {
        const data = await graphql<{ pages: { nodes: Array<{ id: string; title: string }> } }>(
          admin,
          `query { pages(first: 250) { nodes { id title } } }`,
        );
        return data.pages.nodes.map((p) => ({ id: p.id, name: p.title }));
      }
      case "BLOG": {
        const data = await graphql<{ blogs: { nodes: Array<{ id: string; title: string }> } }>(
          admin,
          `query { blogs(first: 250) { nodes { id title } } }`,
        );
        return data.blogs.nodes.map((b) => ({ id: b.id, name: b.title }));
      }
      case "ARTICLE": {
        const data = await graphql<{ articles: { nodes: Array<{ id: string; title: string }> } }>(
          admin,
          `query { articles(first: 250) { nodes { id title } } }`,
        );
        return data.articles.nodes.map((a) => ({ id: a.id, name: a.title }));
      }
      case "MENU": {
        const data = await graphql<{ menus: { nodes: Array<{ id: string; handle: string }> } }>(
          admin,
          `query { menus(first: 250) { nodes { id handle } } }`,
        );
        return data.menus.nodes.map((m) => ({ id: m.id, name: m.handle }));
      }
      case "SHOP": {
        // SHOP has a single resource — return empty, name will be derived
        return [];
      }
      case "METAOBJECT": {
        // Metaobject definitions vary; return empty, names derived from resourceId
        return [];
      }
      default:
        return [];
    }
  } catch (error) {
    console.log(`[listResourceNames] ${resourceType} failed, will use resourceId as name:`, error);
    return [];
  }
}

/** Derive a human-readable name from a resourceId. */
function deriveName(resourceId: string, content: TranslatableContent[]): string {
  // Try to find a "title" or "name" field in the content
  const titleContent = content.find((c) => c.key === "title" || c.key === "name");
  if (titleContent) return titleContent.value.slice(0, 80);

  // Try to extract from GID, e.g. "gid://shopify/Product/123" → "Product 123"
  const match = resourceId.match(/gid:\/\/shopify\/(\w+)\/(\d+)/);
  if (match) return `${match[1]} ${match[2]}`;

  // For SHOP type
  if (resourceId.includes("Shop")) return "Shop";

  return resourceId.split("/").pop() || resourceId;
}

/**
 * Fetch one page of translatable resources.
 * For MENU type, also fetches the menu items (links) and their translatable content.
 */
export async function getTranslatableResources(
  admin: AdminClient,
  resourceType: ResourceType,
  after: string | null = null,
  pageSize = 10,
): Promise<{ resources: TranslatableResource[]; hasNextPage: boolean; endCursor: string | null }> {
  // Special handling for MENU: try fetching via menus API first (needs read_menus scope),
  // fall back to translatableResources API if scope is missing.
  if (resourceType === "MENU") {
    try {
      return await getMenuResourcesWithItems(admin, after, pageSize);
    } catch (error) {
      console.log("[getTranslatableResources] menus query failed, falling back to translatableResources:", error);
      // Fall through to standard translatableResources query
    }
  }

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

  // Fetch names for this page (best-effort, may fail due to missing scopes)
  const names = await listResourceNames(admin, resourceType);
  const nameMap = new Map(names.map((n) => [n.id, n.name]));

  const resources = data.translatableResources.nodes.map((node) => {
    const content = dedupeByLocale(node.translatableContent);
    return {
      resourceId: node.resourceId,
      name: nameMap.get(node.resourceId) || deriveName(node.resourceId, content),
      translatableContent: content,
    };
  });

  return {
    resources,
    hasNextPage: data.translatableResources.pageInfo.hasNextPage,
    endCursor: data.translatableResources.pageInfo.endCursor,
  };
}

type MenuItemsData = {
  menus: {
    nodes: Array<{
      id: string;
      handle: string;
      items: Array<{
        id: string;
        title: string;
        url: string;
      }>;
    }>;
    pageInfo: { endCursor: string | null; hasNextPage: boolean };
  };
};

type TranslatableResourceData = {
  translatableResource: {
    resourceId: string;
    translatableContent: Array<{
      key: string;
      value: string;
      digest: string;
      locale: string;
    }>;
  };
};

/**
 * Fetch menus with their items (links) and the translatable content for each.
 */
async function getMenuResourcesWithItems(
  admin: AdminClient,
  after: string | null,
  pageSize: number,
): Promise<{ resources: TranslatableResource[]; hasNextPage: boolean; endCursor: string | null }> {
  // 1. Fetch menus with their items
  const menusData = await graphql<MenuItemsData>(
    admin,
    `#graphql
      query MenusWithItems($first: Int!, $after: String) {
        menus(first: $first, after: $after) {
          nodes {
            id
            handle
            items {
              id
              title
              url
            }
          }
          pageInfo { endCursor hasNextPage }
        }
      }`,
    { first: pageSize, after },
  );

  const resources: TranslatableResource[] = [];

  for (const menu of menusData.menus.nodes) {
    // 2. Fetch translatable content for the menu itself
    try {
      const menuTrans = await graphql<TranslatableResourceData>(
        admin,
        `#graphql
          query TranslatableResource($resourceId: ID!) {
            translatableResource(resourceId: $resourceId) {
              resourceId
              translatableContent { key value digest locale }
            }
          }`,
        { resourceId: menu.id },
      );
      const content = dedupeByLocale(menuTrans.translatableResource.translatableContent);
      resources.push({
        resourceId: menu.id,
        name: `Menu: ${menu.handle}`,
        translatableContent: content,
      });
    } catch (error) {
      console.log(`[getMenuResources] menu ${menu.id} translatable content failed:`, error);
      // Still add the menu with its title as content
      resources.push({
        resourceId: menu.id,
        name: `Menu: ${menu.handle}`,
        translatableContent: [],
      });
    }

    // 3. Fetch translatable content for each menu item (link)
    for (const item of menu.items) {
      try {
        const itemTrans = await graphql<TranslatableResourceData>(
          admin,
          `#graphql
            query TranslatableResource($resourceId: ID!) {
              translatableResource(resourceId: $resourceId) {
                resourceId
                translatableContent { key value digest locale }
              }
            }`,
          { resourceId: item.id },
        );
        const content = dedupeByLocale(itemTrans.translatableResource.translatableContent);
        resources.push({
          resourceId: item.id,
          name: `  └ ${item.title}`,
          translatableContent: content,
        });
      } catch (error) {
        console.log(`[getMenuResources] item ${item.id} translatable content failed:`, error);
        // Add the item with its title as fallback content
        resources.push({
          resourceId: item.id,
          name: `  └ ${item.title}`,
          translatableContent: [{
            key: "title",
            value: item.title,
            digest: "",
            locale: "en",
          }],
        });
      }
    }
  }

  return {
    resources,
    hasNextPage: menusData.menus.pageInfo.hasNextPage,
    endCursor: menusData.menus.pageInfo.endCursor,
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
