import { useCallback, useMemo, useState } from "react";
import { apiPost } from "@/lib/api";
import { formatJsonImport, getJsonImportDiagnostics } from "@/lib/json-import-editor";
import type { ScannedServer, ImportPreview as ImportPreviewType } from "@moor/types";

type ImportPreview = ImportPreviewType;

export function useConfigImport() {
  const [scanCandidates, setScanCandidates] = useState<ScannedServer[]>([]);
  const [selectedImports, setSelectedImports] = useState<Set<string>>(new Set());
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);

  const [jsonImport, setJsonImport] = useState("");
  const [jsonImportErrors, setJsonImportErrors] = useState<string[]>([]);
  const [jsonImportStatus, setJsonImportStatus] = useState<string | null>(null);
  const jsonImportDiagnostics = useMemo(() => getJsonImportDiagnostics(jsonImport), [jsonImport]);

  const applyImportPreview = useCallback((result: ImportPreview) => {
    setImportPreview(result);
    setScanCandidates(result.servers);
    setSelectedImports(new Set(result.servers.map((server) => server.name)));
    setScanStatus(
      result.newServers === 0 ? `Scanned ${result.scanned} configs. No new servers found.` : null,
    );
  }, []);

  const scan = useCallback(async () => {
    try {
      const result = await apiPost<ImportPreview>("/api/import/scan", {});
      applyImportPreview(result);
    } catch (err) {
      setScanStatus((err as Error).message);
    }
  }, [applyImportPreview]);

  const updateJsonImport = useCallback((value: string) => {
    setJsonImport(value);
    setJsonImportErrors([]);
    setJsonImportStatus(null);
  }, []);

  const formatJson = useCallback(() => {
    const result = formatJsonImport(jsonImport);
    setJsonImportErrors([]);

    if (result.diagnostics.length > 0) {
      setJsonImportStatus("Fix JSON syntax errors before formatting.");
      return;
    }

    setJsonImport(result.value);
    setJsonImportStatus(result.formatted ? "JSON formatted." : "JSON is already formatted.");
  }, [jsonImport]);

  const parseJson = useCallback(async () => {
    if (jsonImportDiagnostics.length > 0) {
      setJsonImportErrors([]);
      setJsonImportStatus("Fix JSON syntax errors before previewing.");
      return;
    }

    try {
      const result = await apiPost<ImportPreview>("/api/import/parse", { content: jsonImport });
      if (result.errors.length > 0 || (result.diagnostics?.length ?? 0) > 0) {
        setImportPreview(result);
        setScanCandidates([]);
        setSelectedImports(new Set());
        setJsonImportErrors(result.errors);
        setJsonImportStatus(null);
        return;
      }

      applyImportPreview(result);
      setJsonImportErrors([]);
      setJsonImportStatus(null);
      return true;
    } catch (err) {
      setJsonImportErrors([(err as Error).message]);
      setJsonImportStatus(null);
      return false;
    }
  }, [jsonImport, jsonImportDiagnostics, applyImportPreview]);

  const executeImport = useCallback(
    async (onComplete: () => void) => {
      const serversToImport = scanCandidates.filter((server) => selectedImports.has(server.name));
      const result = await apiPost<{ imported: string[]; skipped: string[] }>(
        "/api/import/execute",
        {
          servers: serversToImport,
        },
      );
      setScanStatus(
        `Imported ${result.imported.length} servers. Skipped ${result.skipped.length}.`,
      );
      setScanCandidates([]);
      setSelectedImports(new Set());
      setImportPreview(null);
      onComplete();
    },
    [scanCandidates, selectedImports],
  );

  const toggleImport = useCallback((name: string, checked: boolean) => {
    setSelectedImports((prev) => {
      const next = new Set(prev);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  }, []);

  const clearScan = useCallback(() => {
    setScanCandidates([]);
    setScanStatus(null);
    setImportPreview(null);
  }, []);

  const clearJsonImport = useCallback(() => {
    setJsonImport("");
    setJsonImportErrors([]);
    setJsonImportStatus(null);
  }, []);

  const hasStaticAuthorizationHeader = scanCandidates.some((server) => {
    const authorization = Object.entries(server.headers ?? {}).find(
      ([key]) => key.toLowerCase() === "authorization",
    )?.[1];
    return Boolean(authorization && !authorization.includes("{env:"));
  });

  return {
    scanCandidates,
    selectedImports,
    scanStatus,
    importPreview,
    hasStaticAuthorizationHeader,
    jsonImport,
    jsonImportErrors,
    jsonImportStatus,
    jsonImportDiagnostics,
    jsonImportStatusIsError: jsonImportStatus?.startsWith("Fix ") ?? false,
    scan,
    updateJsonImport,
    formatJson,
    parseJson,
    executeImport,
    toggleImport,
    clearScan,
    clearJsonImport,
  };
}
