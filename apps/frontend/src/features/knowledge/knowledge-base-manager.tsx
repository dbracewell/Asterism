"use client";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { KnowledgeBase } from "@/lib/client";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

export function KnowledgeBaseManager() {
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editing, setEditing] = useState<KnowledgeBase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.knowledgeBaseGetMany({ query: { page: 1, page_size: 100 } });
      setBases(data?.knowledge_bases ?? []);
      setError(null);
    } catch {
      setError("Unable to load knowledge bases.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      if (editing) {
        await api.knowledgeBaseUpdate({
          path: { knowledge_base_id: editing.id },
          body: { name: name.trim(), description: description.trim() || null },
        });
        setEditing(null);
      } else {
        await api.knowledgeBaseCreate({ body: { name: name.trim(), description: description.trim() || null } });
      }
      setName("");
      setDescription("");
      await load();
    } catch {
      setError("Unable to create this knowledge base. Its name may already be in use.");
    }
  };

  const remove = async (base: KnowledgeBase) => {
    if (!window.confirm(`Delete “${base.name}” and its indexed documents?`)) return;
    try {
      await api.knowledgeBaseDelete({ path: { knowledge_base_id: base.id } });
      setBases((current) => current.filter((item) => item.id !== base.id));
    } catch {
      setError("Unable to delete this knowledge base.");
    }
  };

  return <main className="mx-auto mt-12 w-full max-w-4xl space-y-6 p-6">
    <header><h1 className="text-2xl font-semibold">Knowledge bases</h1><p className="text-muted-foreground">Private documents available to assigned agents.</p></header>
    <form className="grid gap-3 rounded-lg border p-4" onSubmit={(event) => void create(event)}>
      <label className="grid gap-1"><span className="text-sm font-medium">Name</span><input className="rounded border bg-transparent p-2" value={name} onChange={(event) => setName(event.target.value)} maxLength={255} required /></label>
      <label className="grid gap-1"><span className="text-sm font-medium">Description (optional)</span><textarea className="rounded border bg-transparent p-2" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <div className="flex gap-2"><Button type="submit">{editing ? "Save changes" : "Create knowledge base"}</Button>{editing && <Button type="button" variant="outline" onClick={() => { setEditing(null); setName(""); setDescription(""); }}>Cancel</Button>}</div>
    </form>
    {error && <p className="text-destructive" role="alert">{error}</p>}
    {loading ? <p className="text-muted-foreground">Loading knowledge bases…</p> : bases.length === 0 ? <p className="text-muted-foreground">No knowledge bases yet. Create one to begin indexing private documents.</p> : <div className="divide-y rounded-lg border">
      {bases.map((base) => <article className="flex items-center justify-between gap-4 p-4" key={base.id}>
        <div><Link className="font-medium underline" href={`/knowledge/${base.id}`}>{base.name}</Link>{base.description && <p className="text-muted-foreground text-sm">{base.description}</p>}</div>
        <div className="flex gap-1"><Button variant="outline" size="sm" onClick={() => { setEditing(base); setName(base.name); setDescription(base.description ?? ""); }}>Edit</Button><Button aria-label={`Delete ${base.name}`} variant="ghost" size="icon" onClick={() => void remove(base)}><Trash2 size={16} /></Button></div>
      </article>)}
    </div>}
  </main>;
}
