import { useCallback, useEffect, useState } from "react";
import { getAllTemplates, removeTemplate, saveTemplate } from "@/lib/upload-store";
import {
  fieldsOf,
  freeName,
  type ImportItem,
  type RequestTemplate,
  type TemplateFields,
} from "@/lib/request-templates";

/** What happens to an imported template whose name a kept one has already. */
export type ImportChoice = "replace" | "keep" | "skip";

/** The fields in place of a kept template, which keeps its ID and its dates. */
function replaced(fields: TemplateFields, kept: RequestTemplate): RequestTemplate {
  return {
    ...fields,
    id: kept.id,
    createdAt: kept.createdAt,
    ...(kept.usedAt ? { usedAt: kept.usedAt } : {}),
  };
}

/** The kept templates, or none where the browser refuses IndexedDB. */
const read = () => getAllTemplates().catch((): RequestTemplate[] => []);

/** The request templates kept in this browser. They never leave it unless exported. */
export function useRequestTemplates() {
  const [templates, setTemplates] = useState<RequestTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setTemplates(await read());
  }, []);

  useEffect(() => {
    let live = true;
    void read().then((list) => {
      if (!live) return;
      setTemplates(list);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  /** Saves the fields as a new template, or in place of `replace`. Returns the saved one. */
  const save = useCallback(
    async (fields: TemplateFields, replace?: RequestTemplate) => {
      const template: RequestTemplate = replace
        ? replaced(fields, replace)
        : { ...fields, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
      await saveTemplate(template);
      await reload();
      return template;
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string) => {
      await removeTemplate(id);
      await reload();
    },
    [reload],
  );

  const duplicate = useCallback(
    (template: RequestTemplate) =>
      save({
        ...fieldsOf(template),
        name: freeName(
          template.name,
          templates.map((t) => t.name),
        ),
      }),
    [save, templates],
  );

  /** Remembers that a request was created from the template, as it is kept now. */
  const markUsed = useCallback(
    async (id: string) => {
      const current = (await read()).find((template) => template.id === id);
      if (!current) return;
      await saveTemplate({ ...current, usedAt: new Date().toISOString() });
      await reload();
    },
    [reload],
  );

  /**
   * Adds the templates of an import. One whose name a kept template has replaces it, goes in
   * beside it under a free name, or stays out, as chosen.
   */
  const importItems = useCallback(
    async (items: readonly ImportItem[], choices: readonly ImportChoice[]) => {
      const taken = templates.map((t) => t.name);
      const now = new Date().toISOString();
      for (const [index, item] of items.entries()) {
        const { existing } = item;
        if (existing && choices[index] === "skip") continue;
        if (existing && choices[index] === "replace") {
          await saveTemplate(replaced({ ...item.fields, name: existing.name }, existing));
          continue;
        }
        const name = freeName(item.fields.name, taken);
        taken.push(name);
        await saveTemplate({ ...item.fields, name, id: crypto.randomUUID(), createdAt: now });
      }
      await reload();
    },
    [reload, templates],
  );

  return { templates, loading, save, remove, duplicate, markUsed, importItems };
}
