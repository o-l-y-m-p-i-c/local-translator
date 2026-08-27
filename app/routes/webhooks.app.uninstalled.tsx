import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  await db.$transaction([
    db.translationWorkspace.deleteMany({ where: { shop } }),
    db.shopSettings.deleteMany({ where: { shop } }),
    ...(session ? [db.session.deleteMany({ where: { shop } })] : []),
  ]);

  return new Response();
};
