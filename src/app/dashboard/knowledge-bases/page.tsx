"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Plus,
  Search,
  FolderOpen,
  Trash2,
  Upload,
  ArrowLeft,
  Loader2,
  X,
  FileText,
  Download,
  CheckCircle2
} from "lucide-react";
import Link from "next/link";

interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  file_url: string;
  status: string; // completed, parsing, failed
  parsed_text: string | null;
  created_at: string;
}

export default function KnowledgeBasesPage() {
  const supabase = createClient();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedKb, setSelectedKb] = useState<KnowledgeBase | null>(null);

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [uploading, setUploading] = useState(false);

  // Fetch organization
  const fetchOrg = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: membership } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("profile_id", user.id)
        .single();

      if (membership) {
        setOrgId(membership.organization_id);
      }
    } catch (err) {
      console.error("Error fetching org:", err);
    }
  }, [supabase]);

  // Fetch Knowledge Bases
  const fetchKbs = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("knowledge_bases")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setKbs(data || []);
      if (data && data.length > 0 && !selectedKb) {
        setSelectedKb(data[0]);
      }
    } catch (err) {
      console.error("Error fetching knowledge bases:", err);
    } finally {
      setLoading(false);
    }
  }, [orgId, supabase, selectedKb]);

  useEffect(() => {
    fetchOrg();
  }, [fetchOrg]);

  useEffect(() => {
    if (orgId) {
      fetchKbs();
    }
  }, [orgId, fetchKbs]);

  // Delete Knowledge Base
  const handleDeleteKb = async (id: string) => {
    if (!confirm("Are you sure you want to delete this Knowledge Base document?")) return;
    try {
      const { error } = await supabase
        .from("knowledge_bases")
        .delete()
        .eq("id", id);
      if (error) throw error;
      
      if (selectedKb?.id === id) {
        setSelectedKb(null);
      }
      fetchKbs();
    } catch (err) {
      console.error("Error deleting KB:", err);
      alert("Failed to delete Knowledge Base document.");
    }
  };

  // Add Knowledge Base
  const handleAddKb = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !newName.trim()) return;
    setUploading(true);

    try {
      // Simulate file upload or store URL
      const finalFileUrl = fileUrl.trim() || "https://ulai.co/playbooks/sales_guide.pdf";

      const { data, error } = await supabase
        .from("knowledge_bases")
        .insert({
          organization_id: orgId,
          name: newName.trim(),
          description: newDescription.trim(),
          file_url: finalFileUrl,
          status: "completed",
          parsed_text: fileContent.trim() || "This contains parsed context about: " + newName
        })
        .select()
        .single();

      if (error) throw error;

      setIsAddModalOpen(false);
      setNewName("");
      setNewDescription("");
      setFileUrl("");
      setFileContent("");
      setSelectedKb(data);
      fetchKbs();
    } catch (err) {
      console.error("Error adding knowledge base:", err);
      alert("Failed to save knowledge base.");
    } finally {
      setUploading(false);
    }
  };

  const filteredKbs = kbs.filter(kb =>
    kb.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (kb.description || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header Area */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-900 pb-5">
        <div className="flex items-center gap-3.5">
          <Link href="/dashboard" className="p-2 rounded-xl bg-zinc-950 border border-zinc-900 text-zinc-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="w-10 h-10 rounded-xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center text-violet-400">
            <FolderOpen className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-extrabold text-white tracking-tight">KnowledgeBases</h1>
            <p className="text-xs text-zinc-500 font-mono mt-0.5">{kbs.length} documents uploaded</p>
          </div>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/25 hover:shadow-violet-600/35 transition-all self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Add Knowledge Base
        </button>
      </div>

      {/* Main Split Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Side: Document List */}
        <div className="space-y-4">
          <div className="relative">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-zinc-500">
              <Search className="w-4 h-4" />
            </div>
            <input
              type="text"
              placeholder="Search knowledgebases..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-10 pl-10 pr-4 rounded-xl bg-zinc-950/80 border border-zinc-800/80 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-violet-500/50"
            />
          </div>

          <div className="glass-panel rounded-2xl border border-zinc-800 divide-y divide-zinc-900/60 max-h-[500px] overflow-y-auto pr-1">
            {loading ? (
              <div className="p-12 text-center">
                <Loader2 className="w-6 h-6 animate-spin text-violet-500 mx-auto mb-2" />
                <span className="text-xs text-zinc-500 font-mono">Loading files...</span>
              </div>
            ) : filteredKbs.length === 0 ? (
              <p className="text-zinc-500 text-xs font-mono text-center py-12">No files found.</p>
            ) : (
              filteredKbs.map((kb) => (
                <button
                  key={kb.id}
                  onClick={() => setSelectedKb(kb)}
                  className={`w-full flex items-start gap-4 p-4 text-left transition-all relative ${
                    selectedKb?.id === kb.id
                      ? "bg-gradient-to-r from-violet-600/10 to-indigo-600/5 border-l-[3px] border-violet-500 text-white"
                      : "hover:bg-zinc-900/30 text-zinc-400"
                  }`}
                >
                  <FileText className="w-5 h-5 mt-0.5 text-violet-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <h4 className="font-bold text-xs text-zinc-200 truncate">{kb.name}</h4>
                    <span className="text-[9px] font-mono text-zinc-500 block mt-1">
                      {new Date(kb.created_at).toLocaleDateString()} at {new Date(kb.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right Side: Document Viewer Panel */}
        <div className="lg:col-span-2 space-y-4">
          {selectedKb ? (
            <div className="glass-panel rounded-2xl border border-zinc-800 flex flex-col h-[550px] overflow-hidden bg-zinc-950/40">
              {/* Card Header Panel */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-900 bg-zinc-950/80">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-rose-600/10 border border-rose-500/20 flex items-center justify-center text-rose-500">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-zinc-200">{selectedKb.name}</h3>
                    <p className="text-[9px] font-mono text-zinc-500 mt-0.5">
                      {new Date(selectedKb.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-semibold text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />
                    Completed
                  </span>
                  
                  {/* Action buttons */}
                  <a
                    href={selectedKb.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                    title="Download original file"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>

                  <button
                    onClick={() => handleDeleteKb(selectedKb.id)}
                    className="p-2 rounded-lg bg-zinc-900/40 hover:bg-rose-950/20 border border-transparent hover:border-rose-900/30 text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer"
                    title="Delete document"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* PDF Preview Content Body */}
              <div className="flex-1 p-6 overflow-y-auto bg-zinc-950/20">
                {selectedKb.file_url.endsWith(".pdf") || selectedKb.file_url.includes(".pdf") ? (
                  <iframe
                    src={`https://docs.google.com/viewer?url=${encodeURIComponent(selectedKb.file_url)}&embedded=true`}
                    className="w-full h-full border border-zinc-900 rounded-xl"
                    style={{ minHeight: "400px" }}
                  />
                ) : (
                  <div className="border border-zinc-900 rounded-xl p-5 bg-zinc-950/50 space-y-4">
                    <div className="flex items-center gap-2 text-zinc-300 font-bold text-xs pb-2 border-b border-zinc-900">
                      <span>Document Text Parser Context</span>
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed font-mono whitespace-pre-wrap">
                      {selectedKb.parsed_text || "No parsed context text extracted from this document."}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="glass-panel rounded-2xl border border-zinc-800 p-12 text-center flex flex-col items-center justify-center h-[550px] text-zinc-500 font-mono">
              <FolderOpen className="w-12 h-12 text-zinc-700 mb-4" />
              <p>No document selected</p>
              <p className="text-[10px] text-zinc-650 mt-1">Select a knowledge base file from the sidebar list to inspect.</p>
            </div>
          )}
        </div>
      </div>

      {/* ADD KNOWLEDGE BASE MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg glass-panel border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-900 bg-zinc-950/40">
              <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-violet-400" />
                Add Knowledge Base Document
              </h2>
              <button onClick={() => setIsAddModalOpen(false)} className="p-1 rounded-lg hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddKb} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Document Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sales Playbook"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Description</label>
                <textarea
                  rows={2}
                  placeholder="What is this document about..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="w-full p-3 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50 resize-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Document URL (PDF / Host)</label>
                <input
                  type="text"
                  placeholder="e.g. https://domain.com/playbook.pdf"
                  value={fileUrl}
                  onChange={(e) => setFileUrl(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Parsed Text / Raw Context</label>
                <textarea
                  rows={4}
                  placeholder="Paste context content or manual text guidelines here..."
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  className="w-full p-3 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-855 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || !newName.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {uploading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Document</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
