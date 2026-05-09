import { useCallback, useState } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { ServerCard } from "@/components/shared/ServerCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageLoading } from "@/components/shared/PageLoading";
import { useServers } from "@/hooks/useServers";
import { useConfigImport } from "@/hooks/useConfigImport";
import { AlertTriangle, FileJson, GripVertical, Plus, RefreshCw, ScanSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { AddServerForm } from "./servers/AddServerForm";
import { ConfigImportPanel } from "./servers/ConfigImportPanel";
import { getReorderedServers, getServerIds } from "./servers/server-order";
import type { Server } from "@moor/types";

type ServerActionMap = ReturnType<typeof useServers>["serverActions"];

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unable to save server order";
}

function SortableServerCard({
  server,
  action,
  onStart,
  onStop,
  onRemove,
}: {
  server: Server;
  action: ServerActionMap[string];
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: server.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && "relative")}>
      <ServerCard
        server={server}
        action={action}
        isSorting={isDragging}
        dragHandle={
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 cursor-grab text-[var(--fg-30)] hover:text-cursor-dark active:cursor-grabbing"
            title={`Reorder ${server.name}`}
            aria-label={`Reorder ${server.name}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </Button>
        }
        onStart={onStart}
        onStop={onStop}
        onRemove={onRemove}
      />
    </div>
  );
}

export function Servers() {
  const {
    servers,
    loading,
    startServer,
    stopServer,
    removeServer,
    reorderServers,
    addServer,
    refresh,
    serverActions,
  } = useServers();
  const [showAdd, setShowAdd] = useState(false);
  const [showJsonImport, setShowJsonImport] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const importState = useConfigImport();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleAdd = useCallback(
    async (config: Parameters<typeof addServer>[0]) => {
      await addServer(config);
      refresh();
    },
    [addServer, refresh],
  );

  const handleScan = useCallback(() => {
    void importState.scan();
  }, [importState]);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const nextServers = getReorderedServers(
        servers,
        String(event.active.id),
        event.over?.id ? String(event.over.id) : null,
      );
      if (nextServers === servers) return;

      setOrderError(null);
      try {
        await reorderServers(nextServers);
      } catch (err) {
        setOrderError(getErrorMessage(err));
      }
    },
    [reorderServers, servers],
  );

  return (
    <div className="space-y-6 animate-fade-in-up">
      <PageHeader
        title="Servers"
        subtitle="Manage and configure your MCP servers"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} /> Refresh
            </Button>
            <Button variant="outline" onClick={() => setShowJsonImport(true)}>
              <FileJson className="h-4 w-4 mr-2" /> Import JSON
            </Button>
            <Button variant="outline" onClick={handleScan}>
              <ScanSearch className="h-4 w-4 mr-2" /> Scan Configs
            </Button>
            <Button onClick={() => setShowAdd(true)}>
              <Plus className="h-4 w-4 mr-2" /> Add Server
            </Button>
          </div>
        }
      />

      {/* Import Panels */}
      <ConfigImportPanel
        state={importState}
        showJsonImport={showJsonImport}
        onCloseJsonImport={() => setShowJsonImport(false)}
        onImportComplete={refresh}
      />

      {/* Add Server Form */}
      {showAdd && <AddServerForm onAdd={handleAdd} onClose={() => setShowAdd(false)} />}

      {orderError && (
        <div className="flex items-center gap-2 rounded-lg border border-error-warm/20 bg-error-warm/8 px-3 py-2 animate-fade-in">
          <AlertTriangle className="h-4 w-4 shrink-0 text-error-warm" />
          <p className="font-body text-xs text-error-warm">{orderError}</p>
        </div>
      )}

      {/* Server List */}
      <div className="space-y-2">
        {loading ? (
          <PageLoading message="Loading servers..." />
        ) : servers.length === 0 ? (
          <button
            onClick={() => setShowAdd(true)}
            className={cn(
              "w-full py-10 rounded-xl border-2 border-dashed border-[var(--fg-12)]",
              "text-[var(--fg-40)] hover:text-cursor-orange hover:border-cursor-orange/30 hover:bg-cursor-orange/[0.02]",
              "transition-all duration-200 flex flex-col items-center justify-center gap-3 cursor-pointer",
            )}
          >
            <div className="h-12 w-12 rounded-full bg-surface-300 flex items-center justify-center">
              <Plus className="h-5 w-5" />
            </div>
            <div className="text-center">
              <p className="font-headline text-sm font-medium">Add Your First Server</p>
              <p className="font-body text-xs text-[var(--fg-40)] mt-1">
                Or scan existing configs to import
              </p>
            </div>
          </button>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event) => void handleDragEnd(event)}
          >
            <SortableContext items={getServerIds(servers)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {servers.map((server) => (
                  <SortableServerCard
                    key={server.id}
                    server={server}
                    action={serverActions[server.id]}
                    onStart={startServer}
                    onStop={stopServer}
                    onRemove={removeServer}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}
