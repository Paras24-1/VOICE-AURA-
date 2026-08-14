"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Plus,
  Search,
  BookOpen,
  Trash2,
  Users,
  Upload,
  ArrowLeft,
  Loader2,
  X,
  FileText
} from "lucide-react";
import Link from "next/link";

interface Phonebook {
  id: string;
  name: string;
  description: string;
  created_at: string;
  total_contacts?: number;
}

interface Contact {
  id: string;
  name: string;
  phone_number: string;
  lead_type?: string;
  lead_source?: string;
  lead_temperature?: string;
  category?: string;
}

export default function PhonebooksPage() {
  const supabase = createClient();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [phonebooks, setPhonebooks] = useState<Phonebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  
  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isContactsModalOpen, setIsContactsModalOpen] = useState(false);
  const [selectedPhonebook, setSelectedPhonebook] = useState<Phonebook | null>(null);
  const [selectedContacts, setSelectedContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);

  // Manual Inline Contact addition state
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualCategory, setManualCategory] = useState("General Business");
  const [manualTemp, setManualTemp] = useState("Cold");
  const [manualSource, setManualSource] = useState("Manual");
  const [manualType, setManualType] = useState("Outbound");
  const [addingManual, setAddingManual] = useState(false);

  // New Phonebook Form State
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [csvContacts, setCsvContacts] = useState<{
    name: string;
    phone_number: string;
    lead_type?: string;
    lead_source?: string;
    lead_temperature?: string;
    category?: string;
  }[]>([]);
  const [csvFileName, setCsvFileName] = useState("");
  const [csvError, setCsvError] = useState("");
  const [creating, setCreating] = useState(false);

  // Drag and Drop state
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pagination state
  const [pageSize, setPageSize] = useState(5);
  const [currentPage, setCurrentPage] = useState(1);

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

  // Fetch phonebooks
  const fetchPhonebooks = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const { data: pbData, error } = await supabase
        .from("phonebooks")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Fetch contacts count for each phonebook
      const pbsWithCounts = await Promise.all(
        (pbData || []).map(async (pb) => {
          const { count } = await supabase
            .from("phonebook_contacts")
            .select("*", { count: "exact", head: true })
            .eq("phonebook_id", pb.id);

          return {
            ...pb,
            total_contacts: count || 0
          };
        })
      );

      setPhonebooks(pbsWithCounts);
    } catch (err) {
      console.error("Error fetching phonebooks:", err);
    } finally {
      setLoading(false);
    }
  }, [orgId, supabase]);

  useEffect(() => {
    fetchOrg();
  }, [fetchOrg]);

  useEffect(() => {
    if (orgId) {
      fetchPhonebooks();
    }
  }, [orgId, fetchPhonebooks]);

  // Delete Phonebook
  const handleDeletePhonebook = async (id: string) => {
    if (!confirm("Are you sure you want to delete this phonebook and all its contacts?")) return;
    try {
      const { error } = await supabase
        .from("phonebooks")
        .delete()
        .eq("id", id);
      if (error) throw error;
      fetchPhonebooks();
    } catch (err) {
      console.error("Error deleting phonebook:", err);
      alert("Failed to delete phonebook.");
    }
  };

  // Refresh Contacts List
  const refreshContacts = async (phonebookId: string) => {
    try {
      const { data, error } = await supabase
        .from("phonebook_contacts")
        .select("*")
        .eq("phonebook_id", phonebookId)
        .order("name", { ascending: true });
      if (error) throw error;
      setSelectedContacts(data || []);
    } catch (err) {
      console.error("Error refreshing contacts:", err);
    }
  };

  // View Contacts
  const handleViewContacts = async (pb: Phonebook) => {
    setSelectedPhonebook(pb);
    setIsContactsModalOpen(true);
    setContactsLoading(true);
    await refreshContacts(pb.id);
    setContactsLoading(false);
  };

  // Add Manual Contact
  const handleAddManualContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPhonebook || !manualName.trim() || !manualPhone.trim()) return;
    setAddingManual(true);
    try {
      const { error } = await supabase
        .from("phonebook_contacts")
        .insert({
          phonebook_id: selectedPhonebook.id,
          name: manualName.trim(),
          phone_number: manualPhone.replace(/[^\d+]/g, "").trim(),
          lead_type: manualType,
          lead_source: manualSource,
          lead_temperature: manualTemp,
          category: manualCategory
        });

      if (error) throw error;

      setManualName("");
      setManualPhone("");
      setManualCategory("General Business");
      setManualTemp("Cold");
      
      await refreshContacts(selectedPhonebook.id);
      fetchPhonebooks();
    } catch (err: any) {
      console.error("Error adding contact manually:", err);
      alert("Failed to add contact: " + err.message);
    } finally {
      setAddingManual(false);
    }
  };

  // CSV Parsing
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const parseCSVText = (text: string) => {
    setCsvError("");
    const lines = text.split(/\r?\n/);
    const parsed: {
      name: string;
      phone_number: string;
      lead_type?: string;
      lead_source?: string;
      lead_temperature?: string;
      category?: string;
    }[] = [];

    if (lines.length === 0 || (lines.length === 1 && !lines[0])) {
      setCsvError("The CSV file is empty.");
      setCsvContacts([]);
      return;
    }

    const headers = lines[0].toLowerCase().split(/[;,]/);
    const nameIdx = headers.findIndex(h => h.includes("name"));
    const phoneIdx = headers.findIndex(h => h.includes("phone") || h.includes("number") || h.includes("mobile") || h.includes("contact"));
    const typeIdx = headers.findIndex(h => h.includes("type"));
    const sourceIdx = headers.findIndex(h => h.includes("source"));
    const tempIdx = headers.findIndex(h => h.includes("temp") || h.includes("temperature"));
    const catIdx = headers.findIndex(h => h.includes("category") || h.includes("industry"));

    if (phoneIdx === -1) {
      setCsvError("Could not find a phone/number/contact column in CSV headers.");
      setCsvContacts([]);
      return;
    }

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = line.split(/[;,]/);
      if (cols.length <= phoneIdx) continue;

      const rawPhone = cols[phoneIdx].replace(/[^\d+]/g, "").trim();
      const name = nameIdx !== -1 && cols[nameIdx] ? cols[nameIdx].replace(/^"|"$/g, "").trim() : "Lead " + i;
      const leadType = typeIdx !== -1 && cols[typeIdx] ? cols[typeIdx].replace(/^"|"$/g, "").trim() : "Outbound";
      const leadSource = sourceIdx !== -1 && cols[sourceIdx] ? cols[sourceIdx].replace(/^"|"$/g, "").trim() : "Imported";
      const leadTemp = tempIdx !== -1 && cols[tempIdx] ? cols[tempIdx].replace(/^"|"$/g, "").trim() : "Cold";
      const category = catIdx !== -1 && cols[catIdx] ? cols[catIdx].replace(/^"|"$/g, "").trim() : "General Business";

      if (rawPhone.length >= 7) {
        parsed.push({
          name,
          phone_number: rawPhone,
          lead_type: leadType,
          lead_source: leadSource,
          lead_temperature: leadTemp,
          category: category
        });
      }
    }

    if (parsed.length === 0) {
      setCsvError("No valid phone numbers found in CSV list.");
    }
    setCsvContacts(parsed);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith(".csv")) {
        setCsvFileName(file.name);
        const reader = new FileReader();
        reader.onload = (evt) => {
          if (evt.target?.result) {
            parseCSVText(evt.target.result as string);
          }
        };
        reader.readAsText(file);
      } else {
        setCsvError("Only CSV files are supported.");
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.name.endsWith(".csv")) {
        setCsvFileName(file.name);
        const reader = new FileReader();
        reader.onload = (evt) => {
          if (evt.target?.result) {
            parseCSVText(evt.target.result as string);
          }
        };
        reader.readAsText(file);
      } else {
        setCsvError("Only CSV files are supported.");
      }
    }
  };

  // Submit Phonebook
  const handleCreatePhonebook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !newName.trim()) return;
    setCreating(true);

    try {
      const { data: newPb, error: pbErr } = await supabase
        .from("phonebooks")
        .insert({
          organization_id: orgId,
          name: newName.trim(),
          description: newDescription.trim()
        })
        .select()
        .single();

      if (pbErr) throw pbErr;

      // Bulk insert contacts
      if (csvContacts.length > 0) {
        const contactRows = csvContacts.map(c => ({
          phonebook_id: newPb.id,
          name: c.name,
          phone_number: c.phone_number,
          lead_type: c.lead_type || "Outbound",
          lead_source: c.lead_source || "Imported",
          lead_temperature: c.lead_temperature || "Cold",
          category: c.category || "General Business"
        }));

        const { error: contactsErr } = await supabase
          .from("phonebook_contacts")
          .insert(contactRows);

        if (contactsErr) throw contactsErr;
      }

      // Reset
      setIsCreateModalOpen(false);
      setNewName("");
      setNewDescription("");
      setCsvContacts([]);
      setCsvFileName("");
      setCsvError("");
      fetchPhonebooks();
    } catch (err) {
      console.error("Error creating phonebook:", err);
      alert("Failed to create phonebook.");
    } finally {
      setCreating(false);
    }
  };

  const filteredPhonebooks = phonebooks.filter(pb =>
    pb.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (pb.description || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Pagination Calculations
  const totalPages = Math.ceil(filteredPhonebooks.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedPhonebooks = filteredPhonebooks.slice(startIndex, startIndex + pageSize);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header Area */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-900 pb-5">
        <div className="flex items-center gap-3.5">
          <Link href="/dashboard" className="p-2 rounded-xl bg-zinc-950 border border-zinc-900 text-zinc-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="w-10 h-10 rounded-xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center text-violet-400">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-extrabold text-white tracking-tight">Phonebooks</h1>
            <p className="text-xs text-zinc-500 font-mono mt-0.5">{phonebooks.length} phonebooks</p>
          </div>
        </div>

        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/25 hover:shadow-violet-600/35 transition-all self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Create Phonebook
        </button>
      </div>

      {/* Search Filter Bar */}
      <div className="relative max-w-md w-full">
        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-zinc-500">
          <Search className="w-4 h-4" />
        </div>
        <input
          type="text"
          placeholder="Search phonebook..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setCurrentPage(1);
          }}
          className="w-full h-10 pl-10 pr-4 rounded-xl bg-zinc-950/80 border border-zinc-800/80 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-violet-500/50"
        />
      </div>

      {/* Main Grid View Table */}
      <div className="glass-panel rounded-2xl overflow-hidden border border-zinc-800">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-zinc-950/80 border-b border-zinc-900 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Description</th>
                <th className="px-6 py-4">Total Contact</th>
                <th className="px-6 py-4">Created At</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900/60 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-violet-500 mx-auto mb-2" />
                    <p className="text-zinc-500 font-mono text-xs">Loading phonebooks...</p>
                  </td>
                </tr>
              ) : paginatedPhonebooks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-zinc-500 font-mono">
                    No phonebooks found. Import or create your first phonebook list.
                  </td>
                </tr>
              ) : (
                paginatedPhonebooks.map((pb) => (
                  <tr key={pb.id} className="hover:bg-zinc-900/20 transition-colors">
                    <td className="px-6 py-4 font-bold text-zinc-200">{pb.name}</td>
                    <td className="px-6 py-4 text-zinc-400 max-w-xs truncate">{pb.description || "—"}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        pb.total_contacts ? "bg-violet-600/10 text-violet-400 border border-violet-500/20" : "bg-zinc-800 text-zinc-400"
                      }`}>
                        {pb.total_contacts || 0} Contacts
                      </span>
                    </td>
                    <td className="px-6 py-4 text-zinc-500">
                      {new Date(pb.created_at).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric"
                      })}, {new Date(pb.created_at).toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: true
                      })}
                    </td>
                    <td className="px-6 py-4 text-right space-x-1.5">
                      <button
                        onClick={() => handleViewContacts(pb)}
                        className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-violet-400 hover:text-violet-300 transition-colors cursor-pointer"
                      >
                        <Users className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeletePhonebook(pb.id)}
                        className="p-2 rounded-lg bg-zinc-900/40 hover:bg-rose-950/20 border border-transparent hover:border-rose-900/30 text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination & Show Entries */}
      {!loading && totalPages > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-6 text-xs text-zinc-500">
          <div className="flex items-center gap-2">
            <span>Show</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-zinc-300 focus:outline-none focus:border-violet-500"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
            </select>
            <span>per page</span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              Prev
            </button>
            {Array.from({ length: totalPages }).map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentPage(idx + 1)}
                className={`px-3 py-1.5 rounded-lg border font-semibold transition-all ${
                  currentPage === idx + 1
                    ? "bg-violet-600 border-violet-500 text-white shadow-md shadow-violet-600/25"
                    : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-white"
                }`}
              >
                {idx + 1}
              </button>
            ))}
            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* CREATE MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg glass-panel border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-900 bg-zinc-950/40">
              <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-violet-400" />
                Create New Phonebook
              </h2>
              <button onClick={() => setIsCreateModalOpen(false)} className="p-1 rounded-lg hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreatePhonebook} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Phonebook Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Meta old leads"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">Description</label>
                <textarea
                  rows={2}
                  placeholder="Optional details..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="w-full p-3 rounded-lg bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50 resize-none"
                />
              </div>

              {/* Drag and Drop CSV */}
              <div className="space-y-2">
                <label className="text-[10px] font-mono text-zinc-500 uppercase block tracking-wider font-bold">
                  Contacts List (CSV File)
                </label>
                <div
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border border-dashed rounded-xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center space-y-2 ${
                    dragActive
                      ? "border-violet-500 bg-violet-600/5"
                      : "border-zinc-850 bg-zinc-950/30 hover:border-zinc-700 hover:bg-zinc-950/50"
                  }`}
                >
                  <Upload className={`w-8 h-8 ${dragActive ? "text-violet-400 animate-bounce" : "text-zinc-600"}`} />
                  {csvFileName ? (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-zinc-200 flex items-center justify-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-violet-400" />
                        {csvFileName}
                      </p>
                      <p className="text-[10px] text-emerald-400 font-bold">{csvContacts.length} contacts parsed successfully.</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs font-semibold text-zinc-300">Drag and drop your CSV here, or click to upload</p>
                      <p className="text-[10px] text-zinc-500 mt-1">Accepts CSV with Name and Phone headers</p>
                    </div>
                  )}
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept=".csv"
                    className="hidden"
                  />
                </div>

                {csvError && <p className="text-[10px] text-rose-400 font-semibold">{csvError}</p>}
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-850 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !newName.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Phonebook</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW CONTACTS MODAL */}
      {isContactsModalOpen && selectedPhonebook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg glass-panel border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-900 bg-zinc-950/40">
              <div>
                <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                  <Users className="w-4 h-4 text-violet-400" />
                  {selectedPhonebook.name}
                </h2>
                <p className="text-[10px] text-zinc-500 mt-0.5">Contacts list breakdown</p>
              </div>
              <button onClick={() => setIsContactsModalOpen(false)} className="p-1 rounded-lg hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Inline Manual Add Contact Form */}
            <form onSubmit={handleAddManualContact} className="px-6 py-4 border-b border-zinc-900 bg-zinc-950/20 space-y-3">
              <h3 className="text-xs font-bold font-mono text-zinc-400 uppercase tracking-wider block">Add Manual Contact</h3>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Full Name"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-violet-500/50"
                />
                <input
                  type="text"
                  required
                  placeholder="Phone (e.g. +91XXXXXXXXXX)"
                  value={manualPhone}
                  onChange={(e) => setManualPhone(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-violet-500/50 font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Category (e.g. Garments)"
                  value={manualCategory}
                  onChange={(e) => setManualCategory(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-violet-500/50"
                />
                <select
                  value={manualTemp}
                  onChange={(e) => setManualTemp(e.target.value)}
                  className="w-full h-9 px-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-violet-500/50"
                >
                  <option value="Cold">Cold Lead</option>
                  <option value="Warm">Warm Lead</option>
                  <option value="Hot">Hot Lead</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={addingManual || !manualName.trim() || !manualPhone.trim()}
                className="w-full h-9 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                {addingManual && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Add Contact</span>
              </button>
            </form>

            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {contactsLoading ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-violet-500 mb-2" />
                  <span className="text-xs text-zinc-500 font-mono">Loading contacts list...</span>
                </div>
              ) : selectedContacts.length === 0 ? (
                <p className="text-zinc-500 text-xs italic text-center py-12">This phonebook contains no contacts.</p>
              ) : (
                <div className="border border-zinc-900 rounded-xl overflow-hidden divide-y divide-zinc-950">
                  {selectedContacts.map((c) => (
                    <div key={c.id} className="flex items-center justify-between p-3.5 bg-zinc-950/40 text-xs hover:bg-zinc-900/10 transition-colors">
                      <span className="font-semibold text-zinc-200">{c.name}</span>
                      <span className="font-mono text-zinc-400">{c.phone_number}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
